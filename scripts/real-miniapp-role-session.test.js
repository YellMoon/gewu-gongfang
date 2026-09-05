'use strict';

const assert = require('assert');
const {
  ROLE_KEYS,
  MARKER,
  expectedRole,
  markerFor,
  loadRoleSessions,
  writeRoleSessionResult,
} = require('./real-miniapp-role-session');

const marker = 'e2e-role-test-0123456789abcdef';
assert.deepStrictEqual(ROLE_KEYS, ['super_admin', 'visitor', 'teacher', 'student', 'family']);
assert.ok(MARKER.test(marker));
assert.strictEqual(markerFor(`e2e-account-teacher-${marker}`, 'teacher'), marker);
assert.throws(() => markerFor('teacher-account', 'teacher'), /IDENTITY_INVALID/);
assert.deepStrictEqual(expectedRole('family'), { roles: ['family_member'], profileType: 'student', relationship: 'guardian' });

const rows = {
  super_admin: { accountId: 'canonical-super-admin', status: 'active', roles: ['super_admin'], profileType: null, profileId: null, relationship: null, updatedAt: '2026-08-30T00:00:05.000Z' },
  visitor: { accountId: `e2e-account-visitor-${marker}`, status: 'active', roles: [], profileType: null, profileId: null, relationship: null, updatedAt: '2026-08-30T00:00:04.000Z' },
  teacher: { accountId: `e2e-account-teacher-${marker}`, status: 'active', roles: ['teacher'], profileType: 'teacher', profileId: 'teacher-1', relationship: null, updatedAt: '2026-08-30T00:00:03.000Z' },
  student: { accountId: `e2e-account-student-${marker}`, status: 'active', roles: ['student'], profileType: 'student', profileId: 'student-1', relationship: 'student', updatedAt: '2026-08-30T00:00:02.000Z' },
  family: { accountId: `e2e-account-family-${marker}`, status: 'active', roles: ['family_member'], profileType: 'student', profileId: 'student-1', relationship: 'guardian', updatedAt: '2026-08-30T00:00:01.000Z' },
};

(async () => {
  const receipt = await loadRoleSessions({
    query: async (sql, parameters) => {
      if (sql.includes("admin_grant.role='super_admin'")) return { rows: [rows.super_admin] };
      const [pattern] = parameters;
      return { rows: [rows[ROLE_KEYS.find(key => pattern.includes(`-${key}-`))]] };
    },
    ticketSecret: 'a'.repeat(24), now: new Date('2026-08-30T00:00:00.000Z'),
  });
  assert.strictEqual(receipt.marker, marker);
  for (const key of ROLE_KEYS) {
    assert.strictEqual(receipt.sessions[key].accountId, rows[key].accountId);
    assert.match(receipt.sessions[key].token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  }
  const adminPayload = JSON.parse(Buffer.from(receipt.sessions.super_admin.token.split('.')[0], 'base64url').toString('utf8'));
  assert.deepStrictEqual(adminPayload, {
    v: 1, kind: 'miniapp-cloud', accountId: rows.super_admin.accountId, expiresAt: Date.parse('2026-08-30T00:10:00.000Z'),
  });
  const secretToken = receipt.sessions.super_admin.token;
  let stdout = '';
  const writes = [];
  const outputDependencies = {
    writeFileSync: (...args) => writes.push(args),
    stdout: { write: value => { stdout += value; } },
  };
  assert.throws(
    () => writeRoleSessionResult(receipt, {}, outputDependencies),
    /REAL_MINIAPP_ROLE_SESSION_OUTPUT_REQUIRED/,
  );
  assert.strictEqual(stdout, '', 'missing output configuration must fail before writing any session material to stdout');
  assert.strictEqual(writes.length, 0);
  assert.throws(
    () => writeRoleSessionResult(receipt, {
      GEWU_REAL_MINIAPP_ROLE_SESSION_OUTPUT_PATH: 'sessions.json',
    }, outputDependencies),
    /REAL_MINIAPP_ROLE_SESSION_OUTPUT_INVALID/,
  );
  assert.strictEqual(stdout, '', 'invalid output configuration must not fall back to stdout');
  const safeOutputPath = '/tmp/gewu-real-miniapp-role-session-aaaaaaaaaaaaaaaaaaaaaaaa/sessions.json';
  writeRoleSessionResult(receipt, {
    GEWU_REAL_MINIAPP_ROLE_SESSION_OUTPUT_PATH: safeOutputPath,
  }, outputDependencies);
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0][0], safeOutputPath);
  assert.strictEqual(writes[0][2].mode, 0o600);
  assert.ok(writes[0][1].includes(secretToken), 'the private 0600 receipt must retain the issued session');
  assert.ok(!stdout.includes(secretToken), 'safe stdout must never contain a session token');
  assert.ok(!stdout.includes(rows.super_admin.accountId), 'safe stdout must never contain the canonical administrator account id');
  assert.deepStrictEqual(JSON.parse(stdout), {
    ok: true,
    marker,
    sessionKeys: ROLE_KEYS,
  });
  const olderMarker = 'e2e-role-test-fedcba9876543210';
  const fixtureRoleKeys = ROLE_KEYS.filter(key => key !== 'super_admin');
  const olderRows = Object.fromEntries(fixtureRoleKeys.map(key => [key, {
    ...rows[key],
    accountId: `e2e-account-${key}-${olderMarker}`,
    updatedAt: '2026-08-29T00:00:00.000Z',
  }]));
  const selected = await loadRoleSessions({
    query: async (_sql, [pattern]) => {
      if (_sql.includes("admin_grant.role='super_admin'")) return { rows: [rows.super_admin] };
      const key = fixtureRoleKeys.find(candidate => pattern.includes(`-${candidate}-`));
      return { rows: [olderRows[key], rows[key]] };
    },
    ticketSecret: 'a'.repeat(24), now: new Date('2026-08-30T00:00:00.000Z'),
  });
  assert.strictEqual(selected.marker, marker, 'the newest complete coherent fixture must be selected');
  await assert.rejects(
    () => loadRoleSessions({
      query: async sql => ({ rows: sql.includes("admin_grant.role='super_admin'") ? [] : [rows.visitor] }),
      ticketSecret: 'a'.repeat(24), now: new Date('2026-08-30T00:00:00.000Z'),
    }),
    /IDENTITY_INVALID/,
  );
  await assert.rejects(
    () => loadRoleSessions({ query: async () => ({ rows: [] }), ticketSecret: 'a'.repeat(24) }),
    /IDENTITY_INVALID/,
  );
  console.log('real miniapp role session checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
