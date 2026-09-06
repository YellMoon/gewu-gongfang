const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

(async () => {
  const { createDesktopIdentityClient } = await import('./desktopIdentityClient.mjs');
  // Execute the actual cache-refresh method, with browser dependencies isolated.
  const source = fs.readFileSync(path.join(__dirname, 'browserDatabase.ts'), 'utf8');
  const ast = ts.createSourceFile('browserDatabase.ts', source, ts.ScriptTarget.Latest, true);
  let method;
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'refreshAuthorityProjection') method = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(method, 'real refresh boundary must exist');
  const compiled = ts.transpileModule(`class CacheHarness { ${method.getText(ast)} }; CacheHarness`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const items = Array.from({ length: 426 }, (_, i) => ({ id: `q-${i}`, version: 1 }));
  let failSecondPage = true;
  let pageCalls = 0;
  let builds = 0;
  let saves = 0;
  let events = 0;
  const client = createDesktopIdentityClient({
    desktopIdentity: { status: async () => ({}) },
    fetchImpl: async url => {
      pageCalls++;
      const after = new URL(url).searchParams.get('afterId');
      if (after && failSecondPage) throw new Error('NETWORK_LOST');
      const start = after ? items.findIndex(item => item.id === after) + 1 : 0;
      const questions = items.slice(start, start + 200);
      return { ok: true, json: async () => ({ ok: true, questions, nextCursor: start + questions.length < items.length ? questions.at(-1).id : null }) };
    },
  });
  const CacheHarness = vm.runInNewContext(compiled, {
    window: {
      desktopIdentitySessionProvider: {
        listCloudBusinessProjection: async () => ({ students: [{ id: 'cloud-student' }] }),
        listCloudQuestions: () => client.listCloudQuestions({ baseUrl: 'https://cloud.test', currentSession: { token: 'session', offline: false } }),
      },
      desktopAuthority: { list: async () => [{ id: 'pending-draft' }] },
      dispatchEvent: () => { events++; },
    },
    CustomEvent: class {},
    readCurrentDesktopIdentityContext: () => ({ userId: 'teacher', activeRole: 'teacher' }),
    buildAuthorityBackedBrowserCache: ({ projection, outbox, localOnly }) => {
      builds++;
      assert.equal(projection.payload.questions.length, 426);
      assert.equal(outbox[0].id, 'pending-draft');
      return { ...projection.payload, ...localOnly };
    },
    emptyDatabase: () => ({}),
  });
  const cache = new CacheHarness();
  const previous = { questions: [{ id: 'old-cache' }], questionBasketIds: ['basket-id'], questionVersions: [], importTasks: [], importTaskItems: [] };
  cache.data = previous;
  for (const name of ['hydrateTaxonomiesFromSyncRows', 'migrateLegacyQuestionData', 'migrateLegacyTagData', 'migrateQuestionVersionData', 'migrateImportTaskData', 'rebuildQuestionIndexes']) cache[name] = () => {};
  cache.saveData = () => { saves++; };
  await assert.rejects(cache.refreshAuthorityProjection(), /NETWORK_LOST/);
  assert.strictEqual(cache.data, previous, 'failed later page must preserve the existing cache object');
  assert.deepEqual([pageCalls, builds, saves, events], [2, 0, 0, 0]);
  failSecondPage = false;
  await cache.refreshAuthorityProjection();
  assert.equal(cache.data.questions.length, 426);
  assert.strictEqual(cache.data.questionBasketIds, previous.questionBasketIds);
  assert.deepEqual([pageCalls, builds, saves, events], [5, 1, 1, 1]);
  const committed = cache.data;
  cache.migrateLegacyQuestionData = () => { throw new Error('INVALID_RICH_CONTENT'); };
  await assert.rejects(cache.refreshAuthorityProjection(), /INVALID_RICH_CONTENT/);
  assert.ok(cache.data === committed, 'normalization failures must restore the previous in-memory cache');
  assert.deepEqual([pageCalls, builds, saves, events], [8, 2, 1, 1]);
  cache.migrateLegacyQuestionData = () => {};
  await cache.refreshAuthorityProjection({ notifyConsumers: false });
  assert.deepEqual([pageCalls, builds, saves, events], [11, 3, 2, 1], 'page-owned refresh must update its cache without remounting the initiating page');
  console.log('browser question pagination cache checks passed: failed refresh preserves cache; complete refresh commits once');
})().catch(error => { console.error(error); process.exitCode = 1; });
