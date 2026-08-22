'use strict';

const assert = require('assert');
const { createMiniappCloudAccountService } = require('./miniappCloudAccountService');

const now = new Date('2026-08-22T08:00:00.000Z');
const records = new Map();
const repository = {
  async resolveOrCreate({ accountId, phoneHmac, bootstrapAdmin }) {
    let account = records.get(accountId);
    if (!account) {
      account = { accountId, status: 'active', roles: bootstrapAdmin ? ['super_admin'] : [], profile: null };
      records.set(accountId, account);
    }
    return { ...account, roles: account.roles.slice(), profile: account.profile };
  },
  async readContext({ accountId }) {
    for (const account of records.values()) {
      if (account.accountId === accountId) return { ...account, roles: account.roles.slice(), profile: account.profile };
    }
    return null;
  },
  async listPending() {
    return [...records.values()]
      .filter(account => account.roles.length === 0)
      .map(account => ({ accountId: account.accountId, status: 'pending_authorization', createdAt: '2026-08-22T08:00:00.000Z' }));
  },
  async assignRole({ accountId, role, profileId }) {
    for (const account of records.values()) {
      if (account.accountId !== accountId || (account.roles.length > 0 && !account.roles.includes(role))) continue;
      account.roles = [role];
      account.profile = role === 'teacher' || role === 'student' ? { type: role, id: profileId } : null;
      return { ...account, roles: account.roles.slice(), profile: account.profile };
    }
    return null;
  },
};

const service = createMiniappCloudAccountService({
  now: () => now,
  bootstrapAdminAccountId: 'canonical-admin',
  canonicalWechatIdentity: {
    async resolveOrBind({ loginCode, phoneCode }) {
      assert.ok(['admin-login', 'new-login'].includes(loginCode));
      assert.ok(['admin-proof', 'new-proof'].includes(phoneCode));
      return { authorityId: 'authority-1', accountId: phoneCode === 'admin-proof' ? 'canonical-admin' : 'canonical-new', phoneHmac: phoneCode === 'admin-proof' ? 'a'.repeat(64) : 'b'.repeat(64), provisioned: true, bound: true };
    },
  },
  accountRepository: repository,
  ticketSecret: 'miniapp-cloud-ticket-secret-at-least-32',
});

(async () => {
  const admin = await service.login({ loginCode: 'admin-login', phoneCode: 'admin-proof' });
  assert.equal(admin.identity.status, 'active');
  assert.deepStrictEqual(admin.identity.roles, ['super_admin']);
  assert.match(admin.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);

  const ordinary = await service.login({ loginCode: 'new-login', phoneCode: 'new-proof' });
  assert.equal(ordinary.identity.status, 'pending_authorization');
  assert.deepStrictEqual(ordinary.identity.roles, []);

  const context = await service.context({ token: admin.token });
  assert.equal(context.accountId, admin.identity.accountId);
  assert.deepStrictEqual(context.roles, ['super_admin']);

  assert.strictEqual(typeof service.pendingAccounts, 'function', 'the bootstrap super administrator must have a service boundary for pending cloud accounts');
  assert.strictEqual(typeof service.assignRole, 'function', 'the bootstrap super administrator must have a service boundary for authorizing a pending cloud account');
  assert.deepStrictEqual(
    await service.pendingAccounts({ token: admin.token }),
    [{ accountId: ordinary.identity.accountId, status: 'pending_authorization', createdAt: '2026-08-22T08:00:00.000Z' }],
    'the bootstrap super administrator can see pending accounts without their phone number',
  );
  await assert.rejects(() => service.pendingAccounts({ token: ordinary.token }), error => error.code === 'CLOUD_MINIAPP_IDENTITY_REJECTED');
  assert.deepStrictEqual(
    await service.assignRole({ token: admin.token, accountId: ordinary.identity.accountId, role: 'teacher', profileId: 'teacher-1' }),
    { accountId: ordinary.identity.accountId, status: 'active', roles: ['teacher'], profile: { type: 'teacher', id: 'teacher-1' } },
    'the bootstrap super administrator must bind an ordinary role to one migrated business profile',
  );
  assert.deepStrictEqual(await service.pendingAccounts({ token: admin.token }), []);
  await assert.rejects(() => service.assignRole({ token: admin.token, accountId: ordinary.identity.accountId, role: 'super_admin', profileId: 'admin-1' }), error => error.code === 'CLOUD_MINIAPP_IDENTITY_REJECTED');

  await assert.rejects(() => service.context({ token: 'legacy.jwt.token' }), error => error.code === 'CLOUD_MINIAPP_IDENTITY_REJECTED');
  await assert.rejects(() => service.login({ loginCode: 'new-login', phoneCode: null }), error => error.code === 'CLOUD_MINIAPP_IDENTITY_REJECTED');
  await assert.rejects(() => service.login({ loginCode: 'new-login', phoneCode: 'invalid-proof' }), error => error.code === 'CLOUD_MINIAPP_IDENTITY_REJECTED');

  console.log('miniapp cloud account service checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
