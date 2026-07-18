const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  normalizeRuntimeConfig,
  readRuntimeConfig,
  writeRuntimeConfig,
  writeManagedHostRuntimeConfig,
  writeManagedClientRuntimeConfig,
  applyRuntimeConfigToEnv,
} = require('./runtimeConfig');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-runtime-config-'));
const configPath = path.join(dir, 'gewugongfang.config.json');

const normalized = normalizeRuntimeConfig({
  nodeRole: 'primary-host',
  deviceId: 'desktop_test',
  mainDbPath: 'D:/GewuData/scheduling.db',
  questionBankPath: 'E:/GewuQuestionBank',
  questionBankCandidatePaths: ['E:/GewuQuestionBank', 'J:/GewuQuestionBank/'],
  questionBankStoreId: 'qb_test_store',
  localCachePath: 'D:/GewuQuestionBankCache/',
  nasBackupPath: '//NAS/GewuQuestionBankBackup/',
  desktopSyncToken: 'ab'.repeat(32),
  cloudBaseUrl: 'https://cloud.example.com/',
});

assert.strictEqual(normalized.nodeRole, 'primary-host');
assert.strictEqual(normalized.deviceId, 'desktop_test');
assert.strictEqual(normalized.questionAssetPath.replace(/\\/g, '/'), 'E:/GewuQuestionBank/assets');
assert.deepStrictEqual(
  normalized.questionBankCandidatePaths.map(item => item.replace(/\\/g, '/')),
  ['E:/GewuQuestionBank', 'J:/GewuQuestionBank']
);
assert.strictEqual(normalized.questionBankStoreId, 'qb_test_store');
assert.strictEqual(normalized.localCachePath.replace(/\\/g, '/'), 'D:/GewuQuestionBankCache');
assert.strictEqual(normalized.nasBackupPath.replace(/\\/g, '/'), '//NAS/GewuQuestionBankBackup');
assert.strictEqual(normalized.desktopSyncToken, 'ab'.repeat(32));
assert.strictEqual(normalized.cloudBaseUrl, 'https://cloud.example.com');

const ordinaryWrite = writeRuntimeConfig(configPath, normalized, { userDataPath: dir });
assert.strictEqual(ordinaryWrite.nodeRole, 'desktop-client', 'ordinary settings must not self-promote a device to primary host');
assert.strictEqual(ordinaryWrite.deviceId, 'desktop_test');
writeManagedHostRuntimeConfig(configPath, {
  deviceId: 'desktop_test',
  epochId: 'primary-host-epoch-1',
  generation: 1,
}, { userDataPath: dir });
const readBack = readRuntimeConfig(configPath, { userDataPath: dir });
assert.strictEqual(readBack.mainDbPath.replace(/\\/g, '/'), 'D:/GewuData/scheduling.db');
assert.strictEqual(readBack.nodeRole, 'primary-host');
assert.strictEqual(readBack.primaryHostEpochId, 'primary-host-epoch-1');
assert.strictEqual(readBack.primaryHostGeneration, 1);

const attemptedRoleTamper = writeRuntimeConfig(configPath, {
  ...readBack,
  nodeRole: 'desktop-client',
  primaryHostEpochId: 'attacker-epoch',
  primaryHostGeneration: 99,
  hostBaseUrl: 'http://192.168.1.8:3001',
}, { userDataPath: dir });
assert.strictEqual(attemptedRoleTamper.nodeRole, 'primary-host');
assert.strictEqual(attemptedRoleTamper.primaryHostEpochId, 'primary-host-epoch-1');
assert.strictEqual(attemptedRoleTamper.primaryHostGeneration, 1);
assert.strictEqual(attemptedRoleTamper.hostBaseUrl, 'http://192.168.1.8:3001');

const env = {};
applyRuntimeConfigToEnv(readBack, env);
assert.strictEqual(env.GEWU_NODE_ROLE, 'primary-host');
assert.strictEqual(env.GEWU_DEVICE_ID, 'desktop_test');
assert.strictEqual(env.GEWU_PRIMARY_HOST_EPOCH_ID, 'primary-host-epoch-1');
assert.strictEqual(env.GEWU_PRIMARY_HOST_GENERATION, '1');
assert.strictEqual(env.DB_PATH.replace(/\\/g, '/'), 'D:/GewuData/scheduling.db');
assert.strictEqual(env.QUESTION_BANK_ROOT.replace(/\\/g, '/'), 'E:/GewuQuestionBank');
assert.strictEqual(env.QUESTION_BANK_UPLOAD_DIR.replace(/\\/g, '/'), 'E:/GewuQuestionBank/assets');
assert.strictEqual(env.QUESTION_BANK_CANDIDATE_ROOTS.replace(/\\/g, '/'), 'E:/GewuQuestionBank;J:/GewuQuestionBank');
assert.strictEqual(env.QUESTION_BANK_STORE_ID, 'qb_test_store');
assert.strictEqual(env.GEWU_LOCAL_CACHE_PATH.replace(/\\/g, '/'), 'D:/GewuQuestionBankCache');
assert.strictEqual(env.GEWU_NAS_BACKUP_PATH.replace(/\\/g, '/'), '//NAS/GewuQuestionBankBackup');
assert.strictEqual(env.GEWU_DESKTOP_SYNC_TOKEN, 'ab'.repeat(32));
assert.match(env.JWT_SECRET, /^[a-f0-9]{64}$/);
assert.match(env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET, /^[a-f0-9]{64}$/);
assert.notStrictEqual(env.JWT_SECRET, env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET);
const repeatedEnv = {};
applyRuntimeConfigToEnv(readBack, repeatedEnv);
assert.strictEqual(repeatedEnv.JWT_SECRET, env.JWT_SECRET, 'derived local JWT secret must be stable across restarts');
assert.strictEqual(repeatedEnv.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET, env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET, 'derived artifact secret must be stable across restarts');
const explicitEnv = { JWT_SECRET: 'externally-managed-jwt', GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET: 'externally-managed-artifact' };
applyRuntimeConfigToEnv(readBack, explicitEnv);
assert.strictEqual(explicitEnv.JWT_SECRET, 'externally-managed-jwt');
assert.strictEqual(explicitEnv.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET, 'externally-managed-artifact');

const fallback = normalizeRuntimeConfig({}, { userDataPath: dir });
assert.ok(fallback.deviceId.startsWith('desktop_'));
assert.strictEqual(fallback.nodeRole, 'desktop-client');
assert.ok(fallback.mainDbPath.endsWith(path.join('data', 'scheduling.db')));

assert.throws(() => writeManagedHostRuntimeConfig(configPath, {
  deviceId: 'another-device', epochId: 'epoch-2', generation: 2,
}, { userDataPath: dir }), /PRIMARY_HOST_RUNTIME_DEVICE_MISMATCH/);
const demoted = writeManagedClientRuntimeConfig(configPath, {
  deviceId: 'desktop_test', expectedEpochId: 'primary-host-epoch-1',
}, { userDataPath: dir });
assert.strictEqual(demoted.nodeRole, 'desktop-client');
assert.strictEqual(demoted.primaryHostEpochId, '');
assert.strictEqual(demoted.primaryHostGeneration, null);
