'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = require(path.join(root, 'package.json'));

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

console.log('unified desktop package boundary checks passed');
