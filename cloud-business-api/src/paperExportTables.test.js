'use strict';
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { questionXml } = require('./paperExportTestContent');
const sharp = require('sharp');
const { renderPaperExport, drawPdfTokens } = require('./paperExportRenderer');

async function verifyTables() {
  const text = value => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
  const cell = (value, attrs = {}, type = 'tableCell') => ({ type, attrs, content: typeof value === 'string' ? [text(value)] : value });
  const row = (...content) => ({ type: 'tableRow', content });
  const assetKey = 'c'.repeat(64);
  const table = { type: 'table', content: [
    row(cell('Road', { colspan: 2 }, 'tableHeader')),
    row(cell([{ type: 'paragraph', content: [{ type: 'formula', attrs: { canonicalLatex: 'x^2', displayMode: 'inline' } }] }], { rowspan: 2 }), cell('Dry')),
    row(cell([{ type: 'paragraph', content: [{ type: 'image', attrs: { assetKey, width: 100, height: 50 } }] }])),
  ] };
  const snapshot = [{ id: 'table', stem: 'Before table', options: [], assets: [{ assetKey, fileName: 'diagram.png', mimeType: 'image/png' }],
    richContent: { version: 1, type: 'question-document', sections: { stem: { type: 'doc', content: [text('Before table'), table, text('After table')] }, options: [], subQuestions: [] } } }];
  const bytes = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#336677' } }).png().toBuffer();
  const input = { title: 'Table fidelity', snapshot, formulaMode: 'word-native' };
  const word = await renderPaperExport({ ...input, format: 'word' }, { resolveQuestionAsset: async () => bytes });
  const xml = await questionXml(await JSZip.loadAsync(word.bytes));
  assert.match(xml, /<w:tbl>/, 'Word must contain a real table');
  assert.match(xml, /<w:gridSpan w:val="2"/);
  assert.match(xml, /<w:vMerge w:val="restart"/);
  assert.equal((xml.match(/<m:oMath>/g) || []).length, 1, 'table formulas stay native and editable');
  assert.equal((xml.match(/<w:drawing>/g) || []).length, 1, 'table image must not be duplicated after the body');
  assert(xml.indexOf('Before table') < xml.indexOf('<w:tbl>') && xml.indexOf('</w:tbl>') < xml.indexOf('After table'));
  const pdf = await renderPaperExport({ ...input, format: 'pdf' }, { resolveQuestionAsset: async () => bytes });
  assert(pdf.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));

  const calls = []; let fontSize = 10; let page = 0;
  const doc = { x: 10, y: 95, page: { width: 300, height: 140, margins: { left: 10, right: 10, top: 10, bottom: 10 } },
    fontSize(value) { fontSize = value; return this; }, currentLineHeight() { return 14; }, widthOfString(value) { return value.length * fontSize / 2; },
    text(value, x, y) { calls.push({ value, x, y, page }); return this; }, addPage() { page++; this.y = 10; return this; },
    save() { return this; }, restore() { return this; }, lineWidth() { return this; }, stroke() { return this; },
    rect(x, y, width, height) { calls.push({ kind: 'cell', x, y, width, height, page }); return this; } };
  const tokens = [{ kind: 'table', rows: [
    [{ colspan: 2, rowspan: 1, tokens: [{ kind: 'text', text: 'Header' }] }],
    [{ colspan: 1, rowspan: 1, tokens: [{ kind: 'text', text: 'A' }] }, { colspan: 1, rowspan: 1, tokens: [{ kind: 'text', text: 'B' }] }],
  ] }];
  const originalMargins = { ...doc.page.margins };
  drawPdfTokens(doc, tokens);
  assert.equal(calls.filter(call => call.kind === 'cell').length, 3, 'PDF must draw cell borders');
  const a = calls.find(call => call.value === 'A'), b = calls.find(call => call.value === 'B');
  assert(a && b && a.y === b.y && a.x < b.x, 'PDF cells share a row, not flattened lines');
  assert(page > 0, 'table overflow creates a page');
  assert.deepEqual(doc.page.margins, originalMargins);
  assert(calls.filter(call => call.kind === 'cell').every(call => call.y + call.height <= 130.01));
  const manyRows = { kind: 'table', rows: Array.from({ length: 30 }, (_, i) => [{ colspan: 1, rowspan: 1, tokens: [{ kind: 'text', text: String(i) }] }]) };
  calls.length = 0;
  drawPdfTokens(doc, [manyRows]);
  assert.equal(calls.filter(call => call.kind === 'cell').length, 30, 'long tables paginate without losing rows');
  assert(calls.filter(call => call.kind === 'cell').every(call => call.y + call.height <= 130.01));
  assert.throws(() => drawPdfTokens(doc, [{ kind: 'table', rows: [[{ colspan: 0, rowspan: 1, tokens: [] }]] }]), /TABLE_INVALID/);
  assert.throws(() => drawPdfTokens(doc, [{ kind: 'table', rows: [[{ colspan: 1, rowspan: 1, tokens: [{ kind: 'text', text: 'long '.repeat(500) }] }]] }]), /TABLE_TOO_TALL/, 'never silently clip a cell larger than a page');
  assert.deepEqual(doc.page.margins, originalMargins);
  const nestedInput = structuredClone(input);
  nestedInput.snapshot[0].richContent.sections.stem.content = [{ type: 'table', content: [row(cell([{ type: 'table', content: [row(cell('Nested'))] }]))] }];
  nestedInput.snapshot[0].assets = [];
  nestedInput.snapshot[0].richContent.sections.options = ['A', 'B'].map(label => ({ label, content: { type: 'doc', content: [{ type: 'table', content: [row(cell(label))] }] } }));
  for (const format of ['word', 'pdf']) {
    const result = await renderPaperExport({ ...nestedInput, format });
    assert(result.bytes.length > 1000, 'nested tables and tables inside options render');
    if (format === 'word') {
      const xml = await (await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
      assert.equal((xml.match(/<w:tbl>/g) || []).length, 5, 'nested data tables and the option grid remain distinct');
    }
  }
  console.log('Word/PDF table structure, merged cells, media and native formula checks passed');
}
module.exports = verifyTables;
if (require.main === module) verifyTables().catch(error => { console.error(error); process.exitCode = 1; });
