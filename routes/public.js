'use strict';

/**
 * 前台只读 API + 匿名收藏/阅读计数 + 自动封面
 * 无需鉴权。
 */
const express = require('express');
const crypto = require('crypto');
const { db, stmts, now } = require('../db');
const { parseCookies } = require('../lib/middleware');
const { CATEGORIES } = require('../lib/categories');
const { generateCover } = require('../lib/cover');

const router = express.Router();
router.use(parseCookies);

// ---------------- 工具 ----------------

/** 匿名收藏 cookie 名 */
const FAV_COOKIE = 'nid';

function getOrSetAnonId(req, res) {
  if (req.cookies[FAV_COOKIE]) return req.cookies[FAV_COOKIE];
  const id = crypto.randomBytes(16).toString('hex');
  res.cookie(FAV_COOKIE, id, { httpOnly: false, maxAge: 365 * 24 * 3600 * 1000, path: '/' });
  return id;
}

/** 转义 LIKE 通配符，防止用户输入 % / _ 被当通配符 */
function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, '\\$&');
}

/** 阅读量防刷：同一 IP + 章节 30 秒内只 +1（内存时间窗） */
const readWindow = new Map(); // `${ip}:${chapterId}` -> timestamp
const READ_WINDOW_MS = 30 * 1000;

function maybeCountRead(ip, chapterId) {
  const key = `${ip}:${chapterId}`;
  const last = readWindow.get(key) || 0;
  const nowMs = Date.now();
  if (nowMs - last < READ_WINDOW_MS) return false;
  if (readWindow.size > 50000) readWindow.clear(); // 防止无限增长
  readWindow.set(key, nowMs);
  return true;
}

/** 把章节里的正文安全导出（保持纯文本） */
function publicChapter(row, book) {
  if (!row) return null;
  return {
    id: row.id,
    novel_id: row.novel_id,
    title: row.title,
    content: row.content,
    order_index: row.order_index,
    // 供阅读页跳转
    novel_title: book ? book.title : undefined,
  };
}

// ---------------- 封面（自动生成） ----------------

router.get('/covers/auto-:id.svg', (req, res) => {
  const book = stmts.novelById.get(Number(req.params.id));
  // SVG 由书名确定性生成，缓存一天；改书名后封面最迟一天内自动刷新
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('image/svg+xml').send(generateCover(book ? book.title : '未知书籍'));
});

// ---------------- 列表 ----------------

const SORT_MAP = {
  updated: 'updated_at DESC',
  created: 'created_at DESC',          // 最新入库
  views: 'views DESC, updated_at DESC',
  favorites: 'favorites DESC, updated_at DESC',
  word_count: 'word_count DESC, updated_at DESC',
};

router.get('/api/categories', (req, res) => {
  res.json(CATEGORIES);
});

