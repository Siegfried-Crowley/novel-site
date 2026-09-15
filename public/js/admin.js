/* 管理首页：书籍列表 / 删除 */
(async () => {
  if (!(await Admin.checkSession())) return;

  const body = document.getElementById('bookBody');
  const empty = document.getElementById('empty');
  try {
    const data = await Admin.get('/api/books?sort=updated&pageSize=100');
    const items = data.items || [];
    if (!items.length) {
      empty.style.display = 'block';
      document.getElementById('bookTable').style.display = 'none';
      return;
    }
    body.innerHTML = items.map(b => `
      <tr>
        <td><img class="tcover" src="${site.coverSrc(b)}" onerror="this.onerror=null;this.src='/covers/auto-${b.id}.svg'"></td>
        <td><b>${site.escapeHtml(b.title)}</b></td>
        <td>${site.escapeHtml(b.author || '佚名')}</td>
        <td>${site.escapeHtml(b.category)}</td>
        <td>${b.status === 'finished' ? '完结' : '连载'}</td>
        <td>${site.fmtWords(b.word_count)}</td>
        <td>${site.fmtCount(b.views)}</td>
        <td>${site.fmtCount(b.favorites)}</td>
        <td>${new Date(b.updated_at).toLocaleString('zh-CN')}</td>
        <td style="white-space:nowrap">
          <a class="op-btn" href="/admin/edit/${b.id}">编辑</a>
          <button class="op-btn danger" data-id="${b.id}" data-title="${site.escapeHtml(b.title)}">删除</button>
        </td>
      </tr>`).join('');

    body.querySelectorAll('.op-btn.danger').forEach(btn => {
      btn.addEventListener('click', async () => {
        const title = btn.dataset.title;
        if (!confirm(`确定删除《${title}》？\n将同时删除所有章节和收藏记录，不可恢复。`)) return;
        try {
          await Admin.del(`/api/admin/books/${btn.dataset.id}`);
          btn.closest('tr').remove();
          site.toast('已删除');
        } catch (e) { site.toast(e.message); }
      });
    });
  } catch (e) {
    if (e.message !== '需要登录') site.toast(e.message);
  }
})();
