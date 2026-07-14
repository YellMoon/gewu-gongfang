const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const ts = require('typescript');

function loadTypescript(filename) {
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = new Module(filename);
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const filename = require.resolve('./questionTypes.ts');
const { normalizeQuestionType, questionTypeFromParser } = loadTypescript(filename);
const { choiceMode, setCorrectSelection, validateQuestionStructure } = loadTypescript(require.resolve('../components/question-editor/questionStructureOperations.ts'));

for (const alias of ['single-choice', 'single_choice', 'single choice', 'single']) {
  assert.strictEqual(normalizeQuestionType(alias), '\u5355\u9009\u9898', `existing record type ${alias} must migrate to single choice`);
  assert.strictEqual(questionTypeFromParser(alias), '\u5355\u9009\u9898', `parser type ${alias} must map to single choice`);
}

for (const alias of ['multiple-choice', 'multiple_choice', 'multiple choice', 'multiple', 'multi']) {
  assert.strictEqual(normalizeQuestionType(alias), '\u591a\u9009\u9898', `existing record type ${alias} must migrate to multiple choice`);
  assert.strictEqual(questionTypeFromParser(alias), '\u591a\u9009\u9898', `parser type ${alias} must map to multiple choice`);
}

assert.strictEqual(normalizeQuestionType('SINGLE-CHOICE'), '\u5355\u9009\u9898');
assert.strictEqual(questionTypeFromParser(['unknown', 'MULTIPLE-CHOICE']), '\u591a\u9009\u9898');
assert.strictEqual(normalizeQuestionType('\u5355\u9009\u9898'), '\u5355\u9009\u9898');
assert.strictEqual(normalizeQuestionType('calculation'), '\u89e3\u7b54\u9898');

const rich = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const existingSingleChoice = {
  version: 1,
  type: 'question-document',
  sections: {
    stem: rich('seed'),
    options: [
      { id: 'a', label: 'A', content: rich('A'), isCorrect: true },
      { id: 'b', label: 'B', content: rich('B'), isCorrect: false },
    ],
    subQuestions: [],
    answer: rich('A'),
    analysis: rich('analysis'),
  },
};
const migratedSingleType = normalizeQuestionType('single-choice');
assert.strictEqual(choiceMode(migratedSingleType), 'single', 'migrated single-choice records must render Radio controls');
const radioSelected = setCorrectSelection(existingSingleChoice, 'b', true, choiceMode(migratedSingleType));
assert.deepStrictEqual(radioSelected.sections.options.map(option => option.isCorrect), [false, true], 'Radio selection must leave exactly one correct option');
assert.deepStrictEqual(validateQuestionStructure(radioSelected, migratedSingleType), []);
assert.strictEqual(choiceMode(normalizeQuestionType('multiple-choice')), 'multiple');

console.log('question type normalization tests passed');
