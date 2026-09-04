'use strict';

const assert = require('assert');
const { createMiniappCloudAccountRepository } = require('./miniappCloudAccountRepository');

const calls = [];
const query = async (text, values) => {
  calls.push([text, values]);
  if (text.includes('INSERT INTO business.miniapp_cloud_accounts')) {
    return { rows: [{ accountId: 'canonical-account-1', status: 'active', roles: ['super_admin'], profileType: null, profileId: null }] };
  }
  if (text.includes('SELECT account_id AS "accountId",phone_hmac AS "phoneHmac"')) {
    return { rows: [{ accountId: 'account-1', phoneHmac: 'b'.repeat(64) }] };
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
  const phoneContext = await repository.readContextByPhoneHmac({ phoneHmac: 'b'.repeat(64) });
  assert.deepStrictEqual(phoneContext, { accountId: 'account-1', status: 'active', roles: ['super_admin'], profile: null });
  assert.ok(calls.some(([text, values]) => text.includes('WHERE a.phone_hmac=$1') && values[0] === 'b'.repeat(64)));
  const binding = await repository.readVerifiedPhoneBinding({ accountId: 'account-1' });
  assert.deepStrictEqual(binding, { accountId: 'account-1', phoneHmac: 'b'.repeat(64) });
  assert.ok(calls.some(([text, values]) => text.includes("status='active'") && text.includes('phone_hmac') && values[0] === 'account-1'));
  assert.ok(calls.filter(([text]) => text.includes('array_agg')).every(([text]) => text.includes('student_relationship') && text.includes('"studentRelationship"')));
  assert.strictEqual(typeof repository.listPending, 'undefined', 'a visitor is not a pending-account queue entry');
  assert.strictEqual(typeof repository.assignRole, 'undefined', 'direct miniapp role grants must not exist');
  assert.throws(() => createMiniappCloudAccountRepository({ query }), error => error.code === 'CLOUD_MINIAPP_IDENTITY_INVALID');
  assert.ok(!calls.some(([text]) => /\bphone\b/iu.test(text)), 'repository must never select or log a raw phone column');
  console.log('miniapp cloud account repository checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
