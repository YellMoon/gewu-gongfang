'use strict';

const assert = require('assert');
const { renderPaperExport } = require('./paperExportRenderer');

(async () => {
  const input = { title: 'Paper', answerPosition: 'end', layout: { items: [{ id: 'q1', sectionTitle: 'Part one', score: 3 }] }, snapshot: [{ id: 'q1', stem: 'What is 1 + 1?', answer: '2', explanation: '' }] };
  const word = await renderPaperExport({ ...input, format: 'word' });
  assert.strictEqual(word.extension, 'docx');
  assert.ok(word.bytes.subarray(0, 2).equals(Buffer.from('PK')));
  const pdf = await renderPaperExport({ ...input, format: 'pdf' });
  assert.strictEqual(pdf.extension, 'pdf');
  assert.ok(pdf.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
  console.log('paper export renderer checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
