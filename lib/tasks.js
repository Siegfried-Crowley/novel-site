'use strict';

/**
 * 后台任务执行器（主线程侧）：起 worker 跑 CPU 密集任务，超时自动终止。
 * 超时终止同时也兜底了恶意/写错正则的灾难性回溯（ReDoS）——线程直接被杀掉。
 */
const path = require('path');
const { Worker } = require('worker_threads');

function runTask(workerData, timeoutMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'task-worker.js'), { workerData });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('处理超时，文件可能过大，请分批处理'));
    }, timeoutMs);
    const settle = (fn, value) => { clearTimeout(timer); fn(value); };

    worker.on('message', msg => {
      if (msg && msg.ok) settle(resolve, msg.result);
      else settle(reject, new Error((msg && msg.error) || '处理失败'));
    });
    worker.on('error', err => settle(reject, err));
    worker.on('exit', code => {
      if (code !== 0) settle(reject, new Error(`后台处理线程异常退出（代码 ${code}）`));
    });
  });
}

/** 解析一本 TXT（上传 / 重新切分用），默认超时 10 分钟 */
function parseTxtFileAsync(filePath, filename, chapterRegex, timeoutMs = 10 * 60 * 1000) {
  return runTask({ op: 'parse', filePath, filename, chapterRegex }, timeoutMs);
}

/** 整书排版检测 / 重排，默认超时 5 分钟 */
function bookFormatAsync(novelId, { apply = false, previewCount = 3, previewLimit = 200 } = {}, timeoutMs = 5 * 60 * 1000) {
  return runTask({ op: 'book-format', novelId, apply, previewCount, previewLimit }, timeoutMs);
}

module.exports = { runTask, parseTxtFileAsync, bookFormatAsync };
