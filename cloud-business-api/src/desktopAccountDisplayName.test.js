'use strict';
// UTF-8: display names come from the granted teacher profile, never an ID/phone.
const assert = require('node:assert/strict');
const { createDesktopAccountDisplayNameReader, desktopDisplayName } = require('./desktopAccountDisplayName');

(async () => {
  let rows = [{ name: '  测试教师  ' }];
  const calls = [];
  const read = createDesktopAccountDisplayNameReader({ tenantId: 'tenant-1', query: async (sql, values) => {
    calls.push({ sql, values }); return { rows };
  } });
  const account = { accountId: 'account-1', status: 'active', roles: ['teacher'], profile: { type: 'teacher', id: 'teacher-1' } };
  assert.equal(await read(account), '测试教师');
  assert.deepEqual(calls[0].values, ['account-1', 'tenant-1', 'teacher-1']);
  for (const pattern of [/g\.account_id=\$1/, /t\.tenant_id=\$2/, /t\.id=\$3/, /g\.status='active'/, /g\.role='teacher'/, /g\.profile_type='teacher'/, /NOT t\.legacy_deleted/]) assert.match(calls[0].sql, pattern);
  for (const invalid of [null, { ...account, status: 'disabled' }, { ...account, roles: ['student'] }, { ...account, profile: null }, { ...account, profile: { type: 'student', id: 'student-1' } }]) assert.equal(await read(invalid), null);
  assert.equal(calls.length, 1, 'ineligible contexts must not query names');
  rows = []; assert.equal(await read(account), null);
  rows = [{ name: 'wrong' }, { name: 'ambiguous' }]; assert.equal(await read(account), null);
  for (const name of ['', '   ', null, {}, 'a'.repeat(121), 'name\nrole', 'name\u202Erole']) assert.equal(desktopDisplayName(name), null);
  assert.equal(desktopDisplayName('林老师'), '林老师');
  console.log('desktop account display name checks passed');
})().catch(error => { console.error(error); process.exitCode=1; });
