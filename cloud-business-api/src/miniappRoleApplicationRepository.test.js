'use strict';

const assert = require('assert');
const { createMiniappRoleApplicationRepository } = require('./miniappRoleApplicationRepository');

const calls = [];
const repository = createMiniappRoleApplicationRepository({
  tenantId: 'default',
  query: async (sql, values) => {
    calls.push([sql, values]);
    return { rows: [{
      applicationId: 'role_application_0001', requestedIdentity: 'teacher', profileMode: 'new',
      bindingHint: 'name:teacher;phone:13900139000', profileName: 'teacher', profilePhone: '13900139000',
      status: 'submitted', submittedAt: new Date('2026-09-01T08:00:00.000Z'),
      ...(sql.includes('review_cloud') ? { reviewedAt: null, reviewedByAccountId: null, profileId: null } : {}),
    }] };
  },
});

(async () => {
  const latest = await repository.readLatest({ accountId: 'account-visitor' });
  assert.strictEqual(latest.profileName, 'teacher');
  assert.ok(calls[0][0].includes('business.vnext_read_latest_cloud_role_application_v3'));

  await repository.submit({
    accountId: 'account-visitor', applicationId: 'role_application_0001', idempotencyKey: 'role-new-teacher-1',
    requestedIdentity: 'teacher', profileMode: 'new', profileName: 'teacher', profilePhone: '13900139000',
    profilePhoneHmac: 'a'.repeat(64), requestedProfileId: 'teacher_profile_0001', submittedAt: '2026-09-01T08:00:00.000Z',
  });
  assert.ok(calls[1][0].includes('business.vnext_submit_cloud_role_application_v3'));
  assert.deepStrictEqual(calls[1][1], [
    'default', 'account-visitor', 'role_application_0001', 'role-new-teacher-1', 'teacher', 'new',
    'teacher', '13900139000', 'a'.repeat(64), 'teacher_profile_0001', '2026-09-01T08:00:00.000Z',
  ]);

  await repository.listSubmitted();
  assert.ok(calls[2][0].includes('business.vnext_list_submitted_cloud_role_applications_v3'));
  await repository.review({
    applicationId: 'role_application_0001', decision: 'approved', profileId: null,
    reviewedAt: '2026-09-01T08:05:00.000Z', reviewerAccountId: 'account-super-admin',
  });
  assert.ok(calls[3][0].includes('business.vnext_review_cloud_role_application_v4'));
  assert.deepStrictEqual(calls[3][1], ['default', 'account-super-admin', 'role_application_0001', 'approved', null, '2026-09-01T08:05:00.000Z']);

  const conflictingRepository = createMiniappRoleApplicationRepository({
    tenantId: 'default',
    query: async () => { throw Object.assign(new Error('VNEXT_ROLE_APPLICATION_PROFILE_PHONE_CONFLICT'), { code: 'P0001' }); },
  });
  await assert.rejects(
    () => conflictingRepository.review({ applicationId: 'role_application_0001', decision: 'approved', profileId: null, reviewedAt: '2026-09-01T08:05:00.000Z', reviewerAccountId: 'account-super-admin' }),
    error => error.code === 'CLOUD_ROLE_APPLICATION_PROFILE_PHONE_CONFLICT',
  );
  console.log('miniapp role application repository checks passed');
})();
