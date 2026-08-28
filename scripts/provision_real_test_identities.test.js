'use strict';

const assert = require('assert');
const { MARKER, roleSpecs, hmacPhone } = require('./provision_real_test_identities');

const marker = 'e2e-role-test-0123456789abcdef';
assert.ok(MARKER.test(marker));
assert.ok(!MARKER.test('teacher-test'));
const specs = roleSpecs(marker);
assert.deepStrictEqual(specs.map(spec => spec.key), ['visitor', 'teacher', 'student', 'family']);
assert.deepStrictEqual(specs.map(spec => spec.role), [null, 'teacher', 'student', 'student']);
assert.strictEqual(specs[2].profileId, specs[3].profileId, 'student and family must target the same student profile');
assert.strictEqual(specs[2].relationship, 'student');
assert.strictEqual(specs[3].relationship, 'guardian');
const first = hmacPhone('a'.repeat(24), marker, 'teacher');
assert.match(first, /^[0-9a-f]{64}$/);
assert.strictEqual(first, hmacPhone('a'.repeat(24), marker, 'teacher'));
assert.notStrictEqual(first, hmacPhone('a'.repeat(24), marker, 'student'));
console.log('real test identity provisioning checks passed');
