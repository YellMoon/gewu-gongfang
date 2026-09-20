'use strict';
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { renderPaperExport } = require('./paperExportRenderer');

async function verifyPdfTemplate() {
  const calls = [], original = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function(value, ...args) {
    calls.push({ value: String(value), page: this.page, y: typeof args[1] === 'number' ? args[1] : this.y });
    return original.call(this, value, ...args);
  };
  let result;
  try {
    result = await renderPaperExport({ format: 'pdf', title: 'PDF template test', snapshot: [
      { id: 'a', questionType: 'single', stem: 'CHOICE', options: ['A. first', 'B. second'], answer: 'A' },
      { id: 'b', questionType: 'problem', stem: 'SOLUTIONONE', answer: 'first result' },
      { id: 'c', questionType: 'calculation', stem: 'SOLUTIONTWO', answer: 'second result' },
    ] });
  } finally { PDFDocument.prototype.text = original; }
  assert(calls.some(c => c.value.includes('\u5b66\u6821:') && c.value.includes('\u59d3\u540d\uff1a')), 'PDF uses template identity fields');
  const pages = [...new Set(calls.map(c => c.page))];
  const byPage = pages.map(page => calls.filter(c => c.page === page).map(c => c.value).join(''));
  const first = byPage.findIndex(t => t.includes('SOLUTIONONE')), second = byPage.findIndex(t => t.includes('SOLUTIONTWO'));
  assert(first > 0 && second > first, 'each solution begins its own page');
  assert(byPage.at(-1).includes('\u53c2\u8003\u7b54\u6848'), 'answer section starts independently');
  assert(byPage.at(-1).includes('\u9898\u53f7') && byPage.at(-1).includes('\u7b54\u6848'), 'choice answer grid is present');
  for (const [index, page] of pages.entries()) {
    assert.equal(page.width, 11906 / 20);
    assert.equal(page.height, 16838 / 20);
    assert.deepEqual(page.margins, { top: 1418 / 20, left: 1134 / 20, right: 1134 / 20, bottom: 1134 / 20 });
    assert(byPage[index].includes(`\u5171 ${pages.length} \u9875`), 'every page has updated total-page fields');
  }
  assert(result.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
  console.log('PDF supplied-template geometry, metadata, solution pages, answers and footers passed');
}
module.exports = verifyPdfTemplate;
if (require.main === module) verifyPdfTemplate().catch(e => { console.error(e); process.exitCode = 1; });
