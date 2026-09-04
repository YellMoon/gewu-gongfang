'use strict';

const assert = require('assert');
const babel = require('@babel/core');
const fs = require('fs');
const Module = require('module');
const path = require('path');
const {
  classifyOptionLength,
  columnsForOptions,
  createQuestionDisplay,
  hasQuestionAnswerContent,
  normalizeOptionLabel,
  normalizeOptions,
  renderLatex,
  resolveQuestionAssetRefs,
} = require('./questionDisplay');

function loadDesktopQuestionOptions() {
  const filename = path.resolve(__dirname, '../../../src/utils/questionOptions.ts');
  const transformed = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    presets: [
      ['@babel/preset-env', { targets: { node: 'current' } }],
      '@babel/preset-typescript',
    ],
  });
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded._compile(transformed.code, filename);
  return loaded.exports;
}

const desktopQuestionOptions = loadDesktopQuestionOptions();

assert.deepStrictEqual(normalizeOptions([
  'A. first',
  { label: 'B', content: 'second' },
  { content: 'third' },
]), [
  { label: 'A', content: 'first' },
  { label: 'B', content: 'second' },
  { label: 'C', content: 'third' },
]);
assert.deepStrictEqual(normalizeOptions([
  'A. first packed option\nB. second packed option\nC. third packed option\nD. fourth packed option',
]), [
  { label: 'A', content: 'first packed option' },
  { label: 'B', content: 'second packed option' },
  { label: 'C', content: 'third packed option' },
  { label: 'D', content: 'fourth packed option' },
]);
assert.deepStrictEqual(normalizeOptions([
  'A、10 m/s',
  { label: 'b．', content: '20 m/s' },
  { label: 'C)', content: '30 m/s' },
]), [
  { label: 'A', content: '10 m/s' },
  { label: 'B', content: '20 m/s' },
  { label: 'C', content: '30 m/s' },
], 'common imported option punctuation must not leak into the rendered label or cause a doubled separator');
assert.strictEqual(normalizeOptionLabel('d）', 0), 'D');
assert.strictEqual(normalizeOptionLabel('AB', 0), 'AB', 'non-standard labels must degrade consistently instead of being truncated differently by each client');
assert.strictEqual(classifyOptionLength(normalizeOptions(['a', 'b', 'c', 'd'])), 'short');
assert.strictEqual(classifyOptionLength(normalizeOptions(['123456789012', 'b', 'c', 'd'])), 'short');
assert.strictEqual(classifyOptionLength(normalizeOptions(['1234567890123', 'b', 'c', 'd'])), 'medium');
assert.strictEqual(classifyOptionLength(normalizeOptions(['12345678901234567890123456789', 'b', 'c', 'd'])), 'long');
assert.strictEqual(columnsForOptions(normalizeOptions(['a', 'b', 'c', 'd'])), 4);
assert.strictEqual(columnsForOptions(normalizeOptions(['1234567', '7654321', 'abcdefg', 'gfedcba'])), 2, 'mobile four-column text options must stay genuinely short');
assert.strictEqual(columnsForOptions(normalizeOptions(['a medium option', 'another medium', 'third medium option', 'fourth medium'])), 2);
assert.strictEqual(columnsForOptions(normalizeOptions(['a very long option whose wording must take the complete row', 'another very long option whose wording must take the complete row', 'third very long option whose wording must take the complete row', 'fourth very long option whose wording must take the complete row'])), 1);
assert.strictEqual(columnsForOptions(normalizeOptions(['one', 'two', 'three'])), 1);
assert.strictEqual(columnsForOptions(normalizeOptions(['one', 'two'])), 2);

for (const fixture of [
  ['A、1', 'B、2', 'C、3', 'D、4'],
  ['A. 123456789012', 'B. b', 'C. c', 'D. d'],
  ['A. 1234567890123', 'B. b', 'C. c', 'D. d'],
  ['A. 12345678901234567890123456789', 'B. b', 'C. c', 'D. d'],
  [{ label: 'a．', content: '<b>v</b>' }, { label: 'b)', content: '<i>a</i>' }],
]) {
  const desktopOptions = desktopQuestionOptions.normalizeOptions(fixture);
  const miniappOptions = normalizeOptions(fixture);
  assert.deepStrictEqual(miniappOptions, desktopOptions, 'desktop and miniapp must normalize representative option labels/content identically');
  assert.strictEqual(
    classifyOptionLength(miniappOptions),
    desktopQuestionOptions.classifyOptionLength(desktopOptions),
    'desktop and miniapp must use the same short/medium/long option decision',
  );
}

