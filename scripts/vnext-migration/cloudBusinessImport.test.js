'use strict';

const assert = require('assert');
const { buildCloudBusinessImportSql } = require('./cloudBusinessImport');

function coreSource() {
  return Object.freeze({
    sourceSnapshotSha256: 'a'.repeat(64),
    sourceInventorySha256: 'b'.repeat(64),
    sourceSchemaSha256: 'c'.repeat(64),
    foundation: Object.freeze({
      tenants: Object.freeze([Object.freeze({ id: 'tenant-1', name: 'Tenant', legacyStatus: null, legacyPlan: null, legacyArchiveBefore: null, legacyDeleted: false, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' })]),
      institutions: Object.freeze([Object.freeze({ id: 'institution-1', tenantId: 'tenant-1', name: 'School', contactPersonLegacy: null, contactPhoneLegacy: null, revenueShare: null, notes: null, legacyDeleted: false, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' })]),
      schools: Object.freeze([]),
      rooms: Object.freeze([]),
    }),
    coreScheduling: Object.freeze({
      teachers: Object.freeze([Object.freeze({ id: 'teacher-1', tenant_id: 'tenant-1', name: 'Teacher', phone: null, subject: null, hourly_rate: 100, notes: null, deleted: 0, created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z' })]),
      students: Object.freeze([Object.freeze({ id: 'student-1', tenant_id: 'tenant-1', name: 'Student', phone: null, school: null, grade_year: null, grade_current: null, source_type: null, institution_id: 'institution-1', parent_name: null, parent_wechat: null, student_source: null, balance_hours: null, balance_money: null, notes: null, is_institution_student: 0, parent_phone: null, parent_phone_normalized: null, parent_relation: null, deleted: 0, created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z' })]),
      courses: Object.freeze([Object.freeze({ id: 'course-1', tenant_id: 'tenant-1', name: 'Course', year: 2026, semester: 'summer', display_name: 'Course', type: 1, source_type: 1, institution_id: 'institution-1', price_tuition: 200, price_teacher: 100, billing_unit: 1, teacher_fee_mode: 1, room_id: null, room_name: 'Room snapshot', teacher_id: 'teacher-1', teacher_name: 'Teacher', active: 1, default_duration_minutes: 60, notes: null, deleted: 0, created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z', defaultRoster: Object.freeze([Object.freeze({ studentId: 'student-1', tuition: 200, teacherFee: 100 })]) })]),
      schedules: Object.freeze([Object.freeze({ id: 'schedule-1', tenantId: 'tenant-1', courseId: 'course-1', startAt: '2026-08-01T00:00:00.000Z', endAt: '2026-08-01T01:00:00.000Z', recurringRule: null, status: 1, roomDisplay: 'Room snapshot', serviceType: null, calculatedTuition: 200, calculatedTeacherFee: 100, notes: null, legacyDeleted: false, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', effectiveRosterSource: 'schedule_override', effectiveRoster: Object.freeze([Object.freeze({ studentId: 'student-1', tuition: 180, teacherFee: 90, attendanceStatus: 3 })]) })]),
      quarantines: Object.freeze([Object.freeze({ scheduleId: 'obsolete-1', outcome: 'USER_DECLARED_OBSOLETE_LEGACY_SCHEDULE' })]),
    }),
  });
}

const result = buildCloudBusinessImportSql(coreSource());
assert.strictEqual(result.relationCounts.schedules, 1);
assert.strictEqual(result.relationCounts.schedule_student_overrides, 1);
assert.strictEqual(result.quarantinedScheduleCount, 1);
assert.match(result.sql, /CREATE SCHEMA business AUTHORIZATION vnext_pg17_business_owner/);
assert.match(result.sql, /GRANT CREATE ON DATABASE gewu_cloud TO vnext_pg17_business_owner/);
assert.match(result.sql, /REVOKE CREATE ON DATABASE gewu_cloud FROM vnext_pg17_business_owner/);
assert.match(result.sql, /INSERT INTO business\.teachers/);
assert.match(result.sql, /INSERT INTO business\.course_student_pricings/);
assert.match(result.sql, /INSERT INTO business\.schedules/);
assert.match(result.sql, /INSERT INTO business\.schedule_student_overrides/);
assert.doesNotMatch(result.sql, /obsolete-1/);
assert.ok(result.sql.indexOf('INSERT INTO business.tenants') < result.sql.indexOf('INSERT INTO business.teachers'));
assert.ok(result.sql.indexOf('INSERT INTO business.teachers') < result.sql.indexOf('INSERT INTO business.courses'));
assert.ok(result.sql.indexOf('INSERT INTO business.courses') < result.sql.indexOf('INSERT INTO business.schedules'));

console.log('cloud business import tests passed');
