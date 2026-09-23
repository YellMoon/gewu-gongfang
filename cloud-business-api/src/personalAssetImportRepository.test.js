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
    actor: { accountId: 'super-admin-1', roles: ['super_admin'] },
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
  assert.deepStrictEqual(queryCalls[0].values.slice(0, 4), ['default', 'super-admin-1', 'asset-import-1', 'asset_import_12345678']);
  await assert.rejects(
    () => repository.import({ tenantId: 'default', actor: { accountId: 'student-1', roles: ['student'] }, idempotencyKey: 'asset-import-2', records: [{ date: '2026-08-01', type: 'income', amount: 1, category: 'Tuition', note: '' }] }),
    /CLOUD_PERSONAL_ASSET_ACCESS_DENIED/,
  );
  await assert.rejects(
    () => repository.import({ tenantId: 'default', actor: { accountId: 'super-admin-1', roles: ['super_admin'] }, idempotencyKey: 'asset-import-3', records: [{ date: 'not-a-date', type: 'income', amount: 1, category: 'Tuition', note: '' }] }),
    /CLOUD_PERSONAL_ASSET_INPUT_INVALID/,
  );
  await assert.rejects(
    () => repository.import({ tenantId: 'default', actor: { accountId: 'retired-admin-1', roles: ['admin'] }, idempotencyKey: 'asset-import-4', records: [{ date: '2026-08-03', type: 'income', amount: 1, category: 'Tuition', note: '' }] }),
    /CLOUD_PERSONAL_ASSET_ACCESS_DENIED/,
  );
  await repository.import({tenantId:'default',actor:{accountId:'teacher-1',roles:['teacher']},idempotencyKey:'teacher-import',records:[{date:'2026-09-23',type:'expense',amount:12,category:'Books',note:''}]});
  assert.equal(queryCalls.at(-1).values[1],'teacher-1','teacher imports are owned by the authenticated account');
  for(const invalidRow of [null,{requestHash:'different'}, {requestHash:'same',importId:null}]) {
    let committed=false, rolledBack=false;
    const failing=createPersonalAssetImportRepository({transaction:async work=>{
      try {
        const result=await work(async (_sql,values)=>({rows:invalidRow?[{...invalidRow,requestHash:invalidRow.requestHash==='same'?values[5]:invalidRow.requestHash}]:[]}));
        committed=true;return result;
      } catch(error) {rolledBack=true;throw error;}
    }});
    await assert.rejects(failing.import({tenantId:'default',actor:{accountId:'admin',roles:['super_admin']},idempotencyKey:'failure',records:[{date:'2026-09-23',type:'expense',amount:12,category:'Books',note:''}]}));
    assert.equal(committed,false,'invalid/conflicting receipt must not COMMIT');assert.equal(rolledBack,true);
  }
  const centsInput = {tenantId:'default',actor:{accountId:'teacher-1',roles:['teacher']},idempotencyKey:'cents',records:[{date:'2026-09-23',type:'expense',amount:2.55,category:'Books',note:''}]};
  for (const amount of [2.55, 18.35, 0.01, 100000000, '18.35']) {
    await repository.import({...centsInput,records:[{...centsInput.records[0],amount}]});
    assert.equal(JSON.parse(queryCalls.at(-1).values[4])[0].amount,Number(amount));
  }
  for (const amount of [100000000.01, 1.001, 0.00000000001, true, null]) {
    await assert.rejects(repository.import({...centsInput,records:[{...centsInput.records[0],amount}]}), /CLOUD_PERSONAL_ASSET_INPUT_INVALID/);
  }
  console.log('cloud personal asset import repository and cent precision checks passed');
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
