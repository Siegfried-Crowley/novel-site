/* 编辑页逻辑：书籍信息 / 章节增删改排 / 重新切分 */
const bookId = Number(location.pathname.split('/')[3]);

let book = null;
let chapters = [];

const loading = document.getElementById('loading');
const wrap = document.getElementById('editWrap');

/* 加载书籍 */
async function load() {
  if (!(await Admin.checkSession())) return;
  try {
    // site.ready：分类下拉需要分类列表就绪
    const [data] = await Promise.all([Admin.get(`/api/books/${bookId}`), site.ready]);
    book = data;
    chapters = book.chapters || [];
    document.title = `编辑《${book.title}》 · 管理后台`;
    fillForm();
    renderChapters();
    loading.style.display = 'none';
    wrap.style.display = 'grid';
  } catch (e) {
    loading.innerHTML = `<div class="emoji">😢</div>${site.escapeHtml(e.message)}<br><a href="/admin" style="color:var(--accent)">返回后台</a>`;
  }
}

/* ---- 表单填充 ---- */
function fillForm() {
  document.getElementById('fTitle').value = book.title || '';
  document.getElementById('fAuthor').value = book.author || '';
  document.getElementById('fCategory').innerHTML =
    site.categories.map(c => `<option ${c === book.category ? 'selected' : ''}>${c}</option>`).join('');
  document.getElementById('fStatus').value = book.status === 'finished' ? 'finished' : 'serial';
  document.getElementById('fDesc').value = book.description || '';
  const preview = document.getElementById('coverPreview');
  preview.src = site.coverSrc(book);
  // 必须用普通 function：箭头函数没有自己的 this，回退到自动封面永不生效
  preview.onerror = function () { this.onerror = null; this.src = `/covers/auto-${book.id}.svg`; };
}

/* 保存书籍信息 */
document.getElementById('saveInfo').addEventListener('click', async () => {
  const payload = {
    title: document.getElementById('fTitle').value.trim(),
    author: document.getElementById('fAuthor').value.trim(),
    category: document.getElementById('fCategory').value,
    status: document.getElementById('fStatus').value,
    description: document.getElementById('fDesc').value,
  };
  if (!payload.title) return site.toast('书名不能为空');
  try {
    book = await Admin.post(`/api/admin/books/${bookId}`, payload);
    document.title = `编辑《${book.title}》 · 管理后台`;
    document.getElementById('coverPreview').src = site.coverSrc(book);
    site.toast('已保存');
  } catch (e) { site.toast(e.message); }
});

/* 封面上传 / 恢复默认 */
document.getElementById('coverFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('cover', file);
  try {
    const r = await fetch(`/api/admin/books/${bookId}/cover`, {
      method: 'POST',
      headers: Admin.token ? { Authorization: `Bearer ${Admin.token}` } : {},
      body: form,
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '上传失败');
    book.cover = d.cover;
    document.getElementById('coverPreview').src = d.cover;
    site.toast('封面已更新');
  } catch (err) { site.toast(err.message); }
  e.target.value = '';
});

document.getElementById('delCover').addEventListener('click', async () => {
  try {
    const d = await Admin.del(`/api/admin/books/${bookId}/cover`);
    book.cover = d.cover;
    document.getElementById('coverPreview').src = d.cover;
    site.toast('已恢复默认封面');
  } catch (e) { site.toast(e.message); }
});

/* 删除整本书 */
document.getElementById('deleteBook').addEventListener('click', async () => {
  if (!confirm(`确定删除《${book.title}》？不可恢复。`)) return;
  try {
    await Admin.del(`/api/admin/books/${bookId}`);
    site.toast('已删除，跳转后台…');
    setTimeout(() => location.href = '/admin', 600);
  } catch (e) { site.toast(e.message); }
});

/* ---- 章节列表 ---- */
let editingChapterId = null; // 当前展开编辑的章节 id

