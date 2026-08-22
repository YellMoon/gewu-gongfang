'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = require(path.join(root, 'package.json'));

assert.strictEqual(packageJson.desktopBuildFlavor, 'unified-desktop');
assert.ok(!fs.existsSync(path.join(root, 'electron-builder.host.config.cjs')),
  'a unified desktop release must not retain a second host-only installer configuration');

console.log('unified desktop package boundary checks passed');
