'use strict';

const assert = require('assert');
const {
  canonicalSourceValue,
  canonicalSourceRow,
  hashCanonicalRecord,
} = require('./canonicalTypes');

assert.deepStrictEqual(canonicalSourceValue(null), { type: 'null' });
assert.deepStrictEqual(canonicalSourceValue(9007199254740993n), { type: 'integer64', value: '9007199254740993' });
assert.deepStrictEqual(canonicalSourceValue(12.5), { type: 'real', value: '12.5' });
assert.deepStrictEqual(canonicalSourceValue(-0), { type: 'real', value: '-0' });
assert.deepStrictEqual(canonicalSourceValue('00123'), { type: 'text', value: '00123' });
assert.deepStrictEqual(canonicalSourceValue(Buffer.from([0, 1, 2])), {
  type: 'blob', bytes: 3,
  sha256: 'ae4b3280e56e2faf83f414a6e3dabe9d5fbe18976544c05fed121accb85b53fc',
});
assert.deepStrictEqual(canonicalSourceValue(true), { type: 'boolean', value: true });
assert.throws(
  () => canonicalSourceValue(Number.NaN),
  error => error && error.code === 'MIGRATION_CANONICAL_REAL_INVALID',
);

const row = canonicalSourceRow({ z: 2n, a: 'value', n: null }, ['a', 'n', 'z']);
assert.deepStrictEqual(Object.keys(row), ['a', 'n', 'z']);
assert.deepStrictEqual(row.z, { type: 'integer64', value: '2' });
assert.match(hashCanonicalRecord(row), /^[a-f0-9]{64}$/);
assert.strictEqual(hashCanonicalRecord(row), hashCanonicalRecord({ z: row.z, n: row.n, a: row.a }));

console.log('vNext canonical source type checks passed');
