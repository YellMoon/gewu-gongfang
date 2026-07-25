const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  inspectBackupTarget,
  inspectBackupTargets,
} = require('./questionBankBackupTargetService');

const localCache = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-qb-cache-'));
const nasBackup = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-qb-nas-'));
const missingNas = path.join(os.tmpdir(), `gewu-qb-missing-nas-${Date.now()}`);

const cacheStatus = inspectBackupTarget(localCache, { label: 'local-cache', create: true });
assert.strictEqual(cacheStatus.available, true);
assert.strictEqual(cacheStatus.label, 'local-cache');

const nasStatus = inspectBackupTarget(nasBackup, { label: 'nas-backup', create: false });
assert.strictEqual(nasStatus.available, true);
assert.strictEqual(nasStatus.label, 'nas-backup');

const missingStatus = inspectBackupTarget(missingNas, { label: 'nas-backup', create: false });
assert.strictEqual(missingStatus.available, false);
assert.strictEqual(missingStatus.status, 'offline');

const all = inspectBackupTargets({ localCachePath: localCache, nasBackupPath: nasBackup });
assert.strictEqual(all.localCache.available, true);
assert.strictEqual(all.nasBackup.available, true);

console.log('question bank backup target checks passed');
