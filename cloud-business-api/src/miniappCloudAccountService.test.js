'use strict';

const assert = require('assert');
const { createMiniappCloudAccountService } = require('./miniappCloudAccountService');

const now = new Date('2026-08-22T08:00:00.000Z');
const records = new Map();
const repository = {
  async resolveOrCreate({ phoneHmac, bootstrapAdmin }) {
    let account = records.get(phoneHmac);
    if (!account) {
      account = { accountId: `miniapp-${phoneHmac}`, status: 'active', roles: bootstrapAdmin ? ['super_admin'] : [] };
      records.set(phoneHmac, account);
    }
    return { ...account, roles: account.roles.slice() };
  },
  async readContext({ accountId }) {
    for (const account of records.values()) {
      if (account.accountId === accountId) return { ...account, roles: account.roles.slice() };
    }
    return null;
  },
};

const service = createMiniappCloudAccountService({
  now: () => now,
  phoneVerifier: async code => ({ 'admin-proof': 'verified-admin', 'new-proof': 'verified-new' })[code] || null,
  phoneHmac: phone => ({ 'verified-admin': 'a'.repeat(64), 'verified-new': 'b'.repeat(64) })[phone] || null,
  bootstrapAdminPhoneHmac: 'a'.repeat(64),
  accountRepository: repository,
  ticketSecret: 'miniapp-cloud-ticket-secret-at-least-32',
});

(async () => {
  const admin = await service.login({ phoneCode: 'admin-proof' });
  assert.equal(admin.identity.status, 'active');
  assert.deepStrictEqual(admin.identity.roles, ['super_admin']);
  assert.match(admin.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);

  const ordinary = await service.login({ phoneCode: 'new-proof' });
  assert.equal(ordinary.identity.status, 'pending_authorization');
  assert.deepStrictEqual(ordinary.identity.roles, []);

  const context = await service.context({ token: admin.token });
  assert.equal(context.accountId, admin.identity.accountId);
  assert.deepStrictEqual(context.roles, ['super_admin']);

  await assert.rejects(() => service.context({ token: 'legacy.jwt.token' }), error => error.code === 'CLOUD_MINIAPP_IDENTITY_REJECTED');
  await assert.rejects(() => service.login({ phoneCode: 'invalid-proof' }), error => error.code === 'CLOUD_MINIAPP_IDENTITY_REJECTED');

  console.log('miniapp cloud account service checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
