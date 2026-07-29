const assert = require('assert');
const fs = require('fs');
const path = require('path');

assert.strictEqual(
  fs.existsSync(path.join(__dirname, 'desktopSessionRelayClient.mjs')),
  false,
  'the retired desktop-session relay client must remain deleted',
);
console.log('desktop session relay client retirement verified');
