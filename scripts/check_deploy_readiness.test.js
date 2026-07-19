const assert = require('assert');
const fs = require('fs');

const readiness = require('./check_deploy_readiness');

const scriptPath = 'scripts/check_deploy_readiness.js';

assert.ok(fs.existsSync(scriptPath), 'deploy readiness script should exist');

const source = fs.readFileSync(scriptPath, 'utf-8');

for (const name of ['DEPLOY_HOST', 'DEPLOY_PASSWORD', 'DEPLOY_KEY_PATH', 'BACKEND_JWT_SECRET', 'WECHAT_APPID', 'WECHAT_APPSECRET']) {
  assert.ok(source.includes(name), `deploy readiness should check ${name}`);
}
assert.ok(
  source.includes('DEPLOY_PASSWORD or DEPLOY_KEY_PATH'),
  'deploy readiness should accept either password or SSH key authentication'
);

assert.ok(source.includes('miniapp/project.config.json'), 'deploy readiness should check miniapp project config');
assert.ok(source.includes('https://physicsedu.xyz/scheduling'), 'deploy readiness should check production miniapp API');
assert.ok(source.includes('npm run miniapp:release-check'), 'deploy readiness should mention miniapp release check command');
assert.ok(source.includes("require('dotenv')"), 'deploy readiness should load environment files itself');
assert.ok(source.includes('.env.local'), 'deploy readiness should load the project .env.local file');

for (const key of [
  'backendDesktopIdentityV2',
  'gatewayDesktopPairingV1Tombstone',
  'userRoleGrantMigration',
  'primaryHostGeneration',
  'miniappDesktopAuthorization',
  'desktopIdentityGate',
  'identityDeviceCenter',
]) {
  assert.ok(source.includes(key), `deploy readiness should expose identity evidence: ${key}`);
}

for (const name of [
  'checkIdentityArchitecture',
  'checkIdentitySourceSafety',
  'checkIdentityBuildSafety',
  'checkPrimaryHostRecoveryDelivery',
  'checkDesktopPasswordReset',
]) {
  assert.strictEqual(typeof readiness[name], 'function', `deploy readiness should export ${name}`);
}

for (const marker of [
  'host_recovery_deliveries',
  'primaryHostRecoveryDeliveryProtocol',
  'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_REQUIRED',
  'revealRecoveryPackage',
  'acknowledgeRecoveryPackage',
  'RECOVERY_DELIVERY_STORE_VERSION',
]) {
  assert.ok(source.includes(marker), `deploy readiness must gate recovery delivery marker: ${marker}`);
}
assert.strictEqual(source.includes("setRecoveryPackage(result.recoveryPackage)"), false);

const architecture = readiness.checkIdentityArchitecture();
assert.deepStrictEqual(architecture.issues, [], `identity architecture evidence failed: ${architecture.issues.join(', ')}`);
const sourceSafety = readiness.checkIdentitySourceSafety();
assert.deepStrictEqual(sourceSafety.issues, [], `identity source safety failed: ${sourceSafety.issues.join(', ')}`);
const recoveryDelivery = readiness.checkPrimaryHostRecoveryDelivery();
assert.deepStrictEqual(
  recoveryDelivery.issues,
  [],
  `primary-host recovery delivery evidence failed: ${recoveryDelivery.issues.join(', ')}`
);
const passwordReset = readiness.checkDesktopPasswordReset();
assert.deepStrictEqual(
  passwordReset.issues,
  [],
  `desktop password reset evidence failed: ${passwordReset.issues.join(', ')}`
);
const buildSafety = readiness.checkIdentityBuildSafety();
assert.deepStrictEqual(buildSafety.issues, [], `identity build safety failed: ${buildSafety.issues.join(', ')}`);
assert.strictEqual(buildSafety.scanned, true, 'fresh desktop build artifacts must be scanned');

console.log('deploy readiness checks passed');
