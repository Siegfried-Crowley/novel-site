/* 管理端：评论管理（列表 / 按书名筛选 / 删除） */
(async () => {
  if (!(await Admin.checkSession())) return;

  const body = document.getElementById('commentBody');
  const empty = document.getElementById('empty');
  const countLabel = document.getElementById('countLabel');
  const table = document.getElementById('commentTable');
  const filter = document.getElementById('filter');

  let comments = [];

  async function load() {
    try {
      comments = await Admin.get('/api/admin/comments');
      render();
    } catch (e) {
      if (e.message !== '需要登录') site.toast(e.message);
    }
  }

  function render() {
    const kw = filter.value.trim();
    const rows = kw ? comments.filter(c => (c.novel_title || '').includes(kw)) : comments;
    countLabel.textContent = rows.length ? `共 ${rows.length} 条评论` : '';
    const has = rows.length > 0;
    table.style.display = has ? '' : 'none';
    empty.style.display = has ? 'none' : 'block';
    if (!has) return;

    body.innerHTML = rows.map(c => `
      <tr>
        <td><a href="/book/${c.novel_id}" target="_blank" style="color:var(--accent)">${site.escapeHtml(c.novel_title || `#${c.novel_id}`)}</a></td>
        <td><b>${site.escapeHtml(c.author || '匿名书友')}</b></td>
        <td class="c-content">${site.escapeHtml(c.content)}</td>
        <td style="white-space:nowrap">${new Date(c.created_at).toLocaleString('zh-CN')}</td>
        <td style="white-space:nowrap">
          <button class="op-btn danger" data-id="${c.id}" data-title="${site.escapeHtml(c.content.slice(0, 30))}">删除</button>
        </td>
      </tr>`).join('');

    body.querySelectorAll('.op-btn.danger').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`确定删除这条评论？\n“${btn.dataset.title}…”`)) return;
        try {
          await Admin.del(`/api/admin/comments/${btn.dataset.id}`);
          btn.closest('tr').remove();
          site.toast('评论已删除');
          render();
        } catch (e) { site.toast(e.message); }
      });
    });
  }

  filter.addEventListener('input', render);

  await load();
})();