function renderChapters() {
  const list = document.getElementById('chapterList');
  list.innerHTML = chapters.map((c, i) => `
    <div class="chapter-item" data-id="${c.id}">
      <span class="idx">${i + 1}</span>
      <span class="t">${site.escapeHtml(c.title)}</span>
      <button class="mini" data-act="up" ${i === 0 ? 'disabled' : ''} title="上移">↑</button>
      <button class="mini" data-act="down" ${i === chapters.length - 1 ? 'disabled' : ''} title="下移">↓</button>
      <button class="mini" data-act="edit" title="编辑">✎</button>
      <button class="mini danger" data-act="del" title="删除">✕</button>
    </div>`).join('');

  list.querySelectorAll('.chapter-item').forEach(item => {
    const id = Number(item.dataset.id);
    const btn = (act) => item.querySelector(`[data-act="${act}"]`);
    btn('up').addEventListener('click', () => moveChapter(i => i - 1, id));
    btn('down').addEventListener('click', () => moveChapter(i => i + 1, id));
    btn('edit').addEventListener('click', () => editChapter(id));
    btn('del').addEventListener('click', () => delChapter(id));
  });
}

/* 上移 / 下移（重排 order_index） */
function moveChapter(stepFn, id) {
  const idx = chapters.findIndex(c => c.id === id);
  const to = stepFn(idx);
  if (to < 0 || to >= chapters.length) return;
  [chapters[idx], chapters[to]] = [chapters[to], chapters[idx]];
  saveOrder();
}

async function saveOrder() {
  renderChapters();
  try {
    await Admin.post(`/api/admin/books/${bookId}/reorder`, { order: chapters.map(c => c.id) });
    site.toast('顺序已保存');
  } catch (e) { site.toast(e.message); }
}

/* 展开章节编辑器 */
async function editChapter(id) {
  const item = document.querySelector(`.chapter-item[data-id="${id}"]`);
  if (!item) return;
  editingChapterId = id;
  try {
    const data = await Admin.get(`/api/chapters/${id}`);
    const ch = data.chapter;
    const editor = document.createElement('div');
    editor.className = 'chapter-editor';
    editor.innerHTML = `
      <input id="chTitle" value="${site.escapeHtml(ch.title)}" placeholder="章节标题">
      <textarea id="chContent" placeholder="章节正文">${site.escapeHtml(ch.content)}</textarea>
      <div class="actions">
        <button class="btn-sm primary" id="chSave">保存</button>
        <button class="btn-sm ghost" id="chReflow">重排本段</button>
        <button class="btn-sm ghost" id="chCancel">取消</button>
      </div>`;
    item.replaceWith(editor);

    document.getElementById('chSave').addEventListener('click', async () => {
      const title = document.getElementById('chTitle').value.trim() || ch.title;
      const content = document.getElementById('chContent').value;
      try {
        await Admin.put(`/api/admin/chapters/${id}`, { title, content });
        const c = chapters.find(x => x.id === id);
        c.title = title;
        site.toast('章节已保存');
        renderChapters();
      } catch (e) { site.toast(e.message); }
    });
    // 单章重排预览：把重排结果填进文本框，由管理员确认后手动保存
    document.getElementById('chReflow').addEventListener('click', async () => {
      const btn = document.getElementById('chReflow');
      btn.disabled = true;
      btn.textContent = '重排中…';
      try {
        const d = await Admin.post(`/api/admin/chapters/${id}/reflow`, {});
        if (d.truncated) {
          site.toast('章节过长，预览已截断；请用左侧「自动排版」整书处理');
        } else if (!d.changed) {
          site.toast(d.verdict === 'verse' ? '一句一行排版，无需重排' : '本章排版正常，无需重排');
        } else {
          document.getElementById('chContent').value = d.after;
          site.toast('已按重排结果替换正文，点「保存」生效');
        }
      } catch (e) { site.toast(e.message); }
      btn.disabled = false;
      btn.textContent = '重排本段';
    });
    document.getElementById('chCancel').addEventListener('click', renderChapters);
  } catch (e) { site.toast(e.message); }
}

/* 删除章节 */
async function delChapter(id) {
  if (!confirm('确定删除该章节？')) return;
  try {
    await Admin.del(`/api/admin/chapters/${id}`);
    chapters = chapters.filter(c => c.id !== id);
    site.toast('章节已删除');
    renderChapters();
  } catch (e) { site.toast(e.message); }
}

