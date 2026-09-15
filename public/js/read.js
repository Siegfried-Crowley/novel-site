/* 阅读页逻辑：主题/字号/字体/行距/沉浸/自动翻章/目录抽屉/进度记忆 */
const parts = location.pathname.split('/');
const bookId = Number(parts[2]);
const chapterId = Number(parts[3]);

const content = document.getElementById('content');
const drawer = document.getElementById('drawer');
const drawerMask = document.getElementById('drawerMask');

let next = null; // 下一章信息（读完自动翻章用）

/* ============ 阅读设置（localStorage 持久化） ============ */
const READER_THEMES = {
  light: { bg: '#fffdf7', text: '#3a342b', sub: '#9a9385' },
  sepia: { bg: '#f0e6cc', text: '#5b4636', sub: '#9c8a6d' },
  green:  { bg: '#cde8d1', text: '#2f4a38', sub: '#6f8f79' },
  dark:   { bg: '#1b1a18', text: '#c9c3b8', sub: '#7d776c' },
};
const FONT_SIZES = { small: 16, medium: 18, large: 21 };
const LINE_HEIGHTS = { compact: 1.7, normal: 1.95, loose: 2.3 };
const FONT_FAMILIES = {
  default: "'PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif",
  serif: "'Noto Serif SC','Source Han Serif SC','SimSun','宋体',serif",
  hei: "'SimHei','Heiti SC','Source Han Sans SC','黑体',sans-serif",
  kai: "'KaiTi','STKaiti','Kaiti SC','楷体',serif",
};

let readerTheme = localStorage.getItem('readerTheme') || 'sepia';
let fontSize = localStorage.getItem('readerFontSize') || 'medium';
let readerFont = localStorage.getItem('readerFont') || 'default';
let lineHeight = localStorage.getItem('readerLineHeight') || 'normal';

function applyTheme(t) {
  readerTheme = t;
  localStorage.setItem('readerTheme', t);
  const T = READER_THEMES[t];
  document.documentElement.style.setProperty('--reader-bg', T.bg);
  document.documentElement.style.setProperty('--reader-text', T.text);
  document.documentElement.style.setProperty('--reader-sub', T.sub);
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.toggle('active', s.dataset.theme === t));
}
function applyFontSize(s) {
  fontSize = s;
  localStorage.setItem('readerFontSize', s);
  document.documentElement.style.setProperty('--reader-font-size', FONT_SIZES[s] + 'px');
  document.querySelectorAll('#fontSizeSeg button').forEach(b => b.classList.toggle('active', b.dataset.size === s));
}
function applyFont(f) {
  readerFont = f;
  localStorage.setItem('readerFont', f);
  content.style.fontFamily = FONT_FAMILIES[f];
  document.querySelectorAll('#fontSeg button').forEach(b => b.classList.toggle('active', b.dataset.font === f));
}
function applyLineHeight(l) {
  lineHeight = l;
  localStorage.setItem('readerLineHeight', l);
  document.documentElement.style.setProperty('--reader-line-height', LINE_HEIGHTS[l]);
  document.querySelectorAll('#lineSeg button').forEach(b => b.classList.toggle('active', b.dataset.line === l));
}

applyTheme(readerTheme);
applyFontSize(fontSize);
applyFont(readerFont);
applyLineHeight(lineHeight);

/* 设置弹层开关 */
const popover = document.getElementById('settingsPopover');
document.getElementById('settingsBtn').addEventListener('click', e => {
  e.stopPropagation();
  popover.classList.toggle('open');
});
document.addEventListener('click', e => {
  if (!e.target.closest('.reader-settings')) popover.classList.remove('open');
});
document.querySelectorAll('.theme-swatch').forEach(s => s.addEventListener('click', () => applyTheme(s.dataset.theme)));
document.querySelectorAll('#fontSizeSeg button').forEach(b => b.addEventListener('click', () => applyFontSize(b.dataset.size)));
document.querySelectorAll('#fontSeg button').forEach(b => b.addEventListener('click', () => applyFont(b.dataset.font)));
document.querySelectorAll('#lineSeg button').forEach(b => b.addEventListener('click', () => applyLineHeight(b.dataset.line)));

/* ============ 沉浸阅读（跨章节保持） ============ */
let immersive = localStorage.getItem('readerImmersive') === '1';
function setImmersive(on) {
  immersive = on;
  localStorage.setItem('readerImmersive', on ? '1' : '0');
  document.body.classList.toggle('reader-immersive', on);
  popover.classList.remove('open');
}
if (immersive) document.body.classList.add('reader-immersive');
document.getElementById('immersiveBtn').addEventListener('click', () => setImmersive(true));
document.getElementById('exitImmersive').addEventListener('click', () => setImmersive(false));

