/* 管理端共享逻辑：口令登录 / 带 token 的请求 */

const Admin = {
  // 登录态由 httpOnly 的 atoken cookie 承载（服务端登录时种下），不再存 localStorage——
  // localStorage 里的 token 一旦被 XSS 读到即完全失守。此字段仅保留当次会话内的 Bearer 兼容。
  token: '',
  open: false,

  /** 请求包装，自动带 token；401 时触发登录 */
  async req(method, url, body, isForm) {
    const headers = {};
    if (!isForm && body) headers['Content-Type'] = 'application/json';
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(url, {
      method,
      headers,
      body: isForm ? body : (body ? JSON.stringify(body) : undefined),
    });
    if (res.status === 401) {
      this.requireLogin();
      throw new Error('需要登录');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败(${res.status})`);
    return data;
  },
  get(url) { return this.req('GET', url); },
  post(url, body) { return this.req('POST', url, body); },
  put(url, body) { return this.req('PUT', url, body); },
  del(url) { return this.req('DELETE', url); },

  /** 检查会话，未登录时弹出登录层 */
  async checkSession(showLogin = true) {
    try {
      const r = await fetch('/api/admin/session');
      const d = await r.json();
      this.open = d.open === true || !!d.ok;
      if (this.open) return true;
      if (showLogin) this.requireLogin();
      return false;
    } catch (e) {
      return false;
    }
  },

  requireLogin() {
    let mask = document.getElementById('loginMask');
    if (mask) { mask.style.display = 'flex'; return; }
    mask = document.createElement('div');
    mask.id = 'loginMask';
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    mask.innerHTML = `
      <div style="background:var(--surface);padding:34px 38px;border-radius:14px;box-shadow:var(--shadow);width:320px;text-align:center">
        <div style="font-size:34px;margin-bottom:10px">🔒</div>
        <h3 style="margin-bottom:6px">管理口令</h3>
        <p style="color:var(--text-2);font-size:13px;margin-bottom:18px">输入口令后即可进入管理端</p>
        <input type="password" id="adminPass" placeholder="请输入管理口令"
               style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);outline:none;margin-bottom:14px">
        <button id="loginBtn" style="width:100%;padding:10px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-size:15px;font-weight:600">进入</button>
        <p id="loginErr" style="color:#e05b4a;font-size:13px;margin-top:10px;min-height:18px"></p>
      </div>`;
    document.body.appendChild(mask);

    const doLogin = async () => {
      const pass = document.getElementById('adminPass').value;
      try {
        const r = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass }),
        });
        const d = await r.json();
        if (r.ok && (d.token || d.ok)) {
          Admin.token = d.token || '';
          mask.remove();
          location.reload();
        } else {
          document.getElementById('loginErr').textContent = d.open ? '' : (d.error || '口令错误');
          if (d.open) { mask.remove(); location.reload(); }
        }
      } catch (e) {
        document.getElementById('loginErr').textContent = '登录失败，请重试';
      }
    };
    mask.querySelector('#loginBtn').addEventListener('click', doLogin);
    mask.querySelector('#adminPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    mask.querySelector('#adminPass').focus();
  },
};
