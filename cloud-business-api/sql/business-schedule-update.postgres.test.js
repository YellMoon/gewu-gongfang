'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

const SQL = fs.readFileSync(path.join(__dirname, '20260821-business-schedule-update.sql'), 'utf8');
const OVERRIDE_SQL = fs.readFileSync(path.join(__dirname, '20260822-business-schedule-student-override.sql'), 'utf8');
const APPLY = Object.freeze({ appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'business-schedule-update-test' });

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, APPLY);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, APPLY);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(SQL));
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(OVERRIDE_SQL));
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query(
        'INSERT INTO business.tenants(id,name,legacy_status,legacy_plan,legacy_archive_before,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz)',
        ['tenant-1', 'Tenant one', null, null, null, false, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'],
      );
      await facade.query(
        'INSERT INTO business.institutions(id,tenant_id,name,contact_person_legacy,contact_phone_legacy,revenue_share,notes,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz)',
        ['institution-1', 'tenant-1', 'Institution one', null, null, null, null, false, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'],
      );
      await facade.query(
        'INSERT INTO business.teachers(id,tenant_id,name,phone_legacy,subject,hourly_rate,notes,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz)',
        ['teacher-1', 'tenant-1', 'Teacher one', null, null, null, null, false, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'],
      );
      await facade.query(
        'INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz)',
        ['student-1', 'tenant-1', 'Student one', false, false, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'],
      );
      await facade.query(
        'INSERT INTO business.courses(id,tenant_id,name,year,semester,display_name,course_type,legacy_source_type,institution_id,price_tuition,price_teacher,billing_unit,teacher_fee_mode,legacy_room_id,room_name_snapshot,teacher_id,teacher_name_snapshot,legacy_active,default_duration_minutes,notes,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::timestamptz,$23::timestamptz)',
        ['course-1', 'tenant-1', 'Course one', null, null, 'Course one', 1, 1, 'institution-1', 100, 50, 1, 1, null, null, 'teacher-1', null, true, 60, null, false, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'],
      );
      await facade.query(
        'INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,recurring_rule_json,status,room_display_snapshot,service_type,calculated_tuition,calculated_teacher_fee,notes,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15::timestamptz)',
        ['schedule-1', 'tenant-1', 'course-1', '2026-08-21T01:00:00.000Z', '2026-08-21T02:00:00.000Z', null, 1, 'Room A', null, 100, 50, null, false, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'],
      );
    });
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      const result = await facade.query(
        'SELECT * FROM business.vnext_update_schedule($1,$2,$3::timestamptz,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10)',
        ['tenant-absent', 'schedule-absent', '2026-08-21T00:00:00.000Z', '2026-08-22T00:00:00.000Z', '2026-08-22T01:00:00.000Z', 1, null, 0, 0, null],
      );
      assert.deepStrictEqual(result.rows, []);

      const updated = await facade.query(
        'SELECT * FROM business.vnext_update_schedule($1,$2,$3::timestamptz,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10)',
        ['tenant-1', 'schedule-1', '2026-08-20T00:00:00.000Z', '2026-08-21T03:00:00.000Z', '2026-08-21T04:30:00.000Z', 2, 'Room B', 120, 65, 'updated once'],
      );
      assert.strictEqual(updated.rows.length, 1);
      assert.strictEqual(updated.rows[0].id, 'schedule-1');
      assert.notStrictEqual(updated.rows[0].updated_at.toISOString(), '2026-08-20T00:00:00.000Z');

      const overridden = await facade.query(
        'SELECT * FROM business.vnext_upsert_schedule_student_override($1,$2,$3,$4::timestamptz,$5,$6,$7)',
        ['tenant-1', 'schedule-1', 'student-1', updated.rows[0].updated_at.toISOString(), 4, 80, 40],
      );
      assert.strictEqual(overridden.rows.length, 1);
      assert.strictEqual(overridden.rows[0].id, 'schedule-1');

      const stale = await facade.query(
        'SELECT * FROM business.vnext_update_schedule($1,$2,$3::timestamptz,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10)',
        ['tenant-1', 'schedule-1', '2026-08-20T00:00:00.000Z', '2026-08-21T05:00:00.000Z', '2026-08-21T06:00:00.000Z', 3, 'Room C', 130, 70, 'must not apply'],
      );
      assert.deepStrictEqual(stale.rows, []);

      await assert.rejects(
        () => facade.query("UPDATE business.schedules SET notes='direct-write' WHERE id='schedule-1'"),
        error => error && error.code === '42501',
      );
    });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      const schedule = await facade.query('SELECT start_at,end_at,status,room_display_snapshot,calculated_tuition,calculated_teacher_fee,notes FROM business.schedules WHERE tenant_id=$1 AND id=$2', ['tenant-1', 'schedule-1']);
      assert.deepStrictEqual(schedule.rows.map(row => ({
        startAt: row.start_at.toISOString(), endAt: row.end_at.toISOString(), status: row.status,
        room: row.room_display_snapshot, tuition: Number(row.calculated_tuition), teacherFee: Number(row.calculated_teacher_fee), notes: row.notes,
      })), [{
        startAt: '2026-08-21T03:00:00.000Z', endAt: '2026-08-21T04:30:00.000Z', status: 2,
        room: 'Room B', tuition: 120, teacherFee: 65, notes: 'updated once',
      }]);
      const override = await facade.query('SELECT attendance_status,tuition,teacher_fee FROM business.schedule_student_overrides WHERE tenant_id=$1 AND schedule_id=$2 AND student_id=$3', ['tenant-1', 'schedule-1', 'student-1']);
      assert.deepStrictEqual(override.rows.map(row => ({
        attendanceStatus: row.attendance_status, tuition: Number(row.tuition), teacherFee: Number(row.teacher_fee),
      })), [{ attendanceStatus: 4, tuition: 80, teacherFee: 40 }]);
    });
    await withVNextPg17SyntheticQuery(handle, 'verifier', async facade => {
      await assert.rejects(
        () => facade.query('SELECT * FROM business.vnext_update_schedule($1,$2,$3::timestamptz,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10)', ['tenant-absent', 'schedule-absent', '2026-08-21T00:00:00.000Z', '2026-08-22T00:00:00.000Z', '2026-08-22T01:00:00.000Z', 1, null, 0, 0, null]),
        error => error && error.code === '42501',
      );
      await assert.rejects(
        () => facade.query('SELECT * FROM business.vnext_upsert_schedule_student_override($1,$2,$3,$4::timestamptz,$5,$6,$7)', ['tenant-1', 'schedule-1', 'student-1', '2026-08-20T00:00:00.000Z', 1, 1, 1]),
        error => error && error.code === '42501',
      );
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('business schedule update PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
