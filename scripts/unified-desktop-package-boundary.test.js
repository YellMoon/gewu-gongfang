'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = require(path.join(root, 'package.json'));
const packageFiles = packageJson.build?.files || [];

assert.strictEqual(packageJson.desktopBuildFlavor, 'unified-desktop');
assert.doesNotMatch(packageJson.scripts?.['test:desktop-build-flavor'] || '', /realTwoDesktopE2e/,
  'the unified desktop release gate must not require the retired primary-host acceptance matrix');
assert.doesNotMatch(packageJson.scripts?.['test:authority-architecture'] || '', /primaryHost|realTwoDesktopE2e|authorityRoleMatrixE2e/,
  'the default authority suite must validate cloud authority rather than retired primary-host workflows');
assert.ok(!fs.existsSync(path.join(root, 'electron-builder.host.config.cjs')),
  'a unified desktop release must not retain a second host-only installer configuration');
const electronSource = fs.readFileSync(path.join(root, 'public', 'electron.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'public', 'preload.js'), 'utf8');
assert.doesNotMatch(electronSource, /ipcMain\.handle\('primary-host:/);
assert.doesNotMatch(preloadSource, /primaryHostRuntime/);
assert.doesNotMatch(electronSource, /ipcMain\.handle\('runtime-config:set'/);
assert.doesNotMatch(electronSource, /ipcMain\.handle\('dialog:select-folder'/);
assert.doesNotMatch(preloadSource, /'runtime-config:set'/);
assert.doesNotMatch(preloadSource, /'dialog:select-folder'/);
assert.ok(!packageFiles.includes('src/services/authorityWebSocketTransport.mjs'),
  'the desktop package must not ship the retired authority WebSocket transport');
assert.ok(!packageFiles.includes('src/services/authorityTransports.mjs'),
  'the desktop package must not ship the retired LAN or durable-relay authority selector');
for (const excluded of [
  '!backend/**/*.test.js',
  '!backend/data{,/**/*}',
  '!backend/src/routes/authorityProtocol.js',
  '!backend/src/routes/miniappAuthorityApplications.js',
  '!backend/src/routes/miniappAuthorityProjection.js',
  '!backend/src/services/authorityCloudRuntime.js',
  '!backend/src/websocket/authorityRelayRouter.js',
  '!backend/src/websocket/authoritySocketServer.js',
  '!backend/src/websocket/client.js',
  '!backend/src/websocket/cloudRelayServer.js',
  '!backend/src/websocket/hostTaskWakeup.js',
  '!backend/src/routes/cloudRelay.js',
  '!backend/src/routes/miniappApplications.js',
  '!backend/src/services/cloudRelay*.js',
  '!backend/src/services/primaryHost*.js',
  '!backend/src/services/hostRecoveryFactorService.js',
  '!backend/src/services/relayAssertionService.js',
  '!backend/src/services/miniappApplication*.js',
  '!backend/src/services/miniappProvisioningReconciler.js',
  '!backend/src/services/identityProvisioningService.js',
  '!backend/src/services/questionPreviewIndex.js',
  '!backend/src/services/legacyArchitectureGate.js',
  '!shared/cloudRelayLogic.js',
  '!shared/primaryHostSigningKey.js',
]) {
  assert.ok(packageFiles.includes(excluded), `desktop build.files must fail closed with ${excluded}`);
}

console.log('unified desktop package boundary checks passed');
