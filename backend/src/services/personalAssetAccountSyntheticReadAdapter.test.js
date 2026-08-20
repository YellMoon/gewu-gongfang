const assert = require('assert');
const Module = require('module');

const forbiddenModules = new Set([
  'better-sqlite3', 'pg', 'fs', 'node:fs', 'path', 'node:path', 'net', 'node:net',
  'http', 'node:http', 'https', 'node:https', 'child_process', 'node:child_process',
]);
const originalLoad = Module._load;
let adapterApi;
try {
  Module._load = function guardedLoad(request, parent, isMain) {
    if (forbiddenModules.has(request)) throw new Error(`forbidden adapter dependency: ${request}`);
    return originalLoad.call(this, request, parent, isMain);
  };
  adapterApi = require('./personalAssetAccountSyntheticReadAdapter');
} finally {
  Module._load = originalLoad;
}

const {
  createSyntheticPersonalAssetAccountFixture,
  createSyntheticPersonalAssetAccountListAdapter,
} = adapterApi;

const fictionalAccounts = [
  { account_id: 'synthetic-account-alpha', authority_id: 'synthetic-authority', owner_user_id: 'synthetic-owner-alpha', account_type: 'saving_card', provider: 'Fictional Provider', label: 'Synthetic Account', masked_identifier: 'MASK-ALPHA', balance: 0, currency: 'CNY', status: 'active', created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z' },
  { account_id: 'synthetic-account-alpha-earlier', authority_id: 'synthetic-authority', owner_user_id: 'synthetic-owner-alpha', account_type: 'custom', provider: null, label: 'Earlier Synthetic Account', masked_identifier: null, balance: 0, currency: 'CNY', status: 'active', created_at: '2026-08-19T00:00:00.000Z', updated_at: '2026-08-19T00:00:00.000Z' },
  { account_id: 'synthetic-account-alpha-z', authority_id: 'synthetic-authority', owner_user_id: 'synthetic-owner-alpha', account_type: 'custom', provider: null, label: 'Tied Synthetic Account', masked_identifier: null, balance: 0, currency: 'CNY', status: 'active', created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z' },
  { account_id: 'synthetic-account-beta', authority_id: 'synthetic-authority', owner_user_id: 'synthetic-owner-beta', account_type: 'wechat', provider: null, label: 'Synthetic Wallet', masked_identifier: null, balance: 0, currency: 'CNY', status: 'active', created_at: '2026-08-19T00:00:00.000Z', updated_at: '2026-08-19T00:00:00.000Z' },
  { account_id: 'synthetic-account-archived', authority_id: 'synthetic-authority', owner_user_id: 'synthetic-owner-alpha', account_type: 'custom', provider: null, label: 'Archived Synthetic Account', masked_identifier: null, balance: 0, currency: 'CNY', status: 'archived', created_at: '2026-08-18T00:00:00.000Z', updated_at: '2026-08-18T00:00:00.000Z' },
];

const fixture = createSyntheticPersonalAssetAccountFixture({ accounts: fictionalAccounts });
const adapter = createSyntheticPersonalAssetAccountListAdapter({ fixture });

const own = adapter.list({
  actor: { userId: 'synthetic-owner-alpha', roles: ['student'] },
  authorityId: 'synthetic-authority',
});
assert.deepStrictEqual(own.map(row => row.accountId), [
  'synthetic-account-alpha-earlier', 'synthetic-account-alpha', 'synthetic-account-alpha-z',
]);
assert.strictEqual(own[0].accountNumber, undefined);
assert.strictEqual(own[0].status, 'active');
assert.ok(Object.isFrozen(own));
assert.ok(Object.isFrozen(own[0]));

assert.deepStrictEqual(adapter.list({
  actor: { userId: 'synthetic-admin', roles: ['super_admin'] },
  authorityId: 'synthetic-authority',
  ownerUserId: 'synthetic-owner-beta',
}).map(row => row.accountId), ['synthetic-account-beta']);
assert.deepStrictEqual(adapter.list({
  actor: { id: 'synthetic-owner-alpha' }, authorityId: 'synthetic-authority',
}).map(row => row.accountId), [
  'synthetic-account-alpha-earlier', 'synthetic-account-alpha', 'synthetic-account-alpha-z',
]);
assert.deepStrictEqual(adapter.list({
  actor: { id: 'synthetic-admin', role: 'admin' },
  authorityId: 'synthetic-authority', ownerUserId: 'synthetic-owner-beta',
}).map(row => row.accountId), ['synthetic-account-beta']);
assert.throws(() => adapter.list({
  actor: { userId: 'synthetic-owner-alpha', roles: ['student'] },
  authorityId: 'synthetic-authority', ownerUserId: 'synthetic-owner-beta',
}), error => error.code === 'ASSET_ACCOUNT_FORBIDDEN');
assert.deepStrictEqual(adapter.list({
  actor: { userId: 'nobody' }, authorityId: 'synthetic-authority',
}), []);
assert.throws(() => adapter.list({ actor: {}, authorityId: 'synthetic-authority' }),
  error => error.code === 'ASSET_ACCOUNT_ACTOR_REQUIRED');
assert.throws(() => adapter.list(),
  error => error.code === 'ASSET_ACCOUNT_ACTOR_REQUIRED');
assert.throws(() => adapter.list({ actor: { userId: 'synthetic-owner-alpha' } }),
  error => error.code === 'ASSET_ACCOUNT_AUTHORITY_REQUIRED');

const fixtureSha256BeforeSourceMutation = adapter.inspect().fixtureSha256;
fictionalAccounts[0].label = 'mutated source label';
fictionalAccounts[0].status = 'archived';
fictionalAccounts[0].owner_user_id = 'mutated source owner';
assert.strictEqual(adapter.inspect().fixtureSha256, fixtureSha256BeforeSourceMutation);
assert.deepStrictEqual(adapter.list({
  actor: { userId: 'synthetic-owner-alpha' }, authorityId: 'synthetic-authority',
}).map(row => row.label), [
  'Earlier Synthetic Account', 'Synthetic Account', 'Tied Synthetic Account',
]);

assert.throws(() => createSyntheticPersonalAssetAccountFixture({
  accounts: fictionalAccounts, database: {},
}), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');
assert.throws(() => createSyntheticPersonalAssetAccountListAdapter({
  fixture, allowNetwork: false,
}), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_ADAPTER_INVALID');

let getterReads = 0;
const accessorInput = {
  authorityId: 'synthetic-authority', actor: { userId: 'synthetic-owner-alpha' },
};
Object.defineProperty(accessorInput, 'ownerUserId', {
  enumerable: true,
  get() { getterReads += 1; return 'synthetic-owner-alpha'; },
});
assert.throws(() => adapter.list(accessorInput),
  error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_INPUT_INVALID');
assert.strictEqual(getterReads, 0);

const accessorActor = { userId: 'synthetic-owner-alpha' };
Object.defineProperty(accessorActor, 'role', {
  enumerable: true,
  get() { getterReads += 1; return 'admin'; },
});
assert.throws(() => adapter.list({ actor: accessorActor, authorityId: 'synthetic-authority' }),
  error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_INPUT_INVALID');
assert.strictEqual(getterReads, 0);
assert.throws(() => adapter.list({
  actor: new Proxy({ userId: 'synthetic-owner-alpha' }, {}), authorityId: 'synthetic-authority',
}), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_INPUT_INVALID');

const hostileRoles = new Proxy(['student'], {
  get() { getterReads += 1; throw new Error('must not read roles'); },
});
assert.throws(() => adapter.list({
  actor: { userId: 'synthetic-owner-alpha', roles: hostileRoles }, authorityId: 'synthetic-authority',
}), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_INPUT_INVALID');
assert.strictEqual(getterReads, 0);

const accessorRow = { ...fictionalAccounts[0] };
Object.defineProperty(accessorRow, 'label', {
  enumerable: true,
  get() { getterReads += 1; return 'Synthetic Account'; },
});
assert.throws(() => createSyntheticPersonalAssetAccountFixture({ accounts: [accessorRow] }),
  error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');
assert.strictEqual(getterReads, 0);
assert.throws(() => createSyntheticPersonalAssetAccountFixture({
  accounts: [new Proxy(fictionalAccounts[0], {})],
}), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');
assert.throws(() => createSyntheticPersonalAssetAccountFixture({
  accounts: new Proxy(fictionalAccounts, {}),
}), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');

const sparseAccounts = [];
sparseAccounts[1] = fictionalAccounts[0];
assert.throws(() => createSyntheticPersonalAssetAccountFixture({ accounts: sparseAccounts }),
  error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');
const accessorAccounts = [];
Object.defineProperty(accessorAccounts, '0', {
  enumerable: true,
  get() { getterReads += 1; return fictionalAccounts[0]; },
});
accessorAccounts.length = 1;
assert.throws(() => createSyntheticPersonalAssetAccountFixture({ accounts: accessorAccounts }),
  error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');
assert.strictEqual(getterReads, 0);

const missingRowField = { ...fictionalAccounts[0] };
delete missingRowField.currency;
assert.throws(() => createSyntheticPersonalAssetAccountFixture({ accounts: [missingRowField] }),
  error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');
assert.throws(() => createSyntheticPersonalAssetAccountFixture({
  accounts: [{ ...fictionalAccounts[0], unexpected: true }],
}), error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID');

const before = adapter.inspect();
assert.throws(() => JSON.stringify(own),
  error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_SERIALIZATION_FORBIDDEN');
assert.throws(() => JSON.stringify(own[0]),
  error => error.code === 'SYNTHETIC_ASSET_ACCOUNT_SERIALIZATION_FORBIDDEN');
assert.strictEqual(Reflect.set(own[0], 'label', 'changed'), false);
assert.deepStrictEqual(adapter.inspect(), before);
assert.deepStrictEqual(adapter.list({
  actor: { userId: 'synthetic-owner-alpha' }, authorityId: 'synthetic-authority',
}).map(row => row.label), [
  'Earlier Synthetic Account', 'Synthetic Account', 'Tied Synthetic Account',
]);

assert.deepStrictEqual(Object.keys(adapterApi).sort(), [
  'createSyntheticPersonalAssetAccountFixture',
  'createSyntheticPersonalAssetAccountListAdapter',
].sort());

const source = require('fs').readFileSync(
  require.resolve('./personalAssetAccountSyntheticReadAdapter'), 'utf8',
);
for (const forbiddenToken of [
  'better-sqlite3', "require('pg')", 'fetch(', 'http', 'https', 'fs', 'path',
  'process.env', 'child_process', 'INSERT', 'UPDATE', 'DELETE', 'CREATE',
  'ALTER', 'DROP', 'COPY', 'sync', 'projection', 'snapshot',
]) {
  assert.strictEqual(source.includes(forbiddenToken), false,
    `synthetic adapter source must not contain ${forbiddenToken}`);
}

console.log('personal asset account synthetic read adapter tests passed');
