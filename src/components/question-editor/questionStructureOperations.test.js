const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const ts = require('typescript');

const filename = require.resolve('./questionStructureOperations.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loaded = new Module(filename);
loaded._compile(compiled, filename);

const {
  addOption, addSubQuestion, moveEntity, removeEntity, updateEntity,
  hasRichContent, validateQuestionStructure, setCorrectSelection, mergeQuestionAssets,
} = loaded.exports;

const empty = () => ({ type: 'doc', content: [] });
const rich = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const base = {
  version: 1, type: 'question-document', sections: {
    stem: rich('题干'), options: [], subQuestions: [], answer: rich('答案'), analysis: empty(),
  },
};

const withOption = addOption(base, () => 'option-stable');
assert.strictEqual(withOption.sections.options[0].id, 'option-stable');
assert.notStrictEqual(withOption, base);
assert.notStrictEqual(withOption.sections, base.sections);
assert.deepStrictEqual(base.sections.options, [], 'add must not mutate history snapshots');

const twoOptions = addOption(withOption, () => 'option-2');
assert.deepStrictEqual(twoOptions.sections.options.map(item => item.label), ['A', 'B']);
const moved = moveEntity(twoOptions, 'options', 'option-2', -1);
assert.deepStrictEqual(moved.sections.options.map(item => item.id), ['option-2', 'option-stable']);
assert.deepStrictEqual(moved.sections.options.map(item => item.label), ['A', 'B']);
assert.deepStrictEqual(twoOptions.sections.options.map(item => item.id), ['option-stable', 'option-2']);
const marked = updateEntity(moved, 'options', 'option-stable', { isCorrect: true });
assert.strictEqual(marked.sections.options[1].isCorrect, true);

const nonEmpty = updateEntity(marked, 'options', 'option-stable', { content: rich('非空选项') });
assert.strictEqual(removeEntity(nonEmpty, 'options', 'option-stable', () => false), nonEmpty, 'cancelled removal keeps exact value');
assert.strictEqual(removeEntity(nonEmpty, 'options', 'option-stable', () => true).sections.options.length, 1);
assert.strictEqual(removeEntity(marked, 'options', 'option-stable', () => { throw new Error('empty removal must not confirm'); }).sections.options.length, 1);

const withSub = addSubQuestion(base, () => 'sub-stable');
assert.strictEqual(withSub.sections.subQuestions[0].id, 'sub-stable');
let selected = setCorrectSelection(twoOptions, 'option-stable', true, 'single');
assert.deepStrictEqual(selected.sections.options.map(item => item.isCorrect), [true, false]);
assert.strictEqual(selected.sections.answer.content[0].content[0].text, 'A');
selected = setCorrectSelection(selected, 'option-2', true, 'single');
assert.deepStrictEqual(selected.sections.options.map(item => item.isCorrect), [false, true]);
assert.strictEqual(selected.sections.answer.content[0].content[0].text, 'B');
let multiple = setCorrectSelection(twoOptions, 'option-stable', true, 'multiple');
multiple = setCorrectSelection(multiple, 'option-2', true, 'multiple');
assert.strictEqual(multiple.sections.answer.content[0].content[0].text, 'AB');
assert.strictEqual(setCorrectSelection(multiple, 'option-stable', false, 'multiple').sections.answer.content[0].content[0].text, 'B');
const onlyOne = setCorrectSelection(twoOptions, 'option-stable', true, 'multiple');
assert.strictEqual(setCorrectSelection(onlyOne, 'option-stable', false, 'multiple'), onlyOne, 'multiple choice keeps at least one correct option');
assert.strictEqual(hasRichContent(rich('x')), true);
assert.strictEqual(hasRichContent(empty()), false);
assert.deepStrictEqual(validateQuestionStructure(base), []);
assert.ok(validateQuestionStructure({ ...base, sections: { ...base.sections, stem: empty() } }).includes('请输入题干'));
assert.deepStrictEqual(mergeQuestionAssets(
  [{ id: 'old', oss_key: 'same.png', metadata: 'keep' }, { assetKey: 'rich-image' }],
  [{ id: 'new-duplicate', oss_key: 'same.png' }, { oss_url: 'https://asset/new.png' }],
), [{ id: 'old', oss_key: 'same.png', metadata: 'keep' }, { assetKey: 'rich-image' }, { oss_url: 'https://asset/new.png' }]);

const componentSource = fs.readFileSync(require.resolve('./QuestionStructureEditor.tsx'), 'utf8');
const editSource = fs.readFileSync(require.resolve('../../pages/QuestionBankEdit.tsx'), 'utf8');
assert.ok(componentSource.includes('QuestionStructureEditor') && componentSource.includes('RichQuestionEditor'));
assert.ok(!componentSource.includes('addonBefore='), 'canonical structure editor must not emit the deprecated Ant Input addon warning');
assert.ok(componentSource.includes('moveEntity') && componentSource.includes('removeEntity'));
assert.ok(editSource.includes('beforeunload') && editSource.includes('editorDirty'));
assert.ok(editSource.includes('confirmLoading={saving}') && editSource.includes('saveGate(saveQuestion)'));
assert.ok(editSource.includes('<QuestionStructureEditor'));

console.log('question structure operations tests passed');
