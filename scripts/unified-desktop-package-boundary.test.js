'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = require(path.join(root, 'package.json'));

assert.strictEqual(packageJson.desktopBuildFlavor, 'unified-desktop');
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
