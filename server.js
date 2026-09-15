'use strict';

/**
 * 入口：Express + 静态托管 + API 挂载
 * 启动：npm install && npm start
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const config = require('./config');
const { db } = require('./db');
const { router: publicRouter } = require('./routes/public');
const { router: adminRouter } = require('./routes/admin');

// 确保自定义封面目录存在
fs.mkdirSync(path.join(__dirname, 'public', 'covers'), { recursive: true });

const app = express();
// 默认只信任本机反代（Nginx 与 Node 同机时 req.ip 仍是真实客户端 IP）；
// 直接对外暴露时伪造 X-Forwarded-For 无效，防止刷阅读量。反代不在本机时配置 TRUST_PROXY。
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

app.use(compression()); // gzip 文本响应（章节正文 / HTML / CSS / API 收益最大）

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 封面目录加防护响应头：SVG 文件里可以内嵌脚本，直接打开时禁止其执行
app.use('/covers', (req, res, next) => {
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});

// 静态资源：css/js/图片缓存一天；HTML 要求回源校验，避免更新后浏览器拿旧页面
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
  },
}));

// 页面路由（/list、/book/:id 等，对应 public 下的静态页）
app.get('/list', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'list.html')));
app.get('/rank', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'rank.html')));
app.get('/favorites', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'favorites.html')));
app.get('/book/:id', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'book.html')));
app.get('/read/:bookId/:chapterId', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'read.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/admin/upload', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin-upload.html')));
app.get('/admin/edit/:bookId', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin-edit.html')));
app.get('/admin/comments', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin-comments.html')));

// API 路由
app.use('/', publicRouter);
app.use('/', adminRouter);

// API 404
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

// 统一错误处理（multer 文件过大 / 数量过多 / 非图片等）
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = err.status || err.statusCode || 500;
  let message = err.message || '服务器内部错误';
  if (err.code === 'LIMIT_FILE_SIZE') { status = 413; message = '文件太大，单个文件不能超过 200MB'; }
  else if (err.code === 'LIMIT_FILE_COUNT' || (err.code === 'LIMIT_UNEXPECTED_FILE' && err.field === 'files')) {
    status = 400; message = '单次最多上传 20 个文件';
  }
  else if (err.code === 'LIMIT_UNEXPECTED_FILE') { status = 400; message = '上传字段名错误（应使用 files）'; }
  if (status >= 500) {
    // 内部错误细节只进日志，不返回给客户端（防止泄露文件路径 / 表结构等服务器信息）
    console.error(`[500] ${req.method} ${req.originalUrl}\n${err.stack || err}`);
    message = '服务器内部错误';
  }
  res.status(status).json({ error: message });
});

const server = app.listen(config.port, (err) => {
  // Express 5 的 app.listen 在端口绑定失败时，会把错误作为参数传给回调。
  // 若不处理，会「假装启动成功」打印提示后进程静默退出。
  if (err) {
    console.error(`❌ 启动失败：无法监听端口 ${config.port}（${err.code}）`);
    console.error('   该端口可能已被其他程序占用。请先关闭占用它的进程，');
    console.error('   或在 config.js 中修改 port 后重试。');
    process.exit(1);
  }
  console.log(`📖 小说阅读站已启动: http://localhost:${config.port}`);
  console.log(`   管理端入口: http://localhost:${config.port}/admin`);
  if (config.adminPassword) {
    console.log('   管理口令：已设置');
  } else {
    console.log('   ⚠ 未设置管理口令：管理端仅限本机访问；公网部署请设置 ADMIN_PASSWORD');
  }
});

// 优雅关闭：先停止接收新请求，存量请求处理完再关库（WAL 落盘），避免数据丢失
function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭服务…`);
  server.close(() => {
    try { db.close(); } catch (e) { /* ignore */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10 * 1000).unref(); // 有连接挂住时兜底退出
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