const structured = createQuestionDisplay({
  stemPreview: 'legacy stem',
  answer: 'legacy answer',
  explanation: 'legacy explanation',
  options: [],
  richContent: {
    version: 1,
    type: 'question-document',
    sections: {
      stem: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Speed v' },
        { type: 'formula', attrs: { canonicalLatex: 'v^{2}=2as' } },
        { type: 'image', attrs: { assetKey: 'a'.repeat(64), alt: 'diagram' } },
      ] }] },
      options: [{ id: 'option-a', label: 'A', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '12 m/s' }] }] } }],
      subQuestions: [],
      answer: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
      analysis: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Because' }] }] },
    },
  },
});
assert.match(structured.stem, /v<sup>2<\/sup>=2as/, 'structured formulas must preserve their visible numbers and symbols');
assert.match(structured.stem, new RegExp(`question-asset://${'a'.repeat(64)}`), 'structured images must retain their cloud-delivery asset reference');
assert.deepStrictEqual(structured.options, [{ label: 'A', content: '<p>12 m/s</p>' }]);
assert.strictEqual(structured.answer, '<p>A</p>');
assert.strictEqual(structured.explanation, '<p>Because</p>');

const structuredLabels = createQuestionDisplay({
  richContent: {
    version: 1,
    type: 'question-document',
    sections: {
      stem: { type: 'doc', content: [] },
      options: [
        { id: 'option-a', label: 'a．', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] } },
        { id: 'option-b', label: 'B)', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] } },
      ],
      subQuestions: [],
      answer: { type: 'doc', content: [] },
      analysis: { type: 'doc', content: [] },
    },
  },
});
assert.deepStrictEqual(structuredLabels.options.map(option => option.label), ['A', 'B'], 'structured option labels must follow the same numbering normalization as legacy options');

const physicsFormula = renderLatex(String.raw`x_{0}^{2}+\frac{mv^{2}}{2}+\sqrt[3]{x}+\vec{v}+\alpha+\Omega`);
assert.match(physicsFormula, /<sub>0<\/sub><sup>2<\/sup>/, 'formula fallback must retain subscripts and superscripts');
assert.match(physicsFormula, /question-formula-fraction/, 'formula fallback must retain a visible stacked fraction');
assert.match(physicsFormula, /\u221a|√/, 'formula fallback must retain radicals');
assert.match(physicsFormula, /question-formula-vector/, 'formula fallback must retain vector notation');
assert.match(physicsFormula, /\u03b1|α/, 'formula fallback must retain lowercase Greek letters');
assert.match(physicsFormula, /\u03a9|Ω/, 'formula fallback must retain uppercase Greek letters');
assert.doesNotMatch(physicsFormula, /\\(?:frac|sqrt|vec|alpha|Omega)/, 'supported physics commands must never leak as raw backslash text');

const matrixFormula = renderLatex(String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}`);
assert.match(matrixFormula, /question-formula-matrix/, 'matrix notation must keep a visible matrix structure');
assert.match(matrixFormula, /<tr>[\s\S]*1[\s\S]*2[\s\S]*<\/tr>[\s\S]*<tr>[\s\S]*3[\s\S]*4/, 'matrix rows and cells must remain ordered');
assert.doesNotMatch(matrixFormula, /\\begin|\\end/, 'matrix environment commands must not leak into visible text');

const casesFormula = renderLatex(String.raw`f(x)=\begin{cases}x^{2}&x\ge 0\\-x&x<0\end{cases}`);
assert.match(casesFormula, /question-formula-cases/, 'piecewise notation must keep a visible cases structure');
assert.match(casesFormula, /\u2265|≥/, 'piecewise conditions must keep relation symbols');
assert.doesNotMatch(casesFormula, /\\begin|\\end|\\ge/, 'piecewise environment commands must not leak into visible text');

const unknownFormula = renderLatex(String.raw`E=\futurephysics{mc^{2}}`);
assert.doesNotMatch(unknownFormula, /\\/, 'unknown commands must degrade to readable text without exposing raw backslashes');
assert.match(unknownFormula, /futurephysics[\s\S]*mc<sup>2<\/sup>/, 'unknown-command fallback must retain both a readable command name and its argument');

const safeProjection = createQuestionDisplay({
  stemPreview: 'fallback',
  richContent: {
    version: 1,
    type: 'question-document',
    sections: {
      stem: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: '<script>alert(1)</script>', marks: [{ type: 'superscript' }] },
        { type: 'image', attrs: { assetKey: '../unsafe', alt: 'bad" onerror="alert(1)' } },
      ] }] },
      options: [],
      subQuestions: [],
      answer: { type: 'doc', content: [] },
      analysis: { type: 'doc', content: [] },
    },
  },
});
assert.match(safeProjection.stem, /<sup>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/sup>/);
assert.doesNotMatch(safeProjection.stem, /onerror|question-asset:\/\/\.\./, 'unsafe structured attributes must not reach RichText HTML');

const legacyFormula = createQuestionDisplay({
  stemPreview: '<p>Speed $v^{2}=2as$ and \\frac{1}{2}mv^2</p><script>alert(1)</script>',
  options: ['A. $\\sqrt{4}$ m/s', 'B. H<sub>2</sub>O'],
  answer: '$v=at$',
  explanation: '<img src="question-asset://' + 'b'.repeat(64) + '" onerror="alert(1)">',
  richContent: null,
});
assert.match(legacyFormula.stem, /v<sup>2<\/sup>=2as/, 'legacy inline formulas must keep powers, numbers, and operators');
assert.match(legacyFormula.stem, /question-formula-fraction/, 'legacy bare fractions must remain visibly structured');
assert.match(legacyFormula.options[0].content, /sqrt|\u221a|question-formula/, 'legacy option formulas must be projected instead of exposing source commands');
assert.match(legacyFormula.options[1].content, /H<sub>2<\/sub>O/, 'legacy HTML subscripts must remain visible');
assert.doesNotMatch(JSON.stringify(legacyFormula), /script|onerror/i, 'legacy fallback HTML must be sanitized before it reaches RichText');
assert.match(legacyFormula.explanation, new RegExp(`question-asset://${'b'.repeat(64)}`), 'safe legacy question assets must remain deliverable');

