'use strict';

/**
 * TXT 小说解析器
 * 编码识别 + 清洗 + 书名/作者提取 + 章节切分 + 字数统计
 */
const fs = require('fs');
const iconv = require('iconv-lite');
const jschardet = require('jschardet');

/**
 * 章节标题「起始标记」：第X章/回/节/卷/集/部/篇、Chapter X、序章/楔子/引子/前言/尾声/后记/终章/大结局/番外
 */
const CHAPTER_MARKER_RE = /^(第\s*[0-9一二三四五六七八九十百千万零〇两]+\s*[章回节卷集部篇]|Chapter\s*\d+|序章|楔子|引子|前言|尾声|后记|终章|大结局|番外)/i;

// 标题后常见分隔符（空格/冒号/破折号/引号/括号等）
const TITLE_DELIM_RE = /^[\s:：\-—–·。、\.「『"''"（(【[*~～]/;

/** 用户可参考的默认切分正则（管理端「重新切分」界面展示） */
const DEFAULT_CHAPTER_PATTERN = '第\\s*[0-9一二三四五六七八九十百千万零〇两]+\\s*[章回节卷集部篇]|Chapter\\s*\\d+|序章|楔子|引子|前言|尾声|后记|终章|大结局|番外';

// 纯分隔行（--------、========、~~~ 等）
const SEPARATOR_RE = /^\s*[-_=*~#·—.。]+\s*$/;

// 作者行：要求「作者」后带冒号或空白，避免误匹配「作者简介」等
const AUTHOR_RE = /作者\s*[:：]\s*([^\s:：]{1,30})|作者\s+([^\s:：]{1,30})/;

// 正文句读（标题里几乎不会出现）
const CONTENT_PUNCT_RE = /[，。！？、；]/;

/**
 * 判断一行是否为章节标题。
 * 说明：纯正则「第X章」会误伤正文行（如「第二章内容，…」），
 * 因此采用启发式：
 *  - 标记后接分隔符（空格/冒号/破折号/引号等）→ 标题
 *  - 带编号（第X章 / Chapter X）且后缀短(≤30字)、无句读 → 标题
 *  - 裸词（序章/番外等）必须独立成行或接分隔符
 *
 * 为什么后缀长度放宽到 30：合集类书籍的章节标题可能很长
 * （如「第三章星空下的野战~亚丝娜篇二」），太严会被吞进上一章。
 * 真正的正文句子几乎都带句读（，。！？），由 CONTENT_PUNCT_RE 拦下。
 */
function isChapterTitle(line) {
  const base = line.trim();
  if (!base) return false;
  const m = base.match(CHAPTER_MARKER_RE);
  if (!m) return false;
  const rem = base.slice(m[0].length);
  if (!rem) return true;                      // 「第一章」独立成行
  if (TITLE_DELIM_RE.test(rem)) return true;  // 接空格/冒号/破折号等
  const numbered = m[0].includes('第') || /Chapter\s*\d/i.test(m[0]);
  if (!numbered) return false;                // 裸词必须独立或接分隔符
  return rem.length <= 30 && !CONTENT_PUNCT_RE.test(rem);
}

/** 把字符串转为正则对象（行首匹配），无效返回 null */
function toRegex(input) {
  if (input instanceof RegExp) return input;
  if (typeof input !== 'string' || !input.trim()) return null;
  try {
    return new RegExp(`^\\s*${input.trim()}`, 'i');
  } catch (e) {
    return null;
  }
}

/** 去空白（用于字数统计） */
function countWords(text) {
  return text.replace(/\s/g, '').length;
}

/**
 * 从 Buffer 解码文本：优先整本 UTF-8 严格校验，其次 jschardet 采样探测，GBK/GB18030 兜底。
 * 注意：jschardet 只对开头 64KB 采样 —— 对整本大文件全量探测会把服务器卡死
 * （上传整本小说时表现为「点了没反应」）。
 *
 * 为什么先做整本 UTF-8 校验而不是只查采样：UTF-8 采样如果恰好切断一个多字节字符
 * 会被误判为「非法 UTF-8」，进而把整本 UTF-8 文件按 GBK 解成乱码（銆€鍚変粬…）。
 * TextDecoder 是原生实现，整本校验很快（远快于 jschardet），所以放心整本查。
 */
function decodeBuffer(buf) {
  // 去掉 BOM
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);

  // 1) 整本合法 UTF-8 → 直接按 UTF-8 解码（最常见，最快，不跑 jschardet）
  if (isValidUtf8(buf)) return buf.toString('utf8');

  // 2) 非 UTF-8 → 采样探测（GBK / Big5 / GB18030 等）
  const sample = buf.length > 65536 ? buf.subarray(0, 65536) : buf;
  let detected;
  try {
    detected = jschardet.detect(sample);
  } catch (e) {
    detected = null;
  }
  const enc = (detected && detected.encoding || '').toLowerCase();
  if (enc === 'utf-8') return buf.toString('utf8');
  if (['gb2312', 'gbk', 'gb18030', 'big5'].includes(enc)) {
    return iconv.decode(buf, 'gb18030'); // gb18030 是 gbk/gb2312 的超集
  }

  // 3) 兜底：按 GB18030（gbk/gb2312 超集）强行解码
  return iconv.decode(buf, 'gb18030');
}

function isValidUtf8(buf) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 清洗：去掉 \r、跳过全空行与分隔符行
 */
function cleanLines(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r/g, '').trim();
    if (!line || SEPARATOR_RE.test(line)) continue;
    lines.push(line);
  }
  return lines;
}

