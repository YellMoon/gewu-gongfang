'use strict';
// UTF-8: 仅在隔离 PostgreSQL 中验证导入重试、回滚和账户边界。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPersonalAssetImportRepository } = require('../src/personalAssetImportRepository');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    const receipt = { appliedAt:'2026-09-23T00:00:00.000Z', appliedBy:'personal-asset-import-test' };
    await createVNextPg17CatalogBoundary(runtime).apply(handle, receipt);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, receipt);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async db => {
      await db.query('CREATE ROLE gewu_cloud_schedule_reader NOLOGIN');
      await db.query(fs.readFileSync(path.join(__dirname, '20260823-personal-asset-import.sql'), 'utf8'));
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('asset-test','Test',false,now(),now())");
      const repository = createPersonalAssetImportRepository({transaction: async work => {
        await db.query('BEGIN');
        try { const result = await work((sql, values) => db.query(sql, values)); await db.query('COMMIT'); return result; }
        catch (error) { await db.query('ROLLBACK'); throw error; }
      }});
      const snapshot = async () => (await db.query(`SELECT jsonb_build_object(
        'imports',(SELECT jsonb_agg(t ORDER BY import_id) FROM business.personal_asset_imports t),
        'categories',(SELECT jsonb_agg(t ORDER BY category_id) FROM business.personal_asset_categories t),
        'records',(SELECT jsonb_agg(t ORDER BY record_id) FROM business.personal_asset_records t)) AS state`)).rows[0].state;
      const input = { tenantId:'asset-test',actor:{accountId:'asset-admin',roles:['super_admin']},idempotencyKey:'same-attempt',records:[{date:'2026-09-23',type:'expense',amount:2.55,category:'Books',note:''}] };
      const first = await repository.import(input);
      assert.equal((await db.query('SELECT amount::text FROM business.personal_asset_records')).rows[0].amount,'2.55','database retains exact cents');
      const same = await repository.import(input);
      assert.equal(same.importId, first.importId); assert.equal(same.replayed, true);
      const before = await snapshot();
      await assert.rejects(repository.import({...input, records:[{...input.records[0],category:'Changed'}, {...input.records[0],category:'Extra',amount:20}]}), /CLOUD_PERSONAL_ASSET_IDEMPOTENCY_CONFLICT/);
      assert.deepEqual(await snapshot(), before, 'changed retry must roll back categories and extra records before COMMIT');
      const teacher = await repository.import({...input,actor:{accountId:'asset-teacher',roles:['teacher']}});
      assert.notEqual(teacher.importId,first.importId,'same retry key is independent for another authorized account');
      const rows = (await db.query('SELECT account_id,count(*)::int AS count FROM business.personal_asset_records GROUP BY account_id ORDER BY account_id')).rows;
      assert.deepEqual(rows,[{account_id:'asset-admin',count:1},{account_id:'asset-teacher',count:1}]);
      for(const role of ['student','family_member','visitor','admin']) {
        await assert.rejects(repository.import({...input,actor:{accountId:'denied-'+role,roles:[role]}}), /CLOUD_PERSONAL_ASSET_ACCESS_DENIED/);
      }
      assert.equal((await db.query('SELECT count(*)::int AS count FROM business.personal_asset_records')).rows[0].count,2);
    });
  } finally {
    await runtime.disposeHandle(handle);
    await runtime.stop();
  }
  console.log('personal asset import PostgreSQL rollback, replay and owner-boundary checks passed');
})().catch(error => { console.error(error); process.exitCode=1; });
