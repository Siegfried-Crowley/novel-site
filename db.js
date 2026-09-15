'use strict';

/**
 * SQLite 数据库初始化
 * 单文件数据库（data/novels.db），better-sqlite3 同步驱动。
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'novels.db');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000'); // 排版 worker 等场景下与主连接并发写时等待锁而不是立刻报错

// 建表
db.exec(`
CREATE TABLE IF NOT EXISTS novels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  author      TEXT DEFAULT '',
  category    TEXT DEFAULT '未分类',
  description TEXT DEFAULT '',
  cover       TEXT DEFAULT '',
  status      TEXT DEFAULT 'serial',          -- serial 连载 / finished 完结
  views       INTEGER NOT NULL DEFAULT 0,     -- 阅读量
  favorites   INTEGER NOT NULL DEFAULT 0,     -- 收藏数
  word_count  INTEGER NOT NULL DEFAULT 0,     -- 总字数
  source_file TEXT DEFAULT '',                -- 原始 TXT 保存路径（供重新切分）
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id    INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  chars       INTEGER NOT NULL DEFAULT 0,     -- 每章字数（写入时算好，查询不必 LENGTH(content) 现算）
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_chapters_novel ON chapters(novel_id, order_index);
CREATE INDEX IF NOT EXISTS idx_novels_title ON novels(title);
CREATE INDEX IF NOT EXISTS idx_novels_views ON novels(views);
CREATE INDEX IF NOT EXISTS idx_novels_updated ON novels(updated_at);
CREATE INDEX IF NOT EXISTS idx_novels_category ON novels(category);
CREATE INDEX IF NOT EXISTS idx_search_logs_created ON search_logs(created_at);

-- 匿名收藏去重表：同一浏览器 cookie 对同一本书只算一次
CREATE TABLE IF NOT EXISTS favorites (
  novel_id   INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  cookie     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (novel_id, cookie)
);

-- 匿名评分：同一 cookie 对同一本书只能评一次（可改）
CREATE TABLE IF NOT EXISTS ratings (
  novel_id   INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  cookie     TEXT NOT NULL,
  score      INTEGER NOT NULL,               -- 1~5 星
  created_at TEXT NOT NULL,
  PRIMARY KEY (novel_id, cookie)
);

-- 评论区（匿名，cookie 标识身份）
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id   INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  cookie     TEXT NOT NULL,
  author     TEXT DEFAULT '',
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_novel ON comments(novel_id, created_at);

-- 搜索日志（用于「热门搜索」）
CREATE TABLE IF NOT EXISTS search_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  q          TEXT NOT NULL,
  created_at TEXT NOT NULL
);

`);

// 旧库迁移（v1）：chapters 增加 chars 列并一次性回填。
// 用 user_version 做标记，回填只跑一次，避免每次启动都全表扫描。
const SCHEMA_VERSION = 1;
if (db.pragma('user_version', { simple: true }) < SCHEMA_VERSION) {
  const hasChars = db.prepare("SELECT COUNT(*) AS c FROM pragma_table_info('chapters') WHERE name = 'chars'").get().c > 0;
  if (!hasChars) db.exec('ALTER TABLE chapters ADD COLUMN chars INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE chapters SET chars = LENGTH(content) WHERE chars = 0');
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

// 准备常用查询语句（提升复用）
const stmts = {
  novelById: db.prepare('SELECT * FROM novels WHERE id = ?'),
  chaptersByNovel: db.prepare('SELECT id, novel_id, title, chars, order_index, created_at FROM chapters WHERE novel_id = ? ORDER BY order_index ASC, id ASC'),
  insertNovel: db.prepare(`INSERT INTO novels (title, author, category, description, cover, status, views, favorites, word_count, source_file, created_at, updated_at)
    VALUES (@title, @author, @category, @description, @cover, @status, 0, 0, @word_count, @source_file, @created_at, @updated_at)`),
  deleteNovel: db.prepare('DELETE FROM novels WHERE id = ?'),
  insertChapter: db.prepare('INSERT INTO chapters (novel_id, title, content, chars, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  deleteChaptersByNovel: db.prepare('DELETE FROM chapters WHERE novel_id = ?'),
};

function now() {
  return new Date().toISOString();
}

module.exports = {
  db,
  stmts,
  now,
  DATA_DIR,
  DB_PATH,
  UPLOAD_DIR,
};
