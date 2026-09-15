'use strict';

/**
 * 站点配置
 * 修改方式：编辑本文件，或用环境变量覆盖（便于部署）。
 */
module.exports = {
  // 管理口令。留空 '' = 管理端仅限本机（127.0.0.1）访问，公网访问会被拒绝；
  // 公网部署请务必设置口令。
  adminPassword: process.env.ADMIN_PASSWORD || '',

  // 监听端口
  port: process.env.PORT || 3000,

  // 反向代理层数（Express trust proxy）。默认 'loopback'：只信任本机反代（如 Nginx 装在同一台
  // 服务器上），此时 req.ip 取 X-Forwarded-For 里的真实客户端 IP；直接对外暴露时不受影响，
  // 伪造 X-Forwarded-For 无效。反代不在本机时用环境变量覆盖（如 TRUST_PROXY=1 或 TRUST_PROXY=true）。
  trustProxy: process.env.TRUST_PROXY !== undefined
    ? (process.env.TRUST_PROXY === 'true' ? true : (isNaN(Number(process.env.TRUST_PROXY)) ? process.env.TRUST_PROXY : Number(process.env.TRUST_PROXY)))
    : 'loopback',
};
