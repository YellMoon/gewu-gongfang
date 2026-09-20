'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { drawPdfTokens } = require('./paperExportRenderer');
const { layoutInlineRuns } = require('./pdfInlineLayout');

async function verifyPdfSymbols() {
  // MathJax emits these real-source symbols as SVG <text>, not vector paths.
  // Inspect the actual PDF font encoding, not only the presence of source text.
  const doc = new PDFDocument();
  doc.resume();
  const encoded = [], observed = new Set(), selectFont = doc.font;
  doc.font = function (...args) {
    const result = selectFont.apply(this, args), font = this._font;
    if (!observed.has(font)) {
      observed.add(font);
      const encode = font.encode;
      font.encode = function (value, ...rest) {
        encoded.push({ text: value, glyphs: [...value].map(char => font.font?.glyphForCodePoint?.(char.codePointAt(0))?.id ?? 0) });
        return encode.call(this, value, ...rest);
      };
    }
    return result;
  };
  doc.font(path.join(__dirname, '../../backend/assets/fonts/NotoSansCJKsc-Regular.otf'));
  const originalFont = doc._font;
  for (const text of ['π', 'μ', 'µ', '＋', '－', '（', '）']) {
    drawPdfTokens(doc, [{ kind: 'formula', displayMode: 'inline', media: { width: 20, height: 12,
      bytes: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="12"><text x="0" y="10" font-family="serif">${text}</text></svg>`) } }]);
    const rows = encoded.filter(row => row.text.includes(text));
    assert(rows.length > 0 && rows.every(row => row.glyphs.every(id => id > 0)), `SVG fallback must encode a visible glyph for ${text}`);
    assert.equal(doc._font, originalFont, 'formula fallback must not leak font selection');
  }
  doc.end();

  const lines = layoutInlineRuns({ tokens: [{ kind: 'text', text: 't₁+x₂+m⁰+m²+v₁₀', italic: true }],
    size: 12, lineHeight: 16, maxWidth: 500, measureText: (text, size) => [...text].length * size / 2 });
  const runs = lines.flatMap(line => line.runs);
  assert.equal(runs.map(run => run.text).join(''), 't1+x2+m0+m2+v10', 'Unicode scripts use supported base glyphs without deleting their content');
  const scripts = runs.filter(run => /^[012]$/.test(run.text));
  assert.equal(scripts.length, 6);
  assert(scripts.every(run => run.fontSize === 9 && run.italic), 'script glyphs retain emphasis and use reduced text size');
  assert.equal(scripts.filter(run => run.offsetY > 0).length, 4, 'numeric subscripts remain below the baseline');
  assert.equal(scripts.filter(run => run.offsetY < 0).length, 2, 'numeric superscripts remain above the baseline');
  console.log('paper export PDF Unicode formula and script glyph checks passed');
}

module.exports = verifyPdfSymbols;
if (require.main === module) verifyPdfSymbols().catch(error => { console.error(error); process.exitCode = 1; });
