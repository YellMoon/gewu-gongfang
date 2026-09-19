'use strict';
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const PDFDocument = require('pdfkit');
const { renderPaperExport } = require('./paperExportRenderer');

async function verifyAnswerOrder() {
  const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const snapshot = [{ id: 'answer-order', stem: 'Problem', richContent: { type: 'question-document', version: 1, sections: {
    stem: doc('Problem'), answer: doc('(1) PRIMARYFIRST'), analysis: doc('EXPLANATIONLAST'), options: [],
    subQuestions: [{ label: '(2)', content: doc('Second part'), answer: doc('SECONDANSWER') }, { label: '(3)', content: doc('Third part'), answer: doc('THIRDANSWER') }],
  } } }];
  const check = text => {
    const positions = ['PRIMARYFIRST', 'SECONDANSWER', 'THIRDANSWER', 'EXPLANATIONLAST'].map(value => text.indexOf(value));
    assert(positions.every(value => value >= 0), 'retain every answer');
    assert(positions.every((value, index) => !index || positions[index - 1] < value), 'answers follow the source order: first, second, third, explanation');
  };
  for (const answerPosition of ['end', 'after']) {
    const input = { title: 'Answer order', snapshot, answerPosition, formulaMode: 'word-native' };
    const word = await renderPaperExport({ ...input, format: 'word' });
    check(await (await JSZip.loadAsync(word.bytes)).file('word/document.xml').async('string'));
    const calls = [];
    const originalText = PDFDocument.prototype.text;
    try {
      PDFDocument.prototype.text = function (text, ...args) { calls.push(String(text)); return originalText.call(this, text, ...args); };
      const pdf = await renderPaperExport({ ...input, format: 'pdf' });
      assert(pdf.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
      check(calls.join(''));
    } finally { PDFDocument.prototype.text = originalText; }
  }
  console.log('Word and PDF answer source order checks passed');
}
module.exports = verifyAnswerOrder;
if (require.main === module) verifyAnswerOrder().catch(error => { console.error(error); process.exitCode = 1; });
