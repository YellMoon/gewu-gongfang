const assert = require('assert');
const Database = require('better-sqlite3');
const { createPersonalAssetAccountService } = require('./personalAssetAccountService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE asset_accounts (
    account_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    account_type TEXT NOT NULL, provider TEXT, label TEXT NOT NULL,
    masked_identifier TEXT, balance REAL NOT NULL, currency TEXT NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
`);
let sequence = 0;
const service = createPersonalAssetAccountService({
  db,
  now: () => '2026-07-28T08:00:00.000Z',
  createId: () => `asset-${++sequence}`,
});

const first = service.create({
  actor: { userId: 'user-1', roles: ['student'] },
  authorityId: 'authority-1',
  accountType: 'saving_card',
  provider: 'bank',
  label: 'salary',
  maskedIdentifier: '**** 1234',
  balance: 100,
});
assert.equal(first.ownerUserId, 'user-1');
assert.equal(first.maskedIdentifier, '**** 1234');
assert.equal(first.accountNumber, undefined);
assert.throws(
  () => service.create({
    actor: { userId: 'user-1', roles: ['student'] },
    authorityId: 'authority-1',
    accountType: 'saving_card',
    label: 'unsafe',
    accountNumber: '6222123412341234',
  }),
  error => error.code === 'ASSET_ACCOUNT_SECRET_FORBIDDEN'
);
assert.throws(
  () => service.update({
    actor: { userId: 'user-2', roles: ['student'] },
    accountId: first.accountId,
    changes: { balance: 200 },
  }),
  error => error.code === 'ASSET_ACCOUNT_FORBIDDEN'
);
service.create({
  actor: { userId: 'user-2', roles: ['teacher'] },
  authorityId: 'authority-1',
  accountType: 'wechat',
  label: 'wallet',
});
assert.deepStrictEqual(service.list({
  actor: { userId: 'user-1', roles: ['student'] },
  authorityId: 'authority-1',
}).map(row => row.ownerUserId), ['user-1']);
assert.equal(service.list({
  actor: { userId: 'super-1', roles: ['super_admin'] },
  authorityId: 'authority-1',
  ownerUserId: 'user-2',
}).length, 1);

const candidateFirst = service.recognizeOrCreate({
  actor: { userId: 'user-1', roles: ['student'] },
  authorityId: 'authority-1',
  accountType: 'savings',
  provider: 'Example Bank',
  label: 'Savings card',
  maskedIdentifier: '**** 4321',
});
assert.equal(candidateFirst.created, true);
assert.equal(candidateFirst.account.accountType, 'saving_card');
assert.equal(candidateFirst.account.ownerUserId, 'user-1');

const candidateDuplicate = service.recognizeOrCreate({
  actor: { userId: 'user-1', roles: ['student'] },
  authorityId: 'authority-1',
  accountType: 'debit',
  provider: 'Example Bank',
  label: 'Imported statement',
  maskedIdentifier: '**** 4321',
});
assert.equal(candidateDuplicate.created, false, 'the same owner/type/provider/masked identifier must not create a second account');
assert.equal(candidateDuplicate.account.accountId, candidateFirst.account.accountId);
assert.throws(
  () => service.recognizeOrCreate({
    actor: { userId: 'user-1', roles: ['student'] },
    authorityId: 'authority-1',
    accountType: 'credit',
    provider: 'Example Bank',
    label: 'unsafe import',
    maskedIdentifier: '6222123412341234',
  }),
  error => error.code === 'ASSET_ACCOUNT_SECRET_FORBIDDEN',
  'candidate recognition must reject full identifiers rather than persisting or using them for deduplication',
);

console.log('personalAssetAccountService tests passed');
