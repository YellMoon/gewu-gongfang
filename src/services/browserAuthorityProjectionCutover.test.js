const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('./browserQuestionPaginationCache.test');

const browserDatabase = fs.readFileSync(
  path.join(__dirname, 'browserDatabase.ts'),
  'utf8',
);
const app = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

assert.ok(
  browserDatabase.includes("from './authorityProjectionCacheAdapter.mjs'"),
  'browser cache must be constructed from the typed signed-projection adapter',
);
assert.ok(
  browserDatabase.includes('public async refreshAuthorityProjection({'),
  'browser database must expose a projection refresh boundary',
);
assert.ok(
  !browserDatabase.includes('window.desktopAuthority.readProjection'),
  'renderer data refresh must not retain the retired authority projection fallback',
);
assert.ok(
  browserDatabase.includes('cloudProvider.listCloudBusinessProjection()'),
  'an online unified desktop must hydrate business data from the cloud authority instead of an embedded backend',
);
assert.ok(
  browserDatabase.includes('DESKTOP_CLOUD_PROJECTION_PROVIDER_REQUIRED'),
  'missing cloud session projection provider must fail closed instead of reading a legacy projection',
);
assert.strictEqual(
  browserDatabase.includes('window.primaryHostRuntime'),
  false,
  'unified desktop edits must become encrypted drafts and must never execute in an embedded host runtime',
);
assert.ok(
  browserDatabase.includes('window.desktopAuthority.list()'),
  'verified projection refresh must overlay the encrypted typed outbox',
);
assert.ok(
  app.includes('await dbService.refreshAuthorityProjection()'),
  'application startup must await authority projection before rendering data pages',
);
assert.strictEqual(
  app.includes('/api/sync'),
  false,
  'application startup must not fetch raw sync rows',
);

console.log('browser authority projection cutover checks passed');
