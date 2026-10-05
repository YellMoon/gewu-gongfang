'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function loadInspection() { const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(require.resolve('./questionInspection.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name==='../utils/questionOptions'?require('../utils/questionOptions.ts'):require(name),m,m.exports);return m.exports; }

const source = fs.readFileSync(require.resolve('./questionLocalStore.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleValue = { exports: {} };
vm.runInNewContext(compiled, { module: moduleValue, exports: moduleValue.exports, require: name => {
  if (name === './desktopIdentityPartition.mjs') return { partitionedStorageKey: value => 'test-' + value };
  if (name === './taxonomyFilter.mjs') return require('./taxonomyFilter.mjs');
  if (name === './questionProvenance.mjs') return require('./questionProvenance.mjs');
  if (name === './questionInspection') return loadInspection();
  return require(name);
} });
(async () => {
  const store = moduleValue.exports;
  const subjects = ['physics', '\u7269\u7406', 'chemistry', 'mathematics', 'math', '\u6570\u5b66', 'custom-physics'];
  const questions = subjects.map((subject, index) => ({ id: 'subject-fixture-' + index, subject, content: 'Question ' + index, options: [], status: 'draft' }));
  await store.ensureQuestionLocalStoreSeeded(() => questions);
  const query = subject => store.queryQuestionPage({ page: 1, pageSize: 20, subjectIds: [subject] });
  assert.equal((await query('\u7269\u7406')).total, 2, 'Chinese UI filter must include cloud physics and historical Chinese rows');
  assert.equal((await query('physics')).total, 2);
  assert.equal((await query('\u6570\u5b66')).total, 3);
  assert.equal((await query('\u5316\u5b66')).total, 1);
  assert.equal((await query('custom-physics')).total, 1, 'unknown subjects must match only themselves');
  assert.equal((await query('biology')).total, 0);
  assert.equal((await query('physics')).rows[0].subject, 'physics', 'filtering must not rewrite authoritative payloads');
  await store.ensureQuestionLocalStoreSeeded(() => questions.map(row => ({ ...row, content: 'Updated ' + row.id })));
  assert((await query('physics')).rows.every(row => row.content.startsWith('Updated ')), 'same-count cloud updates must replace the derived index');
  await store.ensureQuestionLocalStoreSeeded(() => [{id:'structured',subject:'physics',content:'题干',options:[{label:'A',content:'独特选项'}],tags:['力学专项'],rich_content:{type:'question-document',sections:{stem:{type:'doc',content:[{type:'formula',attrs:{canonicalLatex:'x^2'}}]},analysis:{type:'doc',content:[{type:'text',text:'推导过程'}]},subQuestions:[]}}}]);
  for (const term of ['独特选项','力学专项','x^2','推导过程']) assert.equal((await store.queryQuestionPage({page:1,pageSize:10,searchTerms:[term]})).total,1,term+' must be found by actual query');
  await store.ensureQuestionLocalStoreSeeded(() => questions.filter(row => row.subject === 'chemistry'));
  assert.equal((await query('physics')).total, 0, 'removed authoritative rows must not survive in the index');
  await store.ensureQuestionLocalStoreSeeded(() => []);
  assert.equal((await query('chemistry')).total, 0, 'an empty authoritative snapshot must clear old index rows');
  console.log('question local subject filtering checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
