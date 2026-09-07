'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
for (const database of ['gewu_cloud', 'postgres', 'gewu_snapshot_shadow_not-random']) {
  const secret = 'never-print-this-test-password';
  const run = spawnSync(process.execPath, [path.join(__dirname, 'scheduleSnapshotRecoveryShadowProbe.js')], {
    input: JSON.stringify({ connection: { database, password: secret }, backupSha256: 'a'.repeat(64) }), encoding: 'utf8', windowsHide: true,
  });
  assert.equal(run.status, 1);
  assert(run.stderr.includes('SHADOW_DATABASE_REQUIRED'), 'refuse production before loading a database driver');
  assert(!run.stderr.includes(secret) && !run.stdout.includes(secret));
}
console.log('snapshot shadow production refusal and input redaction checks passed');
