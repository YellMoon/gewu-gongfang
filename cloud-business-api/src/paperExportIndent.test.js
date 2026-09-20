'use strict';
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const { questionXml } = require('./paperExportTestContent');
const { renderPaperExport } = require('./paperExportRenderer');

async function verifyExportIndent() {
  const { imageOptionColumns, questionBlocks } = require('./paperExportQuestionLayout');
  const marker = text => ({ kind: 'text', text });
  const picture = { kind: 'image', media: { width: 1200, height: 600, displayWidth: 120, displayHeight: 60 } };
  const imageOptions = ['A', 'B', 'C', 'D'].map(label => [marker(label + '.'), picture]);
  assert.equal(imageOptionColumns(imageOptions, 396), 4, 'exact four-column boundary fits');
  assert.equal(imageOptionColumns(imageOptions, 395.9), 2, 'one fraction beyond the boundary selects two rows');
  assert.equal(imageOptionColumns(imageOptions, 191.9), 1, 'two-column overflow selects four rows');
  const split = imageOptions.flatMap(p => [p[0], { kind: 'break' }, p[1], { kind: 'break' }]);
  assert.equal(questionBlocks(split)[0].kind, 'options', 'labels and pictures in separate paragraphs still form a group');
  assert.equal(questionBlocks(imageOptions.flat())[0].kind, 'options', 'inline source picture options still form a group');
  assert(!questionBlocks(split.slice(0, -4)).some(b => b.kind === 'options'), 'an incomplete group must not consume another paragraph');
  assert(!questionBlocks([marker('A. ordinary prose'), picture]).some(b => b.kind === 'options'));
  const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const labels = ['(1)', '\uff08\uff12\uff09', '\u2460', '\u2473', 'a.', 'b\uff0e', 'c.', 'd\uff0e'];
  const snapshot = [{ id: 'indent', stem: 'MAIN', richContent: { sections: {
    stem: { type: 'doc', content: [paragraph('MAIN'), ...labels.map(label => paragraph(label + ' content'.repeat(20))), paragraph('NORMAL')] },
    options: ['A. ' + 'option'.repeat(30), 'B. ' + 'option'.repeat(30)],
    subQuestions: [{ label: '(3)', content: { type: 'doc', content: [paragraph('STRUCTURED')] } }],
  } } }];
  const word = await renderPaperExport({ format: 'word', title: 'Indent', snapshot });
  const xml = await questionXml(await JSZip.loadAsync(word.bytes));
  for (const label of [...labels, 'A.', 'B.', '(3)']) {
    const p = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(m => m[0]).find(p => p.includes(label));
    assert(p && /<w:ind\b[^>]*w:left="420"/.test(p), `${label}: whole paragraph must indent 2 x 10.5pt, including wrapped lines`);
    assert(!/w:firstLine="[1-9]/.test(p), 'not first-line-only indentation');
  }
  const normal = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(m => m[0]).find(p => p.includes('NORMAL'));
  assert(!normal.includes('w:left="420"'), 'plain paragraphs must not inherit subquestion indentation');
  const calls = [], original = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function(text, x, y, ...args) { calls.push({ text, x, y }); return original.call(this, text, x, y, ...args); };
  try {
    await renderPaperExport({ format: 'pdf', title: 'Indent', snapshot });
    await renderPaperExport({ format: 'pdf', title: 'Footer', snapshot: [{ id: 'long', stem: 'Z '.repeat(4000) }] });
  }
  finally { PDFDocument.prototype.text = original; }
  assert(calls.some(c => c.text === '\u2460' && Math.abs(c.x - (1134 / 20 + 21)) < 0.01), 'PDF indents exactly two CJK widths');
  assert(calls.filter(c => c.text === 'Z').every(c => c.y < 16838 / 20 - 1134 / 20 - 16), 'flowing body text cannot enter the supplied footer clearance');

  const key = 'a'.repeat(64);
  const bytes = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#ffffff' } }).png().toBuffer();
  for (const [imageWidth, columns] of [[100, 4], [220, 2], [550, 1]]) {
    const image = { type: 'image', attrs: { assetKey: key, width: imageWidth, height: imageWidth / 2 } };
    const optionParagraphs = ['A', 'B', 'C', 'D'].map(label => ({ type: 'paragraph', content: [{ type: 'text', text: label + '\uff0e' }, structuredClone(image)] }));
    for (const embedded of [false, true]) {
      const sections = { stem: { type: 'doc', content: [paragraph('MAIN')] }, options: [], subQuestions: [] };
      if (embedded) sections.subQuestions = [{ label: '(1)', content: { type: 'doc', content: [paragraph('EMBEDDED'), ...optionParagraphs, paragraph('\u2460 END')] } }];
      else sections.options = optionParagraphs.map((p, i) => ({ label: String.fromCharCode(65 + i), content: { type: 'doc', content: [{ ...p, content: [image] }] } }));
      const input = { title: 'Image options', snapshot: [{ id: 'images', stem: 'MAIN', assets: [{ assetKey: key, fileName: 'option.png', mimeType: 'image/png' }], richContent: { sections } }] };
      const result = await renderPaperExport({ ...input, format: 'word' }, { resolveQuestionAsset: async () => bytes });
      const xml = await questionXml(await JSZip.loadAsync(result.bytes));
      assert.equal((xml.match(/<w:gridCol\b/g) || []).length, columns === 1 ? 0 : columns, `image width ${imageWidth}, embedded=${embedded}`);
      if (columns > 1) assert.match(xml, /<w:tblInd\b[^>]*w:w="420"/, 'whole option grid indents two CJK widths');
      const widths = [...xml.matchAll(/<wp:extent cx="(\d+)"/g)].map(m => Number(m[1]) / 9525);
      assert.equal(widths.length, 4);
      assert(widths.every(w => Math.abs(w - imageWidth) < 0.1), 'do not shrink images to force more columns');
      const drawn = [], origImage = PDFDocument.prototype.image;
      PDFDocument.prototype.image = function(data, x, y, dimensions) { drawn.push({ x, y, ...dimensions }); return origImage.call(this, data, x, y, dimensions); };
      try { await renderPaperExport({ ...input, format: 'pdf' }, { resolveQuestionAsset: async () => bytes }); }
      finally { PDFDocument.prototype.image = origImage; }
      assert.equal(drawn.length, 4);
      // Separate pages can have equal y; use distinct x positions for columns.
      assert.equal(new Set(drawn.map(d => d.x)).size, columns);
      assert(drawn.every(d => Math.abs(d.width - imageWidth * 0.75) < 0.1));
    }
  }
  console.log('Export paragraph indentation and size-aware image options passed');
}
module.exports = verifyExportIndent;
if (require.main === module) verifyExportIndent().catch(e => { console.error(e); process.exitCode = 1; });
