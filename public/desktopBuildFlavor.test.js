'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  UNIFIED_DESKTOP_FLAVOR,
  resolveDesktopBuildFlavor,
  updateFeedForFlavor,
} = require('./desktopBuildFlavor');

const root = path.resolve(__dirname, '..');
const packageJson = require('../package.json');

assert.strictEqual(resolveDesktopBuildFlavor({ isPackaged: true, metadata: {} }), UNIFIED_DESKTOP_FLAVOR);
assert.strictEqual(resolveDesktopBuildFlavor({
  isPackaged: true,
  metadata: { desktopBuildFlavor: 'primary-host' },
  env: { GEWU_DESKTOP_BUILD_FLAVOR: 'desktop-client' },
}), UNIFIED_DESKTOP_FLAVOR, 'a unified desktop must ignore legacy role flavours');
assert.strictEqual(updateFeedForFlavor(UNIFIED_DESKTOP_FLAVOR), 'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/');
assert.strictEqual(packageJson.desktopBuildFlavor, UNIFIED_DESKTOP_FLAVOR);
assert.ok(!packageJson.scripts['dist:win:host']);
assert.ok(!packageJson.scripts['package:host-runtime-contract']);
assert.ok(!packageJson.scripts['publish:desktop-host-update']);
assert.ok(!fs.existsSync(path.join(root, 'electron-builder.host.config.cjs')),
  'a unified desktop release must not retain a second host-only installer configuration');
for (const hostOnlyFile of [
  'public/primaryHostCredentialStore.js',
  'public/primaryHostOperationValidation.js',
  'public/primaryHostRuntimeManager.js',
]) {
  assert.ok(!packageJson.build.files.includes(hostOnlyFile), `the unified package must exclude ${hostOnlyFile}`);
}

console.log('unified desktop build flavor checks passed');
