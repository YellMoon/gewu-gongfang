'use strict';
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const sharp = require('sharp');
const { renderPaperExport, drawPdfOptions } = require('./paperExportRenderer');

async function verifyOptionColumns() {
  for (const [length, columns] of [[1, 4], [13, 2], [29, 1]]) {
    const options = Array.from({ length: 4 }, (_, index) => ({ label: String.fromCharCode(65 + index), content: 'x'.repeat(length) }));
    const result = await renderPaperExport({ format: 'word', title: 'Options', snapshot: [{ id: 'options', stem: 'Choose', options, answer: 'A' }] });
    const xml = await (await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
    assert.equal((xml.match(/<w:gridCol\b/g) || []).length, columns === 1 ? 0 : columns, 'Word option grid follows desktop');
    assert.equal((xml.match(/<w:tr>/g) || []).length, columns === 1 ? 0 : 4 / columns);
  }
  const calls = [];
  let size = 10;
  let pages = 0;
  const document = { x: 10, y: 95, page: { width: 300, height: 120, margins: { left: 10, right: 10, top: 10, bottom: 10 } },
    fontSize(value) { size = value; return this; }, currentLineHeight() { return 14; }, widthOfString(value) { return value.length * size / 2; },
    text(value, x, y) { calls.push({ value, x, y, page: pages }); return this; }, addPage() { pages++; this.y = 10; return this; } };
  const margins = { ...document.page.margins };
  drawPdfOptions(document, ['A. x', 'B. y', 'C. z', 'D. w'].map(text => [{ kind: 'text', text }]), 4);
  const labels = calls.filter(call => /^[ABCD]$/.test(call.value));
  assert.equal(labels.length, 4);
  assert.equal(new Set(labels.map(call => call.y)).size, 1, 'all four PDF columns share a row');
  assert.equal(new Set(labels.map(call => call.x)).size, 4);
  assert.equal(pages, 1, 'move the full option row to the next page when needed');
  assert.deepEqual(document.page.margins, margins, 'column drawing must restore page margins');
  const imageBytes = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const key = 'a'.repeat(64);
  const content = node => ({ type: 'doc', content: [{ type: 'paragraph', content: [node] }] });
  for (const node of [
    { type: 'image', attrs: { assetKey: key, width: 600, height: 300 } },
    { type: 'formula', attrs: { canonicalLatex: 'x^2', displayMode: 'inline' } },
  ]) {
    const snapshot = [{ id: 'rich-options', stem: 'Choose', options: [], assets: node.type === 'image' ? [{ assetKey: key, fileName: 'diagram.png', mimeType: 'image/png' }] : [],
      richContent: { version: 1, type: 'question-document', sections: { stem: content({ type: 'text', text: 'Choose' }),
        options: Array.from({ length: 4 }, (_, index) => ({ label: String.fromCharCode(65 + index), content: content(node) })), subQuestions: [] } } }];
    const input = { title: 'Rich options', snapshot, formulaMode: 'word-native' };
    const resolveQuestionAsset = async () => imageBytes;
    const word = await renderPaperExport({ ...input, format: 'word' }, { resolveQuestionAsset });
    const xml = await (await JSZip.loadAsync(word.bytes)).file('word/document.xml').async('string');
    assert.equal((xml.match(/<w:gridCol\b/g) || []).length, 4);
    if (node.type === 'formula') assert.equal((xml.match(/<m:oMath>/g) || []).length, 4, 'column formulas remain native editable Word equations');
    else {
      const widths = [...xml.matchAll(/<wp:extent cx="(\d+)"/g)].map(match => Number(match[1]) / 9525);
      assert.equal(widths.length, 4);
      assert(widths.every(width => width > 0 && width < 150), 'Word option images fit inside their columns');
      const pdf = await renderPaperExport({ ...input, format: 'pdf' }, { resolveQuestionAsset });
      const draws = [...pdf.bytes.toString('latin1').matchAll(/([\d.]+) 0 0 (-?[\d.]+) [\d.-]+ [\d.-]+ cm\s*\/I\d+ Do/g)];
      assert.equal(draws.length, 4);
      assert(draws.every(match => Number(match[1]) > 0 && Number(match[1]) < 115), 'PDF option images fit inside their columns');
    }
  }
  console.log('Word and PDF option column checks passed');
}
module.exports = verifyOptionColumns;
if (require.main === module) verifyOptionColumns().catch(error => { console.error(error); process.exitCode = 1; });
