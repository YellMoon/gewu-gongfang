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
};

const service = createMiniappCloudAccountService({
  now: () => now,
  bootstrapAdminAccountId: 'canonical-admin',
  canonicalWechatIdentity: {
    async resolveOrBind({ loginCode, phoneCode }) {
      assert.ok(['admin-login', 'new-login', 'guardian-login', 'known-login'].includes(loginCode));
      if (loginCode === 'known-login') return { authorityId: 'authority-1', accountId: 'canonical-admin', phoneHmac: 'a'.repeat(64), provisioned: false, bound: false };
      assert.ok(['admin-proof', 'new-proof', 'guardian-proof'].includes(phoneCode));
      return { authorityId: 'authority-1', accountId: phoneCode === 'admin-proof' ? 'canonical-admin' : phoneCode === 'guardian-proof' ? 'canonical-guardian' : 'canonical-new', phoneHmac: phoneCode === 'admin-proof' ? 'a'.repeat(64) : phoneCode === 'guardian-proof' ? 'c'.repeat(64) : 'b'.repeat(64), provisioned: true, bound: true };
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
  const directWechat = await service.login({ loginCode: 'known-login', phoneCode: null });
  assert.strictEqual(directWechat.identity.accountId, admin.identity.accountId);

  const ordinary = await service.login({ loginCode: 'new-login', phoneCode: 'new-proof' });
  assert.equal(ordinary.identity.status, 'visitor');
  assert.deepStrictEqual(ordinary.identity.roles, []);

  const context = await service.context({ token: admin.token });
  assert.equal(context.accountId, admin.identity.accountId);
  assert.deepStrictEqual(context.roles, ['super_admin']);

  assert.strictEqual(typeof service.pendingAccounts, 'undefined', 'visitor applications must replace a generic pending-account queue');
  assert.strictEqual(typeof service.assignRole, 'undefined', 'a miniapp session must never directly grant a role');

  await assert.rejects(() => service.context({ token: 'legacy.jwt.token' }), error => error.code === 'CLOUD_MINIAPP_IDENTITY_REJECTED');
  await assert.rejects(() => service.login({ loginCode: 'new-login', phoneCode: null }), error => error.code === 'CLOUD_MINIAPP_IDENTITY_REJECTED');
  await assert.rejects(() => service.login({ loginCode: 'new-login', phoneCode: 'invalid-proof' }), error => error.code === 'CLOUD_MINIAPP_IDENTITY_REJECTED');

  console.log('miniapp cloud account service checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
