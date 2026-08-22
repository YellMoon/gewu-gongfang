'use strict';

const assert = require('assert');
const { createMiniappCloudAccountRepository } = require('./miniappCloudAccountRepository');

const calls = [];
const query = async (text, values) => {
  calls.push([text, values]);
  if (text.includes('INSERT INTO business.miniapp_cloud_accounts')) {
    return { rows: [{ accountId: 'account-1', status: 'active', roles: ['super_admin'] }] };
  }
  if (text.includes('FROM business.miniapp_cloud_accounts')) {
    return { rows: [{ accountId: 'account-1', status: 'active', roles: ['super_admin'] }] };
  }
  throw new Error('unexpected query');
};

(async () => {
  const repository = createMiniappCloudAccountRepository({ query, randomId: () => 'account-1' });
  const created = await repository.resolveOrCreate({ phoneHmac: 'a'.repeat(64), bootstrapAdmin: true });
  assert.deepStrictEqual(created, { accountId: 'account-1', status: 'active', roles: ['super_admin'] });
  assert.deepStrictEqual(calls[0][1], ['account-1', 'a'.repeat(64), true]);
  const context = await repository.readContext({ accountId: 'account-1' });
  assert.deepStrictEqual(context, { accountId: 'account-1', status: 'active', roles: ['super_admin'] });
  assert.ok(!calls.some(([text]) => /phone(?!_hmac)/iu.test(text)), 'repository must never select or log a raw phone column');
  console.log('miniapp cloud account repository checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
