'use strict';

const assert = require('assert');
const packageJson = require('./package.json');

assert.ok(!packageJson.scripts['dist:win:host'],
  'the unified desktop release must not expose a second primary-host build command');
assert.ok(!packageJson.scripts['publish:desktop-host-update'],
  'the unified desktop release must not expose a second primary-host update feed');
assert.match(
  packageJson.scripts['dist:win'],
  /node scripts[\\/]wait-for-renderer-build\.js/,
  'the sole desktop release command must wait for the full renderer build before packaging',
);

console.log('unified desktop builder checks passed');
