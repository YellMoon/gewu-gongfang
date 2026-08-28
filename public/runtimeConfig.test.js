'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MANAGED_CLOUD_BASE_URL,
  MANAGED_CLOUD_BUSINESS_BASE_URL,
  applyRuntimeConfigToEnv,
  normalizeRuntimeConfig,
  readRuntimeConfig,
  writeManagedClientRuntimeConfig,
  writeRuntimeConfig,
} = require('./runtimeConfig');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-unified-desktop-config-'));
const configPath = path.join(root, 'runtime.json');
try {
  const normalized = normalizeRuntimeConfig({
    nodeRole: 'primary-host',
    primaryHostEpochId: 'legacy-epoch',
    primaryHostGeneration: 9,
    hostBaseUrl: 'http://192.168.1.8:3001',
    cloudBaseUrl: 'https://untrusted.example',
    cloudBusinessIdentityBaseUrl: 'https://untrusted-business.example',
    mainDbPath: 'D:/GewuDataHost/data/scheduling.db',
    questionBankPath: 'I:/GewuQuestionBank',
    questionAssetPath: 'I:/GewuQuestionBank/assets',
    questionBankCandidatePaths: ['I:/GewuQuestionBank'],
    questionBankStoreId: 'legacy-local-store',
    nasBackupPath: '\\\\legacy-nas\\backup',
  }, { userDataPath: root });
  for (const forbidden of ['nodeRole', 'primaryHostEpochId', 'primaryHostGeneration', 'hostBaseUrl']) {
    assert.ok(!Object.hasOwn(normalized, forbidden), `unified desktop config must erase ${forbidden}`);
  }
  assert.strictEqual(normalized.cloudBaseUrl, MANAGED_CLOUD_BASE_URL);
  assert.strictEqual(normalized.cloudBusinessIdentityBaseUrl, MANAGED_CLOUD_BUSINESS_BASE_URL);
  assert.strictEqual(normalized.mainDbPath, path.join(root, 'data', 'scheduling.db'));
  assert.strictEqual(normalized.questionBankPath, '');
  assert.strictEqual(normalized.questionAssetPath, '');
  assert.deepStrictEqual(normalized.questionBankCandidatePaths, []);
  assert.strictEqual(normalized.questionBankStoreId, '');
  assert.strictEqual(normalized.nasBackupPath, '');

  writeRuntimeConfig(configPath, normalized, { userDataPath: root });
  const written = readRuntimeConfig(configPath, { userDataPath: root });
  for (const forbidden of ['nodeRole', 'primaryHostEpochId', 'primaryHostGeneration', 'hostBaseUrl']) {
    assert.ok(!Object.hasOwn(written, forbidden), `persisted unified config must omit ${forbidden}`);
  }

  const legacyTransition = writeManagedClientRuntimeConfig(configPath, {
    deviceId: written.deviceId,
    expectedEpochId: 'legacy-epoch',
  }, { userDataPath: root });
  assert.strictEqual(legacyTransition.cloudBaseUrl, MANAGED_CLOUD_BASE_URL);

  const env = {
    GEWU_NODE_ROLE: 'primary-host',
    GEWU_HOST_BASE_URL: 'http://legacy',
    QUESTION_BANK_ROOT: 'I:/GewuQuestionBank',
    QUESTION_BANK_UPLOAD_DIR: 'I:/GewuQuestionBank/assets',
    QUESTION_BANK_CANDIDATE_ROOTS: 'I:/GewuQuestionBank',
    QUESTION_BANK_STORE_ID: 'legacy-local-store',
    GEWU_NAS_BACKUP_PATH: '\\\\legacy-nas\\backup',
  };
  applyRuntimeConfigToEnv(written, env);
  assert.ok(!Object.hasOwn(env, 'GEWU_NODE_ROLE'));
  assert.ok(!Object.hasOwn(env, 'GEWU_HOST_BASE_URL'));
  for (const forbidden of [
    'QUESTION_BANK_ROOT',
    'QUESTION_BANK_UPLOAD_DIR',
    'QUESTION_BANK_CANDIDATE_ROOTS',
    'QUESTION_BANK_STORE_ID',
    'GEWU_NAS_BACKUP_PATH',
  ]) {
    assert.ok(!Object.hasOwn(env, forbidden), `unified desktop environment must erase ${forbidden}`);
  }
  assert.strictEqual(env.GEWU_CLOUD_BASE_URL, MANAGED_CLOUD_BASE_URL);
  assert.strictEqual(env.GEWU_CLOUD_BUSINESS_IDENTITY_BASE_URL, MANAGED_CLOUD_BUSINESS_BASE_URL);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('unified desktop runtime config checks passed');
