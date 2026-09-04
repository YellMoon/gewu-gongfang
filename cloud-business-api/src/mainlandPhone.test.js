'use strict';

const assert = require('assert');
const { normalizeMainlandPhone } = require('./mainlandPhone');

assert.strictEqual(normalizeMainlandPhone('13700000000'), '13700000000');
assert.strictEqual(normalizeMainlandPhone('+86 137-0000-0000'), '13700000000');
assert.strictEqual(normalizeMainlandPhone('86 (137) 0000 0000'), '13700000000');
assert.strictEqual(normalizeMainlandPhone('\t137 0000 0000\n'), '13700000000');

for (const value of [
  '12700000000',
  '+86 127-0000-0000',
  '861370000000',
  '+1 3700000000',
  '137abc00000000',
  '13700000000 ext 1',
  '',
  null,
  13700000000,
]) {
  assert.strictEqual(normalizeMainlandPhone(value), null, `must reject non-mainland phone: ${String(value)}`);
}

console.log('mainland phone normalization checks passed');
