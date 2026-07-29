const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
  browserDatabase.includes('window.desktopAuthority.readProjection({ minSourceVersion })'),
  'renderer data refresh must use only the preload authority facade',
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
