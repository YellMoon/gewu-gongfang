'use strict';

const assert = require('assert');
const { normalizeManualPhone, validateManualPhone } = require('./manualPhone');

assert.strictEqual(normalizeManualPhone(' 138 0013 8000 '), '13800138000');
assert.strictEqual(normalizeManualPhone('+86 138-0013-8000'), '13800138000');
assert.strictEqual(validateManualPhone('13800138000'), '');
assert.notStrictEqual(validateManualPhone('12800138000'), '');

console.log('miniapp manual phone utility checks passed');
