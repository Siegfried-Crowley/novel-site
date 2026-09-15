/* 公共工具：主题切换、书籍卡片、格式化、Toast 等 */

const site = {
  base: '',
  categories: [],
  /** init() 完成的 Promise：依赖分类等数据的页面渲染应写成 site.ready.then(...)，
   *  否则页面脚本同步执行时 fetch 还没回来，会渲染空数据 */
  ready: null,
  async init() {
    site.setTheme(localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    try {
      const r = await fetch('/api/categories');
      if (r.ok) site.categories = await r.json();
    } catch (e) { /* ignore */ }
  },
  setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('theme', t);
    document.querySelectorAll('.theme-toggle').forEach(b => { b.textContent = t === 'dark' ? '☀️' : '🌙'; });
  },
  toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    site.setTheme(cur === 'dark' ? 'light' : 'dark');
  },
  escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },
  fmtCount(n) {
    n = Number(n) || 0;
    if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '万';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  },
  fmtWords(n) {
    n = Number(n) || 0;
    return n >= 10000 ? (n / 10000).toFixed(1) + '万字' : n + '字';
  },
  timeAgo(iso) {
    const t = new Date(iso);
    if (isNaN(t)) return '';
    const diff = (Date.now() - t.getTime()) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  },
  statusBadge(status) {
    return status === 'finished'
      ? '<span class="status-badge finished">完结</span>'
      : '<span class="status-badge">连载</span>';
  },
  coverSrc(book) {
    return book.cover || `/covers/auto-${book.id}.svg`;
  },
  /** 书籍卡片 HTML */
  card(b) {
    return `
    <a class="book-card" href="/book/${b.id}" title="${site.escapeHtml(b.title)}">
      <div class="book-cover-wrap">
        <img class="book-cover" src="${site.coverSrc(b)}" alt="${site.escapeHtml(b.title)}" loading="lazy"
             onerror="this.onerror=null;this.src='/covers/auto-${b.id}.svg'">
        ${site.statusBadge(b.status)}
      </div>
      <div class="book-title">${site.escapeHtml(b.title)}</div>
      <div class="book-author">${site.escapeHtml(b.author || '佚名')}</div>
      <div class="book-desc">${site.escapeHtml(b.description || '')}</div>
    </a>`;
  },
  toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2200);
  },
  /* ============ 我的收藏（localStorage，无需登录） ============ */
  FAV_LIST_KEY: 'myFavorites',
  getFavs() {
    try { return JSON.parse(localStorage.getItem(site.FAV_LIST_KEY) || '[]'); }
    catch (e) { return []; }
  },
  saveFavs(list) { localStorage.setItem(site.FAV_LIST_KEY, JSON.stringify(list)); },
  hasFav(id) { return site.getFavs().includes(Number(id)); },
  addFav(id) {
    const list = site.getFavs();
    if (!list.includes(Number(id))) { list.push(Number(id)); site.saveFavs(list); }
  },
  removeFav(id) {
    site.saveFavs(site.getFavs().filter(x => x !== Number(id)));
  },

  /* ============ 最近在读（localStorage progress_<bookId>） ============ */
  /** 读取某本书的本地阅读进度（详情页 / 收藏页 / 首页共用） */
  getProgress(id) {
    try { return JSON.parse(localStorage.getItem(`progress_${id}`) || 'null'); }
    catch (e) { return null; }
  },
  getReadingHistory() {
    const list = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('progress_')) {
        const bookId = Number(k.slice(9));
        try {
          const p = JSON.parse(localStorage.getItem(k));
          if (p && p.id) list.push({ bookId, chapter: { id: p.id, title: p.title }, t: p.t || 0 });
        } catch (e) { /* 忽略坏数据 */ }
      }
    }
    return list.sort((a, b) => b.t - a.t);
  },
  removeReading(bookId) { localStorage.removeItem(`progress_${bookId}`); },

  /** 全局搜索（回车跳转） */
  bindSearch() {
    document.querySelectorAll('.search-box').forEach(box => {
      const input = box.querySelector('input');
      const go = () => {
        const q = input.value.trim();
        location.href = `/list${q ? '?q=' + encodeURIComponent(q) : ''}`;
      };
      box.querySelector('.icon')?.addEventListener('click', go);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    });
  },
  /** 高亮当前导航 */
  markNav(page) {
    document.querySelectorAll('.nav a').forEach(a => {
      a.classList.toggle('active', a.dataset.page === page);
    });
  },
};

/* 主题按钮 */
document.addEventListener('click', e => {
  if (e.target.closest('.theme-toggle')) site.toggleTheme();
});

site.ready = site.init();
site.bindSearch();
