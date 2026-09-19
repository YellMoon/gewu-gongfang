'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const { createBusinessSupplementalLifecycleMutations } = require('../src/businessSupplementalLifecycleMutationService');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const apply = { appliedAt: '2026-09-20T00:00:00.000Z', appliedBy: 'supplemental-runtime-test' };

(async () => {
  const runtime = createDisposablePg17Runtime(); await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, apply);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, apply);
    await withQuery(handle, 'fixture-provisioner', async db => {
      await db.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gewu_cloud_schedule_reader') THEN CREATE ROLE gewu_cloud_schedule_reader NOLOGIN; END IF; END $$");
      await db.query(read('20260823-personal-asset-import.sql'));
      await db.query(read('20260824-supplemental-business-authority.sql'));
      await db.query(read('20260824-foundation-lifecycle.sql'));
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Tenant',false,now(),now()),('tenant-2','Other',false,now(),now())");
      await db.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student-1','tenant-1','Student',false,false,now(),now()),('deleted-student','tenant-1','Deleted',false,true,now(),now()),('other-student','tenant-2','Other',false,false,now(),now())");
      await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher-1','tenant-1','Teacher',false,now(),now())");
      await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) VALUES ('course-1','tenant-1','Course','Course',1,1,100,60,1,1,'teacher-1',true,false,now(),now())");
      await db.query("INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,status,service_type,calculated_tuition,calculated_teacher_fee,legacy_deleted,created_at,updated_at) VALUES ('schedule-1','tenant-1','course-1','2030-01-07T01:00:00Z','2030-01-07T02:00:00Z',1,1,100,60,false,now(),now())");
      await db.query("INSERT INTO business.payments(id,tenant_id,student_id,amount,payment_type,payment_date,notes,updated_at) VALUES ('legacy-payment','tenant-1','student-1',50,1,'2020-01-07','keep business data','2020-01-07T00:00:00.123456Z')");
    });
    const payment = {tenantId:'tenant-1', paymentId:'payment-1', studentId:'student-1', amount:800, paymentType:1, paymentDate:'2030-01-07', paymentMethod:'cash', notes:null};
    await withQuery(handle, 'writer', async db => {
      const service = createBusinessSupplementalLifecycleMutations({query: (sql, values) => db.query(sql, values)});
      await assert.rejects(() => service.payments.create(payment), error => error.code === '42501', 'reproduce production reference-read denial');
    });
    await withQuery(handle, 'fixture-provisioner', async db => {
      await db.query(read('20260920-supplemental-runtime-contract.sql'));
      await db.query(read('20260920-supplemental-runtime-contract.sql'));
      const legacy = await db.query("SELECT notes,amount::float8 AS amount,updated_at FROM business.payments WHERE id='legacy-payment'");
      assert.deepEqual(legacy.rows, [{notes:'keep business data', amount:50, updated_at:new Date('2020-01-07T00:00:00.123Z')}], 'migration preserves externally observed versions and business data, including on replay');
    });
    await withQuery(handle, 'writer', async db => {
      const service = createBusinessSupplementalLifecycleMutations({query: (sql, values) => db.query(sql, values)});
      for (const table of ['students', 'schedules']) {
        const result = await db.query(`SELECT has_table_privilege(current_user,'business.${table}','SELECT') AS broad,
          has_table_privilege(current_user,'business.${table}','INSERT,UPDATE,DELETE') AS writes,
          has_column_privilege(current_user,'business.${table}','id','SELECT') AS reference`);
        assert.deepEqual(result.rows, [{broad:false, writes:false, reference:true}]);
      }
      await assert.rejects(() => db.query('SELECT name FROM business.students'), error => error.code === '42501');
      await assert.rejects(() => db.query('SELECT name FROM business.personal_asset_categories'), error => error.code === '42501');
      await assert.rejects(() => db.query("UPDATE business.students SET name='bypass'"), error => error.code === '42501');
      const legacyUpdated = await service.payments.update({...payment, paymentId:'legacy-payment', expectedUpdatedAt:'2020-01-07T00:00:00.123Z'});
      assert.ok(legacyUpdated, 'an old externally observed baseline remains usable after migration');
      const operations = [
        ['payments', 'paymentId', payment, {amount:900}],
        ['consumptions', 'consumptionId', {tenantId:'tenant-1', consumptionId:'consumption-1', scheduleId:'schedule-1', studentId:'student-1', hours:1, amount:100, consumptionDate:'2030-01-07', notes:null}, {amount:110}],
        ['grades', 'gradeId', {tenantId:'tenant-1', gradeId:'grade-1', studentId:'student-1', subject:'physics', score:90, examDate:'2030-01-07', notes:null}, {score:91}],
        ['assetCategories', 'categoryId', {tenantId:'tenant-1', accountId:'account-1', categoryId:'category-1', name:'books', type:'expense', color:'#123456'}, {color:'#654321'}],
        ['assetRecords', 'recordId', {tenantId:'tenant-1', accountId:'account-1', recordId:'asset-1', date:'2030-01-07', type:'expense', categoryId:'category-1', categoryName:'books', amount:60, studentId:null, studentName:null, note:''}, {amount:70}],
      ];
      const created = [];
      for (const [kind, idKey, input, change] of operations) {
        const initial = await service[kind].create(input);
        assert.equal(initial?.id, input[idKey], `${kind} create under real writer permissions`);
        const updated = await service[kind].update({...input, ...change, expectedUpdatedAt:initial.updatedAt});
        assert.ok(updated, `${kind} must accept the exact timestamp returned by create`);
        assert.notEqual(updated.updatedAt, initial.updatedAt, `${kind} version must advance`);
        assert.equal(await service[kind].update({...input, expectedUpdatedAt:initial.updatedAt}), null, `${kind} stale update`);
        created.push({kind, input, idKey, updatedAt:updated.updatedAt});
      }
      for (const studentId of ['missing', 'deleted-student', 'other-student']) {
        assert.equal(await service.payments.create({...payment, paymentId:`payment-${studentId}`, studentId}), null);
      }
      const asset = created.find(item => item.kind === 'assetRecords');
      assert.equal(await service.assetRecords.update({...asset.input, accountId:'other-account', expectedUpdatedAt:asset.updatedAt}), null);
      assert.equal(await service.assetRecords.remove({...asset.input, accountId:'other-account', expectedUpdatedAt:asset.updatedAt}), null);
      const category = created.find(item => item.kind === 'assetCategories');
      assert.equal(await service.assetCategories.remove({...category.input, expectedUpdatedAt:category.updatedAt}), null, 'referenced categories cannot be removed');
      await db.query('BEGIN');
      try {
        const first = await service.payments.update({...payment, expectedUpdatedAt:created[0].updatedAt});
        const second = await service.payments.update({...payment, expectedUpdatedAt:first.updatedAt});
        assert.ok(Date.parse(second.updatedAt) > Date.parse(first.updatedAt), 'multiple writes in the same transaction advance the public version');
        assert.equal(await service.payments.update({...payment, expectedUpdatedAt:first.updatedAt}), null);
      } finally { await db.query('ROLLBACK'); }
      for (const item of created.reverse()) {
        assert.ok(await service[item.kind].remove({...item.input, expectedUpdatedAt:item.updatedAt}), `${item.kind} cleanup`);
      }
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {}); await runtime.stop().catch(() => {});
  }
  console.log('supplemental runtime PostgreSQL permission and version checks passed');
})().catch(error => { console.error(error); process.exitCode=1; });
