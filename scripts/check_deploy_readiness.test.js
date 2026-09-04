const assert = require('assert');
const fs = require('fs');

const readiness = require('./check_deploy_readiness');

const scriptPath = 'scripts/check_deploy_readiness.js';

assert.ok(fs.existsSync(scriptPath), 'deploy readiness script should exist');

const source = fs.readFileSync(scriptPath, 'utf-8');

assert.strictEqual(
  source.includes("readText('src/services/oneClickSyncTransports.mjs')"),
  false,
  'deploy readiness must not require the retired one-click transport source'
);
assert.ok(
  source.includes("readText('src/services/authorityTransports.mjs')"),
  'deploy readiness must inspect the formal authority transport source'
);
assert.strictEqual(
  source.includes("readText('gateway/src/routes/cloudRelay.js')"),
  false,
  'deploy readiness must not inspect the retired gateway cloud-relay implementation'
);
assert.ok(
  source.includes("readText('gateway/src/app.js')"),
  'deploy readiness must inspect the formal gateway runtime boundary'
);
for (const marker of [
  "legacyAuthority: 'retired'",
  "'CLOUD_RELAY_RETIRED'",
  "'GATEWAY_AUTH_RETIRED'",
  "'GATEWAY_ADMIN_RETIRED'",
  "'GATEWAY_PERMISSIONS_RETIRED'",
]) {
  assert.ok(source.includes(marker), `deploy readiness must gate gateway retirement marker: ${marker}`);
}

for (const name of ['DEPLOY_HOST', 'DEPLOY_PASSWORD', 'DEPLOY_KEY_PATH', 'BACKEND_JWT_SECRET', 'WECHAT_APPID', 'WECHAT_APPSECRET']) {
  assert.ok(source.includes(name), `deploy readiness should check ${name}`);
}
assert.ok(
  source.includes('DEPLOY_PASSWORD or DEPLOY_KEY_PATH'),
  'deploy readiness should accept either password or SSH key authentication'
);

assert.ok(source.includes('miniapp/project.config.json'), 'deploy readiness should check miniapp project config');
assert.ok(source.includes('https://physicsedu.xyz/cloud-business'), 'deploy readiness should check the cloud business authority API');
assert.ok(source.includes('npm run miniapp:release-check'), 'deploy readiness should mention miniapp release check command');
assert.ok(source.includes("require('dotenv')"), 'deploy readiness should load environment files itself');
assert.ok(source.includes('.env.local'), 'deploy readiness should load the project .env.local file');
assert.strictEqual(source.includes('pages/desktop-online-registration/index'), false, 'desktop silent registration must not require a miniapp QR pairing page');

for (const key of [
  'cloudUnifiedDesktopRegistration',
  'desktopOfflineDraftConfirmation',
  'desktopIdentityGate',
]) {
  assert.ok(source.includes(key), `deploy readiness should expose identity evidence: ${key}`);
}

for (const name of [
  'checkIdentityArchitecture',
  'checkIdentitySourceSafety',
  'checkIdentityBuildSafety',
  'checkUnifiedDesktopRegistration',
  'checkDesktopReleaseBoundary',
]) {
  assert.strictEqual(typeof readiness[name], 'function', `deploy readiness should export ${name}`);
}

for (const marker of ['beginUnifiedOnlineRegistration', 'offlineLease', 'awaiting_confirmation', 'confirmAndSubmit']) {
  assert.ok(source.includes(marker), `deploy readiness must gate unified desktop marker: ${marker}`);
}
for (const marker of ['onClick={beginRegistration} block', 'returnToPasswordLogin', 'onClick={returnToPasswordLogin}']) {
  assert.ok(source.includes(marker), `deploy readiness must gate recoverable desktop login flow: ${marker}`);
}
assert.strictEqual(source.includes("router.post('/primary-host/bootstrap'"), false);

const architecture = readiness.checkIdentityArchitecture();
assert.deepStrictEqual(architecture.issues, [], `identity architecture evidence failed: ${architecture.issues.join(', ')}`);
const sourceSafety = readiness.checkIdentitySourceSafety();
assert.deepStrictEqual(sourceSafety.issues, [], `identity source safety failed: ${sourceSafety.issues.join(', ')}`);
const unifiedRegistration = readiness.checkUnifiedDesktopRegistration();
assert.deepStrictEqual(
  unifiedRegistration.issues,
  [],
  `unified desktop registration evidence failed: ${unifiedRegistration.issues.join(', ')}`
);
const buildSafety = readiness.checkIdentityBuildSafety();
assert.deepStrictEqual(buildSafety.issues, [], `identity build safety failed: ${buildSafety.issues.join(', ')}`);
assert.strictEqual(buildSafety.scanned, true, 'fresh desktop build artifacts must be scanned');
const desktopRelease = readiness.checkDesktopReleaseBoundary();
assert.deepStrictEqual(desktopRelease.issues, [], `desktop release boundary failed: ${desktopRelease.issues.join(', ')}`);
assert.strictEqual(
  desktopRelease.miniappReleaseState,
  'development-testable',
  'the user-approved development build must be testable even though formal publication remains gated',
);
assert.strictEqual(desktopRelease.defaultDesktopFlavor, 'unified-desktop');

console.log('deploy readiness checks passed');
