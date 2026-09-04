'use strict';

const assert = require('assert');
const { createMiniappRoleApplicationService } = require('./miniappRoleApplicationService');

const calls = [];
const applications = [];
let applicationSequence = 0;
let profileSequence = 0;
const service = createMiniappRoleApplicationService({
  now: () => new Date('2026-09-01T08:00:00.000Z'),
  randomId: prefix => prefix === 'role_application'
    ? `${prefix}_${String(++applicationSequence).padStart(4, '0')}`
    : `${prefix}_${String(++profileSequence).padStart(4, '0')}`,
  phoneHash: phone => phone === '13800138000' ? 'a'.repeat(64) : phone === '13900139000' ? 'b'.repeat(64) : 'c'.repeat(64),
  cloudAccount: {
    context: async ({ token }) => token === 'visitor-ticket'
      ? { accountId: 'account-visitor', roles: [] }
      : { accountId: 'account-teacher', roles: ['teacher'] },
  },
  repository: {
    readLatest: async input => {
      calls.push(['readLatest', input]);
      return applications.at(-1) || null;
    },
    submit: async input => {
      calls.push(['submit', input]);
      const application = {
        applicationId: input.applicationId,
        requestedIdentity: input.requestedIdentity,
        profileMode: input.profileMode,
        profileName: input.profileName,
        profilePhone: input.profilePhone,
        bindingHint: `name:${input.profileName};phone:${input.profilePhone}`,
        status: 'submitted',
        submittedAt: input.submittedAt,
      };
      applications.push(application);
      return application;
    },
    listSubmitted: async () => applications.filter(application => application.status === 'submitted'),
    review: async input => {
      calls.push(['review', input]);
      const application = applications.find(item => item.applicationId === input.applicationId);
      application.status = input.decision;
      application.reviewedAt = input.reviewedAt;
      application.reviewedByAccountId = input.reviewerAccountId;
      application.profileId = input.profileId || (application.profileMode === 'new' ? 'teacher_profile_0001' : null);
      return application;
    },
  },
});

(async () => {
  assert.deepStrictEqual(await service.mine({ token: 'visitor-ticket' }), { state: 'not_submitted', application: null });

  const existing = await service.submit({
    token: 'visitor-ticket', idempotencyKey: 'role-existing-1', requestedIdentity: 'student', profileMode: 'existing',
    profileName: '\u5f20\u4e09', profilePhone: '138 0013-8000',
  });
  assert.strictEqual(existing.state, 'submitted');
  assert.deepStrictEqual(calls.at(-1), ['submit', {
    accountId: 'account-visitor', applicationId: 'role_application_0001', idempotencyKey: 'role-existing-1',
    requestedIdentity: 'student', profileMode: 'existing', profileName: '\u5f20\u4e09', profilePhone: '13800138000',
    profilePhoneHmac: 'a'.repeat(64), requestedProfileId: null, submittedAt: '2026-09-01T08:00:00.000Z',
  }]);

  const created = await service.submit({
    token: 'visitor-ticket', idempotencyKey: 'role-new-teacher-1', requestedIdentity: 'teacher', profileMode: 'new',
    profileName: '\u738b\u8001\u5e08', profilePhone: '13900139000',
  });
  assert.strictEqual(created.application.profileMode, 'new');
  assert.deepStrictEqual(calls.at(-1)[1], {
    accountId: 'account-visitor', applicationId: 'role_application_0002', idempotencyKey: 'role-new-teacher-1',
    requestedIdentity: 'teacher', profileMode: 'new', profileName: '\u738b\u8001\u5e08', profilePhone: '13900139000',
    profilePhoneHmac: 'b'.repeat(64), requestedProfileId: 'teacher_profile_0001', submittedAt: '2026-09-01T08:00:00.000Z',
  });

  await assert.rejects(
    () => service.submit({ token: 'visitor-ticket', idempotencyKey: 'family-new', requestedIdentity: 'family_member', profileMode: 'new', profileName: 'parent', profilePhone: '13800138000' }),
    error => error.code === 'CLOUD_ROLE_APPLICATION_INVALID',
  );
  await assert.rejects(
    () => service.submit({ token: 'visitor-ticket', idempotencyKey: 'phone-invalid', requestedIdentity: 'student', profileMode: 'new', profileName: 'student', profilePhone: '12345' }),
    error => error.code === 'CLOUD_ROLE_APPLICATION_INVALID',
  );
  await assert.rejects(
    () => service.submit({ token: 'teacher-ticket', idempotencyKey: 'formal', requestedIdentity: 'teacher', profileMode: 'existing', profileName: 'teacher', profilePhone: '13800138000' }),
    error => error.code === 'CLOUD_ROLE_APPLICATION_ACCESS_DENIED',
  );

  const pending = await service.listSubmittedForDesktop({ actor: { accountId: 'account-super-admin', roles: ['super_admin'] } });
  assert.strictEqual(pending.applications.length, 2);
  await assert.rejects(
    () => service.listSubmittedForDesktop({ actor: { accountId: 'account-teacher', roles: ['teacher'] } }),
    error => error.code === 'CLOUD_ROLE_APPLICATION_ACCESS_DENIED',
  );

  await service.reviewForDesktop({
    actor: { accountId: 'account-super-admin', roles: ['super_admin'] },
    applicationId: existing.application.applicationId, decision: 'approved', profileId: 'student-1',
  });
  assert.deepStrictEqual(calls.at(-1), ['review', {
    applicationId: 'role_application_0001', decision: 'approved', profileId: 'student-1',
    reviewedAt: '2026-09-01T08:00:00.000Z', reviewerAccountId: 'account-super-admin',
  }]);

  const newReviewed = await service.reviewForDesktop({
    actor: { accountId: 'account-super-admin', roles: ['super_admin'] },
    applicationId: created.application.applicationId, decision: 'approved', profileId: null,
  });
  assert.strictEqual(newReviewed.state, 'approved');
  assert.strictEqual(newReviewed.application.applicationId, 'role_application_0002', 'new-profile review must update the new application, not the earlier existing-profile request');
  assert.strictEqual(newReviewed.application.profileId, 'teacher_profile_0001');
  assert.strictEqual(calls.at(-1)[1].profileId, null, 'new-profile approval must delegate profile creation to the cloud transaction');
  await assert.rejects(
    () => service.reviewForDesktop({ actor: { accountId: 'account-super-admin', roles: ['super_admin'] }, applicationId: 'x', decision: 'approved' }),
    error => error.code === 'CLOUD_ROLE_APPLICATION_INVALID',
  );
  assert.ok(!Object.hasOwn(service, 'listSubmitted') && !Object.hasOwn(service, 'review'));
  console.log('miniapp role application service checks passed');
})();
