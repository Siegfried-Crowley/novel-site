/* 排行榜逻辑 */
site.markNav('rank');

const tabs = document.querySelectorAll('.rank-tab');
const listEl = document.getElementById('rankList');
const STAT_LABEL = { views: '阅读', favorites: '收藏', updated: '更新' };

async function load(type) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.type === type));
  listEl.innerHTML = '<div class="empty-state"><div class="emoji">⏳</div>加载中…</div>';
  try {
    const data = await fetch(`/api/rank?type=${type}`).then(r => r.json());
    const items = data.items || [];
    if (!items.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="emoji">📭</div>暂无数据</div>';
      return;
    }
    listEl.innerHTML = items.map((b, i) => {
      const stat = type === 'views' ? site.fmtCount(b.views)
        : type === 'favorites' ? site.fmtCount(b.favorites)
        : new Date(b.updated_at).toLocaleDateString('zh-CN');
      return `
      <a class="rank-item" href="/book/${b.id}">
        <div class="rank-no">${i + 1}</div>
        <img class="rank-cover" src="${site.coverSrc(b)}" alt="${site.escapeHtml(b.title)}"
             onerror="this.onerror=null;this.src='/covers/auto-${b.id}.svg'" loading="lazy">
        <div class="rank-mid">
          <div class="t">${site.escapeHtml(b.title)}</div>
          <div class="sub">${site.escapeHtml(b.author || '佚名')} · ${site.escapeHtml(b.category || '未分类')} · ${site.fmtWords(b.word_count)}</div>
        </div>
        <div class="rank-stat">${STAT_LABEL[type]} <b>${stat}</b></div>
      </a>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = '<div class="empty-state"><div class="emoji">😵</div>加载失败</div>';
  }
}

tabs.forEach(t => t.addEventListener('click', () => load(t.dataset.type)));
load('views');
