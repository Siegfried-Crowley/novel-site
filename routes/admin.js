'use strict';

/**
 * 管理端 API：上传 TXT、增改删书籍与章节、重新切分、自动排版
 *
 * 口令策略：
 *  - 设置了 ADMIN_PASSWORD：所有管理接口需要登录（timingSafeEqual 恒时比较 + 失败限流）
 *  - 未设置：管理端仅限本机（127.0.0.1）访问，公网请求一律 403，防止裸奔上公网
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db, stmts, now, UPLOAD_DIR } = require('../db');
const config = require('../config');
const { parseTxtFileAsync, bookFormatAsync } = require('../lib/tasks');
const { reflowChapter } = require('../lib/format');
const { CATEGORIES } = require('../lib/categories');
const { parseCookies } = require('../lib/middleware');

const router = express.Router();
router.use(parseCookies);

// ---------------- 口令 / 会话 ----------------

const adminEnabled = !!config.adminPassword;
const NO_PASSWORD_MSG = '未设置管理口令时，管理端仅限本机访问；请在服务器上设置 ADMIN_PASSWORD 后重启服务';
const SESSION_TTL = 7 * 24 * 3600 * 1000;

const sessions = new Map(); // token -> 过期时间戳（内存会话，重启即失效）
setInterval(() => {
  const nowMs = Date.now();
  for (const [t, exp] of sessions) if (exp < nowMs) sessions.delete(t);
}, 10 * 60 * 1000).unref();

/** 登录失败限流：同一 IP 每分钟最多 5 次错误口令 */
const loginFails = new Map(); // ip -> { count, resetAt }
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_MS = 60 * 1000;

function loginAllowed(ip) {
  const rec = loginFails.get(ip);
  if (!rec || rec.resetAt < Date.now()) return true;
  return rec.count < LOGIN_MAX_FAILS;
}

function recordLoginFail(ip) {
  const rec = loginFails.get(ip);
  const nowMs = Date.now();
  if (!rec || rec.resetAt < nowMs) loginFails.set(ip, { count: 1, resetAt: nowMs + LOGIN_WINDOW_MS });
  else rec.count++;
  if (loginFails.size > 10000) loginFails.clear();
}

/** 恒时字符串比较，抹平逐字符比较的计时侧信道 */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab); // 长度不等也要跑一次等长比较，避免泄露长度信息
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function isLocal(req) {
  const ip = req.ip || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function tokenFrom(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || (req.cookies && req.cookies.atoken) || '';
}

function checkToken(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}

function requireAdmin(req, res, next) {
  if (!adminEnabled) {
    if (isLocal(req)) return next();
    return res.status(403).json({ error: NO_PASSWORD_MSG });
  }
  if (checkToken(tokenFrom(req))) return next();
  return res.status(401).json({ error: '需要管理口令' });
}

router.post('/api/admin/login', (req, res) => {
  if (!adminEnabled) {
    if (!isLocal(req)) return res.status(403).json({ error: NO_PASSWORD_MSG });
    return res.json({ ok: true, open: true, message: '未设置口令，本机可直接使用管理端' });
  }
  const ip = req.ip || '';
  if (!loginAllowed(ip)) return res.status(429).json({ error: '尝试次数过多，请 1 分钟后再试' });
  const { password } = req.body || {};
  if (!password || !safeEqual(password, config.adminPassword)) {
    recordLoginFail(ip);
    return res.status(401).json({ error: '口令错误' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  res.cookie('atoken', token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: SESSION_TTL, path: '/' });
  res.json({ ok: true, token });
});

router.get('/api/admin/session', (req, res) => {
  if (!adminEnabled) {
    if (!isLocal(req)) return res.status(403).json({ error: NO_PASSWORD_MSG });
    return res.json({ ok: true, open: true });
  }
  res.json({ ok: checkToken(tokenFrom(req)) });
});

// ---------------- 上传 ----------------

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.txt';
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (/\.txt$/i.test(file.originalname)) cb(null, true);
    else cb(Object.assign(new Error('只支持 .txt 文件'), { status: 400 }));
  },
  limits: { fileSize: 200 * 1024 * 1024 }, // 单文件上限 200MB（防止超大文件拖垮服务器）
  defParamCharset: 'utf8', // 中文文件名按 UTF-8 解码，否则会被 latin1 解成乱码
});

