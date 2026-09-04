'use strict';

const assert = require('assert');
const { createMiniappCloudAccountRepository } = require('./miniappCloudAccountRepository');
const { createMiniappCloudAccountService } = require('./miniappCloudAccountService');

const familyRow = {
  accountId: 'family-account-1', status: 'active', roles: ['family_member'],
  profileType: 'student', profileId: 'student-1', studentRelationship: 'guardian',
};

(async () => {
  const repository = createMiniappCloudAccountRepository({
    tenantId: 'default',
    query: async () => ({ rows: [familyRow] }),
  });
  assert.deepStrictEqual(await repository.readContext({ accountId: 'family-account-1' }), {
    accountId: 'family-account-1', status: 'active', roles: ['family_member'],
    profile: { type: 'student', id: 'student-1', relationship: 'guardian' },
  });

  const service = createMiniappCloudAccountService({
    now: () => new Date('2026-09-01T00:00:00.000Z'),
    bootstrapAdminAccountId: 'fixed-admin',
    canonicalWechatIdentity: { resolveOrBind: async () => ({ authorityId: 'authority-1', accountId: 'family-account-1', phoneHmac: 'a'.repeat(64), provisioned: true, bound: true }) },
    accountRepository: {
      resolveOrCreate: async () => ({ accountId: 'family-account-1', status: 'active', roles: ['family_member'], profile: { type: 'student', id: 'student-1', relationship: 'guardian' } }),
      readContext: async () => ({ accountId: 'family-account-1', status: 'active', roles: ['family_member'], profile: { type: 'student', id: 'student-1', relationship: 'guardian' } }),
    },
    ticketSecret: 'family-member-test-secret-123456789',
  });
  const login = await service.login({ loginCode: 'login-code', phoneCode: 'phone-code' });
  assert.deepStrictEqual(login.identity.roles, ['family_member']);
  assert.deepStrictEqual(login.identity.profile, { type: 'student', id: 'student-1', relationship: 'guardian' });
  assert.deepStrictEqual((await service.context({ token: login.token })).roles, ['family_member']);

  console.log('cloud family-member canonical role checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
