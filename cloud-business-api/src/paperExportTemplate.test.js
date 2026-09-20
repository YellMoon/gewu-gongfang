'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');
const { renderPaperExport } = require('./paperExportRenderer');

async function verifyTemplate() {
  const reference = fs.readFileSync(path.join(__dirname, '../resources/paper/output-template.docx'));
  assert.equal(crypto.createHash('sha256').update(reference).digest('hex'),
    'fb8ac8d5b95f18ac72110a9161583fbf92736a991545980dd6b6b7b9a19060f2');
  const source = await JSZip.loadAsync(reference);
  const input = { format: 'word', title: '\u6a21\u677f\u5206\u9875\u9a8c\u8bc1', answerPosition: 'end', snapshot: [
    { id: 'a', questionType: 'single_choice', stem: '\u9009\u62e9\u9898\u6b63\u6587', options: ['A. \u7532', 'B. \u4e59'], answer: 'B' },
    { id: 'b', questionType: 'calculation', stem: '\u7b2c\u4e00\u9053\u89e3\u7b54\u9898 $v=at$', answer: '$v=2$' },
    { id: 'c', questionType: 'problem', stem: '\u7b2c\u4e8c\u9053\u89e3\u7b54\u9898', answer: '6' },
  ] };
  input.snapshot[1].richContent = { blocks: [{ type: 'formula', canonicalLatex: 'v=at' }] };
  const result = await renderPaperExport(input);
  const archive = await JSZip.loadAsync(result.bytes);
  const mutable = new Set(['word/document.xml', 'word/_rels/document.xml.rels', '[Content_Types].xml', 'word/settings.xml']);
  for (const entry of Object.values(source.files).filter(entry => !entry.dir && !mutable.has(entry.name))) {
    assert(archive.file(entry.name), `retained template part ${entry.name}`);
    if (/^word\/footer[12]\.xml$/.test(entry.name)) {
      const footer = await archive.file(entry.name).async('string');
      const sourceFooter = await entry.async('string');
      const fieldRuns = sourceFooter.match(/<wps:txbx><w:txbxContent><w:p\b[^>]*><w:pPr>[\s\S]*?<\/w:pPr>([\s\S]*?)<\/w:p>/)[1];
      assert(!footer.includes('<w:drawing>'), 'page fields must not wrap inside a stale floating textbox');
      assert.equal((footer.match(/ NUMPAGES /g) || []).length, 1);
      assert(footer.includes(fieldRuns), 'original page fields and their literal text remain unchanged');
      assert.equal(footer.replace(fieldRuns, ''), sourceFooter.replace(/<w:r><w:rPr><w:sz w:val="18"\/><\/w:rPr><mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent><\/w:r>/, ''),
        'everything outside the page-field wrapper remains byte-identical');
    } else assert.deepEqual(await archive.file(entry.name).async('nodebuffer'), await entry.async('nodebuffer'), `unchanged template part ${entry.name}`);
  }
  const xml = await archive.file('word/document.xml').async('string');
  assert(xml.includes('\u6a21\u677f\u5206\u9875\u9a8c\u8bc1'));
  assert(xml.includes('\u5b66\u6821:') && xml.includes('\u59d3\u540d\uff1a') && xml.includes('\u73ed\u7ea7\uff1a'));
  assert(!xml.includes('\u8bd5\u5377\u540d'), 'replace both split-run title slots');
  assert(!xml.includes('\u3010\u8be6\u89e3\u3011'), 'remove template sample solutions');
  assert.equal((xml.match(/<w:sectPr[ >]/g) || []).length, 2);
  assert.match(xml, /w:footer="510"/);
  assert.match(xml, /<m:oMath[ >]/);
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(m => m[0]);
  for (const label of ['\u7b2c\u4e00\u9053\u89e3\u7b54\u9898', '\u7b2c\u4e8c\u9053\u89e3\u7b54\u9898']) {
    const index = paragraphs.findIndex(p => p.includes(label));
    assert(/<w:pageBreakBefore\/>/.test(paragraphs[index]) ||
      (/<w:pageBreakBefore\/>/.test(paragraphs[index - 1]) && /<w:keepNext\/>/.test(paragraphs[index - 1])),
    'solution starts a page, allowing its section heading on the same page');
  }
  assert.equal((xml.match(/w:line="4800"/g) || []).length, 2, 'each solution reserves 240 pt of writing space');
  assert(xml.indexOf('\u7b2c\u4e8c\u9053\u89e3\u7b54\u9898') < xml.indexOf('\u53c2\u8003\u7b54\u6848'));
  const inline = await JSZip.loadAsync((await renderPaperExport({ ...input, answerPosition: 'after' })).bytes);
  const inlineXml = await inline.file('word/document.xml').async('string');
  assert.equal((inlineXml.match(/<w:sectPr[ >]/g) || []).length, 1);
  assert(!inlineXml.includes('\u53c2\u8003\u7b54\u6848'));
  assert(inlineXml.indexOf('\u7b54\u6848\uff1aB') < inlineXml.indexOf('\u7b2c\u4e00\u9053\u89e3\u7b54\u9898'));
  const single = await JSZip.loadAsync((await renderPaperExport({ ...input, snapshot: [input.snapshot[2]], answerPosition: 'after' })).bytes);
  const singleXml = await single.file('word/document.xml').async('string');
  assert(!singleXml.includes('<w:pageBreakBefore/>'), 'a solution-only paper must not get a blank title-only cover');
  const numbered = Array.from({ length: 23 }, (_, index) => ({ id: `choice-${index}`, questionType: 'single', stem: `Question ${index + 1}`, answer: index % 2 ? 'B' : 'A' }));
  const grid = await JSZip.loadAsync((await renderPaperExport({ ...input, snapshot: numbered })).bytes);
  const gridXml = await grid.file('word/document.xml').async('string');
  assert.equal((gridXml.match(/<w:tr>/g) || []).length, 6, 'answer grid repeats number/answer row pairs beyond ten choices');
  assert(gridXml.includes('<w:t>23</w:t>'));
  console.log('Supplied template preservation, title, answer sections and solution page-space checks passed');
}
module.exports = verifyTemplate;
if (require.main === module) verifyTemplate().catch(error => { console.error(error); process.exitCode = 1; });