/** 文件名兜底修正：个别场景 multer 仍可能按 latin1 解出乱码，检测并转回 UTF-8 */
function normalizeOriginalName(name) {
  if (typeof name !== 'string') return name;
  const fixed = Buffer.from(name, 'latin1').toString('utf8');
  // 转回后是合法文本且不是原样，说明原始字节是 UTF-8 只是被按 latin1 读了
  if (fixed !== name && !fixed.includes('�')) return fixed;
  return name;
}

/** 取书或 404（各路由共用）；未命中时已发送响应，调用方拿到 null 直接 return */
function getBook(req, res) {
  const book = stmts.novelById.get(Number(req.params.id));
  if (!book) { res.status(404).json({ error: '书籍不存在' }); return null; }
  return book;
}

/** 删除书籍的自定义封面文件（auto-*.svg 是动态生成的，没有实体文件） */
function deleteCustomCover(book) {
  if (book && book.cover && book.cover.startsWith('/covers/') && !/\/auto-\d+\.svg$/.test(book.cover)) {
    try { fs.unlinkSync(path.join(__dirname, '..', 'public', book.cover)); } catch (e) { /* ignore */ }
  }
}

/** 校验自定义章节正则：长度上限 + 语法可编译；灾难性回溯由 worker 超时兜底 */
function sanitizeChapterRegex(input) {
  if (input === undefined || input === null || input === '') return undefined;
  const s = String(input);
  if (s.length > 200) throw Object.assign(new Error('正则过长（上限 200 字符）'), { status: 400 });
  try { new RegExp(s); } catch (e) {
    throw Object.assign(new Error(`正则语法错误：${e.message}`), { status: 400 });
  }
  return s;
}

/** 保存一本书及其章节；同名则覆盖更新（保留原 id、阅读量、收藏数）。写库整体在一个事务内。 */
function saveBook(parsed, sourceFilePath) {
  const existing = db.prepare('SELECT * FROM novels WHERE title = ?').get(parsed.title);
  const overwritten = !!existing;
  let novelId;
  const ts = now();

  const insert = db.prepare('INSERT INTO chapters (novel_id, title, content, chars, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    if (existing) {
      db.prepare('UPDATE novels SET author = ?, word_count = ?, source_file = ?, updated_at = ? WHERE id = ?')
        .run(parsed.author, parsed.word_count, sourceFilePath, ts, existing.id);
      stmts.deleteChaptersByNovel.run(existing.id);
      novelId = existing.id;
    } else {
      const info = stmts.insertNovel.run({
        title: parsed.title,
        author: parsed.author,
        category: '未分类',
        description: '',
        cover: '',
        status: 'serial',
        word_count: parsed.word_count,
        source_file: sourceFilePath,
        created_at: ts,
        updated_at: ts,
      });
      novelId = Number(info.lastInsertRowid);
      db.prepare("UPDATE novels SET cover = '/covers/auto-' || id || '.svg' WHERE id = ?").run(novelId);
    }
    parsed.chapters.forEach((ch, i) => {
      insert.run(novelId, ch.title || `第 ${i + 1} 章`, ch.content, ch.content.length, i, ts);
    });
  });
  tx();

  // 覆盖成功后清理被覆盖书籍的旧源文件（source_file 已指向新文件），避免 uploads 目录无限膨胀
  if (overwritten && existing.source_file && existing.source_file !== sourceFilePath && fs.existsSync(existing.source_file)) {
    try { fs.unlinkSync(existing.source_file); } catch (e) { /* ignore */ }
  }

  return { novel: stmts.novelById.get(novelId), overwritten, parsed };
}

