'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createMiniappCloudAccountService } = require('./miniappCloudAccountService');
const secret = 'canonical-fence-test-secret-long-enough';
const initial = { authorityId: 'authority', accountId: 'account', authorityUpdatedAt: '2026-10-07T00:00:00.000001Z', authVersion: '9007199254740993', accessVersion: '1', revocationVersion: '1' };
let fence = { ...initial }; let unavailable = false; let businessReads = 0;
const identity = { accountId: 'account', status: 'active', roles: [], profile: null };
const service = createMiniappCloudAccountService({
  now: () => new Date('2026-10-07T01:00:00Z'), bootstrapAdminAccountId: 'admin', ticketSecret: secret,
  canonicalWechatIdentity: { resolveOrBind: async () => ({ authorityId: 'authority', accountId: 'account', phoneHmac: 'a'.repeat(64), provisioned: false, bound: false }) },
  accountRepository: {
    readCanonicalFence: async () => { if (unavailable) throw new Error('database unavailable'); return fence; },
    resolveOrCreate: async () => identity,
    readContext: async () => { businessReads++; return identity; },
  },
});
const rejected = { code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' };
(async () => {
  const login = await service.login({ loginCode: 'login', phoneCode: 'phone' });
  assert.equal(JSON.parse(Buffer.from(login.token.split('.')[0], 'base64url')).v, 2, 'new tickets must bind the canonical fence');
  assert.deepEqual((await service.context({ token: login.token })).roles, []);
  identity.roles = ['teacher']; identity.profile = { type: 'teacher', id: 'teacher' };
  assert.deepEqual((await service.context({ token: login.token })).roles, ['teacher'], 'approval remains visible to the same fenced ticket');
  for (const key of ['authVersion', 'accessVersion', 'revocationVersion', 'authorityUpdatedAt']) {
    fence = { ...initial, [key]: key === 'authorityUpdatedAt' ? '2026-10-07T00:00:00.000002Z' : String(BigInt(initial[key]) + 1n) };
    const reads = businessReads;
    await assert.rejects(() => service.context({ token: login.token }), rejected);
    assert.equal(businessReads, reads, 'stale tickets must be rejected before business reads');
  }
  fence = null;
  await assert.rejects(() => service.context({ token: login.token }), rejected);
  fence = initial; unavailable = true;
  await assert.rejects(() => service.context({ token: login.token }), rejected);
  await assert.rejects(() => service.login({ loginCode: 'login', phoneCode: 'phone' }), rejected);
  unavailable = false;
  const legacy = Buffer.from(JSON.stringify({ v: 1, kind: 'miniapp-cloud', accountId: 'account', expiresAt: Date.parse('2026-10-07T01:30:00Z') })).toString('base64url');
  const token = `${legacy}.${crypto.createHmac('sha256', secret).update(legacy).digest('base64url')}`;
  await assert.rejects(() => service.context({ token }), rejected);
  console.log('miniapp canonical fence: v2, bigint precision, fresh grants, old fence and v1 rejection passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
