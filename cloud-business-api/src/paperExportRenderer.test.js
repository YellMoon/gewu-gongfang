'use strict';

const assert = require('assert');
const JSZip = require('jszip');
const sharp = require('sharp');
const { renderPaperExport } = require('./paperExportRenderer');

(async () => {
  const imageBytes = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const assetCalls = [];
  const snapshot = [
    { id: 'q1', stem: '<p>First stem</p>', answer: 'A', explanation: 'First explanation', options: [{ label: 'A', content: 'first option' }, { label: 'B', content: 'second option' }], richContent: { blocks: [{ type: 'formula', canonicalLatex: 'x^{2}' }] }, assets: [{ assetKey: 'a'.repeat(64), fileName: 'diagram.png', mimeType: 'image/png', assetType: 'image' }, { assetKey: 'b'.repeat(64), fileName: 'formula-preview.png', mimeType: 'image/png', assetType: 'formula_preview' }] },
    { id: 'q2', stem: 'Second stem', answer: 'B', explanation: 'Second explanation', options: ['B. another option'], richContent: null },
  ];
  const layout = { items: [{ id: 'q1', sectionTitle: 'Part one', score: 3 }, { id: 'q2', sectionTitle: 'Part one', score: 6 }] };
  const input = { title: 'Paper', answerPosition: 'end', layout, snapshot, formulaMode: 'latex-vector' };
  const resolveQuestionAsset = async input => {
    assetCalls.push(input);
    return imageBytes;
  };
  const word = await renderPaperExport({ ...input, format: 'word' }, { resolveQuestionAsset });
  assert.strictEqual(word.extension, 'docx');
  assert.ok(word.bytes.subarray(0, 2).equals(Buffer.from('PK')));
  const wordXml = await (await JSZip.loadAsync(word.bytes)).file('word/document.xml').async('string');
  for (const expected of ['first option', 'second option', 'First explanation', 'Second explanation']) assert.ok(wordXml.includes(expected), `Word must retain ${expected}`);
  assert.ok(!wordXml.includes('x^{2}'), 'LaTeX source must be rendered as a formula instead of being falsely presented as finished paper text');
  for (const expected of ['试题', '参考答案', '答案：A', '解析：First explanation']) assert.ok(wordXml.includes(expected), `Word export must use Chinese paper labels: ${expected}`);
  assert.ok(wordXml.indexOf('Second stem') < wordXml.indexOf('答案：A'), 'end-position answers must follow every question in Word');
  const wordArchive = await JSZip.loadAsync(word.bytes);
  assert.ok(Object.keys(wordArchive.files).some(name => /^word\/media\/.+\.png$/.test(name)), 'Word must embed verified question images rather than omit them');
  assert.ok(Object.keys(wordArchive.files).some(name => /^word\/media\/.+\.svg$/.test(name)), 'Word must embed canonical formulas as vector images');
  assert.deepStrictEqual(assetCalls, [{ questionId: 'q1', assetKey: 'a'.repeat(64), fileName: 'diagram.png', mimeType: 'image/png', assetType: 'image' }, { questionId: 'q1', assetKey: 'b'.repeat(64), fileName: 'formula-preview.png', mimeType: 'image/png', assetType: 'formula_preview' }]);
  const wordAfter = await renderPaperExport({ ...input, format: 'word', answerPosition: 'after' }, { resolveQuestionAsset });
  const wordAfterXml = await (await JSZip.loadAsync(wordAfter.bytes)).file('word/document.xml').async('string');
  assert.ok(wordAfterXml.indexOf('答案：A') < wordAfterXml.indexOf('Second stem'), 'after-position answers must follow their own question in Word');
  const pdf = await renderPaperExport({ ...input, format: 'pdf' }, { resolveQuestionAsset });
  assert.strictEqual(pdf.extension, 'pdf');
  assert.ok(pdf.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
  assert.ok(!pdf.bytes.includes(Buffer.from('x^{2}')), 'PDF must contain formula vectors rather than raw LaTeX source');
  assert.ok(pdf.bytes.includes(Buffer.from('NotoSansCJKsc-Regular')), 'PDF must embed the CJK-capable font used by Chinese question papers');
  const after = await renderPaperExport({ ...input, format: 'pdf', answerPosition: 'after' }, { resolveQuestionAsset });
  assert.ok(after.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) && after.bytes.includes(Buffer.from('NotoSansCJKsc-Regular')),
    'after-position PDF must be rendered through the same CJK-capable renderer');
  console.log('paper export renderer checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
