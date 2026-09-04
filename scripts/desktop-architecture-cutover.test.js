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
  'src/services/desktopIdentityClient.mjs',
  'src/pages/IdentityDeviceCenter.tsx',
  'public/electron.js',
  'src/custom.d.ts',
].forEach(relativePath => {
  const source = read(relativePath);
  assert.ok(!/single[_-]?user|singleUser/i.test(source), `${relativePath} must use only the managed identity architecture`);
});
assert.ok(!read('backend/src/schema.sql').includes('desktop_single_user_pairing_'),
  'new databases must not create retired pairing tables');

const backendCloudRelay = read('backend/src/routes/cloudRelay.js');
assert.ok(!backendCloudRelay.includes('createDesktopSessionRelayService'), 'backend cloud relay tombstones must not retain the retired session relay implementation');
assert.ok(!backendCloudRelay.includes("router.post('/desktop-session"), 'backend must not retain an executable desktop-session route');
assert.ok(!backendCloudRelay.includes("router.post('/desktop-sync"), 'backend must not retain an executable raw desktop-sync route');
absent('gateway/src/routes/cloudRelay.js');

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
  'scripts/deploy_ws_token_fix.py',
  'scripts/check_backend.py',
  'scripts/check_gw_status.py',
  'scripts/check_network.py',
  'scripts/check_processes.py',
  'scripts/check_server.py',
  'scripts/check_tokens.py',
  'scripts/deploy_server_fix.py',
  'scripts/deploy_ws_fix.py',
  'scripts/final_verify.py',
  'scripts/fix_backend_import.py',
  'backend/src/services/desktopSessionRelayService.js',
  'src/services/desktopSessionRelayClient.mjs',
  'src/services/websocketClient.mjs',
  'src/services/websocketClient.test.js',
  'scripts/packaged-host-identity-ui.test.js',
  'scripts/real-two-desktop-e2e.js',
  'public/desktopIdentityKind.js',
  'public/desktopCredentialStore.js',
  'public/primaryHostCredentialStore.js',
  'public/primaryHostOperationValidation.js',
  'public/primaryHostRuntimeManager.js',
  'public/primaryHostRuntimeStatus.js',
  'public/primaryHostRelaunchReadiness.js',
  'public/primaryHostLocalProjectionReader.js',
  'public/primaryHostLocalDraftExecutor.js',
  'public/primaryHostListenPolicy.js',
  'public/windowsHostFirewall.js',
  'src/services/authorityWebSocketTransport.mjs',
  'src/services/authorityWebSocketTransport.test.js',
  'src/services/authorityTransports.mjs',
  'src/services/authorityTransports.test.js',
  'backend/src/services/authorityCloudRuntime.js',
  'backend/src/services/authorityCloudRuntime.test.js',
  'backend/src/websocket/authorityRelayRouter.js',
  'backend/src/websocket/authoritySocketServer.js',
  'backend/src/websocket/authoritySocketServer.test.js',
  'backend/src/websocket/client.js',
  'backend/src/websocket/client.test.js',
  'backend/src/websocket/cloudRelayAuthorityServer.test.js',
  'backend/src/websocket/cloudRelayServer.js',
  'backend/src/websocket/hostTaskWakeup.js',
  'backend/src/websocket/hostTaskWakeup.test.js',
  'backend/src/websocket/websocketAuthorityOwnership.test.js',
  'backend/src/routes/authorityProtocol.js',
  'backend/src/routes/authorityProtocol.http.test.js',
  'backend/src/routes/miniappAuthorityApplications.js',
  'backend/src/routes/miniappAuthorityApplications.http.test.js',
  'backend/src/routes/miniappAuthorityProjection.js',
  'backend/src/routes/miniappAuthorityProjection.test.js',
].forEach(absent);

console.log('desktop architecture cutover checks passed');
