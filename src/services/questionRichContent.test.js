const assert = require('assert');
const fs = require('fs');

const {
  migrateLegacyQuestion,
  normalizeQuestionRichContent,
  projectQuestionRichContent,
} = require('./questionRichContent.ts');

function testLegacyMigrationAndDeterministicProjection() {
  const rich = migrateLegacyQuestion({
    stem: '<p>Hello <strong>world</strong><script>alert(1)</script><br>line 2</p>',
    options: [{ label: 'A', content: '<em>choice</em>' }],
    answer: 'A',
    explanation: '<div>because&nbsp;physics</div>',
  });
  const projection = projectQuestionRichContent(rich);

  assert.strictEqual(projection.stem, 'Hello world\nline 2');
  assert.strictEqual(projection.options[0].content, 'choice');
  assert.strictEqual(projection.answer, 'A');
  assert.strictEqual(projection.explanation, 'because physics');
  assert.strictEqual(projection.searchText, 'Hello world line 2 A choice A because physics');
}

function testFormulaAndImageNodesRoundTrip() {
  const rich = normalizeQuestionRichContent({
    version: 1,
    type: 'question-document',
    sections: {
      stem: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Velocity ' },
        { type: 'formula', attrs: { id: 'f-1', canonicalLatex: '\\frac{s}{t}', displayMode: 'inline', sourceRef: 'formula/source-1.json' } },
        { type: 'image', attrs: { assetKey: 'asset-1', alt: 'motion diagram', width: 240, align: 'center' } },
      ] }, { type: 'formulaBlock', attrs: { id: 'f-block', canonicalLatex: 'E=mc^2', displayMode: 'block', sourceFormat: 'latex', conversionStatus: 'complete', warnings: [], previewRef: 'preview/f-block.png' } }] },
      options: [], subQuestions: [],
      answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] },
    },
  });

  assert.strictEqual(rich.sections.stem.content[0].content[1].attrs.canonicalLatex, '\\frac{s}{t}');
  assert.strictEqual(rich.sections.stem.content[0].content[2].attrs.assetKey, 'asset-1');
  assert.strictEqual(rich.sections.stem.content[1].attrs.displayMode, 'block');
  const projection = projectQuestionRichContent(rich);
  assert.strictEqual(projection.hasFormula, true);
  assert.strictEqual(projection.hasImage, true);
  assert.strictEqual(projection.stem, 'Velocity \\frac{s}{t} motion diagram\nE=mc^2');
}

function testStrictValidationAndSanitization() {
  assert.throws(() => normalizeQuestionRichContent({ version: 2, type: 'question-document', sections: {} }), /version 1/);
  assert.throws(() => normalizeQuestionRichContent({
    version: 1, type: 'question-document', sections: {
      stem: { type: 'doc', content: [{ type: 'script', attrs: { src: 'javascript:alert(1)' } }] },
      options: [], subQuestions: [], answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] },
    },
  }), /unsupported node/);
  assert.throws(() => normalizeQuestionRichContent({
    version: 1, type: 'question-document', sections: {
      stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { assetKey: '../escape', alt: 'x' } }] }] },
      options: [], subQuestions: [], answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] },
    },
  }), /assetKey/);
  const base = migrateLegacyQuestion({ stem: 'safe' });
  const unsafeCases = [
    { type: 'paragraph', attrs: { onclick: 'evil()' }, content: [] },
    { type: 'paragraph', attrs: { style: 'background:url(javascript:evil)' }, content: [] },
    { type: 'paragraph', attrs: { textAlign: 'sideways' }, content: [] },
    { type: 'heading', attrs: { level: 9 }, content: [] },
    { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
    { type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { color: 'expression(evil)' } }] },
    { type: 'image', attrs: { assetKey: 'asset-1', title: 42 } },
    { type: 'image', attrs: { assetKey: 'asset-1', title: 'x'.repeat(1001) } },
  ];
  for (const node of unsafeCases) {
    const candidate = JSON.parse(JSON.stringify(base));
    candidate.sections.stem.content = [node];
    assert.throws(() => normalizeQuestionRichContent(candidate), /rich_content/);
  }
  const starterKit = JSON.parse(JSON.stringify(base));
  starterKit.sections.stem = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2, textAlign: 'center', lineHeight: '1.5' }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'codeBlock', attrs: { language: 'latex' }, content: [{ type: 'text', text: 'x^2' }] },
    { type: 'orderedList', attrs: { start: 2 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }] },
  ] };
  normalizeQuestionRichContent(starterKit);
}

function testProjectionIsDeterministicAndComplete() {
  const first = migrateLegacyQuestion({
    stem: 'Stem', options: [{ label: 'B', content: 'Choice', isCorrect: true }],
    sub_questions: [{ label: '(1)', content: 'Part', answer: 'Part answer' }],
    answer: 'Main answer', explanation: 'Analysis',
  });
  const second = migrateLegacyQuestion(projectQuestionRichContent(first));
  assert.deepStrictEqual(second, first);
  const projected = projectQuestionRichContent(first);
  assert.deepStrictEqual(projected.options[0], { label: 'B', content: 'Choice', isCorrect: true });
  assert.deepStrictEqual(projected.subQuestions[0], { label: '(1)', content: 'Part', answer: 'Part answer' });
  assert.strictEqual(projected.searchText, 'Stem B Choice (1) Part Part answer Main answer Analysis');
  const snake = migrateLegacyQuestion({ options: [{ label: 'C', content: 'snake correct', is_correct: true }] });
  assert.strictEqual(snake.sections.options[0].isCorrect, true);
  const code = normalizeQuestionRichContent({ version: 1, type: 'question-document', sections: {
    stem: { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'latex' }, content: [{ type: 'text', text: 'line one' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'line two' }] }] },
    options: [], subQuestions: [], answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] },
  } });
  assert.strictEqual(projectQuestionRichContent(code).stem, 'line one\nline two');
}

