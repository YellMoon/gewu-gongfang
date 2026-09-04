'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
assert.ok(!appSource.includes("app.use('/api/auth'"), 'the embedded cache runtime must not expose the retired handwritten-phone WeChat login');
assert.ok(!fs.existsSync(path.join(__dirname, 'routes', 'auth.js')), 'the retired embedded login router must be deleted, not left as dormant authority code');

console.log('embedded miniapp phone login retirement checks passed');