/* 新增章节 */
document.getElementById('addChapter').addEventListener('click', async () => {
  try {
    const d = await Admin.post(`/api/admin/books/${bookId}/chapters`, { title: '', content: '' });
    const fresh = await Admin.get(`/api/books/${bookId}`);
    chapters = fresh.chapters || [];
    renderChapters();
    editChapter(d.chapter.id);
  } catch (e) { site.toast(e.message); }
});

/* ---- 重新切分 ---- */
document.getElementById('reparseBtn').addEventListener('click', async () => {
  const regex = document.getElementById('reparseRegex').value.trim();
  if (!confirm(`将以${regex ? '自定义正则' : '默认规则'}重新切分并覆盖全部章节，确定？`)) return;
  const btn = document.getElementById('reparseBtn');
  btn.disabled = true;
  btn.textContent = '切分中…';
  try {
    const d = await Admin.post(`/api/admin/books/${bookId}/reparse`, { regex });
    const preview = document.getElementById('reparsePreview');
    preview.style.display = 'block';
    preview.innerHTML = `✅ 切分完成：共 <b>${d.chapter_count}</b> 章<br>` +
      (d.preview || []).map(p => `· ${site.escapeHtml(p.title)} ${p.first_line ? `— ${site.escapeHtml(p.first_line)}` : ''}`).join('<br>');
    chapters = (await Admin.get(`/api/books/${bookId}`)).chapters || [];
    renderChapters();
    document.getElementById('fAuthor').value = d.author || book.author;
    site.toast('重新切分完成');
  } catch (e) { site.toast(e.message); }
  btn.disabled = false;
  btn.textContent = '重新切分并覆盖章节';
});

/* ---- 自动排版（硬折行检测 + 整书重排） ---- */
document.getElementById('formatBtn').addEventListener('click', async () => {
  const btn = document.getElementById('formatBtn');
  const box = document.getElementById('formatPreview');
  btn.disabled = true;
  btn.textContent = '检测中…';
  box.style.display = 'block';
  box.innerHTML = '检测中，大书可能需要一点时间…';
  try {
    const d = await Admin.post(`/api/admin/books/${bookId}/format`, {});
    const f = d.format || {};
    if (!f.hardWrap) {
      box.innerHTML = `✅ 排版正常：共 ${f.total} 章，未发现硬折行，无需重排。`;
      btn.disabled = false;
      btn.textContent = '重新检测';
      return;
    }
    const statLine = `共 ${f.total} 章：⚠ 硬折行 ${f.hardWrap} · 正常 ${f.good} · 大段连排 ${f.blob} · 一句一行 ${f.verse} · 空 ${f.empty}`;
    const previews = (d.preview || []).map(p => `
      <div style="margin-top:10px">
        <div style="font-weight:600">${site.escapeHtml(p.title)}</div>
        <div style="color:#e05b4a;margin-top:4px">重排前：${site.escapeHtml(p.before)}…</div>
        <div style="color:#2e7d32;margin-top:2px">重排后：${site.escapeHtml(p.after)}…</div>
      </div>`).join('');
    box.innerHTML = `${site.escapeHtml(statLine)}${previews}
      <div style="margin-top:12px"><button class="btn-sm primary" id="formatApply">应用重排（${f.hardWrap} 章将重新分段）</button></div>`;
    document.getElementById('formatApply').addEventListener('click', async () => {
      if (!confirm(`确定对整本书应用自动排版？${f.hardWrap} 个硬折行章节将被重新分段（只重新分段、不增删文字），此操作不可撤销。`)) return;
      const applyBtn = document.getElementById('formatApply');
      applyBtn.disabled = true;
      applyBtn.textContent = '排版中…';
      try {
        const r2 = await Admin.post(`/api/admin/books/${bookId}/format`, { apply: true });
        const after = (r2.formatAfter || {}).hardWrap || 0;
        box.innerHTML = `✅ 排版完成：重排 ${r2.changed} 章（共 ${r2.total} 章）。重排后仍为硬折行的章节：${after}。`;
        site.toast('自动排版完成');
      } catch (e) {
        site.toast(e.message);
        applyBtn.disabled = false;
        applyBtn.textContent = '应用重排';
      }
    });
  } catch (e) {
    box.innerHTML = `❌ ${site.escapeHtml(e.message)}`;
  }
  btn.disabled = false;
  btn.textContent = '重新检测';
});

load();
