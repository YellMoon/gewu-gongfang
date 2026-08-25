'use strict';

const assert = require('assert');
const { createMiniappRoleApplicationService } = require('./miniappRoleApplicationService');

const calls = [];
const applications = [];
const service = createMiniappRoleApplicationService({
  now: () => new Date('2026-08-26T08:00:00.000Z'),
  randomId: () => 'role_application_0001',
  cloudAccount: {
    context: async ({ token }) => token === 'visitor-ticket'
      ? { accountId: 'account-visitor', roles: [] }
      : token === 'super-admin-ticket'
      ? { accountId: 'account-super-admin', roles: ['super_admin'] }
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
        bindingHint: input.bindingHint,
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
      application.profileId = input.profileId;
      return application;
    },
  },
});

(async () => {
  const empty = await service.mine({ token: 'visitor-ticket' });
  assert.deepStrictEqual(empty, { state: 'not_submitted', application: null });

  const submitted = await service.submit({
    token: 'visitor-ticket',
    idempotencyKey: 'role-application-visitor-1',
    requestedIdentity: 'teacher',
    profileMode: 'existing',
    bindingHint: 'teacher profile 1',
  });
  assert.deepStrictEqual(submitted, {
    state: 'submitted',
    application: {
      applicationId: 'role_application_0001',
      requestedIdentity: 'teacher',
      profileMode: 'existing',
      bindingHint: 'teacher profile 1',
      status: 'submitted',
      submittedAt: '2026-08-26T08:00:00.000Z',
    },
  });
  assert.deepStrictEqual(calls.at(-1), ['submit', {
    accountId: 'account-visitor', applicationId: 'role_application_0001', idempotencyKey: 'role-application-visitor-1',
    requestedIdentity: 'teacher', profileMode: 'existing', bindingHint: 'teacher profile 1', submittedAt: '2026-08-26T08:00:00.000Z',
  }]);

  const newProfileApplication = await service.submit({
    token: 'visitor-ticket', idempotencyKey: 'role-application-new-teacher-1', requestedIdentity: 'teacher', profileMode: 'new', bindingHint: 'New teacher profile',
  });
  assert.strictEqual(newProfileApplication.application.profileMode, 'new');
  assert.strictEqual(calls.at(-1)[1].profileMode, 'new');

  await assert.rejects(
    () => service.submit({ token: 'visitor-ticket', idempotencyKey: 'role-application-family-1', requestedIdentity: 'family_member', profileMode: 'create', bindingHint: '' }),
    error => error.code === 'CLOUD_ROLE_APPLICATION_INVALID',
  );
  await assert.rejects(
    () => service.submit({ token: 'visitor-ticket', idempotencyKey: 'role-application-family-new-1', requestedIdentity: 'family_member', profileMode: 'new', bindingHint: 'family member' }),
    error => error.code === 'CLOUD_ROLE_APPLICATION_INVALID',
  );
  await assert.rejects(
    () => service.submit({ token: 'visitor-ticket', idempotencyKey: 'role-application-create-1', requestedIdentity: 'teacher', profileMode: 'create', bindingHint: '' }),
    error => error.code === 'CLOUD_ROLE_APPLICATION_INVALID',
  );
  await assert.rejects(
    () => service.submit({ token: 'teacher-ticket', idempotencyKey: 'role-application-formal-1', requestedIdentity: 'teacher', profileMode: 'existing', bindingHint: 'teacher-profile-1' }),
    error => error.code === 'CLOUD_ROLE_APPLICATION_ACCESS_DENIED',
  );
  const pending = await service.listSubmitted({ token: 'super-admin-ticket' });
  assert.strictEqual(pending.applications.length, 2);
  const reviewed = await service.review({
    token: 'super-admin-ticket', applicationId: 'role_application_0001', decision: 'approved', profileId: 'teacher-1',
  });
  assert.strictEqual(reviewed.state, 'approved');
  assert.deepStrictEqual(calls.at(-1), ['review', {
    applicationId: 'role_application_0001', decision: 'approved', profileId: 'teacher-1',
    reviewedAt: '2026-08-26T08:00:00.000Z', reviewerAccountId: 'account-super-admin',
  }]);
  await assert.rejects(
    () => service.review({ token: 'visitor-ticket', applicationId: 'role_application_0001', decision: 'rejected', profileId: null }),
    error => error.code === 'CLOUD_ROLE_APPLICATION_ACCESS_DENIED',
  );
  console.log('miniapp role application service checks passed');
})();
