'use strict';

const assert = require('assert');
const {
  EXPERIENCE_QUESTION_IDS,
  listUnrecognizedExperienceQuestions,
  unrecognizedExperienceQuestionById,
} = require('./unrecognizedExperienceData');

// Authorized source audit (2026-07-19): SHA-256
// cc32c9804373a906f6799522da77f24882c85fdec447701b0f09002894a132ad.
// Human-checked boundaries: questions 1, 2, 4, 11; answers A, C, B, AC.
// The private source path is intentionally excluded from production data and evidence comments.

const EXPECTED_IDS = [
  'experience-physics-2026-nb2-01',
  'experience-physics-2026-nb2-02',
  'experience-physics-2026-nb2-04',
  'experience-physics-2026-nb2-11',
];

function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  if (Array.isArray(node)) node.forEach(item => walk(item, visitor));
  else Object.values(node).forEach(value => walk(value, visitor));
}

const samples = listUnrecognizedExperienceQuestions();
assert.deepStrictEqual(EXPERIENCE_QUESTION_IDS, EXPECTED_IDS);
assert.deepStrictEqual(samples.map(item => item.id), EXPECTED_IDS);
assert.deepStrictEqual(samples.map(item => item.number), [1, 2, 4, 11]);
assert.deepStrictEqual(samples.map(item => item.answer), ['A', 'C', 'B', 'AC']);
assert.ok(samples.every(item => item.sourceLabel === '\u793a\u4f8b\u9898\uff08\u4e0d\u5c5e\u4e8e\u6b63\u5f0f\u9898\u5e93\uff09'));

const expectedQuestionKeys = [
  'answer',
  'explanationRichContent',
  'id',
  'number',
  'options',
  'sourceLabel',
  'stemRichContent',
  'type',
];
for (const sample of samples) {
  assert.deepStrictEqual(Object.keys(sample).sort(), expectedQuestionKeys);
  assert.strictEqual(sample.stemRichContent.type, 'doc');
  assert.strictEqual(sample.explanationRichContent.type, 'doc');
  assert.deepStrictEqual(sample.options.map(option => option.key), ['A', 'B', 'C', 'D']);
  for (const option of sample.options) {
    assert.deepStrictEqual(Object.keys(option).sort(), ['contentRichContent', 'key']);
    assert.strictEqual(option.contentRichContent.type, 'doc');
  }
}

const serialized = JSON.stringify(samples);
for (const forbidden of [
  'D:\\',
  'question-asset://',
  'data:image/',
  'readonly_snapshots',
  'miniapp_tasks',
]) assert.ok(!serialized.includes(forbidden), `fixed experience data must exclude ${forbidden}`);

walk(samples, node => {
  assert.notStrictEqual(node.type, 'image', 'fixed experience questions must not contain image nodes');
  assert.ok(!Object.prototype.hasOwnProperty.call(node, 'src'), 'fixed experience questions must not contain image sources');
  assert.ok(!Object.prototype.hasOwnProperty.call(node, 'assetKey'), 'fixed experience questions must not contain asset references');
  if (node.type === 'formula') {
    assert.ok(node.attrs?.canonicalLatex, 'formula nodes must retain editable canonical LaTeX');
    assert.strictEqual(node.attrs?.conversionStatus, 'complete');
  }
});

const photoFreeQuestion = samples[1];
const photoFreeSerialized = JSON.stringify(photoFreeQuestion);
for (const forbidden of ['\u5982\u56fe', '\u7532\u56fe', '\u4e59\u56fe', '\u4e19\u56fe', '\u4e01\u56fe', '.png', 'relationship']) {
  assert.ok(!photoFreeSerialized.includes(forbidden), `question 2 must not depend on its source photo: ${forbidden}`);
}

const nuclearQuestion = samples[2];
const nuclearFormulae = [];
walk(nuclearQuestion.stemRichContent, node => {
  if (node.type === 'formula') nuclearFormulae.push(node.attrs.canonicalLatex);
});
assert.deepStrictEqual(nuclearFormulae, [
  '\\mathrm{X}+_{90}^{232}\\mathrm{Th}\\to_{90}^{233}\\mathrm{Th}',
  '_{90}^{233}\\mathrm{Th}\\to_{91}^{233}\\mathrm{Pa}+_{-1}^{0}\\mathrm{e}',
  '_{91}^{233}\\mathrm{Pa}\\to_{92}^{233}\\mathrm{U}+_{-1}^{0}\\mathrm{e}',
]);

const copy = unrecognizedExperienceQuestionById(EXPECTED_IDS[0]);
assert.deepStrictEqual(copy, samples[0]);
copy.answer = 'D';
assert.strictEqual(unrecognizedExperienceQuestionById(EXPECTED_IDS[0]).answer, 'A', 'callers must receive isolated copies');
assert.strictEqual(unrecognizedExperienceQuestionById('not-a-fixed-id'), null);

console.log('unrecognized experience fixed-data checks passed');
