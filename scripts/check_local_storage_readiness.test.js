const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildReadinessReport } = require('./check_local_storage_readiness');

const source = fs.readFileSync(path.join(__dirname, 'check_local_storage_readiness.js'), 'utf-8');

assert.ok(source.includes('gewugongfang.config.json'), 'script should read the runtime config file');
assert.ok(source.includes('inspectBackupTargets'), 'script should inspect local cache and NAS backup targets');
assert.ok(source.includes('retiredQuestionBankStore'), 'legacy local question-bank storage must be reported as retired rather than required');
assert.ok(source.includes('cloud question-bank structure is authoritative'), 'readiness must preserve the cloud-authority boundary');
assert.ok(source.includes('process.exitCode = 1'), 'script should fail when required local storage is unavailable');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-local-storage-readiness-'));
const localCachePath = path.join(root, 'cache');
const nasBackupPath = path.join(root, 'backup');
fs.mkdirSync(localCachePath);
fs.mkdirSync(nasBackupPath);
try {
  const report = buildReadinessReport({
    configPath: path.join(root, 'config.json'),
    config: { nodeRole: 'primary-host', deviceId: 'desktop-1', questionBankPath: 'I:/retired-question-bank', questionBankStoreId: 'retired-store', localCachePath, nasBackupPath },
  });
  assert.strictEqual(report.ok, true, 'a retired local question-bank mount must not block media/backup readiness');
  assert.strictEqual(report.retiredQuestionBankStore.required, false);
  assert.strictEqual(report.retiredQuestionBankStore.configuredStoreId, 'retired-store');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('local storage readiness script checks passed');
