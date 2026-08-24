'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

const SQL = fs.readFileSync(path.join(__dirname, '20260824-schedule-lifecycle.sql'), 'utf8');
const APPLY = Object.freeze({ appliedAt: '2026-08-24T00:00:00.000Z', appliedBy: 'schedule-lifecycle-test' });

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, APPLY);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, APPLY);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(SQL));
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Tenant',false,transaction_timestamp(),transaction_timestamp())");
      await facade.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher-1','tenant-1','Teacher',false,transaction_timestamp(),transaction_timestamp())");
      await facade.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student-1','tenant-1','Student',false,false,transaction_timestamp(),transaction_timestamp())");
      await facade.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) VALUES ('course-1','tenant-1','Course','Course',1,1,100,50,1,1,'teacher-1',true,false,transaction_timestamp(),transaction_timestamp())");
    });
    let createdAt;
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      await assert.rejects(
        () => facade.query(
          'SELECT * FROM business.vnext_create_schedule_record_v1($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)',
          ['tenant-1', 'bad-schedule', 'missing-course', '2026-08-25T01:00:00.000Z', '2026-08-25T02:00:00.000Z', null, 1, null, 1, 0, 0, null, '[]'],
        ),
        error => error?.code === '23503',
      );
      const created = await facade.query(
        'SELECT * FROM business.vnext_create_schedule_record_v1($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)',
        ['tenant-1', 'schedule-1', 'course-1', '2026-08-25T01:00:00.000Z', '2026-08-25T02:00:00.000Z', null, 1, 'Room', 1, 100, 50, null, JSON.stringify([{ student_id: 'student-1', attendance_status: 1, tuition: 100, teacher_fee: 50 }])],
      );
      assert.strictEqual(created.rows.length, 1);
      createdAt = created.rows[0].updated_at.toISOString();
      const staleDelete = await facade.query('SELECT * FROM business.vnext_soft_delete_schedule($1,$2,$3::timestamptz)', ['tenant-1', 'schedule-1', '2026-08-24T00:00:00.000Z']);
      assert.deepStrictEqual(staleDelete.rows, []);
      const removed = await facade.query('SELECT * FROM business.vnext_soft_delete_schedule($1,$2,$3::timestamptz)', ['tenant-1', 'schedule-1', createdAt]);
      assert.strictEqual(removed.rows.length, 1);
      await assert.rejects(() => facade.query("DELETE FROM business.schedules WHERE id='schedule-1'"), error => error?.code === '42501');
    });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      const schedule = await facade.query("SELECT legacy_deleted FROM business.schedules WHERE id='schedule-1'");
      assert.deepStrictEqual(schedule.rows, [{ legacy_deleted: true }]);
      const override = await facade.query("SELECT attendance_status,tuition,teacher_fee FROM business.schedule_student_overrides WHERE schedule_id='schedule-1'");
      assert.deepStrictEqual(override.rows.map(row => ({ attendanceStatus: row.attendance_status, tuition: Number(row.tuition), teacherFee: Number(row.teacher_fee) })), [{ attendanceStatus: 1, tuition: 100, teacherFee: 50 }]);
    });
    await withVNextPg17SyntheticQuery(handle, 'verifier', async facade => {
      await assert.rejects(
        () => facade.query('SELECT * FROM business.vnext_soft_delete_schedule($1,$2,$3::timestamptz)', ['tenant-1', 'schedule-1', createdAt]),
        error => error?.code === '42501',
      );
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('schedule lifecycle PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
