'use strict';

const assert = require('assert');
const JSZip = require('jszip');
const { renderPaperExport } = require('./paperExportRenderer');

(async () => {
  const snapshot = [
    { id: 'q1', stem: '<p>First stem</p>', answer: 'A', explanation: 'First explanation', options: [{ label: 'A', content: 'first option' }, { label: 'B', content: 'second option' }], richContent: { blocks: [{ type: 'formula', canonicalLatex: 'x^{2}' }] } },
    { id: 'q2', stem: 'Second stem', answer: 'B', explanation: 'Second explanation', options: ['B. another option'], richContent: null },
  ];
  const layout = { items: [{ id: 'q1', sectionTitle: 'Part one', score: 3 }, { id: 'q2', sectionTitle: 'Part one', score: 6 }] };
  const input = { title: 'Paper', answerPosition: 'end', layout, snapshot, formulaMode: 'latex-vector' };
  const word = await renderPaperExport({ ...input, format: 'word' });
  assert.strictEqual(word.extension, 'docx');
  assert.ok(word.bytes.subarray(0, 2).equals(Buffer.from('PK')));
  const wordXml = await (await JSZip.loadAsync(word.bytes)).file('word/document.xml').async('string');
  for (const expected of ['first option', 'second option', 'x^{2}', 'First explanation', 'Second explanation']) assert.ok(wordXml.includes(expected), `Word must retain ${expected}`);
  assert.ok(wordXml.indexOf('Second stem') < wordXml.indexOf('Answer: A'), 'end-position answers must follow every question in Word');
  const wordAfter = await renderPaperExport({ ...input, format: 'word', answerPosition: 'after' });
  const wordAfterXml = await (await JSZip.loadAsync(wordAfter.bytes)).file('word/document.xml').async('string');
  assert.ok(wordAfterXml.indexOf('Answer: A') < wordAfterXml.indexOf('Second stem'), 'after-position answers must follow their own question in Word');
  const pdf = await renderPaperExport({ ...input, format: 'pdf' });
  assert.strictEqual(pdf.extension, 'pdf');
  assert.ok(pdf.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
  assert.ok(pdf.bytes.includes(Buffer.from('NotoSansCJKsc-Regular')), 'PDF must embed the CJK-capable font used by Chinese question papers');
  const after = await renderPaperExport({ ...input, format: 'pdf', answerPosition: 'after' });
  assert.ok(after.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) && after.bytes.includes(Buffer.from('NotoSansCJKsc-Regular')),
    'after-position PDF must be rendered through the same CJK-capable renderer');
  console.log('paper export renderer checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
