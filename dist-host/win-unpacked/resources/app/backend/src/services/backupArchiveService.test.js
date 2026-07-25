const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { archiveBackupArtifact } = require('./backupArchiveService');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-backup-archive-'));
const sourceDir = path.join(workspace, 'source');
const localCachePath = path.join(workspace, 'local-cache');
const nasBackupPath = path.join(workspace, 'nas-backup');
const missingNasPath = path.join(workspace, 'missing-nas');
fs.mkdirSync(sourceDir, { recursive: true });
fs.mkdirSync(localCachePath, { recursive: true });
fs.mkdirSync(nasBackupPath, { recursive: true });

const artifactPath = path.join(sourceDir, 'scheduling-backup-test.json');
fs.writeFileSync(artifactPath, JSON.stringify({ ok: true }), 'utf-8');

const archived = archiveBackupArtifact(artifactPath, {
  localCachePath,
  nasBackupPath,
  now: new Date('2026-06-26T10:30:00.000Z'),
});

assert.strictEqual(archived.localCache.available, true);
assert.strictEqual(archived.localCache.status, 'archived');
assert.ok(fs.existsSync(archived.localCache.artifactPath));
assert.strictEqual(fs.readFileSync(archived.localCache.artifactPath, 'utf-8'), fs.readFileSync(artifactPath, 'utf-8'));
assert.match(archived.localCache.artifactPath.replace(/\\/g, '/'), /2026-06/);

assert.strictEqual(archived.nasBackup.available, true);
assert.strictEqual(archived.nasBackup.status, 'archived');
assert.ok(fs.existsSync(archived.nasBackup.artifactPath));

const partial = archiveBackupArtifact(artifactPath, {
  localCachePath,
  nasBackupPath: missingNasPath,
  now: new Date('2026-06-26T10:30:00.000Z'),
});
assert.strictEqual(partial.localCache.available, true);
assert.strictEqual(partial.nasBackup.available, false);
assert.strictEqual(partial.nasBackup.status, 'offline');
assert.ok(!fs.existsSync(missingNasPath), 'NAS archive target should not be auto-created');

const unconfigured = archiveBackupArtifact(artifactPath, {});
assert.strictEqual(unconfigured.localCache.status, 'not-configured');
assert.strictEqual(unconfigured.nasBackup.status, 'not-configured');

console.log('backup archive checks passed');
