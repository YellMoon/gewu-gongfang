const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const absent = relativePath => assert.ok(
  !fs.existsSync(path.join(root, relativePath)),
  `${relativePath} must not remain after the desktop identity architecture cutover`
);

const packageJson = read('package.json');
assert.ok(!packageJson.includes('singleUserPairingEnvelope'), 'desktop packages must not ship the retired pairing envelope');
assert.ok(!packageJson.includes('singleUserDesktopIdentityService'), 'test commands must not execute retired identity services');
assert.ok(!packageJson.includes('singleUserPairingClient'), 'test commands must not execute retired pairing clients');

[
  'backend/src/services/desktopSessionService.js',
  'backend/src/schema.sql',
  'scripts/audit-runtime-evidence.js',
  'scripts/check_deploy_readiness.js',
  'public/primaryHostRuntimeManager.js',
  'src/services/desktopIdentityClient.mjs',
  'src/pages/IdentityDeviceCenter.tsx',
  'public/electron.js',
  'scripts/real-two-desktop-e2e.js',
  'src/custom.d.ts',
].forEach(relativePath => {
  const source = read(relativePath);
  assert.ok(!/single[_-]?user|singleUser/i.test(source), `${relativePath} must use only the managed identity architecture`);
});
assert.ok(!read('backend/src/schema.sql').includes('desktop_single_user_pairing_'),
  'new databases must not create retired pairing tables');

for (const relativePath of [
  'backend/src/routes/cloudRelay.js',
  'gateway/src/routes/cloudRelay.js',
]) {
  const source = read(relativePath);
  assert.ok(!source.includes('createDesktopSessionRelayService'), `${relativePath} must not retain the retired session relay implementation`);
  assert.ok(!source.includes("router.post('/desktop-session"), `${relativePath} must not retain an executable desktop-session route`);
  assert.ok(!source.includes("router.post('/desktop-sync"), `${relativePath} must not retain an executable raw desktop-sync route`);
}

[
  'backend/src/services/singleUserDesktopIdentityService.js',
  'backend/src/services/singleUserDesktopIdentityService.test.js',
  'backend/src/services/singleUserPairingEnvelope.js',
  'public/singleUserPairingEnvelope.js',
  'public/singleUserPairingEnvelope.test.js',
  'src/services/singleUserPairingClient.mjs',
  'src/services/singleUserPairingClient.test.js',
  'scripts/inspect-single-user-pairing-state.js',
  'scripts/live-cloud-pairing-route-smoke.js',
  'scripts/single-user-pairing-runtime-smoke.js',
  'backend/src/services/desktopSessionRelayService.js',
  'src/services/desktopSessionRelayClient.mjs',
].forEach(absent);

console.log('desktop architecture cutover checks passed');