router.post('/api/admin/upload', requireAdmin, upload.array('files', 20), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '未收到文件' });
    }
    const results = [];
    for (const f of req.files) {
      try {
        // 编码识别 + 切分 + 排版检测在工作线程执行，不阻塞前台读者请求
        const { parsed, format } = await parseTxtFileAsync(f.path, normalizeOriginalName(f.originalname));
        const { novel, overwritten } = saveBook(parsed, f.path);
        results.push({
          id: novel.id,
          title: novel.title,
          author: novel.author,
          word_count: novel.word_count,
          chapter_count: parsed.chapters.length,
          overwritten,
          format,
          preview: parsed.chapters.slice(0, 5).map(c => ({ title: c.title, first_line: (c.content.split('\n')[0] || '').slice(0, 40) })),
        });
      } catch (e) {
        // 解析失败：清掉已落盘的源文件，避免 uploads 目录堆积无用文件
        try { fs.unlinkSync(f.path); } catch (_) { /* ignore */ }
        results.push({ error: `${f.originalname}: ${e.message}`, title: f.originalname });
      }
    }
    res.json({ results });
  } catch (e) { next(e); }
});

// ---------------- 书籍信息 ----------------

router.post('/api/admin/books', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: '书名不能为空' });
  const ts = now();
  const info = stmts.insertNovel.run({
    title: String(b.title).trim(),
    author: String(b.author || '').trim(),
    category: CATEGORIES.includes(b.category) ? b.category : '未分类',
    description: String(b.description || ''),
    cover: '',
    status: b.status === 'finished' ? 'finished' : 'serial',
    word_count: parseInt(b.word_count, 10) || 0,
    source_file: '',
    created_at: ts,
    updated_at: ts,
  });
  const novelId = Number(info.lastInsertRowid);
  db.prepare("UPDATE novels SET cover = '/covers/auto-' || id || '.svg' WHERE id = ?").run(novelId);
  res.json({ ok: true, book: stmts.novelById.get(novelId) });
});

router.post('/api/admin/books/:id', requireAdmin, (req, res) => {
  const book = getBook(req, res);
  if (!book) return;
  const b = req.body || {};
  const title = b.title !== undefined ? String(b.title).trim() : book.title;
  if (!title) return res.status(400).json({ error: '书名不能为空' });

  // 书名与其它书重复时报错（避免冲突）
  const dup = db.prepare('SELECT id FROM novels WHERE title = ? AND id != ?').get(title, book.id);
  if (dup) return res.status(400).json({ error: `已有同名书籍「${title}」，改名或先删除旧的` });

  db.prepare(`UPDATE novels SET
      title=@title, author=@author, category=@category, description=@description,
      status=@status, updated_at=@updated_at
    WHERE id=@id`).run({
    id: book.id,
    title,
    author: b.author !== undefined ? String(b.author).trim() : book.author,
    category: b.category !== undefined ? (CATEGORIES.includes(b.category) ? b.category : '未分类') : book.category,
    description: b.description !== undefined ? String(b.description) : book.description,
    status: b.status !== undefined ? (b.status === 'finished' ? 'finished' : 'serial') : book.status,
    updated_at: now(),
  });
  res.json({ ok: true, book: stmts.novelById.get(book.id) });
});

router.delete('/api/admin/books/:id', requireAdmin, (req, res) => {
  const book = getBook(req, res);
  if (!book) return;
  deleteCustomCover(book);
  stmts.deleteNovel.run(book.id);
  res.json({ ok: true });
});

// ---------------- 封面 ----------------

const coverUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'covers')),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      cb(null, `custom-${req.params.id || 'x'}-${Date.now()}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error('仅支持图片文件'), { status: 400 }));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post('/api/admin/books/:id/cover', requireAdmin, coverUpload.single('cover'), (req, res) => {
  const book = getBook(req, res);
  if (!book) { try { fs.unlinkSync(req.file.path); } catch (e) {} return; }
  if (!req.file) return res.status(400).json({ error: '未收到图片' });
  deleteCustomCover(book);
  const coverPath = `/covers/${req.file.filename}`;
  db.prepare('UPDATE novels SET cover = ?, updated_at = ? WHERE id = ?').run(coverPath, now(), book.id);
  res.json({ ok: true, cover: coverPath });
});

router.delete('/api/admin/books/:id/cover', requireAdmin, (req, res) => {
  const book = getBook(req, res);
  if (!book) return;
  deleteCustomCover(book);
  const autoCover = `/covers/auto-${book.id}.svg`;
  db.prepare('UPDATE novels SET cover = ?, updated_at = ? WHERE id = ?').run(autoCover, now(), book.id);
  res.json({ ok: true, cover: autoCover });
});

// ---------------- 评论管理 ----------------

router.get('/api/admin/comments', requireAdmin, (req, res) => {
  const novelId = Number(req.query.novel_id) || 0;
  const limit = Math.min(200, Number(req.query.limit) || 50);
  let rows;
  if (novelId) {
    rows = db.prepare(`
      SELECT c.id, c.novel_id, n.title AS novel_title, c.author, c.content, c.created_at
      FROM comments c JOIN novels n ON n.id = c.novel_id
      WHERE c.novel_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).all(novelId, limit);
  } else {
    rows = db.prepare(`
      SELECT c.id, c.novel_id, n.title AS novel_title, c.author, c.content, c.created_at
      FROM comments c JOIN novels n ON n.id = c.novel_id
      ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).all(limit);
  }
  res.json(rows);
});

router.delete('/api/admin/comments/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM comments WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: '评论不存在' });
  res.json({ ok: true });
});

// ---------------- 章节管理 ----------------

router.post('/api/admin/books/:id/chapters', requireAdmin, (req, res) => {
  const book = getBook(req, res);
  if (!book) return;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM chapters WHERE novel_id = ?').get(book.id).m;
  const content = String((req.body && req.body.content) || '');
  const info = stmts.insertChapter.run(
    book.id,
    String((req.body && req.body.title) || `第 ${maxOrder + 2} 章`),
    content,
    content.length,
    maxOrder + 1,
    now()
  );
  db.prepare('UPDATE novels SET updated_at = ? WHERE id = ?').run(now(), book.id);
  res.json({ ok: true, chapter: db.prepare('SELECT * FROM chapters WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/api/admin/chapters/:id', requireAdmin, (req, res) => {
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(Number(req.params.id));
  if (!chapter) return res.status(404).json({ error: '章节不存在' });
  const b = req.body || {};
  const title = b.title !== undefined ? String(b.title) : chapter.title;
  const content = b.content !== undefined ? String(b.content) : chapter.content;
  db.prepare('UPDATE chapters SET title = ?, content = ?, chars = ? WHERE id = ?')
    .run(title, content, content.length, chapter.id);
  db.prepare('UPDATE novels SET updated_at = ? WHERE id = ?').run(now(), chapter.novel_id);
  res.json({ ok: true });
});

router.delete('/api/admin/chapters/:id', requireAdmin, (req, res) => {
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(Number(req.params.id));
  if (!chapter) return res.status(404).json({ error: '章节不存在' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM chapters WHERE id = ?').run(chapter.id);
    // 后续章节整体前移一位（此前逐行 UPDATE，大书删一章要跑几千条语句）
    db.prepare('UPDATE chapters SET order_index = order_index - 1 WHERE novel_id = ? AND order_index > ?')
      .run(chapter.novel_id, chapter.order_index);
    db.prepare('UPDATE novels SET updated_at = ? WHERE id = ?').run(now(), chapter.novel_id);
  });
  tx();
  res.json({ ok: true });
});

/** 调整章节顺序：body = { order: [chapterId, ...] } */
router.post('/api/admin/books/:id/reorder', requireAdmin, (req, res) => {
  const book = getBook(req, res);
  if (!book) return;
  const order = (req.body && req.body.order) || [];
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order 必须为数组' });
  const tx = db.transaction(() => order.forEach((id, i) => db.prepare('UPDATE chapters SET order_index = ? WHERE id = ? AND novel_id = ?').run(i, Number(id), book.id)));
  tx();
  db.prepare('UPDATE novels SET updated_at = ? WHERE id = ?').run(now(), book.id);
  res.json({ ok: true });
});

// ---------------- 重新切分 ----------------

router.post('/api/admin/books/:id/reparse', requireAdmin, async (req, res, next) => {
  try {
    const book = getBook(req, res);
    if (!book) return;
    if (!book.source_file || !fs.existsSync(book.source_file)) {
      return res.status(400).json({ error: '找不到原始 TXT 源文件，无法重新切分' });
    }
    let customRegex;
    try {
      customRegex = sanitizeChapterRegex(req.body && req.body.regex);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }

    // 解析在工作线程执行（含恶意正则的超时兜底），不阻塞前台
    const { parsed, format } = await parseTxtFileAsync(book.source_file, path.basename(book.source_file), customRegex);

    const ts = now();
    const insert = db.prepare('INSERT INTO chapters (novel_id, title, content, chars, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const tx = db.transaction(() => {
      stmts.deleteChaptersByNovel.run(book.id);
      parsed.chapters.forEach((ch, i) => insert.run(book.id, ch.title || `第 ${i + 1} 章`, ch.content, ch.content.length, i, ts));
    });
    tx();
    db.prepare('UPDATE novels SET word_count = ?, updated_at = ?, author = ? WHERE id = ?')
      .run(parsed.word_count, now(), parsed.author || book.author, book.id);

    res.json({
      ok: true,
      chapter_count: parsed.chapters.length,
      author: parsed.author,
      word_count: parsed.word_count,
      format,
      preview: parsed.chapters.slice(0, 5).map(c => ({ title: c.title, first_line: (c.content.split('\n')[0] || '').slice(0, 40) })),
    });
  } catch (e) { next(e); }
});

// ---------------- 自动排版（硬折行重排） ----------------

/**
 * 整书排版：默认 dry-run 返回检测汇总 + 前 3 个硬折行章节的 before/after 预览；
 * body { apply: true } 时在事务内重排并覆盖全书章节（只重新分段，不增删文字）。
 * 检测与重排在 worker 线程执行，避免大书阻塞前台。
 */
router.post('/api/admin/books/:id/format', requireAdmin, async (req, res, next) => {
  try {
    const book = getBook(req, res);
    if (!book) return;
    const apply = !!(req.body && req.body.apply);
    const result = await bookFormatAsync(book.id, { apply });
    res.json({ ok: true, applied: apply, ...result });
  } catch (e) { next(e); }
});

/**
 * 单章重排预览（不写库）：返回重排前后内容，编辑页用它替换文本框，由管理员手动保存。
 * 超长章节截断返回，防止响应体过大；截断时前端不替换正文。
 */
const REFLOW_PREVIEW_LIMIT = 20000;

router.post('/api/admin/chapters/:id/reflow', requireAdmin, (req, res) => {
  const chapter = db.prepare('SELECT id, title, content FROM chapters WHERE id = ?').get(Number(req.params.id));
  if (!chapter) return res.status(404).json({ error: '章节不存在' });
  const r = reflowChapter(chapter.content);
  const truncated = chapter.content.length > REFLOW_PREVIEW_LIMIT || r.content.length > REFLOW_PREVIEW_LIMIT;
  res.json({
    ok: true,
    changed: r.changed && !truncated,
    truncated,
    verdict: r.verdict,
    stats: r.stats,
    before: chapter.content.slice(0, REFLOW_PREVIEW_LIMIT),
    after: r.content.slice(0, REFLOW_PREVIEW_LIMIT),
  });
});

module.exports = { router };
