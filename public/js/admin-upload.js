/* 上传页：拖拽上传 TXT → 解析 → 结果预览 */
(async () => {
  if (!(await Admin.checkSession())) return;

  const zone = document.getElementById('dropZone');
  const input = document.getElementById('fileInput');
  const resultBox = document.getElementById('resultBox');
  const resultList = document.getElementById('resultList');

  const openPicker = () => input.click();
  zone.addEventListener('click', openPicker);
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    upload(e.dataTransfer.files);
  });
  input.addEventListener('change', () => { upload(input.files); input.value = ''; });

  function upload(files) {
    const list = [...files].filter(f => /\.txt$/i.test(f.name));
    if (!list.length) return site.toast('只支持 .txt 文件');
    if (list.length > 20) return site.toast('单次最多上传 20 个文件');
    if (list.some(f => f.size > 200 * 1024 * 1024)) return site.toast('单文件不能超过 200MB');

    zone.innerHTML = `<div class="uploading"><div class="big" style="font-size:34px">⏳</div>
      <div>正在上传并解析 ${list.length} 本小说…</div></div>`;

    const form = new FormData();
    list.forEach(f => form.append('files', f, f.name));

    // 300 秒超时保护：解析在工作线程进行，大书也基本能在时限内完成
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300000);

    fetch('/api/admin/upload', {
      method: 'POST',
      headers: Admin.token ? { Authorization: `Bearer ${Admin.token}` } : {},
      body: form,
      signal: controller.signal,
    }).then(async r => {
      clearTimeout(timer);
      if (r.status === 401) { Admin.requireLogin(); throw new Error('需要登录'); }
      let data = {};
      try { data = await r.json(); } catch (e) { /* 非 JSON 响应 */ }
      zone.innerHTML = `<div class="big">📥</div>
        <div class="title">拖拽 TXT 文件到这里，或点击选择</div>
        <div class="hint">支持多本批量上传 · 自动识别编码（UTF-8 / GBK）· 同名书籍将覆盖更新</div>`;
      if (!r.ok) {
        // 显示服务器返回的具体错误（文件过多 / 未收到文件等）
        site.toast(data.error || `上传失败（${r.status}）`);
        return;
      }
      const results = data.results || [];
      const okCount = results.filter(x => x.id).length;
      renderResults(results);
      if (okCount === 0 && results.length === 0) {
        site.toast('没有文件被处理');
        return;
      }
      // 单本上传成功 → 自动跳转编辑页预览切分结果
      if (okCount === 1) {
        site.toast('上传成功，正在打开编辑页…');
        setTimeout(() => location.href = `/admin/edit/${results.find(x => x.id).id}`, 1200);
      } else if (okCount > 1) {
        site.toast(`批量上传完成：${okCount} 本成功`);
      }
    }).catch(e => {
      clearTimeout(timer);
      zone.innerHTML = `<div class="big">📥</div>
        <div class="title">拖拽 TXT 文件到这里，或点击选择</div>
        <div class="hint">支持多本批量上传 · 自动识别编码（UTF-8 / GBK）· 同名书籍将覆盖更新</div>`;
      if (e.name === 'AbortError') {
        site.toast('上传超时（300 秒），建议分批上传');
      } else if (e.message !== '需要登录') {
        site.toast('上传失败，请重试');
      }
    });
  }

  function renderResults(results) {
    resultBox.style.display = 'block';
    resultList.innerHTML = results.map(r => {
      if (r.error) {
        return `<div class="result-item">
          <div class="head"><h3>❌ ${site.escapeHtml(r.title)}</h3></div>
          <div class="meta">${site.escapeHtml(r.error)}</div>
        </div>`;
      }
      const preview = (r.preview || []).map(p => `
        <div class="preview-item">▶ <b>${site.escapeHtml(p.title)}</b>
          ${p.first_line ? `<span class="fl">— ${site.escapeHtml(p.first_line)}</span>` : ''}</div>`).join('');
      return `
      <div class="result-item">
        <div class="head">
          <h3>📕 ${site.escapeHtml(r.title)}</h3>
          <span class="badge ${r.overwritten ? 'warn' : ''}">${r.overwritten ? '已覆盖同名书籍' : '新书入库'}</span>
          ${r.format && r.format.hardWrap > 0
            ? `<span class="badge warn">⚠ 排版较差（${r.format.hardWrap}/${r.format.total} 章硬折行，可在编辑页自动重排）</span>`
            : ''}
        </div>
        <div class="meta">作者：${site.escapeHtml(r.author || '佚名')} · ${r.chapter_count} 章 · ${site.fmtWords(r.word_count)}</div>
        ${r.preview && r.preview.length ? `<div class="preview"><div class="preview-title">切分预览：</div>${preview}${r.chapter_count > 5 ? `<div class="preview-item">… 共 ${r.chapter_count} 章</div>` : ''}</div>` : ''}
        <div class="result-actions">
          <a class="btn" href="/admin/edit/${r.id}">去编辑 ✎</a>
          <a class="btn btn-outline" style="text-decoration:none;padding:8px 20px" href="/book/${r.id}" target="_blank">查看前台 ↗</a>
        </div>
      </div>`;
    }).join('');
    resultList.scrollIntoView({ behavior: 'smooth' });
  }
})();
