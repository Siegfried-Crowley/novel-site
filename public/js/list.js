/* 列表页逻辑：分类 / 搜索 / 排序 / 状态与字数筛选 / 分页 */
site.markNav('list');

const PAGE_SIZE = 18;
const params = new URLSearchParams(location.search);
const state = {
  cat: params.get('cat') || '',
  q: params.get('q') || '',
  sort: params.get('sort') || 'updated',
  status: params.get('status') || '',
  minWords: params.get('minWords') || '',
  page: parseInt(params.get('page'), 10) || 1,
};

const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const pagination = document.getElementById('pagination');
const countLabel = document.getElementById('countLabel');
const sortSelect = document.getElementById('sortSelect');
const statusSelect = document.getElementById('statusSelect');
const wordsSelect = document.getElementById('wordsSelect');

/* 渲染分类导航并高亮当前（等分类接口返回，site.ready） */
function renderCats() {
  const nav = document.getElementById('catNav');
  const all = document.createElement('a');
  all.className = 'cat-chip' + (!state.cat ? ' active' : '');
  all.href = '/list?sort=' + state.sort;
  all.textContent = '全部';
  nav.appendChild(all);
  site.categories.forEach(c => {
    const a = document.createElement('a');
    a.className = 'cat-chip' + (state.cat === c ? ' active' : '');
    a.href = `/list?cat=${encodeURIComponent(c)}&sort=${state.sort}`;
    a.textContent = c;
    nav.appendChild(a);
  });
}
site.ready.then(renderCats);

/* 搜索框同步 URL */
const searchInput = document.getElementById('searchInput');
if (state.q) searchInput.value = state.q;
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    state.q = searchInput.value.trim();
    state.page = 1;
    applyUrl();
  }
});

/* 排序 */
sortSelect.value = state.sort;
sortSelect.addEventListener('change', () => {
  state.sort = sortSelect.value;
  state.page = 1;
  applyUrl();
});

/* 状态筛选 */
statusSelect.value = state.status;
statusSelect.addEventListener('change', () => {
  state.status = statusSelect.value;
  state.page = 1;
  applyUrl();
});

/* 字数筛选 */
wordsSelect.value = state.minWords;
wordsSelect.addEventListener('change', () => {
  state.minWords = wordsSelect.value;
  state.page = 1;
  applyUrl();
});

function applyUrl() {
  const p = new URLSearchParams();
  if (state.cat) p.set('cat', state.cat);
  if (state.q) p.set('q', state.q);
  if (state.sort !== 'updated') p.set('sort', state.sort);
  if (state.status) p.set('status', state.status);
  if (state.minWords) p.set('minWords', state.minWords);
  if (state.page > 1) p.set('page', state.page);
  const qs = p.toString();
  location.href = '/list' + (qs ? '?' + qs : '');
}

function renderPagination(total, page) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  let html = `<button ${page <= 1 ? 'disabled' : ''} data-page="${page - 1}">‹</button>`;
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, start + 4);
  for (let i = start; i <= end; i++) {
    html += `<button class="${i === page ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }
  html += `<button ${page >= pages ? 'disabled' : ''} data-page="${page + 1}">›</button>`;
  pagination.innerHTML = html;
  pagination.querySelectorAll('button[data-page]').forEach(b => {
    b.addEventListener('click', () => {
      const p = Number(b.dataset.page);
      if (p >= 1 && p <= pages) { state.page = p; applyUrl(); }
    });
  });
}

/* 热门搜索词（非搜索状态时展示） */
(async function renderHotTags() {
  const box = document.getElementById('hotTags');
  if (!box || state.q) return;
  try {
    const words = await fetch('/api/search/hot').then(r => r.json());
    if (!words || !words.length) return;
    box.style.display = '';
    box.innerHTML = words.map(w =>
      `<a class="hot-tag" href="/list?q=${encodeURIComponent(w)}">${site.escapeHtml(w)}</a>`).join('');
  } catch (e) { /* 忽略 */ }
})();

async function loadList() {
  try {
    const p = new URLSearchParams();
    if (state.cat) p.set('cat', state.cat);
    if (state.q) p.set('q', state.q);
    p.set('sort', state.sort);
    if (state.status) p.set('status', state.status);
    if (state.minWords) p.set('minWords', state.minWords);
    p.set('page', state.page);
    p.set('pageSize', PAGE_SIZE);

    const data = await fetch(`/api/books?${p.toString()}`).then(r => r.json());
    const items = data.items || [];

    countLabel.textContent = data.total ? `共 ${data.total} 本书` : '';
    grid.innerHTML = items.map(b => site.card(b)).join('');
    empty.style.display = items.length ? 'none' : 'block';

    if (data.total > PAGE_SIZE) renderPagination(data.total, state.page);
    else pagination.innerHTML = '';
  } catch (e) {
    site.toast('加载失败，请刷新重试');
  }
}

/* 从 URL 重新同步状态（URL 是权威） */
function syncStateFromUrl() {
  const p = new URLSearchParams(location.search);
  state.cat = p.get('cat') || '';
  state.q = p.get('q') || '';
  state.sort = p.get('sort') || 'updated';
  state.status = p.get('status') || '';
  state.minWords = p.get('minWords') || '';
  state.page = parseInt(p.get('page'), 10) || 1;
  if (searchInput) searchInput.value = state.q;
}

/* 修复 bfcache bug：返回上一页时 JS state 不会重载、残留搜索词，
   此时点下一页会把残留的 q 拼进 URL 又跳回搜索。恢复时从 URL 重新同步。 */
window.addEventListener('pageshow', e => {
  if (e.persisted) {
    syncStateFromUrl();
    loadList();
  }
});

loadList();
