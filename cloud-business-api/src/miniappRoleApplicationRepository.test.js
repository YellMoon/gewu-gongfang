'use strict';

const assert = require('assert');
const { createMiniappRoleApplicationRepository } = require('./miniappRoleApplicationRepository');

const calls = [];
const repository = createMiniappRoleApplicationRepository({
  tenantId: 'default',
  query: async (sql, values) => {
    calls.push([sql, values]);
    return { rows: [{
      applicationId: 'role_application_0001', requestedIdentity: 'teacher', profileMode: 'existing', bindingHint: 'teacher profile 1',
      status: 'submitted', submittedAt: new Date('2026-08-26T08:00:00.000Z'),
    }] };
  },
});

(async () => {
  const latest = await repository.readLatest({ accountId: 'account-visitor' });
  assert.deepStrictEqual(latest, {
    applicationId: 'role_application_0001', requestedIdentity: 'teacher', profileMode: 'existing', bindingHint: 'teacher profile 1',
    status: 'submitted', submittedAt: '2026-08-26T08:00:00.000Z',
  });
  assert.ok(calls[0][0].includes('business.vnext_read_latest_cloud_role_application_v2'));
  assert.deepStrictEqual(calls[0][1], ['default', 'account-visitor']);

  const submitted = await repository.submit({
    accountId: 'account-visitor', applicationId: 'role_application_0001', idempotencyKey: 'role-application-visitor-1',
    requestedIdentity: 'teacher', profileMode: 'existing', bindingHint: 'teacher profile 1', submittedAt: '2026-08-26T08:00:00.000Z',
  });
  assert.deepStrictEqual(submitted, latest);
  assert.ok(calls[1][0].includes('business.vnext_submit_cloud_role_application_v2'));
  assert.deepStrictEqual(calls[1][1], [
    'default', 'account-visitor', 'role_application_0001', 'role-application-visitor-1', 'teacher', 'existing', 'teacher profile 1', '2026-08-26T08:00:00.000Z',
  ]);
  const pending = await repository.listSubmitted();
  assert.strictEqual(pending.length, 1);
  assert.ok(calls[2][0].includes('business.vnext_list_submitted_cloud_role_applications_v2'));
  assert.deepStrictEqual(calls[2][1], ['default']);
  const reviewed = await repository.review({
    applicationId: 'role_application_0001', decision: 'approved', profileId: 'teacher-1',
    reviewedAt: '2026-08-26T08:00:00.000Z', reviewerAccountId: 'account-super-admin',
  });
  assert.strictEqual(reviewed.status, 'submitted');
  assert.ok(calls[3][0].includes('business.vnext_review_cloud_role_application_v2'));
  assert.deepStrictEqual(calls[3][1], ['default', 'account-super-admin', 'role_application_0001', 'approved', 'teacher-1', '2026-08-26T08:00:00.000Z']);
  console.log('miniapp role application repository checks passed');
})();
