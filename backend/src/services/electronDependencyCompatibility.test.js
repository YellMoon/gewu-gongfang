const assert = require('assert');
const path = require('path');

const backendPackage = require(path.join(__dirname, '..', '..', 'package.json'));

assert.strictEqual(
  backendPackage.dependencies['sanitize-html'],
  '2.17.4',
  'Electron 28 embeds Node 18, so sanitize-html must stay on the CommonJS-compatible 2.17.4 release',
);

console.log('electron backend dependency compatibility tests passed');