/** 热门搜索词（近 30 天搜索量 Top） */
router.get('/api/search/hot', (req, res) => {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT q, COUNT(*) AS c FROM search_logs
    WHERE created_at >= ? AND length(q) <= 20
    GROUP BY q ORDER BY c DESC LIMIT 10`).all(cutoff);
  res.json(rows.map(r => r.q));
});

router.get('/api/books', (req, res) => {
  // 批量按 id 取书（我的收藏 / 最近在读用），与列表共用响应结构
  if (req.query.ids !== undefined) {
    const ids = String(req.query.ids).split(',')
      .map(s => Number.parseInt(s, 10))
      .filter(Number.isInteger)
      .slice(0, 50);
    const rows = ids.length
      ? db.prepare(`SELECT * FROM novels WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
      : [];
    return res.json({ items: rows, total: rows.length, page: 1, pageSize: rows.length, hasMore: false });
  }

  const { cat = '', q = '', sort = 'updated' } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 12));
  const limit = req.query.limit ? Math.min(50, parseInt(req.query.limit, 10) || 0) : 0;

  const where = [];
  const params = {};
  if (cat) {
    where.push('category = @cat');
    params.cat = cat;
  }
  if (q) {
    where.push("(title LIKE @q ESCAPE '\\' OR author LIKE @q ESCAPE '\\')");
    params.q = `%${escapeLike(q)}%`;
    // 记录搜索日志（热门搜索用），只记有效关键词；
    // 1% 概率顺带清理 90 天前旧记录，防止表无限膨胀
    const kw = q.trim();
    if (kw) {
      db.prepare('INSERT INTO search_logs (q, created_at) VALUES (?, ?)').run(kw, now());
      if (Math.random() < 0.01) {
        db.prepare('DELETE FROM search_logs WHERE created_at < ?')
          .run(new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString());
      }
    }
  }
  if (req.query.status) {
    // 兼容旧链接里的 'ongoing'——库中存储值为 serial
    const status = req.query.status === 'ongoing' ? 'serial' : String(req.query.status);
    where.push('status = @status');
    params.status = status;
  }
  if (req.query.minWords !== undefined && req.query.minWords !== '') {
    const minWords = Number.parseInt(req.query.minWords, 10);
    if (Number.isNaN(minWords) || minWords < 0) {
      return res.status(400).json({ error: 'minWords 参数无效' });
    }
    where.push('word_count >= @minWords');
    params.minWords = minWords;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderBy = SORT_MAP[sort] || SORT_MAP.updated;

  const total = db.prepare(`SELECT COUNT(*) AS c FROM novels ${whereSql}`).get(params).c;

  let rows;
  if (limit > 0) {
    rows = db.prepare(`SELECT * FROM novels ${whereSql} ORDER BY ${orderBy} LIMIT @limit`)
      .all({ ...params, limit });
  } else {
    const offset = (page - 1) * pageSize;
    rows = db.prepare(`SELECT * FROM novels ${whereSql} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: pageSize, offset });
  }

  res.json({
    items: rows,
    total,
    page,
    pageSize,
    hasMore: limit === 0 ? page * pageSize < total : rows.length >= limit,
  });
});

// ---------------- 详情 ----------------

router.get('/api/books/:id', (req, res) => {
  const book = stmts.novelById.get(Number(req.params.id));
  if (!book) return res.status(404).json({ error: '书籍不存在' });

  const chapters = stmts.chaptersByNovel.all(book.id);
  const latest = chapters[chapters.length - 1] || null;

  // 收藏状态（基于匿名 cookie）
  const anonId = req.cookies[FAV_COOKIE];
  let favorited = false, rated = false;
  if (anonId) {
    favorited = !!db.prepare('SELECT 1 FROM favorites WHERE novel_id = ? AND cookie = ?').get(book.id, anonId);
    rated = !!db.prepare('SELECT 1 FROM ratings WHERE novel_id = ? AND cookie = ?').get(book.id, anonId);
  }

  // 评分统计
  const rating = db.prepare('SELECT AVG(score) AS avg, COUNT(*) AS c FROM ratings WHERE novel_id = ?').get(book.id);
  const avgScore = rating.avg ? Math.round(rating.avg * 10) / 10 : 0;
  const scoreCount = rating.c || 0;

  // 同类推荐（同分类，按阅读量排，不足补其他书）
  let related = db.prepare(
    'SELECT id, title, author, category, cover, status, views, favorites, word_count, description FROM novels WHERE category = ? AND id != ? ORDER BY views DESC, updated_at DESC LIMIT 4'
  ).all(book.category, book.id);
  if (related.length < 4) {
    const have = new Set(related.map(r => r.id));
    const fill = db.prepare(
      'SELECT id, title, author, category, cover, status, views, favorites, word_count, description FROM novels WHERE id != ? ORDER BY views DESC, updated_at DESC LIMIT ?'
    ).all(book.id, 4 - related.length);
    related = related.concat(fill.filter(r => !have.has(r.id)));
  }

  res.json({
    ...book,
    chapters: chapters.map(c => ({ id: c.id, title: c.title, order_index: c.order_index, chars: c.chars })),
    chapter_count: chapters.length,
    latest_chapter: latest ? { id: latest.id, title: latest.title, created_at: latest.created_at } : null,
    favorited,
    avg_score: avgScore,
    score_count: scoreCount,
    rated,
    related,
  });
});

router.get('/api/books/:id/chapters', (req, res) => {
  const book = stmts.novelById.get(Number(req.params.id));
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  res.json(stmts.chaptersByNovel.all(book.id));
});

// ---------------- 章节正文 + 阅读计数 ----------------

router.get('/api/chapters/:id', (req, res) => {
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(Number(req.params.id));
  if (!chapter) return res.status(404).json({ error: '章节不存在' });
  const book = stmts.novelById.get(chapter.novel_id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });

  // 前后章节
  const prev = db.prepare('SELECT id, title, order_index FROM chapters WHERE novel_id = ? AND order_index < ? ORDER BY order_index DESC LIMIT 1').get(book.id, chapter.order_index);
  const next = db.prepare('SELECT id, title, order_index FROM chapters WHERE novel_id = ? AND order_index > ? ORDER BY order_index ASC LIMIT 1').get(book.id, chapter.order_index);

  // 阅读量 +1（防刷）
  if (maybeCountRead(req.ip, chapter.id)) {
    db.prepare('UPDATE novels SET views = views + 1 WHERE id = ?').run(book.id);
  }

  res.json({
    chapter: publicChapter(chapter, book),
    book: { id: book.id, title: book.title, category: book.category, cover: book.cover },
    prev,
    next,
  });
});

// ---------------- 收藏 ----------------

router.post('/api/books/:id/favorite', (req, res) => {
  const book = stmts.novelById.get(Number(req.params.id));
  if (!book) return res.status(404).json({ error: '书籍不存在' });

  const anonId = getOrSetAnonId(req, res);
  const exists = db.prepare('SELECT 1 FROM favorites WHERE novel_id = ? AND cookie = ?').get(book.id, anonId);

  // 无 body 时保持旧的「切换」语义；前端可用 action 明确表达意图，
  // 避免「想取消收藏却因服务端本就未收藏、反而加上了」
  const action = req.body && req.body.action;
  const target = action === 'add' ? true : (action === 'remove' ? false : !exists);

  if (target && !exists) {
    db.prepare('INSERT INTO favorites (novel_id, cookie, created_at) VALUES (?, ?, ?)').run(book.id, anonId, now());
    db.prepare('UPDATE novels SET favorites = favorites + 1 WHERE id = ?').run(book.id);
  } else if (!target && exists) {
    db.prepare('DELETE FROM favorites WHERE novel_id = ? AND cookie = ?').run(book.id, anonId);
    db.prepare('UPDATE novels SET favorites = MAX(0, favorites - 1) WHERE id = ?').run(book.id);
  }

  const updated = stmts.novelById.get(book.id);
  res.json({ favorited: target, total: updated.favorites });
});

// ---------------- 评分 ----------------

router.post('/api/books/:id/rate', (req, res) => {
  const book = stmts.novelById.get(Number(req.params.id));
  if (!book) return res.status(404).json({ error: '书籍不存在' });

  const score = Math.round(Number(req.body && req.body.score));
  if (![1, 2, 3, 4, 5].includes(score)) {
    return res.status(400).json({ error: '评分必须为 1~5 星' });
  }
  const anonId = getOrSetAnonId(req, res);
  const exists = db.prepare('SELECT 1 FROM ratings WHERE novel_id = ? AND cookie = ?').get(book.id, anonId);
  if (exists) {
    db.prepare('UPDATE ratings SET score = ? WHERE novel_id = ? AND cookie = ?').run(score, book.id, anonId);
  } else {
    db.prepare('INSERT INTO ratings (novel_id, cookie, score, created_at) VALUES (?, ?, ?, ?)').run(book.id, anonId, score, now());
  }
  const rating = db.prepare('SELECT AVG(score) AS avg, COUNT(*) AS c FROM ratings WHERE novel_id = ?').get(book.id);
  res.json({
    rated: true,
    avg_score: Math.round(rating.avg * 10) / 10,
    score_count: rating.c,
  });
});

// ---------------- 评论 ----------------

/** 评论防刷：同一 IP + cookie 30 秒内只能发一条（只按 cookie 的话清 cookie 即可绕过） */
const commentWindow = new Map();
const COMMENT_WINDOW_MS = 30 * 1000;

router.get('/api/books/:id/comments', (req, res) => {
  const book = stmts.novelById.get(Number(req.params.id));
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const rows = db.prepare(
    'SELECT id, novel_id, author, content, created_at FROM comments WHERE novel_id = ? ORDER BY created_at DESC, id DESC LIMIT 100'
  ).all(book.id);
  res.json(rows);
});

router.post('/api/books/:id/comments', (req, res) => {
  const book = stmts.novelById.get(Number(req.params.id));
  if (!book) return res.status(404).json({ error: '书籍不存在' });

  const content = String((req.body && req.body.content) || '').trim();
  if (!content) return res.status(400).json({ error: '评论内容不能为空' });
  if (content.length > 500) return res.status(400).json({ error: '评论不能超过 500 字' });
  const author = String((req.body && req.body.author) || '匿名书友').trim().slice(0, 20) || '匿名书友';

  const anonId = getOrSetAnonId(req, res);
  const key = `${req.ip || ''}:${anonId}`;
  const last = commentWindow.get(key) || 0;
  if (Date.now() - last < COMMENT_WINDOW_MS) {
    return res.status(429).json({ error: '评论太快了，请 30 秒后再试' });
  }
  if (commentWindow.size > 50000) commentWindow.clear();
  commentWindow.set(key, Date.now());

  const info = db.prepare('INSERT INTO comments (novel_id, cookie, author, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(book.id, anonId, author, content, now());
  const row = db.prepare('SELECT id, novel_id, author, content, created_at FROM comments WHERE id = ?').get(info.lastInsertRowid);
  res.json(row);
});

// ---------------- 排行榜 ----------------

router.get('/api/rank', (req, res) => {
  const type = req.query.type || 'views';
  let orderBy;
  if (type === 'favorites') orderBy = 'favorites DESC, updated_at DESC';
  else if (type === 'updated') orderBy = 'updated_at DESC';
  else orderBy = 'views DESC, updated_at DESC';

  const rows = db.prepare(`SELECT id, title, author, category, cover, status, views, favorites, word_count, updated_at FROM novels ORDER BY ${orderBy} LIMIT 20`).all();
  res.json({ type, items: rows });
});

module.exports = { router };
