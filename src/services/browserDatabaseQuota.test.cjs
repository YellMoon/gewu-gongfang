const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

(async () => {
  const source = fs.readFileSync(path.join(__dirname, 'browserDatabase.ts'), 'utf8');
  const ast = ts.createSourceFile('browserDatabase.ts', source, ts.ScriptTarget.Latest, true);
  const names = new Set(['refreshAuthorityProjection', 'saveData', 'loadData', 'hydrateTaxonomiesFromSyncRows']);
  const methods = [];
  function visit(node) {
    if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(methods.length, names.size);
  const { buildAuthorityBackedBrowserCache } = await import('./authorityProjectionCacheAdapter.mjs');
  const { createAuthorityCacheCheckpoint } = await import('./authorityCacheCheckpoint.mjs');
  const codecPath = path.join(__dirname, 'browserDatabaseStorage.ts');
  const codec = fs.existsSync(codecPath) ? (() => {
    const compiled = ts.transpileModule(fs.readFileSync(codecPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, require, btoa, atob, Uint8Array });
    return exports;
  })() : {};
  const reference = JSON.parse(fs.readFileSync(path.join(__dirname, '../../reference-data/zujuan-high-school-2026-10-11.json'), 'utf8'));
  const projection = { taxonomy_systems: [], taxonomy_nodes: [] };
  for (const subject of reference.subjects) {
    for (const system of subject.systems) {
      const systemId = `fixture-${subject.bankId}-${system.kind}`;
      projection.taxonomy_systems.push({ id: systemId, subject: subject.subject, name: system.kind, sort_order: 0 });
      for (const node of system.nodes) projection.taxonomy_nodes.push({
        id: `fixture-node-${subject.bankId}-${system.kind}-${node.sourceId}`, system_id: systemId,
        parent_id: node.parentId ? `fixture-node-${subject.bankId}-${system.kind}-${node.parentId}` : null,
        name: node.name, sort_order: node.sortOrder, deleted: false,
        created_at: '2026-10-11T07:18:13.511Z', updated_at: '2026-10-11T07:18:13.511Z',
      });
    }
  }
  assert.ok(projection.taxonomy_nodes.length > 13500);
  assert.equal(new Set(projection.taxonomy_nodes.map(node => node.id)).size, projection.taxonomy_nodes.length);
  const dom = new JSDOM('', { url: 'https://fixture.test', storageQuota: 5 * 1024 * 1024 });
  const storage = dom.window.localStorage;
  const previous = { questions: [{ id: 'old', version: 1 }], taxonomy_nodes: [], questionBasketIds: ['old'], questionVersions: [], importTasks: [], importTaskItems: [] };
  const identity = { userId: 'fixture-admin', activeRole: 'super_admin' };
  let failPersistence = false;
  let events = 0;
  const compiled = ts.transpileModule(`class CacheHarness { ${methods.join('\n')} }; CacheHarness`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const Harness = vm.runInNewContext(compiled, {
    ...codec,
    localStorage: { getItem: key => storage.getItem(key), setItem: (key, value) => {
      if (failPersistence) throw new Error('DISK_FAILURE');
      storage.setItem(key, value);
    } },
    window: { desktopIdentitySessionProvider: {
      businessAuthority: 'https://cloud.test', listCloudBusinessProjection: async () => projection,
      listCloudQuestions: async () => [{ id: 'cloud-question', version: 1, content: '中文题干 μm', assets: [{ data_url: 'data:image/png;base64,KEEP' }] }],
    }, desktopAuthority: { list: async () => [] }, dispatchEvent: () => { events++; } },
    readCurrentDesktopIdentityContext: () => identity, buildAuthorityBackedBrowserCache,
    emptyDatabase: () => ({}), CustomEvent: class {}, console,
    removeUnreferencedLegacyAssetCategorySeeds: value => value,
    calculateGrade: () => 1,
  });
  const cache = new Harness();
  cache.partitionKey = 'fixture-admin:super_admin:all';
  cache.storageKey = 'fixture-cache';
  cache.data = previous;
  cache.authorityCacheCheckpoint = createAuthorityCacheCheckpoint(previous);
  for (const name of ['syncLegacyTreesFromTags', 'syncAllQuestionLegacyTagFields', 'migrateLegacyQuestionData', 'migrateLegacyTagData', 'migrateQuestionVersionData', 'migrateImportTaskData', 'rebuildQuestionIndexes']) cache[name] = () => {};
  storage.setItem(cache.storageKey, JSON.stringify(previous));
  await cache.refreshAuthorityProjection();
  assert.equal(cache.data.taxonomy_nodes.length, projection.taxonomy_nodes.length);
  assert.equal(cache.data.tags.length, projection.taxonomy_nodes.length);
  const raw = JSON.stringify(cache.data);
  assert.ok(raw.length > 5 * 1024 * 1024, 'fixture must exceed the browser quota before encoding');
  const stored = storage.getItem(cache.storageKey);
  assert.ok(stored.length < 1024 * 1024, 'complete taxonomy must persist with room for another identity partition');
  assert.equal(events, 1);
  const restored = codec.decodeBrowserDatabase(stored);
  assert.equal(JSON.stringify(restored), raw, 'compression must preserve every node, draft, CJK text and embedded asset');
  assert.equal(restored.questions[0].assets[0].data_url, 'data:image/png;base64,KEEP');
  assert.equal(JSON.stringify(codec.decodeBrowserDatabase(JSON.stringify(previous))), JSON.stringify(previous), 'existing plain JSON caches must remain readable');
  assert.equal(codec.encodeBrowserDatabase(previous), JSON.stringify(previous), 'small legacy caches keep their existing format');
  assert.throws(() => codec.decodeBrowserDatabase(JSON.stringify({ format: 'gewu.browser-cache.gzip.v1', payload: 'corrupt' })));
  const fresh = new Harness();
  fresh.storageKey = cache.storageKey;
  fresh.authorityCacheCheckpoint = createAuthorityCacheCheckpoint(previous);
  for (const name of ['migrateLegacyQuestionData', 'migrateLegacyTagData', 'migrateQuestionVersionData', 'migrateImportTaskData', 'rebuildQuestionIndexes', 'syncTaxonomySyncRowsFromCanonical']) fresh[name] = () => {};
  fresh.loadData();
  assert.equal(fresh.data.taxonomy_nodes.length, projection.taxonomy_nodes.length, 'a restarted desktop must restore the complete compressed tree');
  assert.equal(fresh.data.tags.length, projection.taxonomy_nodes.length);
  storage.setItem('other-account', stored);
  await cache.refreshAuthorityProjection({ notifyConsumers: false });
  const committed = cache.data;
  const committedBytes = storage.getItem(cache.storageKey);
  failPersistence = true;
  await assert.rejects(cache.refreshAuthorityProjection(), /DISK_FAILURE/);
  assert.strictEqual(cache.data, committed, 'a failed durable save must restore the previous in-memory cache');
  assert.equal(storage.getItem(cache.storageKey), committedBytes);
  assert.equal(events, 1, 'failed persistence must not notify consumers');
  dom.window.close();
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  let chromiumQuota;
  try {
    const page = await browser.newPage();
    await page.route('https://cache-quota.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cache quota regression</title>' }));
    await page.goto('https://cache-quota.test/');
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('fflate')), '../umd/index.js') });
    const compiledCodec = ts.transpileModule(fs.readFileSync(codecPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    await page.addScriptTag({ content: `(function(){const exports={};const require=()=>window.fflate;${compiledCodec}\nwindow.cacheCodec=exports;})();` });
    chromiumQuota = await page.evaluate(rawCache => {
      let originalError = null;
      try { localStorage.setItem('cache', rawCache); } catch (error) { originalError = error.name; }
      const encoded = window.cacheCodec.encodeBrowserDatabase(JSON.parse(rawCache));
      localStorage.setItem('cache', encoded);
      localStorage.setItem('other-identity', encoded);
      const restored = window.cacheCodec.decodeBrowserDatabase(localStorage.getItem('cache'));
      return { originalError, fullRoundTrip: JSON.stringify(restored) === rawCache, nodes: restored.taxonomy_nodes.length, storedCharacters: encoded.length };
    }, raw);
    assert.equal(chromiumQuota.originalError, 'QuotaExceededError', 'actual Chromium must reproduce the original full-tree cache failure');
    assert.equal(chromiumQuota.fullRoundTrip, true);
    assert.equal(chromiumQuota.nodes, projection.taxonomy_nodes.length);
    await page.reload();
    assert.equal(await page.evaluate(() => !!localStorage.getItem('cache')), true, 'compressed bytes survive a browser restart/reload');
  } finally { await browser.close(); }
  console.log(JSON.stringify({ passed: true, nodes: projection.taxonomy_nodes.length, rawCharacters: raw.length, storedCharacters: stored.length, oldCacheReadable: true, failedSavePreserved: true, chromiumQuota }));
})().catch(error => { console.error(error); process.exitCode = 1; });
