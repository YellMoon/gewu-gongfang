'use strict';

const assert = require('assert');
const JSZip = require('jszip');
const sharp = require('sharp');
const { drawPdfTokens, normalizeOptionTokenGroups, wordFormulaTransformation, renderPaperExport } = require('./paperExportRenderer');
require('./pdfInlineLayout.test');

(async () => {
  const drawn = [];
  const probe = {x:10,y:75,page:{width:100,height:100,margins:{left:10,right:10,bottom:10}},
    fontSize(){return this;},currentLineHeight(){return 12;},widthOfString(text){return [...text].length*5;},
    text(text,x,y){drawn.push({kind:'text',text,x,y});return this;},
    addPage(){this.y=10;this.x=10;drawn.push({kind:'page'});return this;}};
  drawPdfTokens(probe,[{kind:'text',text:'a'.repeat(15)},
    {kind:'formula',displayMode:'inline',latex:'x^{2}',media:{width:24,height:32,bytes:Buffer.from('<svg/>')}},
    {kind:'text',text:'end'}],'',10,(_doc,_svg,x,y,dimensions)=>drawn.push({kind:'formula',x,y,...dimensions}));
  assert.equal(drawn.filter(run=>run.kind==='formula').length,1, 'inline math must be drawn graphically, never flattened to ASCII');
  assert.equal(drawn.filter(run=>run.kind==='page').length,1, 'overflowing formula row must move to the next page');
  assert(drawn.find(run=>run.kind==='formula').y >= 10);
  assert(drawn.filter(run=>run.kind==='text').every(run=>!run.text.includes('^')));
  assert.deepStrictEqual(wordFormulaTransformation({ width: 36, height: 16 }, 'inline'), { width: 36, height: 16 },
    'inline Word formulas must preserve their measured size instead of being stretched to a fixed blank row');
  assert.deepStrictEqual(wordFormulaTransformation({ width: 800, height: 300 }, 'block'), { width: 192, height: 72 },
    'large block formulas must be proportionally capped to keep the paper layout readable');
  const imageBytes = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const assetCalls = [];
  const snapshot = [
    { id: 'q1', stem: '<p>First stem</p>', answer: 'A', explanation: 'First explanation', options: [{ label: 'A', content: 'first option' }, { label: 'B', content: 'second option' }], richContent: { blocks: [{ type: 'formula', canonicalLatex: 'x^{2}' }] }, assets: [{ assetKey: 'a'.repeat(64), fileName: 'diagram.png', mimeType: 'image/png', assetType: 'image' }, { assetKey: 'b'.repeat(64), fileName: 'formula-preview.png', mimeType: 'image/png', assetType: 'formula_preview' }] },
    { id: 'q2', stem: 'Second stem', answer: 'B', explanation: 'Second explanation', options: ['B. another option'], richContent: null },
  ];
  const productionRichContent = {
    version: 1,
    type: 'question-document',
    sections: {
      stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Structured stem ' }, { type: 'formulaBlock', attrs: { id: 'formula-stem', canonicalLatex: 'E=mc^{2}', displayMode: 'block' } }] }] },
      options: [{ id: 'option-a', label: 'A', isCorrect: true, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Structured option ' }, { type: 'formula', attrs: { id: 'formula-option', canonicalLatex: '\\frac{1}{2}', displayMode: 'inline' } }] }] } }],
      subQuestions: [{ id: 'sub-1', label: '（1）', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Structured subquestion ' }, { type: 'formulaBlock', attrs: { id: 'formula-sub', canonicalLatex: 'a^{2}+b^{2}=c^{2}', displayMode: 'block' } }] }] }, answer: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Structured subanswer' }] }] } }],
      answer: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Structured answer ' }, { type: 'formula', attrs: { id: 'formula-answer', canonicalLatex: 'x=1', displayMode: 'inline' } }] }] },
      analysis: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Structured analysis ' }, { type: 'formula', attrs: { id: 'formula-analysis', canonicalLatex: 'v=at', displayMode: 'inline' } }] }] },
    },
  };
  const layout = { items: [{ id: 'q1', sectionTitle: 'Part one', score: 2.5 }, { id: 'q2', sectionTitle: 'Part one', score: 6 }] };
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
  assert.ok(wordXml.includes('（2.5 分）'), 'one-decimal paper scores accepted by the editor must survive Word rendering with user-facing Chinese copy');
  assert.ok(!wordXml.includes(' pts'), 'Chinese paper exports must not expose the internal English score abbreviation');
  assert.ok(!wordXml.includes('x^{2}'), 'LaTeX source must be rendered as a formula instead of being falsely presented as finished paper text');
  for (const expected of ['试题', '参考答案', '答案：A', '解析：First explanation']) assert.ok(wordXml.includes(expected), `Word export must use Chinese paper labels: ${expected}`);
  assert.ok(wordXml.indexOf('Second stem') < wordXml.indexOf('答案：A'), 'end-position answers must follow every question in Word');
  const wordArchive = await JSZip.loadAsync(word.bytes);
  assert.ok(Object.keys(wordArchive.files).some(name => /^word\/media\/.+\.png$/.test(name)), 'Word must embed verified question images rather than omit them');
  assert.ok(Object.keys(wordArchive.files).some(name => /^word\/media\/.+\.png$/.test(name)), 'Word must embed a raster formula representation that Microsoft Word can display');
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
  const richWord = await renderPaperExport({
    format: 'word', title: 'Structured formula paper', answerPosition: 'end', formulaMode: 'latex-vector',
    snapshot: [{ id: 'q-rich', stem: 'Fallback stem', answer: 'A', explanation: 'Explanation', richContent: productionRichContent }],
  });
  const richArchive = await JSZip.loadAsync(richWord.bytes);
  const richXml = await richArchive.file('word/document.xml').async('string');
  assert.ok(richXml.includes('Structured stem'), 'formal rich content text must remain in the exported paper');
  for (const expected of ['Structured option', 'Structured subquestion', 'Structured subanswer', 'Structured answer', 'Structured analysis']) {
    assert.ok(richXml.includes(expected), `formal rich content must retain ${expected}`);
  }
  assert.ok(!richXml.includes('E=mc^{2}'), 'formal rich content formulas must not degrade into raw LaTeX');
  const answerHeadingIndex = richXml.indexOf('\u53c2\u8003\u7b54\u6848');
  assert.ok(answerHeadingIndex > 0, 'end-position export must contain an answer heading');
  assert.strictEqual((richXml.slice(0, answerHeadingIndex).match(/<w:drawing>/g) || []).length, 3,
    'only stem, option and subquestion formulas may appear before the answer heading');
  const richAnswerIndex = richXml.indexOf('Structured answer');
  assert.ok(richAnswerIndex < richXml.indexOf('<w:drawing>', richAnswerIndex),
    'an answer formula must retain its position after its answer text instead of moving into the question body');
  const richFormulaSvg = Object.keys(richArchive.files).filter(name => /^word\/media\/.+\.svg$/.test(name));
  const richFormulaPng = Object.keys(richArchive.files).filter(name => /^word\/media\/.+\.png$/.test(name));
  assert.strictEqual(richFormulaSvg.length, 0, 'Word formula runs must not select SVG because current Microsoft Word renders those formula slots blank');
  assert.ok(richFormulaPng.length >= 5, 'all formulas in formal sections, options, subquestions, answer and analysis must embed a Word-readable PNG');
  const richPdf = await renderPaperExport({
    format: 'pdf', title: 'Structured formula paper', answerPosition: 'end', formulaMode: 'latex-vector',
    snapshot: [{ id: 'q-rich', stem: 'Fallback stem', answer: 'A', explanation: 'Explanation', richContent: productionRichContent }],
  });
  assert.ok(richPdf.bytes.includes(Buffer.from('/Subtype /Image')),
    'PDF formulas must use their measured fallback images so a formula cannot overflow the page or create a blank trailing page');
  const defaultInlinePdf = await renderPaperExport({
    format: 'pdf', title: 'Default inline formula paper', answerPosition: 'end', formulaMode: 'latex-vector',
    snapshot: [{ id: 'q-default-inline', stem: 'Fallback', answer: '', explanation: '', richContent: { blocks: [
      { type: 'formula', canonicalLatex: '\\frac{H}{2t}' },
    ] } }],
  });
  assert.ok(!defaultInlinePdf.bytes.includes(Buffer.from('/Subtype /Image')),
    'inline vector formulas must not be rasterized');
  const hasVectorCurves = bytes => /\n(?:-?[\d.]+ ){5}-?[\d.]+ c\n/u.test(bytes.toString('latin1'));
  assert.ok(hasVectorCurves(defaultInlinePdf.bytes),
    'inline formulas must retain vector geometry, not plain-text approximations');
  const legacyFractionPdf = await renderPaperExport({
    format: 'pdf', title: 'Legacy fraction paper', answerPosition: 'end', formulaMode: 'latex-vector',
    snapshot: [{ id: 'q-legacy-fraction', stem: 'Fallback', answer: '', explanation: '', richContent: { blocks: [
      { type: 'formula', canonicalLatex: '\\frac H {2t}' },
    ] } }],
  });
  assert.ok(!legacyFractionPdf.bytes.includes(Buffer.from('frac')),
    'legacy TeX fractions without a braced numerator must not leak the frac command into PDF text');
  assert.ok(hasVectorCurves(legacyFractionPdf.bytes),
    'legacy TeX fractions must also retain vector geometry');
  assert.deepStrictEqual(normalizeOptionTokenGroups(['A. first', 'B．second']).map(tokens => tokens.map(token => token.text)), [
    ['A. first'], ['B．second'],
  ], 'already-labelled string options must not receive a duplicate generated label');
  assert.deepStrictEqual(normalizeOptionTokenGroups([{ label: 'A', content: 'from A．point to B．point' }]).map(tokens => tokens.map(token => token.text)), [
    ['A. from A．point to B．point'],
  ], 'the renderer must not guess that ordinary option prose contains packed options');
  const inlineWord = await renderPaperExport({
    format: 'word', title: 'Inline formula paper', answerPosition: 'end', formulaMode: 'latex-vector',
    snapshot: [{ id: 'q-inline', stem: 'Fallback', answer: '', explanation: '', richContent: {
      version: 1, type: 'question-document', sections: {
        stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before ' }, { type: 'formula', attrs: { canonicalLatex: 'x=1', displayMode: 'inline' } }, { type: 'text', text: ' after' }] }] },
        options: [], subQuestions: [], answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] },
      },
    } }],
  });
  const inlineXml = await (await JSZip.loadAsync(inlineWord.bytes)).file('word/document.xml').async('string');
  const inlineBefore = inlineXml.indexOf('Before');
  const inlineAfter = inlineXml.indexOf('after');
  const inlineParagraph = inlineXml.slice(inlineXml.lastIndexOf('<w:p', inlineBefore), inlineXml.indexOf('</w:p>', inlineBefore));
  assert.ok(inlineBefore < inlineAfter && inlineParagraph.includes('<w:drawing>') && inlineParagraph.includes('after'),
    'inline formula text and its vector must remain in the same Word paragraph');
  console.log('paper export renderer checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
