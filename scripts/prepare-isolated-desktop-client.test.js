const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('scripts/prepare-isolated-desktop-client.js', 'utf8');
assert.ok(source.includes('managedCloudBaseUrl'),
  'the disposable ordinary-desktop profile must support an isolated identity-cloud endpoint');
assert.ok(source.includes('process.argv[4]'),
  'the isolated identity-cloud endpoint must be supplied explicitly by the E2E runner');
assert.ok(source.includes('process.argv[5]'),
  'the isolated E2E runner must be able to provide a unique ordinary-desktop device id');
assert.ok(source.includes('TEST_DEVICE_ID_REQUIRED'),
  'the isolated profile helper must reject a non-disposable device id');

console.log('isolated desktop client profile checks passed');
