/* 书籍详情页逻辑：信息 / 收藏 / 评分 / 目录 / 同类推荐 / 评论 */
const bookId = Number(location.pathname.split('/')[2]);

function setProgress(c) {
  localStorage.setItem(`progress_${bookId}`, JSON.stringify({ id: c.id, title: c.title }));
}

(async () => {
  let book;
  try {
    book = await fetch(`/api/books/${bookId}`).then(r => { if (!r.ok) throw 0; return r.json(); });
  } catch (e) {
    document.body.innerHTML = '<div class="empty-state" style="padding-top:100px"><div class="emoji">😢</div>书籍不存在或已被删除<br><a href="/">返回首页</a></div>';
    return;
  }
  document.title = `${book.title} · 公益书坊`;

  const progress = site.getProgress(bookId);
  const lastCh = book.chapters[book.chapters.length - 1];
  const startCh = progress && book.chapters.find(c => c.id === progress.id) ? progress : lastCh;

  if (book.favorited && !site.hasFav(book.id)) site.addFav(book.id);
  let favorited = site.hasFav(book.id);

  const hero = document.getElementById('hero');
  hero.innerHTML = `
    <img class="cover" src="${site.coverSrc(book)}" alt="${site.escapeHtml(book.title)}"
         onerror="this.onerror=null;this.src='/covers/auto-${book.id}.svg'">
    <div class="book-info">
      <h1>${site.escapeHtml(book.title)}</h1>
      <div class="book-meta">
        <span>作者：<b>${site.escapeHtml(book.author || '佚名')}</b></span>
        <span>分类：<b>${site.escapeHtml(book.category || '未分类')}</b></span>
        <span>状态：${site.statusBadge(book.status)}</span>
        <span>字数：<b>${site.fmtWords(book.word_count)}</b></span>
        <span>阅读：<b>${site.fmtCount(book.views)}</b></span>
        <span id="favMeta">收藏：<b>${site.fmtCount(book.favorites)}</b></span>
        ${book.latest_chapter ? `<span>最近更新：<b>${site.escapeHtml(book.latest_chapter.title)}</b><span style="opacity:.7">（${site.timeAgo(book.latest_chapter.created_at)}）</span></span>` : ''}
      </div>
      <div class="book-desc-box">${site.escapeHtml(book.description || '暂无简介')}</div>
      <div class="book-actions">
        ${startCh ? `<a class="btn" href="/read/${book.id}/${startCh.id}">${progress ? '继续阅读' : '开始阅读'}</a>` : ''}
        <button class="btn btn-outline ${favorited ? 'fav-on' : ''}" id="favBtn">${favorited ? '已收藏 ❤' : '收藏 ☆'}</button>
      </div>
      <div class="rating-row">
        <div class="stars" id="stars"></div>
        <span class="rating-text" id="ratingText"></span>
      </div>
    </div>`;

  /* ---------- 收藏 ---------- */
  const favBtn = document.getElementById('favBtn');
  function renderFav(state) {
    favorited = state;
    favBtn.textContent = state ? '已收藏 ❤' : '收藏 ☆';
    favBtn.classList.toggle('fav-on', state);
  }
  favBtn.addEventListener('click', async () => {
    const next = !favorited;
    if (next) site.addFav(book.id); else site.removeFav(book.id);
    renderFav(next);
    try {
      const r = await fetch(`/api/books/${book.id}/favorite`, { method: 'POST' });
      const d = await r.json();
      if (d.favorited !== undefined) {
        renderFav(d.favorited);
        if (d.favorited) site.addFav(book.id); else site.removeFav(book.id);
        const meta = document.getElementById('favMeta');
        if (meta) meta.innerHTML = `收藏：<b>${site.fmtCount(d.total)}</b>`;
      }
    } catch (e) {
      if (next) site.removeFav(book.id); else site.addFav(book.id);
      renderFav(!next);
      site.toast('操作失败');
    }
  });

  /* ---------- 评分 ---------- */
  let avgScore = book.avg_score || 0;
  let scoreCount = book.score_count || 0;
  let rated = book.rated;
  function renderRating() {
    const filled = Math.round(avgScore);
    document.getElementById('stars').innerHTML = [1, 2, 3, 4, 5].map(n => `
      <button class="star${n <= filled ? ' on' : ''}" data-score="${n}">★</button>`).join('');
    document.getElementById('ratingText').innerHTML = scoreCount
      ? `<b>${avgScore}</b> 分 · ${scoreCount} 人评分${rated ? ' · <span style="opacity:.7">你已评，可再点修改</span>' : ''}`
      : '暂无评分，点星星给这本书打分';
  }
  renderRating();
  document.getElementById('stars').addEventListener('click', async e => {
    const star = e.target.closest('.star');
    if (!star) return;
    const score = Number(star.dataset.score);
    try {
      const r = await fetch(`/api/books/${book.id}/rate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '评分失败');
      avgScore = d.avg_score; scoreCount = d.score_count; rated = true;
      renderRating();
      site.toast(`你打了 ${score} 星，谢谢支持`);
    } catch (err) { site.toast(err.message); }
  });

  /* ---------- 章节目录（含每章字数） ---------- */
  const chapters = book.chapters || [];
  document.getElementById('chCount').textContent = `共 ${chapters.length} 章`;
  const list = document.getElementById('chapters');
  const expandBtn = document.getElementById('expandBtn');
  const MAX = 40;
  const collapsed = chapters.length > MAX;
  let shown = collapsed ? MAX : chapters.length;

  function renderChapters() {
    const slice = chapters.slice(0, shown);
    list.innerHTML = slice.map(c => `
      <a href="/read/${book.id}/${c.id}" class="${progress && progress.id === c.id ? 'cur' : ''}"
         title="${site.escapeHtml(c.title)}">${site.escapeHtml(c.title)}<span class="c-info">${site.fmtWords(c.chars)}</span></a>`).join('');
    if (collapsed) {
      expandBtn.style.display = 'inline-block';
      expandBtn.textContent = shown >= chapters.length ? '收起' : `展开全部章节（${chapters.length - shown}）`;
    }
  }
  renderChapters();
  expandBtn.addEventListener('click', () => {
    shown = shown >= chapters.length ? MAX : chapters.length;
    renderChapters();
  });

  /* ---------- 同类推荐 ---------- */
  const related = book.related || [];
  const relatedGrid = document.getElementById('relatedGrid');
  if (relatedGrid) {
    relatedGrid.innerHTML = related.length
      ? related.map(b => site.card(b)).join('')
      : '<div class="empty-state" style="padding:20px">还没有其他书</div>';
  }

  /* ---------- 评论 ---------- */
  const commentList = document.getElementById('commentList');
  const commentCount = document.getElementById('commentCount');
  const nameInput = document.getElementById('commentName');
  const textInput = document.getElementById('commentText');

  // 昵称记忆
  nameInput.value = localStorage.getItem('readerName') || '';

  async function loadComments() {
    try {
      const r = await fetch(`/api/books/${book.id}/comments`);
      const rows = await r.json();
      commentCount.textContent = `${rows.length} 条`;
      commentList.innerHTML = rows.length ? rows.map(c => `
        <div class="comment-item">
          <div class="head">
            <span class="author">${site.escapeHtml(c.author || '匿名书友')}</span>
            <span class="time">${site.timeAgo(c.created_at)}</span>
          </div>
          <div class="body">${site.escapeHtml(c.content)}</div>
        </div>`).join('')
        : '<div class="empty-state" style="padding:20px"><div class="emoji">💬</div>还没有书评，来抢沙发吧</div>';
    } catch (e) { commentList.innerHTML = ''; }
  }
  loadComments();

  document.getElementById('commentSubmit').addEventListener('click', async () => {
    const content = textInput.value.trim();
    if (!content) return site.toast('写点什么再发表吧');
    const author = nameInput.value.trim();
    localStorage.setItem('readerName', author);
    try {
      const r = await fetch(`/api/books/${book.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, content }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '发表失败');
      textInput.value = '';
      site.toast('评论已发布');
      loadComments();
    } catch (e) { site.toast(e.message); }
  });
})();
