const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  normalizeRuntimeConfig,
  readRuntimeConfig,
  ensureRuntimeConfig,
  writeRuntimeConfig,
  writeManagedHostBootstrapRuntimeConfig,
  writeManagedHostRuntimeConfig,
  writeManagedClientRuntimeConfig,
  writeManagedDesktopIdentityMode,
  applyRuntimeConfigToEnv,
  MANAGED_CLOUD_BASE_URL,
} = require('./runtimeConfig');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-runtime-config-'));
assert.strictEqual(
  MANAGED_CLOUD_BASE_URL,
  'https://physicsedu.xyz/cloud-business',
  'ordinary desktops must use the deployed cloud-business authority by default',
);
const configPath = path.join(dir, 'gewugongfang.config.json');

const firstLaunchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-runtime-first-launch-'));
const firstLaunchPath = path.join(firstLaunchDir, 'gewugongfang.config.json');
const firstLaunchConfig = ensureRuntimeConfig(firstLaunchPath, { userDataPath: firstLaunchDir });
const repeatedFirstLaunchConfig = ensureRuntimeConfig(firstLaunchPath, { userDataPath: firstLaunchDir });
assert.ok(fs.existsSync(firstLaunchPath), 'first launch must persist the generated runtime configuration');
assert.strictEqual(repeatedFirstLaunchConfig.deviceId, firstLaunchConfig.deviceId, 'device id must stay stable across reads');
assert.strictEqual(firstLaunchConfig.desktopIdentityMode, 'full', 'desktop identity mode must default to full');

const retiredSingleUserAttempt = normalizeRuntimeConfig({ desktopIdentityMode: 'single-user' }, {
  userDataPath: firstLaunchDir,
  primaryHostCapable: false,
});
assert.strictEqual(retiredSingleUserAttempt.desktopIdentityMode, 'full', 'single-user mode must be retired');

const previousE2eAuthorityDataMode = process.env.GEWU_E2E_NO_AUTHORITY_DATA;
const previousE2eManagedCloud = process.env.GEWU_E2E_MANAGED_CLOUD_BASE_URL;
try {
  process.env.GEWU_E2E_NO_AUTHORITY_DATA = '1';
  process.env.GEWU_E2E_MANAGED_CLOUD_BASE_URL = 'http://127.0.0.1:48123';
  assert.strictEqual(normalizeRuntimeConfig({ nodeRole: 'desktop-client' }, {
    userDataPath: firstLaunchDir,
  }).cloudBaseUrl, 'http://127.0.0.1:48123',
  'an explicit no-real-data E2E run must use its isolated loopback control plane');
  process.env.GEWU_E2E_MANAGED_CLOUD_BASE_URL = 'https://untrusted.example';
  assert.strictEqual(normalizeRuntimeConfig({ nodeRole: 'desktop-client' }, {
    userDataPath: firstLaunchDir,
  }).cloudBaseUrl, MANAGED_CLOUD_BASE_URL,
  'the E2E override must reject a non-loopback cloud endpoint');
} finally {
  if (previousE2eAuthorityDataMode === undefined) delete process.env.GEWU_E2E_NO_AUTHORITY_DATA;
  else process.env.GEWU_E2E_NO_AUTHORITY_DATA = previousE2eAuthorityDataMode;
  if (previousE2eManagedCloud === undefined) delete process.env.GEWU_E2E_MANAGED_CLOUD_BASE_URL;
  else process.env.GEWU_E2E_MANAGED_CLOUD_BASE_URL = previousE2eManagedCloud;
}

const normalized = normalizeRuntimeConfig({
  nodeRole: 'primary-host',
  deviceId: 'desktop_test',
  mainDbPath: 'D:/GewuData/scheduling.db',
  questionBankPath: 'E:/GewuQuestionBank',
  questionBankCandidatePaths: ['E:/GewuQuestionBank', 'J:/GewuQuestionBank/'],
  questionBankStoreId: 'qb_test_store',
  localCachePath: 'D:/GewuQuestionBankCache/',
  nasBackupPath: '//NAS/GewuQuestionBankBackup/',
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
assert.strictEqual(Object.hasOwn(normalized, 'desktopSyncToken'), false, 'shared relay secrets must be removed from runtime configuration');
assert.strictEqual(normalized.cloudBaseUrl, 'https://cloud.example.com');

const ordinaryWrite = writeRuntimeConfig(configPath, normalized, { userDataPath: dir });
assert.strictEqual(ordinaryWrite.nodeRole, 'desktop-client', 'ordinary settings must not self-promote a device to primary host');
assert.strictEqual(ordinaryWrite.deviceId, 'desktop_test');
const hostBootstrap = writeManagedHostBootstrapRuntimeConfig(configPath, {
  deviceId: 'desktop_test',
}, { userDataPath: dir, primaryHostCapable: true });
assert.strictEqual(hostBootstrap.nodeRole, 'primary-host', 'a primary-host package must retain its host bootstrap role');
assert.strictEqual(hostBootstrap.primaryHostEpochId, '');
assert.strictEqual(hostBootstrap.primaryHostGeneration, null);
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
assert.throws(() => writeManagedDesktopIdentityMode(configPath, 'single-user', {
  userDataPath: dir,
  primaryHostCapable: true,
}), /DESKTOP_IDENTITY_MODE_RETIRED/);

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
assert.strictEqual(env.GEWU_DESKTOP_IDENTITY_MODE, 'full');

assert.strictEqual(env.GEWU_PRIMARY_HOST_GENERATION, '1');
assert.strictEqual(env.DB_PATH.replace(/\\/g, '/'), 'D:/GewuData/scheduling.db');
assert.strictEqual(env.QUESTION_BANK_ROOT.replace(/\\/g, '/'), 'E:/GewuQuestionBank');
assert.strictEqual(env.QUESTION_BANK_UPLOAD_DIR.replace(/\\/g, '/'), 'E:/GewuQuestionBank/assets');
assert.strictEqual(env.QUESTION_BANK_CANDIDATE_ROOTS.replace(/\\/g, '/'), 'E:/GewuQuestionBank;J:/GewuQuestionBank');
assert.strictEqual(env.QUESTION_BANK_STORE_ID, 'qb_test_store');
assert.strictEqual(env.GEWU_LOCAL_CACHE_PATH.replace(/\\/g, '/'), 'D:/GewuQuestionBankCache');
assert.strictEqual(env.GEWU_NAS_BACKUP_PATH.replace(/\\/g, '/'), '//NAS/GewuQuestionBankBackup');
const repeatedEnv = {};
applyRuntimeConfigToEnv(readBack, repeatedEnv);
const explicitEnv = {
  JWT_SECRET: 'externally-managed-jwt',
  GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET: 'externally-managed-artifact',
  GEWU_CLOUD_RELAY_HOST_TOKEN: 'retired-relay-secret',
};
applyRuntimeConfigToEnv(readBack, explicitEnv);
assert.strictEqual(explicitEnv.JWT_SECRET, 'externally-managed-jwt');
assert.strictEqual(explicitEnv.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET, 'externally-managed-artifact');
assert.strictEqual(explicitEnv.GEWU_CLOUD_RELAY_HOST_TOKEN, undefined);
const ordinaryEnv = {};
applyRuntimeConfigToEnv(ordinaryWrite, ordinaryEnv);
assert.strictEqual(
  ordinaryEnv.GEWU_CLOUD_RELAY_HOST_TOKEN,
  undefined,
  'an ordinary desktop must never receive the primary-host relay assertion capability'
);

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