const legacyRelations = createQuestionDisplay({
  stemPreview: 'x &lt; y and y &gt; z; compare x &amp; z.',
  options: [String.raw`A. \alpha \in A`, String.raw`B. \vec{v}\cdots\hat{x}`],
  answer: '',
  explanation: '',
});
assert.match(legacyRelations.stem, /x &lt; y[\s\S]*y &gt; z[\s\S]*x &amp; z/, 'encoded comparison and ampersand symbols must remain visible instead of being mistaken for HTML tags');
assert.match(legacyRelations.options[0].content, /\u03b1/u, 'bare legacy Greek commands must render as symbols even without dollar delimiters');
assert.match(legacyRelations.options[0].content, /\u2208/u, 'bare legacy set-membership commands must render as symbols');
assert.match(legacyRelations.options[1].content, /question-formula-vector/u, 'bare legacy vector commands must retain vector notation');
assert.match(legacyRelations.options[1].content, /\u22ef/u, 'bare legacy ellipsis commands must render visibly');
assert.doesNotMatch(JSON.stringify(legacyRelations), /\\(?:alpha|in|vec|cdots|hat)/u, 'supported bare LaTeX commands must not leak into the miniapp question card');

const commonAccentsAndFunctions = renderLatex(String.raw`\overline{AB}+\hat{x}+\sin\theta+\alpha\in A+\cdots`);
assert.match(commonAccentsAndFunctions, /question-formula-overline/u, 'overline notation must keep a visible accent');
assert.match(commonAccentsAndFunctions, /question-formula-accent/u, 'hat notation must keep a visible accent');
assert.match(commonAccentsAndFunctions, /sin/u, 'common function names must remain readable');
assert.match(commonAccentsAndFunctions, /\u2208/u, 'set-membership notation must remain visible');
assert.match(commonAccentsAndFunctions, /\u22ef/u, 'ellipsis notation must remain visible');
assert.doesNotMatch(commonAccentsAndFunctions, /question-formula-unsupported/u, 'common school-level notation must not fall through to an unsupported-command label');

assert.strictEqual(hasQuestionAnswerContent({ answer: '', explanation: '', subQuestions: [] }), false, 'an empty question must not expose a meaningless answer action');
assert.strictEqual(hasQuestionAnswerContent({ answer: '<p>A</p>', explanation: '', subQuestions: [] }), true, 'a visible answer must expose the answer action');
assert.strictEqual(hasQuestionAnswerContent({ answer: '', explanation: '', subQuestions: [{ answer: '<span class="question-formula">2</span>' }] }), true, 'a subquestion answer must expose the answer action');

const unresolvedAssetKey = 'c'.repeat(64);
const unresolvedAsset = resolveQuestionAssetRefs(
  `<p>Diagram <img src="question-asset://${unresolvedAssetKey}" alt="force diagram" /></p>`,
  {},
);
assert.doesNotMatch(unresolvedAsset, /question-asset:\/\//, 'an unresolved question asset must not leak an unusable private URI into RichText');
assert.match(unresolvedAsset, /图片暂未加载/, 'an unresolved question asset must remain visibly represented instead of silently becoming blank');
assert.match(unresolvedAsset, /force diagram/, 'the unresolved media placeholder must retain useful alternative text');

const resolvedAsset = resolveQuestionAssetRefs(
  `<img src="question-asset://${unresolvedAssetKey}" alt="diagram" />`,
  { [unresolvedAssetKey]: 'wxfile://tmp/diagram.png?x=1&y=2' },
);
assert.match(resolvedAsset, /wxfile:\/\/tmp\/diagram\.png\?x=1&amp;y=2/, 'resolved delivery paths must be safely inserted into RichText HTML');
assert.doesNotMatch(resolvedAsset, /图片暂未加载/, 'resolved question assets must replace the loading placeholder');

console.log('miniapp question display checks passed');