/* ============ 进度记忆 ============ */
function saveProgress(c) {
  localStorage.setItem(`progress_${bookId}`, JSON.stringify({ id: c.id, title: c.title, t: Date.now() }));
}

/* ============ 目录抽屉 ============ */
function openDrawer() { drawer.classList.add('open'); drawerMask.classList.add('open'); }
function closeDrawer() { drawer.classList.remove('open'); drawerMask.classList.remove('open'); }
document.getElementById('dirBtn').addEventListener('click', openDrawer);
document.getElementById('drawerClose').addEventListener('click', closeDrawer);
drawerMask.addEventListener('click', closeDrawer);

/* ============ 读完自动下一章 ============ */
let autoNextFired = false;
const autoNextFloat = document.getElementById('autoNextFloat');
window.addEventListener('scroll', () => {
  if (!next || autoNextFired || immersive) return;
  if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 280) {
    autoNextFired = true;
    autoNextFloat.classList.add('show');
    setTimeout(() => location.href = `/read/${bookId}/${next.id}`, 900);
  }
});

/* ============ 键盘 ============ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (immersive) setImmersive(false);
    else if (drawer.classList.contains('open')) closeDrawer();
    else if (popover.classList.contains('open')) popover.classList.remove('open');
    return;
  }
  if (e.target.matches('input,textarea')) return;
  if (drawer.classList.contains('open') || popover.classList.contains('open')) return;
  if (e.key === 'ArrowLeft' && prevLink) location.href = prevLink;
  if (e.key === 'ArrowRight' && next) location.href = `/read/${bookId}/${next.id}`;
});

/* ============ 加载章节 ============ */
let prevLink = null;
(async () => {
  let data;
  try {
    const r = await fetch(`/api/chapters/${chapterId}`);
    if (!r.ok) throw 0;
    data = await r.json();
  } catch (e) {
    content.innerHTML = '章节不存在，<a href="/">返回首页</a>';
    return;
  }

  const { chapter, book, prev, next: nxt } = data;
  next = nxt || null;
  document.title = `${chapter.title} · ${book.title}`;
  document.getElementById('bookTitle').href = `/book/${book.id}`;
  document.getElementById('bookTitle').textContent = book.title;
  document.getElementById('chapterTitle').textContent = chapter.title;
  document.getElementById('topTitle').textContent = `${book.title} · ${chapter.title}`;
  document.getElementById('backBtn').href = `/book/${book.id}`;
  const floatBack = document.getElementById('floatBack');
  if (floatBack) floatBack.href = `/book/${book.id}`;
  document.getElementById('drawerBookTitle').textContent = book.title;

  const paragraphs = chapter.content.split(/\n+/).map(s => s.trim()).filter(Boolean);
  content.innerHTML = paragraphs.length
    ? paragraphs.map(p => `<p>${site.escapeHtml(p)}</p>`).join('')
    : '（本章暂无内容）';
  applyFont(readerFont);

  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  if (prev) {
    prevLink = `/read/${book.id}/${prev.id}`;
    prevBtn.onclick = () => location.href = prevLink;
  } else prevBtn.disabled = true;
  if (next) {
    nextBtn.onclick = () => location.href = `/read/${book.id}/${next.id}`;
  } else {
    nextBtn.disabled = true;
    nextBtn.textContent = '已是最后一章';
  }

  // 目录抽屉数据：书被删 / 网络失败时跳过，别让整个阅读页崩掉
  let chapters = [];
  try {
    const r = await fetch(`/api/books/${book.id}/chapters`);
    if (r.ok) chapters = await r.json();
  } catch (e) { /* ignore */ }
  if (chapters.length) {
    document.getElementById('drawerList').innerHTML = chapters.map(c => `
      <a href="/read/${book.id}/${c.id}" class="${c.id === chapter.id ? 'current' : ''}"
         title="${site.escapeHtml(c.title)}">${site.escapeHtml(c.title)}</a>`).join('');
  }

  saveProgress(chapter);
  const idx = chapters.findIndex(c => c.id === chapter.id);
  document.getElementById('progressHint').textContent = idx >= 0 ? `第 ${idx + 1} / ${chapters.length} 章` : '';

  window.scrollTo(0, 0);
})();
