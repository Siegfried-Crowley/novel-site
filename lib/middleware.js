'use strict';

/** 极简 cookie 读取中间件（前台 / 后台共用） */
function parseCookies(req, res, next) {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const pair of header.split(';')) {
      const i = pair.indexOf('=');
      if (i > -1) {
        req.cookies[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
      }
    }
  }
  next();
}

module.exports = { parseCookies };
