'use strict';

const assert = require('assert');
const { createMiniappCloudAccountRepository } = require('./miniappCloudAccountRepository');

const calls = [];
const query = async (text, values) => {
  calls.push([text, values]);
  if (text.includes('INSERT INTO business.miniapp_cloud_accounts')) {
    return { rows: [{ accountId: 'canonical-account-1', status: 'active', roles: ['super_admin'], profileType: null, profileId: null }] };
  }
  if (text.includes('ORDER BY a.created_at ASC,a.account_id ASC')) {
    return { rows: [{ accountId: 'account-pending', status: 'active', createdAt: new Date('2026-08-22T08:00:00.000Z') }] };
  }
  if (text.includes('WITH target AS')) {
    return { rows: [{ accountId: 'account-pending', status: 'active', roles: ['teacher'], profileType: 'teacher', profileId: 'teacher-1' }] };
  }
  if (text.includes('FROM business.miniapp_cloud_accounts')) {
    return { rows: [{ accountId: 'account-1', status: 'active', roles: ['super_admin'], profileType: null, profileId: null }] };
  }
  throw new Error('unexpected query');
};

(async () => {
  const repository = createMiniappCloudAccountRepository({ query, tenantId: 'default' });
  const created = await repository.resolveOrCreate({ accountId: 'canonical-account-1', phoneHmac: 'a'.repeat(64), bootstrapAdmin: true });
  assert.deepStrictEqual(created, { accountId: 'canonical-account-1', status: 'active', roles: ['super_admin'], profile: null });
  assert.deepStrictEqual(calls[0][1], ['canonical-account-1', 'a'.repeat(64), true]);
  const context = await repository.readContext({ accountId: 'account-1' });
  assert.deepStrictEqual(context, { accountId: 'account-1', status: 'active', roles: ['super_admin'], profile: null });
  assert.deepStrictEqual(await repository.listPending(), [{ accountId: 'account-pending', status: 'pending_authorization', createdAt: '2026-08-22T08:00:00.000Z' }]);
  const pendingQuery = calls.find(([text]) => text.includes('ORDER BY a.created_at ASC,a.account_id ASC'))?.[0] || '';
  assert.ok(pendingQuery.includes("a.status='active'"), 'pending accounts must be active account records without a role, not an unpersisted account status');
  assert.ok(pendingQuery.includes('NOT EXISTS'), 'pending accounts must have no active role grant');
  assert.deepStrictEqual(await repository.assignRole({ accountId: 'account-pending', role: 'teacher', profileId: 'teacher-1' }), { accountId: 'account-pending', status: 'active', roles: ['teacher'], profile: { type: 'teacher', id: 'teacher-1' } });
  const roleQuery = calls.find(([text]) => text.includes('WITH target AS'));
  assert.ok(roleQuery[0].includes('tenant_id=$4'), 'role binding must verify the selected profile inside the configured tenant');
  assert.deepStrictEqual(roleQuery[1], ['account-pending', 'teacher', 'teacher-1', 'default']);
  assert.throws(() => createMiniappCloudAccountRepository({ query }), error => error.code === 'CLOUD_MINIAPP_IDENTITY_INVALID');
  await assert.rejects(() => repository.assignRole({ accountId: 'account-pending', role: 'super_admin' }), error => error.code === 'CLOUD_MINIAPP_IDENTITY_INVALID');
  assert.ok(!calls.some(([text]) => /phone(?!_hmac)/iu.test(text)), 'repository must never select or log a raw phone column');
  console.log('miniapp cloud account repository checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
