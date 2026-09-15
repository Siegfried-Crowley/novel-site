'use strict';

/**
 * SVG 渐变封面自动生成（零依赖）
 * 无封面时按书名确定性生成一张好看的 3:4 封面。
 */

// 一组好看的渐变配色（深色系为主，配白字）
const PALETTES = [
  ['#1e3c72', '#2a5298'],
  ['#0f3443', '#34e89e'],
  ['#2c3e50', '#fd746c'],
  ['#41295a', '#2f0743'],
  ['#004e92', '#000428'],
  ['#42275a', '#734b6d'],
  ['#1a2a6c', '#b21f1f'],
  ['#0f2027', '#2c5364'],
  ['#603813', '#b29f94'],
  ['#355c7d', '#c06c84'],
  ['#141e30', '#243b55'],
  ['#232526', '#414345'],
];

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function paletteFor(title) {
  return PALETTES[hashCode(title || '') % PALETTES.length];
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 中文按字符宽度折行（每个汉字近似等宽）。
 * @returns {string[]} 行数组
 */
function wrapTitle(title, maxPerLine) {
  const chars = String(title).replace(/\s+/g, '').split('');
  const lines = [];
  for (let i = 0; i < chars.length; i += maxPerLine) {
    lines.push(chars.slice(i, i + maxPerLine).join(''));
  }
  return lines;
}

/**
 * 生成 SVG 封面
 * @param {string} title 书名
 * @param {number} [width=300]
 * @param {number} [height=400]
 * @returns {string} SVG 字符串
 */
function generateCover(title, width = 300, height = 400) {
  const [c1, c2] = paletteFor(title);
  const maxPerLine = Math.max(2, Math.floor(width / 28)); // 每字约 28px
  const lines = wrapTitle(title, maxPerLine).slice(0, 6);
  const fontSize = Math.min(30, Math.floor(width / (Math.max(maxPerLine, 4)) * 0.9));

  const lineHeight = fontSize * 1.5;
  const totalH = lines.length * lineHeight;
  const startY = (height - totalH) / 2 + fontSize / 2;

  // 装饰性圆形（半透明）
  const circles = [
    `circle cx="${width * 0.15}" cy="${height * 0.12}" r="${width * 0.28}" fill="rgba(255,255,255,0.06)"`,
    `circle cx="${width * 0.9}" cy="${height * 0.85}" r="${width * 0.34}" fill="rgba(255,255,255,0.05)"`,
    `circle cx="${width * 0.75}" cy="${height * 0.22}" r="${width * 0.12}" fill="rgba(255,255,255,0.04)"`,
  ].join('\n    ');

  const textLines = lines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      return `<text x="50%" y="${y}" text-anchor="middle" fill="#ffffff" font-size="${fontSize}" font-weight="700" font-family="'Microsoft YaHei','PingFang SC',sans-serif" letter-spacing="2">${escapeXml(line)}</text>`;
    })
    .join('\n    ');

  // 上下分隔装饰线
  const underline = lines.length > 0
    ? `<rect x="${width * 0.32}" y="${startY + totalH / 2 + fontSize * 0.6}" width="${width * 0.36}" height="2" fill="rgba(255,255,255,0.35)"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  ${circles}
  <rect x="8" y="8" width="${width - 16}" height="${height - 16}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/>
  ${textLines}
  ${underline}
</svg>`;
}

module.exports = { generateCover, escapeXml };
