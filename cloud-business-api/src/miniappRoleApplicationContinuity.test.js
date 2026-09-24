'use strict';
const assert = require('node:assert/strict');
const { createMiniappCloudAccountService } = require('./miniappCloudAccountService');
const { createMiniappRoleApplicationService } = require('./miniappRoleApplicationService');
const { createCloudBusinessApp } = require('./app');

async function verifyApprovalContinuity() {
  for (const role of ['teacher', 'student', 'family_member']) {
    const identities = new Map();
    const applications = new Map();
    const reads = [], writes = [];
    let seq = 0;
    const cloud = createMiniappCloudAccountService({
      now: () => new Date('2026-09-24T01:00:00Z'),
      bootstrapAdminAccountId: 'admin', ticketSecret: 'test-only-approval-continuity-secret',
      canonicalWechatIdentity: { resolveOrBind: async ({ loginCode }) => ({ authorityId: 'authority', accountId: loginCode, phoneHmac: 'a'.repeat(64), provisioned: false, bound: true }) },
      accountRepository: {
        resolveOrCreate: async ({ accountId }) => {
          const context = { accountId, status: 'active', roles: [], profile: null };
          identities.set(accountId, context); return context;
        },
        readContext: async ({ accountId }) => identities.get(accountId),
      },
    });
    const service = createMiniappRoleApplicationService({
      now: () => new Date('2026-09-24T01:01:00Z'), randomId: prefix => `${prefix}-${++seq}`,
      phoneHash: () => 'a'.repeat(64), cloudAccount: cloud,
      repository: {
        readLatest: async ({ accountId }) => { reads.push(accountId); return applications.get(accountId) || null; },
        submit: async input => { writes.push(input); const row = { ...input, status: 'submitted' }; applications.set(input.accountId, row); return row; },
        listSubmitted: async () => [...applications.values()].filter(row => row.status === 'submitted'),
        review: async input => {
          const row = [...applications.values()].find(item => item.applicationId === input.applicationId);
          row.status = input.decision;
          if (row.status === 'approved') identities.set(row.accountId, {
            accountId: row.accountId, status: 'active', roles: [role],
            profile: { type: role === 'teacher' ? 'teacher' : 'student', id: 'test-profile',
              ...(role === 'teacher' ? {} : { relationship: role === 'student' ? 'student' : 'guardian' }) },
          });
          return row;
        },
      },
    });
    const owner = await cloud.login({ loginCode: 'applicant', phoneCode: 'test-phone-code' });
    const other = await cloud.login({ loginCode: 'other', phoneCode: 'test-phone-code' });
    const input = { token: owner.token, idempotencyKey: 'attempt-1', requestedIdentity: role,
      profileMode: 'existing', profileName: 'Test applicant', profilePhone: '13800000000' };
    assert.equal((await service.mine({ token: owner.token })).state, 'not_submitted');
    const submitted = await service.submit(input);
    assert.equal((await service.mine({ token: owner.token })).state, 'submitted');
    const actor = { accountId: 'admin', roles: ['super_admin'] };
    await service.reviewForDesktop({ actor, applicationId: submitted.application.applicationId, decision: 'approved', profileId: 'test-profile' });
    assert.deepEqual((await cloud.context({ token: owner.token })).roles, [role], 'the actual signed session observes fresh grants');
    const approved = await service.mine({ token: owner.token });
    assert.equal(approved.state, 'approved', `${role}: same signed session can read its approval`);
    assert.equal(approved.application.applicationId, submitted.application.applicationId);
    assert.equal(reads.at(-1), 'applicant', 'account comes only from verified session');
    assert.equal((await service.mine({ token: other.token })).application, null, 'another account cannot see the applicant');
    const app = createCloudBusinessApp({ query: async () => ({ rows: [] }), miniappRoleApplications: service });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}/api/miniapp/role-applications`;
      const result = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${owner.token}` } });
      assert.equal(result.status, 200, 'HTTP read must not turn approval into identity rejection');
      assert.equal((await result.json()).state, 'approved');
      const replay = await fetch(base, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json', 'x-idempotency-key': 'formal-retry' },
        body: JSON.stringify({ requestedIdentity: role, profileMode: 'existing', profileName: 'Test applicant', profilePhone: '13800000000' }) });
      assert.equal(replay.status, 403, 'HTTP submission remains forbidden after approval');
    } finally { await new Promise(resolve => server.close(resolve)); }
    await assert.rejects(() => service.submit({ ...input, idempotencyKey: 'attempt-2' }), { code: 'CLOUD_ROLE_APPLICATION_ACCESS_DENIED' });
    assert.equal(writes.length, 1, 'approval never enables another application write');
    identities.get('applicant').status = 'disabled';
    const readCount = reads.length;
    await assert.rejects(() => service.mine({ token: owner.token }), { code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
    await assert.rejects(() => service.mine({ token: 'invalid-token' }), { code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
    assert.equal(reads.length, readCount, 'disabled/invalid sessions never query application history');
  }
  console.log('role approval continuity: signed sessions, three roles, own history, disabled sessions and visitor-only writes passed');
}
module.exports = verifyApprovalContinuity;
if (require.main === module) verifyApprovalContinuity().catch(error => { console.error(error); process.exitCode = 1; });