function testParserOptionalNullsAreNormalizedAway() {
  const rich = normalizeQuestionRichContent({ version: 1, type: 'question-document', sections: {
    stem: { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'formula', attrs: { id: 'f-null', canonicalLatex: 'x', displayMode: 'inline', sourceRef: null, previewRef: null } },
      { type: 'image', attrs: { assetKey: 'asset-null', src: 'question-asset://asset-null', alt: 'diagram', width: null, height: null, title: null } },
    ] }] }, options: [], subQuestions: [], answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] },
  } });
  const [formula, image] = rich.sections.stem.content[0].content;
  assert.strictEqual(Object.hasOwn(formula.attrs, 'sourceRef'), false);
  assert.strictEqual(Object.hasOwn(image.attrs, 'width'), false);
}

function testLegacyChoiceAnswerAndFormulaMigration() {
  const rich = migrateLegacyQuestion({
    stem: 'legacy stem', answer: 'AC',
    options: ['first', 'second', 'third'],
    formulas: ['x^2', { latex: '\\frac{a}{b}' }],
  });
  assert.deepStrictEqual(rich.sections.options.map(option => option.isCorrect), [true, false, true]);
  const formulaNodes = rich.sections.stem.content.filter(node => node.type === 'formulaBlock');
  assert.deepStrictEqual(formulaNodes.map(node => node.attrs.canonicalLatex), ['x^2', '\\frac{a}{b}']);
  const normalized = normalizeQuestionRichContent(rich);
  assert.deepStrictEqual(normalized.sections.stem.content.filter(node => node.type === 'formulaBlock').map(node => node.attrs.canonicalLatex), ['x^2', '\\frac{a}{b}']);
}

function testWordParserFormulaSourceFormats() {
  const parserModel = fs.readFileSync('modules/question-bank/parsers/formula_model.py', 'utf8');
  const formats = JSON.parse('[' + parserModel.match(/^SOURCE_FORMATS = \{([^}]+)\}/m)[1] + ']');
  for (const sourceFormat of formats) {
    const rich = migrateLegacyQuestion({ stem: 'Word formula' });
    rich.sections.stem.content = [{ type: 'paragraph', content: [{ type: 'formula', attrs: {
      id: 'word-formula-1', canonicalLatex: 'x^2', displayMode: 'inline', sourceFormat, conversionStatus: 'complete',
    } }] }];
    const normalized = normalizeQuestionRichContent(rich);
    assert.strictEqual(normalized.sections.stem.content[0].content[0].attrs.sourceFormat, sourceFormat);
    assert.strictEqual(projectQuestionRichContent(normalized).stem, 'x^2');
    rich.sections.stem.content[0].content[0].attrs.sourceFormat = 'unrecognized-format';
    assert.throws(() => normalizeQuestionRichContent(rich), /sourceFormat is invalid/);
  }
}

function testPreviewOnlyFormulaPreservesOriginal() {
  const doc = migrateLegacyQuestion({ stem: 'before' });
  const attrs = { id: 'formula-original', canonicalLatex: null, displayMode: 'inline', sourceFormat: 'mathtype', conversionStatus: 'preview_only', previewRef: 'word/media/image67.wmf' };
  doc.sections.stem.content = [{ type: 'paragraph', content: [{ type: 'formula', attrs }] }];
  assert.deepStrictEqual(normalizeQuestionRichContent(doc).sections.stem.content[0].content[0].attrs, attrs);
  for (const alteration of [
    { conversionStatus: 'complete' }, { conversionStatus: 'failed' }, { previewRef: null },
    { previewRef: '../escape.wmf' }, { previewRef: 'javascript:bad' }, { canonicalLatex: 42 },
  ]) {
    const candidate = structuredClone(doc);
    Object.assign(candidate.sections.stem.content[0].content[0].attrs, alteration);
    assert.throws(() => normalizeQuestionRichContent(candidate), /formula/);
  }
}
testPreviewOnlyFormulaPreservesOriginal();
testWordParserFormulaSourceFormats();
testLegacyMigrationAndDeterministicProjection();
testFormulaAndImageNodesRoundTrip();
testStrictValidationAndSanitization();
testProjectionIsDeterministicAndComplete();
testParserOptionalNullsAreNormalizedAway();
testLegacyChoiceAnswerAndFormulaMigration();
const packageJson = fs.readFileSync('package.json', 'utf8');
assert.ok(packageJson.includes('node src/services/questionRichContent.test.js') && packageJson.includes('npm run test:rich-content'), 'rich content suite should run in npm test');
console.log('questionRichContent tests passed');
