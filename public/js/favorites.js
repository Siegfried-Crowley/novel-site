/* 我的收藏：读取 localStorage 收藏列表，展示书籍并支持移除 */
site.markNav('favorites');

const grid = document.getElementById('favGrid');
const empty = document.getElementById('empty');
const countEl = document.getElementById('favCount');

(async () => {
  const ids = site.getFavs();
  if (!ids.length) {
    countEl.textContent = '共 0 本';
    empty.style.display = 'block';
    return;
  }
  countEl.textContent = `共 ${ids.length} 本`;

  // 一次批量拉取（此前逐本串行请求，收藏多时明显变慢）；不在结果里的书说明已删除，顺手清掉
  let items = [];
  try {
    const r = await fetch('/api/books?ids=' + ids.join(','));
    if (r.ok) items = (await r.json()).items || [];
  } catch (e) { /* 网络失败按空处理 */ }
  const byId = new Map(items.map(b => [b.id, b]));

  const books = [];
  const gone = [];
  for (const id of ids) {
    const b = byId.get(id);
    if (b) books.push(b);
    else gone.push(id);
  }
  if (gone.length) {
    gone.forEach(id => site.removeFav(id));
    countEl.textContent = `共 ${books.length} 本`;
  }

  if (!books.length) { empty.style.display = 'block'; return; }

  grid.innerHTML = books.map(b => {
    const prog = site.getProgress(b.id);
    const continueHref = prog ? `/read/${b.id}/${prog.id}` : `/book/${b.id}`;
    const continueText = prog ? `继续：${site.escapeHtml(prog.title)}` : '开始阅读';
    return `
    <div class="fav-item">
      <button class="fav-remove" data-id="${b.id}" title="取消收藏">✕</button>
      <a class="book-card" href="/book/${b.id}" title="${site.escapeHtml(b.title)}">
        <div class="book-cover-wrap">
          <img class="book-cover" src="${site.coverSrc(b)}" alt="${site.escapeHtml(b.title)}" loading="lazy"
               onerror="this.onerror=null;this.src='/covers/auto-${b.id}.svg'">
          ${site.statusBadge(b.status)}
        </div>
        <div class="book-title">${site.escapeHtml(b.title)}</div>
        <div class="book-author">${site.escapeHtml(b.author || '佚名')} · ${site.escapeHtml(b.category || '未分类')}</div>
      </a>
      <a class="btn" style="justify-content:center;width:100%;padding:7px 0;font-size:13px" href="${continueHref}">${continueText}</a>
    </div>`;
  }).join('');

  grid.querySelectorAll('.fav-remove').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      site.removeFav(id);
      btn.closest('.fav-item').remove();
      site.toast('已取消收藏');
      if (!grid.children.length) { empty.style.display = 'block'; countEl.textContent = '共 0 本'; }
      // 同步后端全局计数。必须用 action:'remove' 明确表达意图——
      // /favorite 是切换语义，盲发可能因服务端本就未收藏而反向加上
      try {
        await fetch(`/api/books/${id}/favorite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'remove' }),
        });
      } catch (e) { /* 本地已移除，后台计数失败静默 */ }
    });
  });
})();
