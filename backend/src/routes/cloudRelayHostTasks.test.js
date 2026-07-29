'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'cloudRelayHost.js'), 'utf8');
assert.strictEqual(source.includes('desktop-session-challenge-start'), false);
assert.strictEqual(source.includes('desktop-session-challenge-exchange'), false);
assert.strictEqual(source.includes("task.task_type === 'desktop-sync'"), false);
console.log('legacy cloud relay host task handlers retired');
