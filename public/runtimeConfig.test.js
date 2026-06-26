const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  normalizeRuntimeConfig,
  readRuntimeConfig,
  writeRuntimeConfig,
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
assert.strictEqual(normalized.cloudBaseUrl, 'https://cloud.example.com');

writeRuntimeConfig(configPath, normalized);
const readBack = readRuntimeConfig(configPath, { userDataPath: dir });
assert.strictEqual(readBack.mainDbPath.replace(/\\/g, '/'), 'D:/GewuData/scheduling.db');

const env = {};
applyRuntimeConfigToEnv(readBack, env);
assert.strictEqual(env.GEWU_NODE_ROLE, 'primary-host');
assert.strictEqual(env.GEWU_DEVICE_ID, 'desktop_test');
assert.strictEqual(env.DB_PATH.replace(/\\/g, '/'), 'D:/GewuData/scheduling.db');
assert.strictEqual(env.QUESTION_BANK_ROOT.replace(/\\/g, '/'), 'E:/GewuQuestionBank');
assert.strictEqual(env.QUESTION_BANK_UPLOAD_DIR.replace(/\\/g, '/'), 'E:/GewuQuestionBank/assets');
assert.strictEqual(env.QUESTION_BANK_CANDIDATE_ROOTS.replace(/\\/g, '/'), 'E:/GewuQuestionBank;J:/GewuQuestionBank');
assert.strictEqual(env.QUESTION_BANK_STORE_ID, 'qb_test_store');
assert.strictEqual(env.GEWU_LOCAL_CACHE_PATH.replace(/\\/g, '/'), 'D:/GewuQuestionBankCache');
assert.strictEqual(env.GEWU_NAS_BACKUP_PATH.replace(/\\/g, '/'), '//NAS/GewuQuestionBankBackup');

const fallback = normalizeRuntimeConfig({}, { userDataPath: dir });
assert.ok(fallback.deviceId.startsWith('desktop_'));
assert.strictEqual(fallback.nodeRole, 'desktop-client');
assert.ok(fallback.mainDbPath.endsWith(path.join('data', 'scheduling.db')));
