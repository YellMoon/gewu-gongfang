'use strict';

const BODY_SIZE = 10.5;
const INDENT_PT = BODY_SIZE * 2;
const INDENT_TWIPS = INDENT_PT * 20;
const OPTION_GAP_PT = 12;
const optionLabel = text => /^\s*([A-D])[.\uff0e\u3001]\s*$/.exec(text);
const textOf = tokens => tokens.filter(t => t.kind === 'text').map(t => t.text).join('');
const isSubquestion = text => /^\s*(?:[\(\uff08][0-9\uff10-\uff19]+[\)\uff09]|[\u2460-\u2473\u3251-\u325f\u32b1-\u32bf]|[abcd][.\uff0e]|[A-G][.\uff0e\u3001])/.test(text);

// Display dimensions are CSS px, not bitmap pixel counts (often high-DPI).
// With no display dimensions, the bitmap's 96dpi natural size is conservative.
function imageWidthPt(token) {
  const m = token.media;
  if (!m) return Infinity;
  const width = m.displayWidth ?? (m.displayHeight != null ? m.displayHeight * m.width / m.height : m.width);
  return Number.isFinite(width) && width > 0 ? width * 0.75 : Infinity;
}

function imageOptionColumns(options, availableWidthPt, fallback = 1) {
  if (![2, 4].includes(options.length)) return fallback;
  const widths = options.map(tokens => {
    const images = tokens.filter(t => t.kind === 'image');
    if (images.length !== 1 || !optionLabel(textOf(tokens)) || tokens.some(t => !['text', 'break', 'image'].includes(t.kind))) return null;
    return imageWidthPt(images[0]);
  });
  if (widths.some(w => w === null)) return fallback;
  // Labels are on their own short line above the image; never downscale just
  // to force four columns. Only the final single-column image may fit the page.
  for (const columns of options.length === 4 ? [4, 2] : [2]) {
    const cell = (availableWidthPt - OPTION_GAP_PT * (columns - 1)) / columns;
    if (widths.every(w => w <= cell)) return columns;
  }
  return 1;
}

function questionBlocks(tokens, prefix = '', forceIndent = false) {
  const paragraphs = [];
  let current = [];
  const flush = () => { if (current.length) paragraphs.push(current); current = []; };
  for (const token of tokens || []) {
    if (token.kind === 'break') { flush(); continue; }
    if (token.kind === 'text') {
      const lines = token.text.split(/\r?\n/);
      lines.forEach((text, i) => {
        if (i) flush();
        if (optionLabel(text) && current.some(t => t.kind === 'image')) flush();
        if (text) current.push({ ...token, text });
      });
    } else current.push(token);
  }
  flush();
  // A label and its image may be stored as separate source paragraphs.
  for (let i = 0; i < paragraphs.length - 1; i++) {
    if (optionLabel(textOf(paragraphs[i])) && !paragraphs[i].some(t => t.kind === 'image') &&
        paragraphs[i + 1].every(t => t.kind === 'image')) paragraphs.splice(i, 2, [...paragraphs[i], ...paragraphs[i + 1]]);
  }
  const blocks = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const options = paragraphs.slice(i, i + 4);
    if (options.length === 4 && options.every((p, n) => optionLabel(textOf(p))?.[1] === 'ABCD'[n] && p.filter(t => t.kind === 'image').length === 1 && p.every(t => ['text', 'image'].includes(t.kind)))) {
      blocks.push({ kind: 'options', options }); i += 3;
    } else {
      const lead = i === 0 ? prefix : '';
      blocks.push({ kind: 'paragraph', tokens: paragraphs[i], prefix: lead, indent: forceIndent || isSubquestion(lead + textOf(paragraphs[i])) });
    }
  }
  if (!blocks.length && prefix) blocks.push({ kind: 'paragraph', tokens: [], prefix, indent: forceIndent || isSubquestion(prefix) });
  // Retain the original renderer's final-line + following-image pagination.
  // A structural paragraph boundary must not orphan an associated diagram.
  for (let i = 0; i < blocks.length - 1; i++) {
    const before = blocks[i], after = blocks[i + 1];
    if (before.kind === 'paragraph' && after.kind === 'paragraph' && before.indent === after.indent &&
        !after.prefix && after.tokens.length && after.tokens.every(t => t.kind === 'image')) {
      before.tokens = [...before.tokens, { kind: 'break' }, ...after.tokens];
      blocks.splice(i + 1, 1); i--;
    }
  }
  return blocks;
}

module.exports = { BODY_SIZE, INDENT_PT, INDENT_TWIPS, OPTION_GAP_PT, imageOptionColumns, questionBlocks };
