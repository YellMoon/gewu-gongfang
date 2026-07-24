'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Sqlite = require('better-sqlite3');

const projectRoot = path.resolve(__dirname, '..');
const sourceDb = String(process.env.GEWU_RUNTIME_SMOKE_SOURCE_DB || '').trim();
const evidenceFile = String(process.env.GEWU_RUNTIME_SMOKE_EVIDENCE_FILE || '').trim();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-single-user-runtime-'));

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readCounts(sqlite) {
  const tableNames = ['users', 'desktop_device_authorizations', 'primary_host_epochs', 'questions'];
  return Object.fromEntries(tableNames.map(table => {
    const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    return [table, exists ? Number(sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count) : 0];
  }));
}

async function createIsolatedDatabaseCopy() {
  if (!sourceDb || !fs.existsSync(sourceDb)) return null;
  const destination = path.join(temporaryRoot, 'runtime-copy.sqlite');
  const source = new Sqlite(sourceDb, { readonly: true, fileMustExist: true });
  const before = readCounts(source);
  try {
    await source.backup(destination);
  } finally {
    source.close();
  }
  const copy = new Sqlite(destination, { readonly: true, fileMustExist: true });
  const after = readCounts(copy);
  const integrity = copy.pragma('integrity_check', { simple: true });
  copy.close();
  if (integrity !== 'ok' || JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('RUNTIME_DATABASE_COPY_INTEGRITY_FAILED');
  }
  return { before, after, sha256: sha256(destination) };
}

function runCheck(file) {
  const result = spawnSync(process.execPath, [file], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
  return {
    file: path.basename(file),
    exitCode: Number(result.status ?? 1),
    summary: String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || '',
  };
}

(async () => {
  const databaseCopy = await createIsolatedDatabaseCopy();
  const checks = [
    'backend/src/services/singleUserDesktopIdentityService.test.js',
    'public/desktopIdentityVault.test.js',
    'src/services/singleUserPairingClient.test.js',
    'gateway/src/routes/cloudRelay.http.test.js',
    'backend/src/services/cloudRelayClient.test.js',
    'backend/src/routes/cloudRelayHostTasks.test.js',
    'backend/src/services/desktopDeviceChallengeService.test.js',
    'backend/src/services/desktopSessionRelayService.test.js',
    'src/services/desktopSessionRelayClient.test.js',
    'src/services/desktopIdentityClient.test.js',
    'src/components/DesktopIdentityGate.test.js',
    'src/pages/IdentityDeviceCenter.test.js',
    'backend/src/services/syncBatchBackupService.test.js',
  ].map(runCheck);
  if (checks.some(check => check.exitCode !== 0)) throw new Error('SINGLE_USER_RUNTIME_CHECK_FAILED');
  const evidence = Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceDatabaseCopied: !!databaseCopy,
    databaseCountsPreserved: databaseCopy ? JSON.stringify(databaseCopy.before) === JSON.stringify(databaseCopy.after) : null,
    databaseCopySha256: databaseCopy?.sha256 || null,
    checks,
    secretsRecorded: false,
  });
  if (evidenceFile) {
    const resolved = path.resolve(evidenceFile);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(evidence));
})().catch(error => {
  console.error(String(error?.code || error?.message || error));
  process.exitCode = 1;
});
