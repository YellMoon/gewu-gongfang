'use strict';

const assert = require('assert');
const { ROLE_KEYS, MARKER, expectedRole, markerFor, loadRoleSessions } = require('./real-miniapp-role-session');

const marker = 'e2e-role-test-0123456789abcdef';
assert.deepStrictEqual(ROLE_KEYS, ['visitor', 'teacher', 'student', 'family']);
assert.ok(MARKER.test(marker));
assert.strictEqual(markerFor(`e2e-account-teacher-${marker}`, 'teacher'), marker);
assert.throws(() => markerFor('teacher-account', 'teacher'), /IDENTITY_INVALID/);
assert.deepStrictEqual(expectedRole('family'), { roles: ['student'], profileType: 'student', relationship: 'guardian' });

const rows = {
  visitor: { accountId: `e2e-account-visitor-${marker}`, status: 'active', roles: [], profileType: null, profileId: null, relationship: null },
  teacher: { accountId: `e2e-account-teacher-${marker}`, status: 'active', roles: ['teacher'], profileType: 'teacher', profileId: 'teacher-1', relationship: null },
  student: { accountId: `e2e-account-student-${marker}`, status: 'active', roles: ['student'], profileType: 'student', profileId: 'student-1', relationship: 'student' },
  family: { accountId: `e2e-account-family-${marker}`, status: 'active', roles: ['student'], profileType: 'student', profileId: 'student-1', relationship: 'guardian' },
};

(async () => {
  const receipt = await loadRoleSessions({
    query: async (_sql, [pattern]) => ({ rows: [rows[ROLE_KEYS.find(key => pattern.includes(`-${key}-`))]] }),
    ticketSecret: 'a'.repeat(24), now: new Date('2026-08-30T00:00:00.000Z'),
  });
  assert.strictEqual(receipt.marker, marker);
  for (const key of ROLE_KEYS) {
    assert.strictEqual(receipt.sessions[key].accountId, rows[key].accountId);
    assert.match(receipt.sessions[key].token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  }
  await assert.rejects(
    () => loadRoleSessions({ query: async () => ({ rows: [] }), ticketSecret: 'a'.repeat(24) }),
    /IDENTITY_INVALID/,
  );
  console.log('real miniapp role session checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