/** 从文件名提取书名（去掉扩展名） */
function titleFromFilename(filename) {
  return (filename || '').replace(/\.txt$/i, '').trim() || '未命名小说';
}

/**
 * 解析整本 TXT
 * @param {Buffer} buf
 * @param {string} [filename] 用于兜底书名
 * @param {string} [chapterRegex] 自定义章节正则（重新切分时用）
 * @returns {{title:string, author:string, chapters:Array<{title:string, content:string}>, word_count:number, encoding:string}}
 */
function parseTxt(buf, filename, chapterRegex) {
  const text = decodeBuffer(buf);
  const encoding = 'detected';
  const lines = cleanLines(text);
  const customRe = toRegex(chapterRegex);
  const isTitle = (line) => (customRe ? customRe.test(line) : isChapterTitle(line));

  // —— 书名 / 作者 ——
  // 书名一律取 TXT 文件名（管理者的文件名就是设计好的小说名），文件名为空才退回首行
  let title = titleFromFilename(filename) || lines[0] || '未命名小说';
  let author = '';
  for (const line of lines.slice(0, 15)) {
    const m = line.match(AUTHOR_RE);
    if (m) {
      author = (m[1] || m[2] || '').trim();
      break;
    }
  }

  // —— 切分章节 ——
  // 只有带正文的章节才保留：开头的「第一卷」等卷/篇标题（后无正文）不会被切成一个空章节
  const chapters = [];
  let current = null;
  let opening = []; // 第一个章节标题之前的开篇正文（如合集开头的主角设定），不能丢
  const push = () => {
    if (current && current.lines.length > 0) {
      chapters.push({ title: current.title, content: current.lines.join('\n') });
    }
  };

  for (const line of lines) {
    if (isTitle(line)) {
      push();
      current = { title: line.trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      opening.push(line);
    }
  }
  push();

  // 开篇正文（标题前的无主内容）作为「第 1 章」放最前，避免整段内容丢失
  if (opening.length > 0) {
    chapters.unshift({ title: '第 1 章', content: opening.join('\n') });
  }

  // 兜底：整本没匹配到任何章节标题 → 整本作为「第 1 章」
  if (chapters.length === 0) {
    chapters.push({ title: '第 1 章', content: lines.join('\n') });
  }

  const word_count = countWords(text);

  return { title, author, chapters, word_count, encoding };
}

/**
 * 读取文件并解析（供重新切分 / 上传流程使用）
 */
function parseTxtFile(filePath, filename, chapterRegex) {
  return parseTxt(fs.readFileSync(filePath), filename, chapterRegex);
}

module.exports = {
  parseTxt,
  parseTxtFile,
  decodeBuffer,
  countWords,
  isChapterTitle,
  CHAPTER_MARKER_RE,
  DEFAULT_CHAPTER_PATTERN,
};
