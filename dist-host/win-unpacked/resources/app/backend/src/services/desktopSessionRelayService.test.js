'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

assert.strictEqual(
  fs.existsSync(path.join(__dirname, 'desktopSessionRelayService.js')),
  false,
  'the retired desktop-session relay service must remain deleted',
);
console.log('desktop session relay retirement verified');
