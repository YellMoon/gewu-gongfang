'use strict';

const assert = require('node:assert/strict');
const { createDesktopAccountProfileService, createDesktopAccountProfileReader } = require('./desktopAccountProfileService');

(async () => {
  const calls = [];
  const context = { authorityId: 'authority-1', accountId: 'canonical-1', roles: ['super_admin', 'teacher'], activeRole: 'teacher', teacherId: 'phone-merged-teacher' };
  let rejected = false;
  let teacher = { name: ' 测试教师 ', phone: '13800138000', subject: '数学', wechat: 'openid-must-not-be-shown' };
  const read = createDesktopAccountProfileService({
    sessionContext: async input => { calls.push(['session', input]); if (rejected) throw Object.assign(new Error('expired'), { code: 'CLOUD_ONLINE_IDENTITY_REJECTED' }); return context; },
    readAccountName: async input => { calls.push(['account', input]); return 'teacher.login'; },
    readTeacher: async input => { calls.push(['teacher', input]); return teacher; },
  });
  const expected = { accountName: 'teacher.login', name: '测试教师', phone: '13800138000', subject: '数学', wechat: null, activeRole: 'teacher', eligibleRoles: ['super_admin', 'teacher'] };
  assert.deepEqual(await read.read({ sessionToken: 'current.token' }), expected);
  assert.deepEqual(calls, [['session', { sessionToken: 'current.token' }], ['account', { authorityId: 'authority-1', accountId: 'canonical-1' }], ['teacher', { teacherId: 'phone-merged-teacher' }]]);
  await assert.rejects(read.read({ sessionToken: 'current.token', accountId: 'other' }), { code: 'DESKTOP_IDENTITY_INPUT_FORBIDDEN' });
  assert.equal(calls.length, 3, 'identity selection is rejected before authentication or reading');
  rejected = true;
  await assert.rejects(read.read({ sessionToken: 'expired.token' }), { code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
  assert.equal(calls.length, 4, 'rejected sessions must not read any profile metadata');
  rejected = false;
  teacher = { name: 'name\nrole', phone: '', subject: null };
  assert.deepEqual(await read.read({ sessionToken: 'current.token' }), { ...expected, name: null, phone: null, subject: null });
  context.roles = ['super_admin']; context.activeRole = 'super_admin'; context.teacherId = null;
  const admin = await read.read({ sessionToken: 'current.token' });
  assert.deepEqual(admin, { ...expected, name: null, phone: null, subject: null, activeRole: 'super_admin', eligibleRoles: ['super_admin'] });
  assert.equal(calls.filter(call => call[0] === 'teacher').length, 2);

  const sqlCalls = [];
  let contactRows = [{ phoneHmac: 'a'.repeat(64) }];
  let credentialRows = [{ loginName: 'teacher.login' }];
  const reader = createDesktopAccountProfileReader({ tenantId: 'tenant-1',
    canonicalQuery: async (sql, values) => { sqlCalls.push(['canonical', sql, values]); return { rows: contactRows }; },
    identityQuery: async (sql, values) => { sqlCalls.push(['identity', sql, values]); return { rows: credentialRows }; },
    businessQuery: async (sql, values) => { sqlCalls.push(['business', sql, values]); return { rows: [{ name: '教师', phone: '13800138000', subject: '物理' }] }; },
  });
  assert.equal(await reader.readAccountName({ authorityId: 'authority-1', accountId: 'canonical-1' }), 'teacher.login');
  assert.deepEqual(sqlCalls[0][2], ['authority-1', 'canonical-1']);
  for (const pattern of [/v\.authority_id=\$1/, /v\.account_id=\$2/, /v\.verification_state='verified'/, /v\.verified_at IS NOT NULL/, /v\.revoked_at IS NULL/, /a\.status='active'/]) assert.match(sqlCalls[0][1], pattern);
  assert.match(sqlCalls[1][1], /SELECT login_name AS "loginName" FROM vnext_control_plane\.vnext_read_desktop_password_by_phone_hash\(\$1\)/);
  assert.match(sqlCalls[1][1], /authority_id=\$2 AND account_id=\$3/);
  assert.doesNotMatch(sqlCalls[1][1], /password_hash|password_salt|SELECT \*/i, 'never fetch password material for presentation');
  assert.deepEqual(sqlCalls[1][2], ['a'.repeat(64), 'authority-1', 'canonical-1']);
  assert.deepEqual(await reader.readTeacher({ teacherId: 'phone-merged-teacher' }), { name: '教师', phone: '13800138000', subject: '物理' });
  assert.deepEqual(sqlCalls[2][2], ['tenant-1', 'phone-merged-teacher']);
  assert.match(sqlCalls[2][1], /tenant_id=\$1 AND id=\$2 AND NOT legacy_deleted/);
  credentialRows = []; assert.equal(await reader.readAccountName({ authorityId: 'authority-1', accountId: 'canonical-1' }), null);
  contactRows = []; assert.equal(await reader.readAccountName({ authorityId: 'authority-1', accountId: 'canonical-1' }), null);
  contactRows = [{ phoneHmac: 'a'.repeat(64) }, { phoneHmac: 'b'.repeat(64) }];
  await assert.rejects(reader.readAccountName({ authorityId: 'authority-1', accountId: 'canonical-1' }), { code: 'DESKTOP_PROFILE_SOURCE_INVALID' });
  console.log('desktop account profile service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
