'use strict';
// Execute the actual HTTP route's student-scope CTEs with the new read-only ledger
// in disposable PostgreSQL. Unrelated room/asset projections are outside this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCloudBusinessApp } = require('../src/app');
const { withMiniappStudentLedgerProjection } = require('../src/miniappStudentLedgerProjection');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
(async () => {
  let actualSql;
  const empty = Object.fromEntries(['students', 'studentContacts', 'teachers', 'courses', 'schedules', 'institutions', 'schools', 'rooms', 'assetRecords', 'assetCategories', 'payments', 'grades'].map(key => [key, []]));
  const app = createCloudBusinessApp({ businessTenantId: 'own',
    query: async sql => { actualSql = sql; return { rows: [{ projection: empty }] }; },
    miniappCloudAccount: { login: async () => {}, context: async () => ({ status: 'active', roles: ['teacher'], profile: { type: 'teacher', id: 'teacher' }, accountId: 'account' }) } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/business/miniapp-projection`, { headers: { authorization: 'Bearer miniapp.ticket' } })).status, 200); }
  finally { await new Promise(resolve => server.close(resolve)); }
  const start = actualSql.indexOf('WITH managed_teachers AS (');
  const end = actualSql.indexOf('SELECT jsonb_build_object(', start);
  assert(start > 0 && end > start);
  const scopeSql = actualSql.slice(start, end) + "SELECT jsonb_build_object('students',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'balance_hours',99999,'balance_money',99999) ORDER BY id) FROM scoped_students),'[]'::jsonb)) AS projection";
  const sql = withMiniappStudentLedgerProjection(scopeSql);
  const pg = createDisposablePg17Runtime(); await pg.start();
  const handle = await pg.createIsolatedHandle();
  try {
    const receipt = { appliedAt: '2026-09-20T00:00:00.000Z', appliedBy: 'miniapp-student-ledger-test' };
    await createVNextPg17CatalogBoundary(pg).apply(handle, receipt);
    await createBusinessFoundationCatalogBoundary(pg).apply(handle, receipt);
    await withQuery(handle, 'fixture-provisioner', async db => {
      await db.query('CREATE ROLE gewu_cloud_schedule_reader NOLOGIN; GRANT USAGE ON SCHEMA business TO gewu_cloud_schedule_reader');
      for (const file of ['20260821-business-schedule-update.sql', '20260822-business-schedule-student-override.sql', '20260907-z-teacher-student-write-scope.sql', '20260824-supplemental-business-authority.sql']) {
        await db.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      }
      await require('./managedTeacherProfileFixture').applyManagedTeacherProfileFixture(db);
      await db.query('GRANT SELECT ON business.teachers,business.students,business.courses,business.schedules,business.course_student_pricings,business.schedule_student_overrides TO gewu_cloud_schedule_reader');
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('own','Own',false,now(),now()),('foreign','Foreign',false,now(),now())");
      await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher','own','Teacher',false,now(),now()),('other','own','Other',false,now(),now())");
      for (const [id, tenant, creator, deleted] of [
        ['enrolled', 'own', null, false], ['created', 'own', 'teacher', false], ['override', 'own', null, false],
        ['unrelated', 'own', 'other', false], ['deleted', 'own', 'teacher', true], ['foreign-student', 'foreign', null, false],
        ['empty', 'own', 'teacher', false],
      ]) await db.query('INSERT INTO business.students(id,tenant_id,name,created_by_teacher_id,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$1,$3,false,$4,now(),now())', [id, tenant, creator, deleted]);
      await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) VALUES ('course','own','Course','Course',1,1,180,120,1,1,'teacher',true,false,now(),now())");
      await db.query("INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES ('own','course','enrolled',180,120)");
      await db.query("INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,status,calculated_tuition,calculated_teacher_fee,legacy_deleted,created_at,updated_at) VALUES ('lesson','own','course','2026-09-08T01:00:00Z','2026-09-08T02:30:00Z',1,270,180,false,now(),now())");
      await db.query("INSERT INTO business.schedule_student_overrides(tenant_id,schedule_id,student_id,attendance_status,tuition,teacher_fee) VALUES ('own','lesson','override',1,180,120)");
      for (const [id, student, tenant, deleted] of [
        ['enrolled', 'enrolled', 'own', false], ['created', 'created', 'own', false], ['override', 'override', 'own', false],
        ['unrelated', 'unrelated', 'own', false], ['deleted-student', 'deleted', 'own', false],
        ['foreign-student', 'foreign-student', 'foreign', false], ['wrong-tenant', 'enrolled', 'foreign', false], ['deleted-row', 'enrolled', 'own', true],
      ]) {
        for (const [type, amount] of [[1, 1200], [2, 12]]) await db.query("INSERT INTO business.payments(id,tenant_id,student_id,amount,payment_type,payment_date,notes,deleted) VALUES ($1,$2,$3,$4,$5,'2026-09-08','internal-payment-note',$6)", [`${id}-${type}`, tenant, student, amount, type, deleted]);
        await db.query("INSERT INTO business.consumptions(id,tenant_id,student_id,schedule_id,hours,amount,consumption_date,notes,deleted) VALUES ($1,$2,$3,'historical-other-lesson',1.5,180,'2026-09-08','internal-consumption-note',$4)", [id, tenant, student, deleted]);
        await db.query("INSERT INTO business.grades(id,tenant_id,student_id,subject,score,exam_date,notes,deleted) VALUES ($1,$2,$3,'Physics',86,'2026-09-08','internal-grade-note',$4)", [id, tenant, student, deleted]);
      }
      const read = async (role, id, tenant = 'own') => {
        await db.query('BEGIN; SET LOCAL ROLE gewu_cloud_schedule_reader');
        try { return (await db.query(sql, [tenant, role, id])).rows[0].projection; }
        finally { await db.query('ROLLBACK'); }
      };
      const verify = (value, ids) => {
        assert.deepEqual(value.students.map(row => row.id), ids);
        const funded = ids.filter(id => id !== 'empty');
        assert.deepEqual([...new Set(value.payments.map(row => row.student_id))].sort(), funded);
        assert.deepEqual(value.grades.map(row => row.student_id).sort(), funded);
        for (const s of value.students) assert.deepEqual([s.balance_hours, s.balance_money], s.id === 'empty' ? [0, 0] : [10.5, 1020]);
        assert(!Object.hasOwn(value, 'consumptions'));
        assert(!JSON.stringify(value).includes('internal-'));
        for (const row of value.payments) assert.deepEqual(Object.keys(row).sort(), ['amount', 'id', 'payment_date', 'payment_method', 'payment_type', 'student_id']);
        for (const row of value.grades) assert.deepEqual(Object.keys(row).sort(), ['exam_date', 'id', 'score', 'student_id', 'subject']);
      };
      verify(await read('teacher', 'teacher'), ['created', 'empty', 'enrolled', 'override']);
      verify(await read('teacher', 'other'), ['unrelated']);
      verify(await read('teacher', 'absent'), []);
      // Family contexts use the same student scope, verified separately by the HTTP test.
      for (const id of ['created', 'enrolled', 'override', 'unrelated', 'empty']) verify(await read('student', id), [id]);
      for (const id of ['deleted', 'foreign-student', 'absent']) verify(await read('student', id), []);
      verify(await read('student', 'foreign-student', 'foreign'), ['foreign-student']);
      verify(await read('manager', null), ['created', 'empty', 'enrolled', 'override', 'unrelated']);
      verify(await read('visitor', null), []);
      for (const table of ['payments', 'consumptions', 'grades']) {
        await db.query('BEGIN; SET LOCAL ROLE gewu_cloud_schedule_reader');
        try { await assert.rejects(db.query(`DELETE FROM business.${table}`), error => error.code === '42501'); }
        finally { await db.query('ROLLBACK'); }
      }
    });
  } finally { await pg.disposeHandle(handle).catch(() => {}); await pg.stop().catch(() => {}); }
  console.log('miniapp student ledger SQL: exact balances, scoped records, tenant/deletion isolation, no private ledger fields and read-only role passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
