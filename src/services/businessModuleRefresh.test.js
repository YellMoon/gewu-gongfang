'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
(async () => {
  const { buildAuthorityBackedBrowserCache } = await import('./authorityProjectionCacheAdapter.mjs');
  const source = fs.readFileSync('src/services/browserDatabase.ts', 'utf8');
  const ast = ts.createSourceFile('browserDatabase.ts', source, ts.ScriptTarget.Latest, true);
  let method;
  function visit(node) { if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'refreshAuthorityProjection') method = node; ts.forEachChild(node, visit); }
  visit(ast);
  const code = ts.transpileModule(`return class Cache { ${method.getText(ast)} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const module of ['courses', 'schedules']) {
    const calls = [], persisted = [];
    const previous = { students: [{ id: 'student' }], courses: [{ id: 'course', name: 'old' }], rooms: [{ id: 'room', name: 'old' }], schedules: [{ id: 'lesson', notes: 'old' }],
      questions: [{ id: 'question', content: 'preserve' }], payments: [{ id: 'payment', amount: 180 }], questionBasketIds: ['question'] };
    const identity = { userId: 'actor', activeRole: 'teacher' };
    const env = { window: { desktopIdentitySessionProvider: {
      businessAuthority: 'https://fixture.invalid', listCloudQuestions: async () => { throw new Error('QUESTION_FETCH_FORBIDDEN'); },
      listCloudBusinessProjection: async options => { calls.push(options); return { courses: [{ id: 'course', name: 'new' }], rooms: [{ id: 'room', name: 'new' }], schedules: [{ id: 'lesson', notes: 'new' }], students: [], payments: [] }; },
    }, desktopAuthority: { list: async () => [] }, dispatchEvent: () => {} },
    readCurrentDesktopIdentityContext: () => identity, emptyDatabase: () => ({}), buildAuthorityBackedBrowserCache, CustomEvent: class {} };
    const Cache = new Function(...Object.keys(env), code)(...Object.values(env));
    const cache = new Cache();
    cache.data = structuredClone(previous);
    for (const name of ['hydrateTaxonomiesFromSyncRows','migrateLegacyQuestionData','migrateLegacyTagData','migrateQuestionVersionData','migrateImportTaskData','rebuildQuestionIndexes']) cache[name] = () => {};
    cache.saveData = () => persisted.push(structuredClone(cache.data));
    await cache.refreshAuthorityProjection({ module });
    assert.deepEqual(calls, [{ module }]);
    assert.deepEqual(JSON.parse(JSON.stringify(cache.data.students)), previous.students);
    assert.deepEqual(cache.data.payments, previous.payments);
    assert.deepEqual(cache.data.questions.map(q => q.id), ['question']);
    assert.deepEqual(cache.data.questionBasketIds, ['question']);
    if (module === 'courses') { assert.equal(cache.data.courses[0].name, 'new'); assert.equal(cache.data.rooms[0].name, 'new'); assert.deepEqual(cache.data.schedules[0].notes, 'old'); }
    else { assert.equal(cache.data.schedules[0].notes, 'new'); assert.equal(cache.data.courses[0].name, 'old'); }
    assert.equal(persisted.length, 1);
    assert.deepEqual(persisted[0], cache.data, 'readback matches persisted derived cache');
  }
  console.log('actual cache module refresh: requested scope only, no question fetch, unrelated financial/student data and persisted readback preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
