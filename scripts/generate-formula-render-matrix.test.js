const assert = require('assert');
const { matrixCases, buildQuestions } = require('./generate-formula-render-matrix');

const cases = matrixCases();
assert.strictEqual(cases.length, 16, 'four formula modes x two answer positions x two formats');
for (const mode of ['word-native', 'eq-field', 'mathtype-compatible', 'latex-vector']) {
  for (const answerPosition of ['end', 'after-each']) {
    for (const format of ['word', 'pdf']) {
      assert.ok(cases.some(row => row.formulaMode === mode && row.answerPosition === answerPosition && row.format === format));
    }
  }
}

const questions = buildQuestions();
const serialized = JSON.stringify(questions);
assert.ok(questions.length >= 3, 'matrix must exercise multiple question types');
assert.ok(serialized.includes('canonicalLatex'), 'matrix must contain editable canonical formulas');
assert.ok(serialized.includes('subQuestions'), 'matrix must contain subquestions and subanswers');
assert.ok(serialized.includes('data:image/png;base64,'), 'matrix must contain a real embedded image');
assert.ok(serialized.includes('knowledge_point_names'), 'matrix must render knowledge points');

console.log('formula render matrix definition checks passed');
