'use strict';
// Executes the runtime's exact student-scope CTEs and ledger SQL in isolated PostgreSQL.
// Unrelated projection fields (assets, rooms etc.) are omitted here; this is not a full deployment test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCloudBusinessApp } = require('../src/app');
const { withDesktopStudentLedgerProjection } = require('../src/desktopStudentLedgerProjection');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
(async () => {
  let actualSql;
  const empty = { students: [], studentContacts: [], teachers: [], courses: [], schedules: [], institutions: [], schools: [], rooms: [], assetRecords: [], assetCategories: [], payments: [], consumptions: [] };
  const app = createCloudBusinessApp({ businessTenantId: 'own', query: async sql => { actualSql = sql; return { rows: [{ projection: empty }] }; },
    desktopRegistration: { begin: async () => {}, register: async () => {}, sessionContext: async () => ({ roles: ['teacher'], profile: { type: 'teacher', id: 'teacher' }, accountId: 'account' }) } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/business/desktop-projection`, { headers: { authorization: 'Bearer desktop.ticket' } })).status, 200); }
  finally { await new Promise(resolve => server.close(resolve)); }
  const start = actualSql.indexOf('WITH scoped_schedules AS (');
  const end = actualSql.indexOf('SELECT jsonb_build_object(', start);
  assert(start > 0 && end > start);
  const scopeSql = actualSql.slice(start, end) + "SELECT jsonb_build_object('students',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id) ORDER BY id) FROM scoped_students),'[]'::jsonb)) AS projection";
  const sql = withDesktopStudentLedgerProjection(scopeSql);
  const pg = createDisposablePg17Runtime(); await pg.start();
  const handle = await pg.createIsolatedHandle();
  try {
    const receipt = { appliedAt: '2026-09-08T00:00:00.000Z', appliedBy: 'desktop-student-ledger-test' };
    await createVNextPg17CatalogBoundary(pg).apply(handle, receipt);
    await createBusinessFoundationCatalogBoundary(pg).apply(handle, receipt);
    await withQuery(handle, 'fixture-provisioner', async db => {
      await db.query('CREATE ROLE gewu_cloud_schedule_reader NOLOGIN; GRANT USAGE ON SCHEMA business TO gewu_cloud_schedule_reader');
      for (const file of ['20260821-business-schedule-update.sql', '20260822-business-schedule-student-override.sql', '20260907-z-teacher-student-write-scope.sql', '20260824-supplemental-business-authority.sql']) {
        await db.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      }
      await db.query('GRANT SELECT ON business.students,business.courses,business.schedules,business.course_student_pricings,business.schedule_student_overrides TO gewu_cloud_schedule_reader');
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('own','Own',false,now(),now()),('foreign','Foreign',false,now(),now())");
      await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher','own','Teacher',false,now(),now()),('other','own','Other',false,now(),now())");
      for (const [id, tenant, creator, deleted] of [
        ['enrolled', 'own', null, false], ['created', 'own', 'teacher', false], ['override', 'own', null, false],
        ['unrelated', 'own', 'other', false], ['deleted', 'own', 'teacher', true], ['foreign-student', 'foreign', null, false],
      ]) {
        await db.query('INSERT INTO business.students(id,tenant_id,name,created_by_teacher_id,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$1,$3,false,$4,now(),now())', [id, tenant, creator, deleted]);
      }
      await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) SELECT id,'own',id,id,1,1,180,120,1,1,teacher,true,false,now(),now() FROM (VALUES ('own-course','teacher'),('other-course','other')) AS x(id,teacher)");
      await db.query("INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES ('own','own-course','enrolled',180,120),('own','own-course','deleted',180,120),('own','other-course','enrolled',180,120),('own','other-course','unrelated',180,120)");
      await db.query("INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,status,calculated_tuition,calculated_teacher_fee,legacy_deleted,created_at,updated_at) VALUES ('lesson','own','own-course','2026-09-08T01:00:00Z','2026-09-08T02:30:00Z',1,270,180,false,now(),now())");
      await db.query("INSERT INTO business.schedule_student_overrides(tenant_id,schedule_id,student_id,attendance_status,tuition,teacher_fee) VALUES ('own','lesson','override',1,180,120)");
      for (const [id, student, tenant, deleted] of [
        ['enrolled', 'enrolled', 'own', false], ['created', 'created', 'own', false], ['override', 'override', 'own', false],
        ['unrelated', 'unrelated', 'own', false], ['deleted-student', 'deleted', 'own', false],
        ['foreign-student', 'foreign-student', 'foreign', false], ['wrong-tenant', 'enrolled', 'foreign', false],
        ['deleted-row', 'enrolled', 'own', true],
      ]) {
        await db.query("INSERT INTO business.payments(id,tenant_id,student_id,amount,payment_type,payment_date,deleted) VALUES ($1,$2,$3,1200,1,'2026-09-08',$4)", [id, tenant, student, deleted]);
        // A shared student's ledger is student-wide, including lessons not in the current teacher's course.
        await db.query("INSERT INTO business.consumptions(id,tenant_id,student_id,schedule_id,hours,amount,consumption_date,deleted) VALUES ($1,$2,$3,'historical-other-lesson',1.5,180,'2026-09-08',$4)", [id, tenant, student, deleted]);
      }
      const read = async teacher => {
        await db.query('BEGIN; SET LOCAL ROLE gewu_cloud_schedule_reader');
        try { return (await db.query(sql, ['own', 'teacher', teacher])).rows[0].projection; }
        finally { await db.query('ROLLBACK'); }
      };
      const assertIds = (value, ids) => {
        assert.deepEqual(value.students.map(row => row.id), ids);
        assert.deepEqual(value.payments.map(row => row.id), ids);
        assert.deepEqual(value.consumptions.map(row => row.id), ids);
      };
      assertIds(await read('teacher'), ['created', 'enrolled', 'override']);
      assertIds(await read('other'), ['enrolled', 'unrelated']);
      assertIds(await read('absent'), []);
      const first = await read('teacher');
      assert.equal(first.payments[0].amount, 1200); assert.equal(first.consumptions[0].hours, 1.5);
      await db.query("UPDATE business.courses SET legacy_deleted=true WHERE id='own-course'");
      assertIds(await read('teacher'), ['created']);
      await db.query('BEGIN; SET LOCAL ROLE gewu_cloud_schedule_reader');
      try { await assert.rejects(db.query("UPDATE business.payments SET amount=1 WHERE id='created'"), error => error.code === '42501'); }
      finally { await db.query('ROLLBACK'); }
      const indexes = await db.query("SELECT indexname FROM pg_indexes WHERE schemaname='business' AND indexname IN ('payments_tenant_student_idx','consumptions_tenant_student_idx')");
      assert.equal(indexes.rows.length, 2, 'reuse existing tenant/student indexes; no migration needed');
    });
  } finally { await pg.disposeHandle(handle).catch(() => {}); await pg.stop().catch(() => {}); }
  console.log('actual desktop student scope/ledger SQL: creator, course, override, shared student, tenant, deletion and reader boundaries passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
