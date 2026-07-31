'use strict';

const assert = require('assert');
const fs = require('fs');
const {
  DESKTOP_CLIENT_FLAVOR,
  PRIMARY_HOST_FLAVOR,
  resolveDesktopBuildFlavor,
  validateDesktopCapabilityManifest,
  updateFeedForFlavor,
} = require('./desktopBuildFlavor');

assert.strictEqual(resolveDesktopBuildFlavor({ isPackaged: true, metadata: {} }), DESKTOP_CLIENT_FLAVOR);
assert.strictEqual(resolveDesktopBuildFlavor({
  isPackaged: true,
  metadata: { desktopBuildFlavor: DESKTOP_CLIENT_FLAVOR },
  env: { GEWU_DESKTOP_BUILD_FLAVOR: PRIMARY_HOST_FLAVOR },
}), DESKTOP_CLIENT_FLAVOR, 'a packaged ordinary build must not be promoted by environment variables');
assert.strictEqual(resolveDesktopBuildFlavor({
  isPackaged: true,
  metadata: { desktopBuildFlavor: PRIMARY_HOST_FLAVOR },
}), PRIMARY_HOST_FLAVOR);
assert.strictEqual(resolveDesktopBuildFlavor({
  isPackaged: false,
  metadata: { desktopBuildFlavor: PRIMARY_HOST_FLAVOR },
  env: { GEWU_DESKTOP_BUILD_FLAVOR: DESKTOP_CLIENT_FLAVOR },
}), PRIMARY_HOST_FLAVOR, 'host package metadata must not be downgraded by inherited environment');
assert.throws(
  () => validateDesktopCapabilityManifest({
    metadata: { desktopBuildFlavor: PRIMARY_HOST_FLAVOR, desktopCapabilityManifest: { flavor: PRIMARY_HOST_FLAVOR, revision: 1 } },
    runtimeFlavor: DESKTOP_CLIENT_FLAVOR,
  }),
  error => error && error.code === 'PRIMARY_HOST_CAPABILITY_MISMATCH'
);
assert.strictEqual(resolveDesktopBuildFlavor({
  isPackaged: false,
  metadata: { desktopBuildFlavor: DESKTOP_CLIENT_FLAVOR },
  env: { GEWU_DESKTOP_BUILD_FLAVOR: PRIMARY_HOST_FLAVOR },
}), PRIMARY_HOST_FLAVOR, 'development may explicitly exercise the host-only runtime');
assert.strictEqual(
  updateFeedForFlavor(DESKTOP_CLIENT_FLAVOR),
  'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/',
);
assert.strictEqual(
  updateFeedForFlavor(PRIMARY_HOST_FLAVOR),
  'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/host/',
);
assert.strictEqual(
  updateFeedForFlavor(PRIMARY_HOST_FLAVOR, { UPDATE_FEED_URL: 'https://updates.example/custom' }),
  'https://updates.example/custom/',
);

const packageJson = require('../package.json');
const hostBuild = require('../electron-builder.host.config.cjs');
const electronSource = fs.readFileSync('public/electron.js', 'utf8');
const preloadSource = fs.readFileSync('public/preload.js', 'utf8');
assert.strictEqual(packageJson.desktopBuildFlavor, DESKTOP_CLIENT_FLAVOR);
assert.strictEqual(
  packageJson.build.npmRebuild,
  false,
  'ordinary packaging must use the Electron ABI prepared by rebuild:electron instead of rebuilding it a second time',
);
assert.ok(
  packageJson.scripts['verify:packaged-electron-native-abi'],
  'a packaged Electron runtime ABI verifier must exist'
);
assert.ok(
  packageJson.scripts['dist:win'].includes('verify:packaged-electron-native-abi'),
  'ordinary Windows packaging must load native modules from the unpacked artifact before rebuilding them for Node'
);
assert.ok(
  packageJson.scripts['dist:win:host'].includes('verify:packaged-electron-native-abi'),
  'primary-host packaging must load native modules from the unpacked artifact before rebuilding them for Node'
);
assert.strictEqual(hostBuild.extraMetadata.desktopBuildFlavor, PRIMARY_HOST_FLAVOR);
assert.strictEqual(hostBuild.directories.output, 'dist-host');
assert.strictEqual(
  hostBuild.npmRebuild,
  false,
  'the host build must use the Electron ABI prepared by rebuild:electron instead of rebuilding it a second time',
);
assert.ok(hostBuild.publish.some(entry => entry.url.endsWith('/desktop/host/')));
assert.ok(electronSource.includes('if (PRIMARY_HOST_CAPABLE)'));
assert.ok(electronSource.includes("config.nodeRole !== 'desktop-client'"));
assert.ok(preloadSource.includes("if (desktopBuildFlavor === 'primary-host')"));
assert.ok(!preloadSource.includes('GEWU_ELECTRON_LOCAL_BRIDGE_SECRET'));
assert.ok(!preloadSource.includes('signPairingEnvelope'));
assert.ok(electronSource.includes("'x-gewu-electron-local-bridge': electronLocalBridgeSecret"));
assert.ok(packageJson.build.files.includes('public/desktopBuildFlavor.js'));
assert.ok(packageJson.build.files.includes('public/electronShellPolicy.js'),
  'both packaged flavors must include the production menu and updater error policy');
assert.ok(packageJson.build.files.includes('public/localSessionSigningSecret.js'),
  'both packaged flavors must include the local session-signing fallback');
assert.ok(packageJson.build.files.includes('public/windowsHostFirewall.js'),
  'the firewall planner must be packaged with both desktop flavors');
assert.ok(hostBuild.files.includes('public/windowsHostFirewallElevated.ps1'),
  'the primary-host installer must contain the elevated firewall helper');
assert.ok(electronSource.includes("require('./windowsHostFirewall')"));
assert.ok(electronSource.includes("ipcMain.handle('primary-host:firewall-status'"));
assert.ok(electronSource.includes("ipcMain.handle('primary-host:firewall-enable-lan'"));
assert.ok(electronSource.includes("ipcMain.handle('primary-host:worker-status'"));
assert.ok(preloadSource.includes("ipcRenderer.invoke('primary-host:firewall-status')"));
assert.ok(preloadSource.includes("ipcRenderer.invoke('primary-host:firewall-enable-lan')"));
assert.ok(preloadSource.includes("ipcRenderer.invoke('primary-host:worker-status')"));
assert.ok(packageJson.scripts['test:desktop-build-flavor'].includes('localSessionSigningSecret.test.js'),
  'the local session-signing fallback must run in the packaged desktop test suite');
assert.ok(packageJson.scripts['test:desktop-build-flavor'].includes('verify-packaged-electron-native-abi.test.js'),
  'the packaged ABI verifier contract must run in the desktop packaging test suite');
assert.strictEqual(
  packageJson.build.artifactName,
  'GewuGongfang-Desktop-${version}-${arch}.${ext}',
  'ordinary releases must have a stable flavor-specific installer name',
);
for (const hostOnlyFile of [
  'public/primaryHostCredentialStore.js',
  'public/primaryHostOperationValidation.js',
  'public/primaryHostRuntimeManager.js',
]) {
  assert.ok(!packageJson.build.files.includes(hostOnlyFile), `ordinary package must exclude ${hostOnlyFile}`);
  assert.ok(hostBuild.files.includes(hostOnlyFile), `host package must include ${hostOnlyFile}`);
}
assert.ok(packageJson.scripts['publish:desktop-host-update']);

console.log('desktop build flavor checks passed');
