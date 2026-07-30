'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'packaged-smoke-check.js'), 'utf8');

assert.match(
  source,
  /mkdtempSync\(/,
  'packaged smoke must create an isolated user-data directory',
);
assert.match(
  source,
  /--user-data-dir=/,
  'packaged smoke must pass the isolated user-data directory to Electron',
);
assert.match(
  source,
  /rmSync\([^)]*\{\s*recursive:\s*true,\s*force:\s*true/,
  'packaged smoke must remove only its own temporary user-data directory',
);
assert.match(
  source,
  /maxRetries:\s*[1-9]\d*/,
  'packaged smoke cleanup must retry while Electron releases temporary files',
);
assert.match(
  source,
  /await\s+waitForProcessExit\(/,
  'packaged smoke must wait for the Electron process to exit before deleting user data',
);
assert.match(
  source,
  /function verifyPackagedNativeAbi\(/,
  'packaged smoke must verify the embedded native database module with Electron before launch',
);
assert.match(
  source,
  /ELECTRON_RUN_AS_NODE/,
  'packaged smoke must use the Electron runtime for native ABI verification',
);
assert.match(
  source,
  /better-sqlite3/,
  'packaged smoke must verify the embedded better-sqlite3 module',
);
assert.match(
  source,
  /verifyPackagedNativeAbi\(\);/,
  'packaged smoke must run native ABI verification before the renderer smoke flow',
);

console.log('packaged smoke isolation checks passed');
