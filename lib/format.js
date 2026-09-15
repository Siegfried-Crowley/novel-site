'use strict';

/**
 * TXT 排版检测与自动重排
 *
 * 背景：很多上传的 TXT 是「固定宽度硬折行」——每行在固定字数处换行，经常断在
 * 句子中间。前台按 \n 拆段渲染，每个硬折行都会变成一个 <p>，阅读体验很差。
 *
 * 本模块只做两件事：
 *  1. 检测章节排版质量（verdict：hard-wrap / good / blob / verse / empty）
 *  2. 对硬折行章节做重排：把断在中间的行重新拼成完整段落。
 *
 * 重排只把行重新拼接成段落、去掉每行首尾空白，不增删任何文字。
 */

// 句末或成对符号右半边（「」『』括号右半边 + 中文/英文右引号）——段落收尾信号。
// 注意必须包含右引号 ” ’ " '：对话行常以「…」” 或「？」” 结尾，漏掉会把好排版误判为硬折行。
const PARA_CLOSE_RE = /[。！？…」』」）】〉”’"')]$/;

/** 取数组的 q 分位数（用于估算折行宽度） */
function percentile(arr, q) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor(q * s.length));
  return s[i];
}

/** 统计按空行切分的段落数（连续非空行算一段） */
function countParagraphs(lines) {
  let paras = 0, inPara = false;
  for (const l of lines) {
    if (l.trim()) {
      if (!inPara) { paras++; inPara = true; }
    } else {
      inPara = false;
    }
  }
  return paras;
}

/**
 * 检测一章内容的排版质量
 * @param {string} content 章节正文
 * @returns {{verdict:string, endRatio:number, wrapWidth:number, lineCount:number, paraCount:number}}
 *  verdict：
 *   - 'hard-wrap' 硬折行（行尾大量落在句子中间）→ 可自动重排
 *   - 'good'      正常排版（一行一段）
 *   - 'blob'      大段连排（存在超长单行）→ 无段落标记，无法可靠自动断段
 *   - 'verse'     一句一行（短行 + 句末标点齐全）→ 阅读可接受，不动
 *   - 'empty'     无正文
 */
function detectChapter(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return { verdict: 'empty', endRatio: 1, wrapWidth: 0, lineCount: 0, paraCount: 0 };
  }
  const lines = content.split(/\r?\n/);
  const nonBlank = lines.filter(l => l.trim());
  const lens = nonBlank.map(l => l.trim().length);
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  const max = Math.max(...lens);
  const endRatio = nonBlank.filter(l => PARA_CLOSE_RE.test(l.trim())).length / nonBlank.length;
  const wrapWidth = percentile(lens, 0.8);

  let verdict;
  if (max > 300) verdict = 'blob';                       // 整章一大坨
  else if (nonBlank.length < 4) verdict = 'good';        // 太短（书名/作者等开篇元信息），不冒险重排
  else if (endRatio < 0.75 && wrapWidth < 120) verdict = 'hard-wrap';
  else if (avg < 18 && endRatio >= 0.75) verdict = 'verse';
  else verdict = 'good';

  return { verdict, endRatio, wrapWidth, lineCount: lines.length, paraCount: countParagraphs(lines) };
}

/**
 * 重排一章：仅当检测为 hard-wrap 时，把断行拼接成完整段落（段落间用空行分隔）。
 * 非 hard-wrap 章节原样返回。
 * @returns {{content:string, changed:boolean, verdict:string, stats:object}}
 */
function reflowChapter(content) {
  const det = detectChapter(content);
  if (det.verdict !== 'hard-wrap') {
    return {
      content,
      changed: false,
      verdict: det.verdict,
      stats: { beforeLines: det.lineCount, afterParas: det.paraCount },
    };
  }

  const W = det.wrapWidth;
  const lines = content.split(/\r?\n/);
  const paras = [];
  let buf = [];
  const flush = () => { if (buf.length) { paras.push(buf.join('')); buf = []; } };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }                    // 空行 = 段落分隔
    if (buf.length === 0) { buf.push(line); continue; }
    const last = buf[buf.length - 1];
    // 段落结束条件：前一行以句末标点收尾，且明显短于折行宽（说明段落在行内自然收尾）
    // 满宽的行即使碰巧以句末标点结尾，也多半是段内换行，继续拼接，避免过度切段。
    const prevShort = last.length < W * 0.72;
    if (PARA_CLOSE_RE.test(last) && prevShort) {
      flush();
      buf.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();
  if (!paras.length) paras.push(lines.map(l => l.trim()).filter(Boolean).join(''));

  const out = paras.join('\n\n');
  return {
    content: out,
    changed: out !== content,
    verdict: det.verdict,
    stats: { beforeLines: det.lineCount, afterParas: paras.length },
  };
}

/**
 * 逐章检测整本书，聚合排版质量。
 * @param {Array<{content:string}>} chapters
 * @returns {{total:number, hardWrap:number, good:number, blob:number, verse:number, empty:number, verdict:string}}
 */
function analyzeBook(chapters) {
  const agg = { total: 0, hardWrap: 0, good: 0, blob: 0, verse: 0, empty: 0 };
  for (const ch of chapters || []) {
    agg.total++;
    const v = detectChapter((ch && ch.content) || '').verdict;
    if (v === 'hard-wrap') agg.hardWrap++;
    else if (v === 'good') agg.good++;
    else if (v === 'blob') agg.blob++;
    else if (v === 'verse') agg.verse++;
    else agg.empty++;
  }
  agg.verdict = agg.total > 0 && agg.hardWrap > 0 ? 'hard-wrap' : 'ok';
  return agg;
}

module.exports = { detectChapter, reflowChapter, analyzeBook };
