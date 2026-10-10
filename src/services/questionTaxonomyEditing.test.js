'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file) {
  const exports = {};
  new Function('exports', ts.transpileModule(fs.readFileSync(require.resolve(file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(exports);
  return exports;
}
const { questionTaxonomyValues, questionTaxonomyPatch, parseQuestionNumbers } = load('./questionTaxonomyEditing.ts');
assert.deepEqual(parseQuestionNumbers('1, 3, 8-12 3', 50), [1, 3, 8, 9, 10, 11, 12]);
assert.equal(parseQuestionNumbers('1-1000', 1000).length, 1000);
for (const input of ['', '0', '51', '12-8', 'NaN', '1-99999999999999999']) assert.throws(() => parseQuestionNumbers(input, 50));
const question = { id: 'q', subject: 'physics', content: 'unchanged', version: 7,
  knowledge_ids: ['k-old'], model_ids: ['m-old'], taxonomy_ids: { s1: ['a'], s2: ['x'], other: ['keep'] } };
assert.deepEqual(questionTaxonomyValues(question).knowledge, ['k-old']);
assert.deepEqual(questionTaxonomyPatch(question, { s1: ['b', 'b'] }).taxonomy_ids.s1, ['b']);
assert.deepEqual(questionTaxonomyPatch(question, { s1: ['b'] }, 'add').taxonomy_ids.s1, ['a', 'b']);
assert.deepEqual(questionTaxonomyPatch(question, { s1: ['a'] }, 'remove').taxonomy_ids.s1, []);
assert.deepEqual(questionTaxonomyPatch(question, { s1: [] }).taxonomy_ids.other, ['keep']);
assert.deepEqual(questionTaxonomyPatch(question, { knowledge: [] }).knowledge_point_ids, []);

// Exercise the actual database writer and in-place relation rebuilding, without constructing a user cache.
const source = fs.readFileSync(process.env.QUESTION_TAXONOMY_DATABASE_SOURCE || require.resolve('./browserDatabase.ts'), 'utf8');
const tree = ts.createSourceFile('browserDatabase.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = tree.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'BrowserDatabaseService');
const adapter = load('./tagAdapter.ts');
const env = { ...adapter, applyTrustedQuestionProvenance: updates => updates,
  mergeBrowserQuestionUpdate: (existing, updates) => ({ ...existing, ...updates }) };
const Class = new Function(...Object.keys(env), ts.transpileModule(declaration.getText(tree), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText + '\nreturn BrowserDatabaseService;')(...Object.values(env));
const db = Object.create(Class.prototype);
const tags = [['knowledge', 'k-old'], ['model', 'm-old'], ['s1', 'a'], ['s1', 'b'], ['s2', 'x'], ['s2', 'y']]
  .map(([tag_type, id]) => ({ tag_type, id, tag_name: id, status: 1 }));
db.data = { questions: [structuredClone(question)], tags, questionTagRels: [
  ['knowledge', 'k-old'], ['model', 'm-old'], ['s1', 'a'], ['s2', 'x'],
].map(([tag_type, tag_id]) => ({ id: adapter.makeQuestionTagRelId('q', tag_id, tag_type), question_id: 'q', tag_type, tag_id })) };
db.getTaxonomySystems = () => ['knowledge', 'model', 's1', 's2'].map(id => ({ id }));
db.normalizeQuestionRecord = value => value;
db.createQuestionVersionSnapshot = () => {};
let draft;
db.recordAuthorityDraft = (collection, action, id, value) => { draft = structuredClone(value); };
db.syncQuestionLocalRecord = () => {};
db.saveData = () => {};
assert.equal(db.updateQuestion('q', questionTaxonomyPatch(question, { s1: ['a', 'b'], s2: ['y'] })), true);
assert.deepEqual(db.data.questions[0].taxonomy_ids.s1, ['a', 'b']);
assert.deepEqual(db.data.questions[0].taxonomy_ids.s2, ['y']);
assert.deepEqual(draft.taxonomy_ids.other, ['keep']);
assert.equal(draft.content, 'unchanged');
assert.equal(draft.version, 7, 'draft retains the observed cloud CAS baseline');
assert.equal(db.updateQuestion('q', { taxonomy_ids: { ...draft.taxonomy_ids, s1: [] } }), true);
assert.deepEqual(db.data.questions[0].taxonomy_ids.s1, [], 'taxonomy-only edits must rebuild relations');
assert.equal(db.updateQuestion('q', questionTaxonomyPatch(db.data.questions[0], { knowledge: [], model: [] })), true);
assert.deepEqual(db.data.questions[0].knowledge_ids, []);
assert.deepEqual(db.data.questions[0].model_ids, []);
assert.equal(db.updateQuestion('q', { knowledge_ids: ['k-old'], model_point_ids: ['m-old'] }), true);
assert.deepEqual(db.data.questions[0].taxonomy_ids.knowledge, ['k-old'], 'legacy writers remain compatible');
assert.deepEqual(db.data.questions[0].taxonomy_ids.model, ['m-old']);
assert.equal(db.updateQuestion('q', { taxonomy_ids: { ...db.data.questions[0].taxonomy_ids, knowledge: [] } }), true);
assert.deepEqual(db.data.questions[0].knowledge_point_ids, [], 'taxonomy-only clears mirror both aliases');
assert.equal(db.updateQuestion('missing', { taxonomy_ids: {} }), false);
const wrapper = fs.readFileSync(require.resolve('../pages/QuestionBankEdit.tsx'), 'utf8');
assert.match(wrapper, /<QuestionBankPreview subject=\{subject\} context=\{context\} taggingWorkspace/);
console.log('taxonomy writer round-trip, multiple systems, clearing, legacy aliases, CAS preservation and unrestricted number selection passed');
