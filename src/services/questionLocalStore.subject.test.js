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
  await store.ensureQuestionLocalStoreSeeded(() => [
    { id: 'year-one', subject: 'physics', content: 'One', year: '2025-2026' },
    { id: 'year-two', subject: 'physics', content: 'Two', year: '2026-2027' },
    { id: 'year-three', subject: 'physics', content: 'Three', year: '2035-2036' },
  ]);
  assert.equal((await store.queryQuestionPage({ page: 1, pageSize: 20, years: ['2025-2026', '2026-2027'] })).total, 2, 'multiple years must use OR matching');
  assert.equal((await store.queryQuestionPage({ page: 1, pageSize: 20, years: [] })).total, 3, 'clearing years means all years');
  assert.equal((await store.queryQuestionPage({ page: 1, pageSize: 20, year: '2035-2036' })).total, 1, 'legacy single-year callers remain compatible');
  const metadataRows=[
    {id:'metadata-one',subject:'physics',content:'One',source:'Paper A',region:'Zhejiang',school:'School A',year:'2025-2026'},
    {id:'metadata-two',subject:'physics',content:'Two',source:'Paper B',region:'Zhejiang',school:'School B',year:'2025-2026'},
    {id:'metadata-three',subject:'physics',content:'Three',source:'Paper B',region:'Shanghai',school:'School A',year:'2026-2027'},
    {id:'metadata-history',subject:'history',content:'History',source:'History paper',region:'Other region',school:'Other school'},
    {id:'metadata-deleted',subject:'physics',content:'Deleted',source:'Deleted paper',region:'Deleted region',school:'Deleted school',deleted:true},
  ];
  await store.ensureQuestionLocalStoreSeeded(()=>metadataRows);
  const metadataQuery=facets=>store.queryQuestionPage({page:1,pageSize:20,subjectIds:['physics'],...facets});
  assert.equal((await metadataQuery({sources:['Paper A','Paper B']})).total,3,'multiple paper names match with OR');
  assert.equal((await metadataQuery({regions:['Zhejiang','Shanghai']})).total,3,'multiple regions match with OR');
  assert.equal((await metadataQuery({sources:['Paper B'],schools:['School A','School B']})).total,2,'multiple schools match with OR inside a field');
  assert.equal((await metadataQuery({sources:['Paper A'],regions:['Shanghai']})).total,0,'different metadata fields match with AND');
  assert.equal((await metadataQuery({regions:['Zhejiang'],schools:['School A']})).total,1);
  assert.equal((await metadataQuery({sources:['Zhejiang']})).total,0,'region text never leaks into paper filtering');
  assert.equal((await metadataQuery({schools:['2025-2026']})).total,0,'academic-year values never leak into school filtering');
  assert.equal((await metadataQuery({sources:['Paper B'],years:['2025-2026']})).total,1,'independent academic-year row remains compatible');
  assert.equal((await metadataQuery({source:'2025-2026'})).total,2,'legacy aggregate callers remain compatible');
  assert.deepEqual(JSON.parse(JSON.stringify(store.questionMetadataFilterOptions(metadataRows,['\u7269\u7406']))),{sources:['Paper A','Paper B'],regions:['Shanghai','Zhejiang'],schools:['School A','School B']},'candidate values are distinct, scoped to subject aliases and exclude deleted rows');
  await store.ensureQuestionLocalStoreSeeded(() => questions.map(row => ({ ...row, content: 'Updated ' + row.id })));
  assert((await query('physics')).rows.every(row => row.content.startsWith('Updated ')), 'same-count cloud updates must replace the derived index');
  await store.ensureQuestionLocalStoreSeeded(() => [{id:'structured',subject:'physics',content:'题干',options:[{label:'A',content:'独特选项'}],tags:['力学专项'],rich_content:{type:'question-document',sections:{stem:{type:'doc',content:[{type:'formula',attrs:{canonicalLatex:'x^2'}}]},analysis:{type:'doc',content:[{type:'text',text:'推导过程'}]},subQuestions:[]}}}]);
  for (const term of ['独特选项','力学专项','x^2','推导过程']) assert.equal((await store.queryQuestionPage({page:1,pageSize:10,searchTerms:[term]})).total,1,term+' must be found by actual query');
  const doc = text => ({ type: 'doc', content: [{ type: 'text', text }] });
  await store.ensureQuestionLocalStoreSeeded(() => [
    { id: 'prompt-rich', subject: 'physics', content: 'staleLegacy', answer: 'answerOnly', tags: ['tagOnly'], rich_content: { type: 'question-document', sections: {
      stem: doc('stemOnly'), options: [{ label: 'A', content: doc('optionOnly') }],
      answer: doc('richAnswerOnly'), analysis: doc('analysisOnly'),
      subQuestions: [{ content: doc('experimentOnly'), answer: doc('subAnswerOnly'), analysis: doc('subAnalysisOnly') }],
    } } },
    { id: 'prompt-legacy', subject: 'physics', content: '<p>legacyStem</p>', options: ['legacyOption'],
      sub_questions: [{ stem: 'legacySmallQuestion', options: [{ text: 'smallOption' }], answer: 'legacySubAnswer' }], answer: 'legacyAnswer' },
  ]);
  const searchPrompt = term => store.queryQuestionPage({ page: 1, pageSize: 20, searchScope: 'stem', searchTerms: [term] });
  for (const term of ['stemOnly', 'optionOnly', 'experimentOnly', 'legacyStem', 'legacyOption', 'legacySmallQuestion', 'smallOption'])
    assert.equal((await searchPrompt(term)).total, 1, term + ' must match a prompt');
  for (const term of ['staleLegacy', 'answerOnly', 'richAnswerOnly', 'analysisOnly', 'subAnswerOnly', 'subAnalysisOnly', 'tagOnly', 'legacySubAnswer', 'legacyAnswer', 'prompt-rich'])
    assert.equal((await searchPrompt(term)).total, 0, term + ' must stay outside prompt search');
  assert.equal((await store.queryQuestionPage({ page: 1, pageSize: 20, searchTerms: ['tagOnly'] })).total, 1, 'other broad-search callers remain compatible');
  await store.ensureQuestionLocalStoreSeeded(() => questions.filter(row => row.subject === 'chemistry'));
  assert.equal((await query('physics')).total, 0, 'removed authoritative rows must not survive in the index');
  await store.ensureQuestionLocalStoreSeeded(() => []);
  assert.equal((await query('chemistry')).total, 0, 'an empty authoritative snapshot must clear old index rows');
  const { saveDesktopAuthorizationSession, clearDesktopAuthorizationSession } = await import('./desktopAuthorizationSession.mjs');
  await saveDesktopAuthorizationSession({ token: 'memory-token', userId: 'memory-user', deviceId: 'memory-device', activeRole: 'teacher' });
  await store.upsertQuestionLocalRecord({ id: 'memory-provenance', subject: 'physics', content: 'Local question' });
  const local = (await query('physics')).rows[0];
  assert.equal(local.ownerUserId, 'memory-user', 'local provenance must use the canonical memory session');
  assert.equal(local.sourceDeviceId, 'memory-device');
  await clearDesktopAuthorizationSession();
  console.log('question local subject filtering checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
