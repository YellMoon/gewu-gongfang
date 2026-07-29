const assert = require('assert');
const fs = require('fs');
const path = require('path');

const retired = path.join(__dirname, 'oneClickSyncTransports.mjs');
assert.strictEqual(fs.existsSync(retired), false, 'legacy /api/sync transport must not be restored');

console.log('legacy desktop transport retirement checks passed');
