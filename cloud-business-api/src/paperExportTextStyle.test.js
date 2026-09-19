'use strict';

const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { renderPaperExport, drawPdfTokens } = require('./paperExportRenderer');

async function verifyTextStyles() {
  const text = (value, vertical) => ({ type: 'text', text: value, ...(vertical ? { marks: [{ type: vertical }] } : {}) });
  const paragraph = (...content) => ({ type: 'paragraph', content });
  const doc = (...content) => ({ type: 'doc', content });
  const richContent = { version: 1, type: 'question-document', sections: {
    stem: doc(paragraph(text('Force F'), text('1', 'subscript'), text(' and area m'), text('2', 'superscript'), text(' < limit > ')), paragraph(text('Next paragraph'), text('BOLD', 'bold'), text('ITALIC', 'italic'), text('UNDERLINE', 'underline'), text('STRIKE', 'strike'))),
    options: [{ label: 'A', content: doc(paragraph(text('3', 'superscript'), text(' remains styled'))) },
      { label: 'B', content: doc(paragraph(text('EMPHATICOPTION', 'bold'))) }],
    subQuestions: [], answer: doc(paragraph(text('v'), text('1', 'subscript'))), analysis: doc(paragraph(text('x'), text('2', 'superscript'))),
  } };
  const word = await renderPaperExport({ format: 'word', title: 'Text styles', answerPosition: 'end', formulaMode: 'word-native',
    snapshot: [{ id: 'text-style', stem: '', options: [], answer: '', richContent }] });
  const archive = await JSZip.loadAsync(word.bytes);
  const xml = await archive.file('word/document.xml').async('string');
  assert.equal((xml.match(/w:vertAlign w:val="subscript"/g) || []).length, 2, 'stem and answer subscripts survive as editable Word text');
  assert.equal((xml.match(/w:vertAlign w:val="superscript"/g) || []).length, 3, 'stem, option and analysis superscripts survive');
  assert(xml.includes(' &lt; limit &gt; '), 'rich text is literal text, not HTML to strip; preserve spaces and comparison signs');
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(match => match[0]);
  assert(!paragraphs.find(row => row.includes('Force F')).includes('Next paragraph'), 'preserve the source paragraph break');
  const runs = [...xml.matchAll(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)].map(match => match[0]);
  for (const [label, tag] of [['BOLD', '<w:b/>'], ['ITALIC', '<w:i/>'], ['UNDERLINE', '<w:u '], ['STRIKE', '<w:strike/>']]) {
    assert(runs.find(row => row.includes(label)).includes(tag), `Word retains ${label}`);
  }
  assert(!runs.find(row => row.includes('A. ')).includes('w:vertAlign'), 'option labels must not inherit the first content run superscript');
  assert(!runs.find(row => row.includes('B. ')).includes('<w:b/>'), 'option labels must not inherit the first content run bold mark');
  assert(runs.find(row => row.includes('EMPHATICOPTION')).includes('<w:b/>'), 'option content keeps its own bold mark');

  const calls = [];
  let size = 10;
  const probe = { x: 10, y: 10, page: { width: 250, height: 200, margins: { left: 10, right: 10, top: 10, bottom: 10 } },
    fontSize(value) { size = value; return this; }, currentLineHeight() { return 14; }, widthOfString(value) { return value.length * size / 2; },
    save() { return this; }, restore() { return this; }, lineWidth() { return this; },
    text(value, x, y, options) { calls.push({ value, x, y, size, options }); return this; }, addPage() { this.y = 10; return this; } };
  drawPdfTokens(probe, [{ kind: 'text', text: 'F' }, { kind: 'text', text: '1', verticalAlign: 'subscript' },
    { kind: 'text', text: '+' }, { kind: 'text', text: '2', verticalAlign: 'superscript' }, { kind: 'break' }, { kind: 'text', text: 'next' }]);
  const normal = calls.find(call => call.value === 'F');
  const sub = calls.find(call => call.value === '1');
  const sup = calls.find(call => call.value === '2');
  assert(sub.size < normal.size && sub.y > normal.y, 'PDF subscript uses smaller type below the base run');
  assert(sup.size < normal.size && sup.y < normal.y, 'PDF superscript uses smaller type above the base run');
  assert(calls.find(call => call.value === 'next').y > sub.y, 'PDF paragraph break is retained');
  drawPdfTokens(probe, [{ kind: 'text', text: 'styled', bold: true, italic: true, underline: true, strike: true }, { kind: 'text', text: 'plain' }]);
  const styled = calls.find(call => call.value === 'styled').options;
  assert(styled.oblique && styled.stroke && styled.fill && styled.underline && styled.strike, 'PDF retains all source emphasis marks');
  const plain = calls.find(call => call.value === 'plain').options;
  assert(!plain.oblique && !plain.stroke && !plain.underline && !plain.strike, 'PDF style must not leak into the next run');
  console.log('paper export text styles and paragraph checks passed');
}

module.exports = verifyTextStyles;
if (require.main === module) verifyTextStyles().catch(error => { console.error(error); process.exitCode = 1; });
