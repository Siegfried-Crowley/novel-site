/* 首页逻辑 */
site.markNav('home');

/* 分类导航：等 site.ready（分类接口返回）后再渲染，否则渲染空数据 */
(function () {
  const nav = document.getElementById('catNav');
  if (!nav) return;
  site.ready.then(() => {
    site.categories.forEach(c => {
      const a = document.createElement('a');
      a.className = 'cat-chip';
      a.href = `/list?cat=${encodeURIComponent(c)}`;
      a.textContent = c;
      nav.appendChild(a);
    });
  });
})();

/* 书籍卡片渲染 */
function renderGrid(id, books) {
  const grid = document.getElementById(id);
  if (!grid) return;
  grid.innerHTML = books.length
    ? books.map(b => site.card(b)).join('')
    : '<div class="empty-state"><div class="emoji">📭</div>还没有书籍，去管理端上传吧</div>';
}

/* 轮播 */
function renderCarousel(books) {
  const track = document.getElementById('carouselTrack');
  const dots = document.getElementById('carouselDots');
  if (!track || !books.length) return;

  track.innerHTML = books.map((b, i) => `
    <div class="carousel-slide${i === 0 ? ' active' : ''}" style="background-image:url('${site.coverSrc(b)}')">
      <div class="carousel-content">
        <div class="carousel-title">${site.escapeHtml(b.title)}</div>
        <div class="carousel-desc">${site.escapeHtml(b.description || '暂无简介，点进去看看吧')}</div>
        <a class="btn" href="/book/${b.id}">开始阅读</a>
      </div>
    </div>`).join('');

  dots.innerHTML = books.map((_, i) => `<button data-i="${i}"${i === 0 ? ' class="active"' : ''}></button>`).join('');

  let cur = 0;
  const slides = track.querySelectorAll('.carousel-slide');
  const dotBtns = dots.querySelectorAll('button');
  const show = (i) => {
    cur = (i + slides.length) % slides.length;
    slides.forEach((s, j) => s.classList.toggle('active', j === cur));
    dotBtns.forEach((d, j) => d.classList.toggle('active', j === cur));
  };
  dots.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) show(Number(b.dataset.i));
  });
  // 页面切到后台时暂停自动轮播（定时器保留，回到前台自动继续）
  setInterval(() => { if (!document.hidden) show(cur + 1); }, 5000);
}

/* 热门搜索词 */
(async function renderHotSearch() {
  const sec = document.getElementById('hotSearchSection');
  const box = document.getElementById('hotSearch');
  if (!sec || !box) return;
  try {
    const words = await fetch('/api/search/hot').then(r => r.json());
    if (!words || !words.length) return;
    sec.style.display = '';
    box.innerHTML = words.map((w, i) =>
      `<a class="hot-tag" href="/list?q=${encodeURIComponent(w)}"><span class="idx">${i + 1}</span>${site.escapeHtml(w)}</a>`).join('');
  } catch (e) { /* 搜索日志为空时静默 */ }
})();

/* 最近在读 */
(async function renderContinue() {
  const sec = document.getElementById('continueSection');
  const grid = document.getElementById('continueGrid');
  if (!sec || !grid) return;
  const history = site.getReadingHistory();
  if (!history.length) { sec.style.display = 'none'; return; }

  // 一次批量拉取全部书籍（此前逐本请求，在读多时明显变慢）
  let items = [];
  try {
    const r = await fetch('/api/books?ids=' + history.map(h => h.bookId).join(','));
    if (r.ok) items = (await r.json()).items || [];
  } catch (e) { /* 网络失败按空处理 */ }
  const byId = new Map(items.map(b => [b.id, b]));

  const rows = [];
  for (const h of history) {
    const b = byId.get(h.bookId);
    if (!b) { site.removeReading(h.bookId); continue; } // 书被删了，清理进度
    rows.push({ b, h });
  }
  if (!rows.length) { sec.style.display = 'none'; return; }

  grid.innerHTML = rows.map(({ b, h }) => `
    <div class="continue-card">
      <img src="${site.coverSrc(b)}" alt="" loading="lazy"
           onerror="this.onerror=null;this.src='/covers/auto-${b.id}.svg'">
      <div class="continue-info">
        <div class="t">${site.escapeHtml(b.title)}</div>
        <div class="c">读到《${site.escapeHtml(h.chapter.title)}》</div>
        <div class="continue-actions">
          <a class="go" href="/read/${b.id}/${h.chapter.id}">继续阅读</a>
          <button class="del" data-id="${b.id}">✕</button>
        </div>
      </div>
    </div>`).join('');

  grid.querySelectorAll('.del').forEach(btn => btn.addEventListener('click', () => {
    site.removeReading(Number(btn.dataset.id));
    btn.closest('.continue-card').remove();
    if (!grid.children.length) sec.style.display = 'none';
  }));
})();

(async () => {
  try {
    const [hot, latest] = await Promise.all([
      fetch('/api/books?sort=views&limit=8').then(r => r.json()),
      fetch('/api/books?sort=updated&limit=8').then(r => r.json()),
    ]);
    renderCarousel(hot.items || []);
    renderGrid('hotGrid', hot.items || []);
    renderGrid('latestGrid', latest.items || []);
  } catch (e) {
    site.toast('加载失败，请刷新重试');
  }
})();
