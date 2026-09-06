'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require.resolve('./questionLocalStore.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleValue = { exports: {} };
vm.runInNewContext(compiled, { module: moduleValue, exports: moduleValue.exports, require: name => {
  if (name === './desktopIdentityPartition.mjs') return { partitionedStorageKey: value => 'test-' + value };
  if (name === './taxonomyFilter.mjs') return require('./taxonomyFilter.mjs');
  if (name === './questionProvenance.mjs') return require('./questionProvenance.mjs');
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
  console.log('question local subject filtering checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
