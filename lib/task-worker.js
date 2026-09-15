'use strict';

/**
 * 后台任务 worker（worker_threads 入口）
 *
 * 把 CPU 密集的大文本处理挪到工作线程，避免阻塞主线程导致整站无响应：
 *  - op = 'parse'       读文件 + 编码识别 + 章节切分 + 排版检测（上传 / 重新切分）
 *  - op = 'book-format' 逐章检测排版质量；apply 时在事务内写回重排结果
 *
 * worker 里 require('../db') 会打开一个独立的 SQLite 连接；
 * WAL 模式支持多连接并发读写，主连接设置了 busy_timeout 兜底锁竞争。
 */
const { parentPort, workerData } = require('worker_threads');

(async () => {
  try {
    const { op } = workerData;
    let result;

    if (op === 'parse') {
      const { parseTxtFile } = require('./txt-parser');
      const { analyzeBook } = require('./format');
      const parsed = parseTxtFile(workerData.filePath, workerData.filename, workerData.chapterRegex);
      result = { parsed, format: analyzeBook(parsed.chapters) };
    } else if (op === 'book-format') {
      const { db, now } = require('../db');
      const { detectChapter, reflowChapter, analyzeBook } = require('./format');
      const novelId = workerData.novelId;
      const rows = db.prepare('SELECT id, title, content FROM chapters WHERE novel_id = ? ORDER BY order_index ASC, id ASC').all(novelId);

      const format = analyzeBook(rows);
      const preview = [];
      let changed = 0;
      let formatAfter = null;

      if (workerData.apply) {
        // 重排覆盖：只改分段，不增删文字；检测为非 hard-wrap 的章节原样保留
        const update = db.prepare('UPDATE chapters SET content = ?, chars = ? WHERE id = ?');
        const ts = now();
        const after = [];
        const tx = db.transaction(() => {
          for (const row of rows) {
            const r = reflowChapter(row.content);
            if (r.changed) { update.run(r.content, r.content.length, row.id); changed++; }
            after.push({ content: r.content });
          }
          db.prepare('UPDATE novels SET updated_at = ? WHERE id = ?').run(ts, novelId);
        });
        tx();
        formatAfter = analyzeBook(after);
      } else {
        // dry-run：收集前几个硬折行章节的重排前后预览，不写库
        const limit = workerData.previewLimit || 200;
        for (const row of rows) {
          if (detectChapter(row.content).verdict !== 'hard-wrap') continue;
          const r = reflowChapter(row.content);
          preview.push({
            id: row.id,
            title: row.title,
            before: row.content.slice(0, limit),
            after: r.content.slice(0, limit),
          });
          if (preview.length >= (workerData.previewCount || 3)) break;
        }
      }

      result = { format, formatAfter, changed, total: rows.length, preview };
    } else {
      throw new Error(`未知任务类型: ${op}`);
    }

    parentPort.postMessage({ ok: true, result });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: e.message });
  }
})();
