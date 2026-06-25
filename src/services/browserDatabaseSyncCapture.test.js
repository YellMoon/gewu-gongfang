const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/browserDatabase.ts', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(source.includes('recordSyncChange'), 'browser database should define local sync change capture');
assert.ok(source.includes('sync_engine_sync_pending_changes'), 'browser database should write to SyncEngine pending changes');

for (const table of [
  'students',
  'courses',
  'schedules',
  'payments',
  'consumptions',
  'teachers',
  'grades',
  'rooms',
  'institutions',
  'assetRecords',
  'assetCategories',
  'questions',
]) {
  assert.ok(source.includes(`this.recordSyncChange('${table}'`), `browser database should queue changes for ${table}`);
}

assert.ok(source.includes(", 'create',"), 'browser database should queue create operations');
assert.ok(source.includes(", 'update',"), 'browser database should queue update operations');
assert.ok(source.includes(", 'delete',"), 'browser database should queue delete operations');
assert.ok(packageJson.includes('src/services/browserDatabaseSyncCapture.test.js'), 'browser database sync capture test should run in npm test');

console.log('browserDatabase sync capture checks passed');
