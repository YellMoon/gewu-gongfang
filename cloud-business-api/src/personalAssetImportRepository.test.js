'use strict';

const assert = require('assert');
const { createPersonalAssetImportRepository } = require('./personalAssetImportRepository');

const now = new Date('2026-08-23T00:00:00.000Z');
const queryCalls = [];
const repository = createPersonalAssetImportRepository({
  randomId: () => 'asset_import_12345678',
  transaction: async work => work(async (text, values) => {
    queryCalls.push({ text, values });
    return { rows: [{ importId: 'asset_import_12345678', recordCount: 2, requestHash: values[5], createdAt: now, replayed: false }] };
  }),
});

async function main() {
  const receipt = await repository.import({
    tenantId: 'default',
    actor: { accountId: 'admin-1', roles: ['admin'] },
    idempotencyKey: 'asset-import-1',
    records: [
      { date: '2026-08-01', type: 'income', amount: '88.50', category: 'Tuition', note: 'August' },
      { date: '2026-08-02', type: 'expense', amount: 12, category: 'Books', note: '' },
    ],
  });
  assert.deepStrictEqual(receipt, { importId: 'asset_import_12345678', recordCount: 2, createdAt: now.toISOString(), replayed: false });
  assert.strictEqual(queryCalls.length, 1, 'a personal asset import must be atomic');
  assert.ok(queryCalls[0].text.includes('business.personal_asset_imports'), 'the immutable import receipt must be stored in cloud');
  assert.ok(queryCalls[0].text.includes('business.personal_asset_categories'), 'categories must be cloud-owned');
  assert.ok(queryCalls[0].text.includes('business.personal_asset_records'), 'records must be cloud-owned');
  assert.ok(queryCalls[0].text.includes('ON CONFLICT (tenant_id,account_id,idempotency_key)'), 'retries must be idempotent per account');
  assert.deepStrictEqual(queryCalls[0].values.slice(0, 4), ['default', 'admin-1', 'asset-import-1', 'asset_import_12345678']);
  await assert.rejects(
    () => repository.import({ tenantId: 'default', actor: { accountId: 'student-1', roles: ['student'] }, idempotencyKey: 'asset-import-2', records: [{ date: '2026-08-01', type: 'income', amount: 1, category: 'Tuition', note: '' }] }),
    /CLOUD_PERSONAL_ASSET_ACCESS_DENIED/,
  );
  await assert.rejects(
    () => repository.import({ tenantId: 'default', actor: { accountId: 'admin-1', roles: ['admin'] }, idempotencyKey: 'asset-import-3', records: [{ date: 'not-a-date', type: 'income', amount: 1, category: 'Tuition', note: '' }] }),
    /CLOUD_PERSONAL_ASSET_INPUT_INVALID/,
  );
  console.log('cloud personal asset import repository checks passed');
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
