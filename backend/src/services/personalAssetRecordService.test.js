const assert = require('assert');
const Database = require('better-sqlite3');
const { createPersonalAssetRecordService } = require('./personalAssetRecordService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE asset_accounts (
    account_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    account_type TEXT NOT NULL, provider TEXT, label TEXT NOT NULL,
    masked_identifier TEXT, balance REAL NOT NULL, currency TEXT NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE personal_asset_categories (
    category_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL, category_type TEXT NOT NULL, color TEXT, status TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE personal_asset_records (
    record_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    account_id TEXT NOT NULL, record_date TEXT NOT NULL, record_type TEXT NOT NULL,
    category_id TEXT, category_name TEXT, amount REAL NOT NULL, student_id TEXT,
    student_name TEXT, note TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
const service = createPersonalAssetRecordService({
  db,
  now: () => '2026-07-28T12:00:00.000Z',
});
const actor = { userId: 'user-1', roles: ['student'] };
const category = service.createCategory({
  authorityId: 'authority-1',
  actor,
  record: { id: 'category-1', name: 'Food', type: 'expense', color: '#123456' },
});
assert.strictEqual(category.ownerUserId, 'user-1');

const created = service.create({
  authorityId: 'authority-1',
  actor,
  record: {
    id: 'record-1',
    date: '2026-07-28',
    type: 'expense',
    category_id: 'category-1',
    category_name: 'Food',
    amount: 88,
    note: 'lunch',
  },
});
assert.strictEqual(created.id, 'record-1');
assert.strictEqual(created.ownerUserId, 'user-1');
assert.strictEqual(created.accountId, 'personal-ledger:authority-1:user-1');
assert.strictEqual(
  db.prepare('SELECT owner_user_id FROM personal_asset_records WHERE record_id=?').get('record-1').owner_user_id,
  'user-1',
);

assert.throws(
  () => service.update({
    actor: { userId: 'user-2', roles: ['student'] },
    id: 'record-1',
    changes: { amount: 999 },
  }),
  error => error?.code === 'ASSET_RECORD_FORBIDDEN',
);
assert.throws(
  () => service.create({
    authorityId: 'authority-1',
    actor,
    record: {
      id: 'record-2',
      date: '2026-07-28',
      type: 'expense',
      amount: 1,
      owner_user_id: 'user-2',
    },
  }),
  error => error?.code === 'ASSET_RECORD_FIELD_FORBIDDEN',
);
assert.strictEqual(service.delete({ actor, id: 'record-1' }).status, 'deleted');
assert.strictEqual(service.deleteCategory({ actor, id: 'category-1' }).status, 'deleted');

console.log('personalAssetRecordService tests passed');
