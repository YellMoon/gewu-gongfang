'use strict';

const assert = require('assert');
const { createHash } = require('crypto');
const {
  createBusinessFoundationShadowAdmissionBoundary,
  validateBusinessFoundationShadowAdmissionFixture,
} = require('./businessFoundationShadowAdmission');
const {
  createDisposablePg17Runtime,
  createVNextPg17BusinessFoundationShadowAdmissionTrace,
  armVNextPg17BusinessFoundationShadowAdmissionTrace,
  inspectVNextPg17BusinessFoundationShadowAdmissionTrace,
  createVNextPg17BusinessFoundationShadowAdmissionFaultPlan,
  armVNextPg17BusinessFoundationShadowAdmissionFaultPlan,
  withVNextPg17SyntheticQuery,
} = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('./businessFoundationCatalogAssertion');
const { createBusinessFoundationAdmissionCatalogBoundary } = require('./businessFoundationAdmissionCatalog');
const { APPROVED_OBSOLETE_SCHEDULES_SOURCE_INVENTORY_SHA256, APPROVED_OBSOLETE_SCHEDULE_IDS } = require('./coreSchedulingLegacyExceptionManifest');

assert.strictEqual(typeof createBusinessFoundationShadowAdmissionBoundary, 'function');

const BATCH_HASHES = Object.freeze({
  sourceSnapshotSha256: '1'.repeat(64),
  sourceInventoryBeforeSha256: '2'.repeat(64),
  // The admission contract requires a stable source inventory before and after the read.
  sourceInventoryAfterSha256: '2'.repeat(64),
  sourceCatalogSha256: '4'.repeat(64),
  sourceContractSha256: '5'.repeat(64),
  sourceSchemaSha256: '6'.repeat(64),
  businessManifestSha256: '7'.repeat(64),
  mapperSetSha256: '8'.repeat(64),
  consentSha256: '9'.repeat(64),
  shadowTargetIdentitySha256: 'a'.repeat(64),
});
const BATCH_FIELD_ORDER = [
  'batchId', 'sourceSnapshotSha256', 'sourceInventoryBeforeSha256', 'sourceInventoryAfterSha256',
  'sourceCatalogSha256', 'sourceContractSha256', 'sourceSchemaSha256', 'businessManifestSha256',
  'mapperSetSha256', 'consentSha256', 'shadowTargetIdentitySha256', 'createdAt', 'batchRequestSha256',
];
const CORE_RELATION_COUNTS = Object.freeze({ tenants: 1, institutions: 1, schools: 1, rooms: 1, teachers: 1, students: 1, courses: 3, course_student_pricings: 2, schedules: 3, schedule_student_overrides: 1 });
const CORE_LEDGER_RELATION_COUNTS = Object.freeze({ tenants: 1, institutions: 1, schools: 1, rooms: 1, teachers: 1, students: 1, courses: 3, schedules: 3 });

function sha256(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }
function stableSha256(value) { return sha256(JSON.stringify(value)); }

const SHADOW_ADMISSION_TRACE = Object.freeze([
  'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
  "SET LOCAL TIME ZONE 'UTC'",
  "SELECT (SELECT COUNT(*)::text FROM business.tenants) AS tenants, (SELECT COUNT(*)::text FROM business.institutions) AS institutions, (SELECT COUNT(*)::text FROM business.schools) AS schools, (SELECT COUNT(*)::text FROM business.rooms) AS rooms, (SELECT COUNT(*)::text FROM business.teachers) AS teachers, (SELECT COUNT(*)::text FROM business.students) AS students, (SELECT COUNT(*)::text FROM business.courses) AS courses, (SELECT COUNT(*)::text FROM business.course_student_pricings) AS course_student_pricings, (SELECT COUNT(*)::text FROM business.schedules) AS schedules, (SELECT COUNT(*)::text FROM business.schedule_student_overrides) AS schedule_student_overrides, (SELECT COUNT(*)::text FROM migration_admission.migration_batches) AS batches, (SELECT COUNT(*)::text FROM migration_admission.migration_batch_events) AS events, (SELECT COUNT(*)::text FROM migration_admission.migration_quarantine) AS quarantine, (SELECT COUNT(*)::text FROM migration_admission.migration_row_ledger) AS ledger",
  'COMMIT',
  'BEGIN',
  "SET LOCAL TIME ZONE 'UTC'",
  "SELECT (SELECT COUNT(*)::text FROM business.tenants) AS tenants, (SELECT COUNT(*)::text FROM business.institutions) AS institutions, (SELECT COUNT(*)::text FROM business.schools) AS schools, (SELECT COUNT(*)::text FROM business.rooms) AS rooms, (SELECT COUNT(*)::text FROM business.teachers) AS teachers, (SELECT COUNT(*)::text FROM business.students) AS students, (SELECT COUNT(*)::text FROM business.courses) AS courses, (SELECT COUNT(*)::text FROM business.course_student_pricings) AS course_student_pricings, (SELECT COUNT(*)::text FROM business.schedules) AS schedules, (SELECT COUNT(*)::text FROM business.schedule_student_overrides) AS schedule_student_overrides, (SELECT COUNT(*)::text FROM migration_admission.migration_batches) AS batches, (SELECT COUNT(*)::text FROM migration_admission.migration_batch_events) AS events, (SELECT COUNT(*)::text FROM migration_admission.migration_quarantine) AS quarantine, (SELECT COUNT(*)::text FROM migration_admission.migration_row_ledger) AS ledger",
  'SET LOCAL ROLE vnext_pg17_migration_admission_owner',
  'INSERT INTO migration_admission.migration_batches (batch_id, source_snapshot_sha256, source_inventory_before_sha256, source_inventory_after_sha256, source_catalog_sha256, source_contract_sha256, source_schema_sha256, business_manifest_sha256, mapper_set_sha256, consent_sha256, shadow_target_identity_sha256, batch_request_sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
  "INSERT INTO migration_admission.migration_batch_events (batch_id, event_sequence, status, event_code, event_sha256, created_at) VALUES ($1, 1, 'prepared', 'PREPARED', $2, $3)",
  "INSERT INTO migration_admission.migration_batch_events (batch_id, event_sequence, status, event_code, event_sha256, created_at) VALUES ($1, 2, 'running', 'RUNNING', $2, $3)",
  'SET LOCAL ROLE NONE',
  'SET LOCAL ROLE vnext_pg17_business_owner',
  'INSERT INTO business.tenants (id, name, legacy_status, legacy_plan, legacy_archive_before, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
  'INSERT INTO business.institutions (id, tenant_id, name, contact_person_legacy, contact_phone_legacy, revenue_share, notes, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
  'INSERT INTO business.schools (id, tenant_id, name, legacy_count, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
  'INSERT INTO business.rooms (id, tenant_id, name, address_legacy, legacy_count, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
  'INSERT INTO business.teachers (id, tenant_id, name, phone_legacy, subject, hourly_rate, notes, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
  'INSERT INTO business.students (id, tenant_id, name, phone_legacy, school_legacy, grade_year, grade_current, legacy_source_type, institution_id, parent_name_legacy, parent_wechat_legacy, student_source_legacy, legacy_balance_hours, legacy_balance_money, notes, legacy_is_institution_student, parent_phone_legacy, parent_phone_normalized_legacy, parent_relation_legacy, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)',
  'INSERT INTO business.courses (id, tenant_id, name, year, semester, display_name, course_type, legacy_source_type, institution_id, price_tuition, price_teacher, billing_unit, teacher_fee_mode, legacy_room_id, room_name_snapshot, teacher_id, teacher_name_snapshot, legacy_active, default_duration_minutes, notes, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)',
  'INSERT INTO business.courses (id, tenant_id, name, year, semester, display_name, course_type, legacy_source_type, institution_id, price_tuition, price_teacher, billing_unit, teacher_fee_mode, legacy_room_id, room_name_snapshot, teacher_id, teacher_name_snapshot, legacy_active, default_duration_minutes, notes, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)',
  'INSERT INTO business.courses (id, tenant_id, name, year, semester, display_name, course_type, legacy_source_type, institution_id, price_tuition, price_teacher, billing_unit, teacher_fee_mode, legacy_room_id, room_name_snapshot, teacher_id, teacher_name_snapshot, legacy_active, default_duration_minutes, notes, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)',
  'INSERT INTO business.course_student_pricings (tenant_id, course_id, student_id, tuition, teacher_fee) VALUES ($1, $2, $3, $4, $5)',
  'INSERT INTO business.course_student_pricings (tenant_id, course_id, student_id, tuition, teacher_fee) VALUES ($1, $2, $3, $4, $5)',
  'INSERT INTO business.schedules (id, tenant_id, course_id, start_at, end_at, recurring_rule_json, status, room_display_snapshot, service_type, calculated_tuition, calculated_teacher_fee, notes, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)',
  'INSERT INTO business.schedules (id, tenant_id, course_id, start_at, end_at, recurring_rule_json, status, room_display_snapshot, service_type, calculated_tuition, calculated_teacher_fee, notes, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)',
  'INSERT INTO business.schedules (id, tenant_id, course_id, start_at, end_at, recurring_rule_json, status, room_display_snapshot, service_type, calculated_tuition, calculated_teacher_fee, notes, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)',
  'INSERT INTO business.schedule_student_overrides (tenant_id, schedule_id, student_id, attendance_status, tuition, teacher_fee) VALUES ($1, $2, $3, $4, $5, $6)',
  'SET LOCAL ROLE NONE',
  'SET LOCAL ROLE vnext_pg17_migration_admission_owner',
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', 'ADMITTED', $7)",
  'COMMIT',
]);
const QUARANTINED_LEDGER_INSERT = "INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, NULL, NULL, 'quarantined', $5, $6)";
const QUARANTINE_INSERT = 'INSERT INTO migration_admission.migration_quarantine (batch_id, source_relation, source_primary_key_sha256, reason_code, sealed_artifact_reference_sha256, created_at) VALUES ($1, $2, $3, $4, NULL, $5)';
const QUARANTINE_ADMISSION_SQL = new Set([...SHADOW_ADMISSION_TRACE, QUARANTINED_LEDGER_INSERT, QUARANTINE_INSERT]);

const SHADOW_RECONCILIATION_TRACE = Object.freeze([
  'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
  "SET LOCAL TIME ZONE 'UTC'",
  'SELECT batch_id FROM migration_admission.migration_batches WHERE batch_id = $1',
  'SELECT source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code FROM migration_admission.migration_row_ledger WHERE batch_id = $1 ORDER BY source_relation, source_primary_key_sha256',
  'SELECT id, name, legacy_status AS "legacyStatus", legacy_plan AS "legacyPlan", to_char(legacy_archive_before AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "legacyArchiveBefore", legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.tenants ORDER BY id',
  'SELECT id, tenant_id AS "tenantId", name, contact_person_legacy AS "contactPersonLegacy", contact_phone_legacy AS "contactPhoneLegacy", revenue_share::float8 AS "revenueShare", notes, legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.institutions ORDER BY id',
  'SELECT id, tenant_id AS "tenantId", name, legacy_count AS "legacyCount", legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.schools ORDER BY id',
  'SELECT id, tenant_id AS "tenantId", name, address_legacy AS "addressLegacy", legacy_count AS "legacyCount", legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.rooms ORDER BY id',
  'SELECT id, tenant_id AS "tenantId", name, phone_legacy AS "phoneLegacy", subject, hourly_rate::float8 AS "hourlyRate", notes, legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.teachers ORDER BY id',
  'SELECT id, tenant_id AS "tenantId", name, phone_legacy AS "phoneLegacy", school_legacy AS "schoolLegacy", grade_year AS "gradeYear", grade_current AS "gradeCurrent", legacy_source_type AS "legacySourceType", institution_id AS "institutionId", parent_name_legacy AS "parentNameLegacy", parent_wechat_legacy AS "parentWechatLegacy", student_source_legacy AS "studentSourceLegacy", legacy_balance_hours::float8 AS "legacyBalanceHours", legacy_balance_money::float8 AS "legacyBalanceMoney", notes, legacy_is_institution_student AS "legacyIsInstitutionStudent", parent_phone_legacy AS "parentPhoneLegacy", parent_phone_normalized_legacy AS "parentPhoneNormalizedLegacy", parent_relation_legacy AS "parentRelationLegacy", legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.students ORDER BY id',
  'SELECT c.id, c.tenant_id AS "tenantId", c.name, c.year, c.semester, c.display_name AS "displayName", c.course_type AS "courseType", c.legacy_source_type AS "legacySourceType", c.institution_id AS "institutionId", c.price_tuition::float8 AS "priceTuition", c.price_teacher::float8 AS "priceTeacher", c.billing_unit AS "billingUnit", c.teacher_fee_mode AS "teacherFeeMode", c.legacy_room_id AS "legacyRoomId", c.room_name_snapshot AS "roomNameSnapshot", c.teacher_id AS "teacherId", c.teacher_name_snapshot AS "teacherNameSnapshot", c.legacy_active AS "legacyActive", c.default_duration_minutes AS "defaultDurationMinutes", c.notes, c.legacy_deleted AS "legacyDeleted", to_char(c.created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(c.updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt", COALESCE((SELECT json_agg(json_build_object(\'studentId\', p.student_id, \'tuition\', p.tuition::float8, \'teacherFee\', p.teacher_fee::float8, \'attendanceStatus\', 1) ORDER BY p.student_id) FROM business.course_student_pricings p WHERE p.tenant_id = c.tenant_id AND p.course_id = c.id), \'[]\'::json) AS "defaultRoster" FROM business.courses c ORDER BY c.id',
  'SELECT s.id, s.tenant_id AS "tenantId", s.course_id AS "courseId", to_char(s.start_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "startAt", to_char(s.end_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "endAt", s.recurring_rule_json AS "recurringRule", s.status, s.room_display_snapshot AS "roomDisplay", s.service_type AS "serviceType", s.calculated_tuition::float8 AS "calculatedTuition", s.calculated_teacher_fee::float8 AS "calculatedTeacherFee", s.notes, s.legacy_deleted AS "legacyDeleted", to_char(s.created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(s.updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt", CASE WHEN EXISTS (SELECT 1 FROM business.schedule_student_overrides o WHERE o.tenant_id = s.tenant_id AND o.schedule_id = s.id) THEN \'schedule_override\' WHEN EXISTS (SELECT 1 FROM business.course_student_pricings p WHERE p.tenant_id = s.tenant_id AND p.course_id = s.course_id) THEN \'course_default\' ELSE \'none\' END AS "effectiveRosterSource", COALESCE((SELECT json_agg(json_build_object(\'studentId\', o.student_id, \'tuition\', o.tuition::float8, \'teacherFee\', o.teacher_fee::float8, \'attendanceStatus\', o.attendance_status) ORDER BY o.student_id) FROM business.schedule_student_overrides o WHERE o.tenant_id = s.tenant_id AND o.schedule_id = s.id), (SELECT json_agg(json_build_object(\'studentId\', p.student_id, \'tuition\', p.tuition::float8, \'teacherFee\', p.teacher_fee::float8, \'attendanceStatus\', 1) ORDER BY p.student_id) FROM business.course_student_pricings p WHERE p.tenant_id = s.tenant_id AND p.course_id = s.course_id), \'[]\'::json) AS "effectiveRoster" FROM business.schedules s ORDER BY s.id',
  'COMMIT',
]);

function batch() {
  const value = {
    batchId: 'synthetic-foundation-batch-1',
    ...BATCH_HASHES,
    createdAt: '2026-08-21T00:00:00.000Z',
  };
  const canonical = {};
  for (const key of BATCH_FIELD_ORDER) if (key !== 'batchRequestSha256') canonical[key] = value[key];
  value.batchRequestSha256 = sha256(JSON.stringify(canonical));
  return value;
}

function fixture() {
  return {
    batch: batch(),
    tenants: [{ id: 'tenant-synthetic-1', name: 'Synthetic Tenant', legacyStatus: 'active', legacyPlan: null, legacyArchiveBefore: null, legacyDeleted: false, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' }],
    institutions: [{ id: 'institution-synthetic-1', tenantId: 'tenant-synthetic-1', name: 'Synthetic Institution', contactPersonLegacy: null, contactPhoneLegacy: null, revenueShare: null, notes: null, legacyDeleted: false, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' }],
    schools: [{ id: 'school-synthetic-1', tenantId: 'tenant-synthetic-1', name: 'Synthetic School', legacyCount: null, legacyDeleted: false, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' }],
    rooms: [{ id: 'room-synthetic-1', tenantId: 'tenant-synthetic-1', name: 'Synthetic Room', addressLegacy: null, legacyCount: null, legacyDeleted: false, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' }],
    coreScheduling: coreScheduling(),
  };
}

function coreScheduling() {
  const common = { tenant_id: 'tenant-synthetic-1', deleted: 0, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z' };
  const defaultPricing = JSON.stringify([{ student_id: 'student-synthetic-1', tuition: 120, teacher_fee: 60 }]);
  const overridePricing = JSON.stringify([{ student_id: 'student-synthetic-1', tuition: 150, teacher_fee: 80, status: 1 }]);
  const schedule = (id, courseId, startTime, studentPricings) => ({
    ...common, id, course_id: courseId, start_time: startTime, end_time: `${startTime.slice(0, 10)} 11:00`, recurring_rule: null, status: 1, room: 'Synthetic Room', service_type: 1,
    student_ids: studentPricings === '[]' ? '[]' : JSON.stringify(['student-synthetic-1']), student_pricings: studentPricings,
    calculated_tuition: studentPricings === '[]' ? 0 : 120, calculated_teacher_fee: studentPricings === '[]' ? 0 : 60, notes: null,
  });
  return {
    sourceInventorySha256: 'b'.repeat(64),
    teachers: [{ ...common, id: 'teacher-synthetic-1', name: 'Synthetic Teacher', phone: null, subject: null, hourly_rate: 60, notes: null }],
    students: [{ ...common, id: 'student-synthetic-1', name: 'Synthetic Student', phone: null, school: null, grade_year: null, grade_current: null, source_type: null, institution_id: 'institution-synthetic-1', parent_name: null, parent_wechat: null, student_source: null, balance_hours: null, balance_money: null, notes: null, is_institution_student: 0, parent_phone: null, parent_phone_normalized: null, parent_relation: null }],
    courses: [
      { ...common, id: 'course-override-1', name: 'Override Course', year: null, semester: null, display_name: 'Override Course', type: 1, source_type: 1, institution_id: 'institution-synthetic-1', price_tuition: 120, price_teacher: 60, billing_unit: 1, teacher_fee_mode: 1, student_pricings: defaultPricing, room_id: 'missing-legacy-room', room_name: 'Legacy room snapshot', teacher_id: 'teacher-synthetic-1', teacher_name: 'Synthetic Teacher', active: 1, default_duration_minutes: 60, notes: null },
      { ...common, id: 'course-default-1', name: 'Default Course', year: null, semester: null, display_name: 'Default Course', type: 1, source_type: 1, institution_id: 'institution-synthetic-1', price_tuition: 120, price_teacher: 60, billing_unit: 1, teacher_fee_mode: 1, student_pricings: defaultPricing, room_id: null, room_name: null, teacher_id: 'teacher-synthetic-1', teacher_name: 'Synthetic Teacher', active: 1, default_duration_minutes: 60, notes: null },
      { ...common, id: 'course-none-1', name: 'No Roster Course', year: null, semester: null, display_name: 'No Roster Course', type: 1, source_type: 1, institution_id: 'institution-synthetic-1', price_tuition: 0, price_teacher: 0, billing_unit: 1, teacher_fee_mode: 1, student_pricings: '[]', room_id: null, room_name: null, teacher_id: 'teacher-synthetic-1', teacher_name: 'Synthetic Teacher', active: 1, default_duration_minutes: 60, notes: null },
    ],
    schedules: [
      schedule('schedule-override-1', 'course-override-1', '2026-08-21 10:00', overridePricing),
      schedule('schedule-default-1', 'course-default-1', '2026-08-22 10:00', '[]'),
      schedule('schedule-none-1', 'course-none-1', '2026-08-23 10:00', '[]'),
    ],
  };
}

function fixtureWithLegacySentinels(count = 18) {
  const value = fixture();
  for (let index = 1; index <= count; index += 1) {
    value.coreScheduling.schedules.push({
      ...value.coreScheduling.schedules[2], id: `schedule-obsolete-${String(index).padStart(2, '0')}`,
      student_ids: JSON.stringify(['__institution_unbound__']),
      student_pricings: JSON.stringify([{ student_id: '__institution_unbound__', tuition: 0, teacher_fee: 0, status: 1 }]),
    });
  }
  return value;
}

function fixtureWithApprovedLegacySentinels() {
  const value = fixtureWithLegacySentinels();
  value.coreScheduling.sourceInventorySha256 = APPROVED_OBSOLETE_SCHEDULES_SOURCE_INVENTORY_SHA256;
  value.coreScheduling.schedules.slice(3).forEach((row, index) => { row.id = APPROVED_OBSOLETE_SCHEDULE_IDS[index]; });
  return value;
}

function fixtureWithUnsortedRosters() {
  const value = fixture();
  const secondStudent = { ...value.coreScheduling.students[0], id: 'student-synthetic-2', name: 'Synthetic Student 2' };
  value.coreScheduling.students.push(secondStudent);
  const defaultRoster = JSON.stringify([
    { student_id: secondStudent.id, tuition: 120, teacher_fee: 60 },
    { student_id: 'student-synthetic-1', tuition: 100, teacher_fee: 50 },
  ]);
  const overrideRoster = JSON.stringify([
    { student_id: secondStudent.id, tuition: 150, teacher_fee: 80, status: 3 },
    { student_id: 'student-synthetic-1', tuition: 120, teacher_fee: 60, status: 1 },
  ]);
  value.coreScheduling.courses[1].student_pricings = defaultRoster;
  value.coreScheduling.schedules[0].student_ids = JSON.stringify([secondStudent.id, 'student-synthetic-1']);
  value.coreScheduling.schedules[0].student_pricings = overrideRoster;
  value.coreScheduling.schedules[1].student_ids = JSON.stringify([secondStudent.id, 'student-synthetic-1']);
  return value;
}

const accepted = validateBusinessFoundationShadowAdmissionFixture(fixture());
assert.ok(Object.isFrozen(accepted));
assert.strictEqual(accepted.tenants[0].id, 'tenant-synthetic-1');
assert.deepStrictEqual(accepted.coreScheduling.schedules.map(row => row.effectiveRosterSource), ['schedule_override', 'course_default', 'none']);
const quarantinedSentinels = validateBusinessFoundationShadowAdmissionFixture(fixtureWithLegacySentinels());
assert.strictEqual(quarantinedSentinels.coreScheduling.schedules.length, 3);
assert.strictEqual(quarantinedSentinels.coreScheduling.quarantines.length, 18);
assert.ok(quarantinedSentinels.coreScheduling.quarantines.every(row => row.outcome === 'LEGACY_COPY_UNBOUND_PARTICIPANT'));
const approvedSentinels = validateBusinessFoundationShadowAdmissionFixture(fixtureWithApprovedLegacySentinels());
assert.ok(approvedSentinels.coreScheduling.quarantines.every(row => row.outcome === 'USER_DECLARED_OBSOLETE_LEGACY_SCHEDULE'));
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture({ ...fixture(), unexpected: true }), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture({ ...fixture(), tenants: new Proxy([], {}) }), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
const missingParent = fixture();
missingParent.rooms[0].tenantId = 'missing-tenant';
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture(missingParent), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
const extraTenantField = fixture();
extraTenantField.tenants[0].unapproved = 'no';
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture(extraTenantField), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
const timestampDrift = fixture();
timestampDrift.schools[0].updatedAt = '2026-08-19T00:00:00.000Z';
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture(timestampDrift), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
class SyntheticArray extends Array {}
const subclassArray = fixture();
subclassArray.rooms = new SyntheticArray(...subclassArray.rooms);
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture(subclassArray), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
const overflowCount = fixture();
overflowCount.rooms[0].legacyCount = 2147483648;
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture(overflowCount), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
const underflowCount = fixture();
underflowCount.schools[0].legacyCount = -2147483649;
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture(underflowCount), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
const emptyFoundation = fixture();
emptyFoundation.tenants = [];
emptyFoundation.institutions = [];
emptyFoundation.schools = [];
emptyFoundation.rooms = [];
assert.throws(() => validateBusinessFoundationShadowAdmissionFixture(emptyFoundation), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');

const boundary = createBusinessFoundationShadowAdmissionBoundary(Object.freeze({}));
assert.strictEqual(typeof boundary.admit, 'function');
assert.rejects(() => boundary.admit(Object.freeze({}), fixture()), error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID');

async function runBusinessFoundationShadowAdmissionCases(runtime) {
  const controlCatalog = createVNextPg17CatalogBoundary(runtime);
  const businessCatalog = createBusinessFoundationCatalogBoundary(runtime);
  const admissionCatalog = createBusinessFoundationAdmissionCatalogBoundary(runtime);
  const boundary = createBusinessFoundationShadowAdmissionBoundary(runtime);
  let handle = await runtime.createIsolatedHandle();
  try {
    await controlCatalog.apply(handle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await businessCatalog.apply(handle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await admissionCatalog.apply(handle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await assert.rejects(() => boundary.admit(handle, emptyFoundation), error => error && error.code === 'VNEXT_PG17_ADMISSION_INPUT_INVALID');
    assert.deepStrictEqual(
      (await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query("SELECT (SELECT COUNT(*)::text FROM business.tenants) AS tenants, (SELECT COUNT(*)::text FROM migration_admission.migration_batches) AS batches, (SELECT COUNT(*)::text FROM migration_admission.migration_row_ledger) AS ledger"))).rows,
      [{ tenants: '0', batches: '0', ledger: '0' }],
    );
    const input = fixture();
    const trace = createVNextPg17BusinessFoundationShadowAdmissionTrace(runtime, handle);
    armVNextPg17BusinessFoundationShadowAdmissionTrace(trace);
    assert.deepStrictEqual(await boundary.admit(handle, input), { admitted: true, relationCounts: CORE_RELATION_COUNTS });
    const traceQueries = inspectVNextPg17BusinessFoundationShadowAdmissionTrace(trace).queries;
    assert.deepStrictEqual(traceQueries, SHADOW_ADMISSION_TRACE);
    assert.ok(traceQueries.every(query => !query.includes(';') && !/vnext_control_plane|\b(?:CREATE|ALTER|DROP|GRANT|REVOKE|DELETE|UPDATE|TRUNCATE|CALL|COPY)\b/iu.test(query)));
    const target = await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query("SELECT (SELECT COUNT(*)::text FROM business.tenants) AS tenants, (SELECT COUNT(*)::text FROM business.institutions) AS institutions, (SELECT COUNT(*)::text FROM business.schools) AS schools, (SELECT COUNT(*)::text FROM business.rooms) AS rooms, (SELECT COUNT(*)::text FROM business.teachers) AS teachers, (SELECT COUNT(*)::text FROM business.students) AS students, (SELECT COUNT(*)::text FROM business.courses) AS courses, (SELECT COUNT(*)::text FROM business.course_student_pricings) AS course_pricings, (SELECT COUNT(*)::text FROM business.schedules) AS schedules, (SELECT COUNT(*)::text FROM business.schedule_student_overrides) AS schedule_overrides, (SELECT COUNT(*)::text FROM migration_admission.migration_batches) AS batches, (SELECT COUNT(*)::text FROM migration_admission.migration_batch_events) AS events, (SELECT COUNT(*)::text FROM migration_admission.migration_quarantine) AS quarantine, (SELECT COUNT(*)::text FROM migration_admission.migration_row_ledger) AS ledger"));
    assert.deepStrictEqual(target.rows, [{ tenants: '1', institutions: '1', schools: '1', rooms: '1', teachers: '1', students: '1', courses: '3', course_pricings: '2', schedules: '3', schedule_overrides: '1', batches: '1', events: '2', quarantine: '0', ledger: '12' }]);
    const persisted = await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query("SELECT b.batch_id, b.source_snapshot_sha256, b.source_inventory_before_sha256, b.source_inventory_after_sha256, b.source_catalog_sha256, b.source_contract_sha256, b.source_schema_sha256, b.business_manifest_sha256, b.mapper_set_sha256, b.consent_sha256, b.shadow_target_identity_sha256, b.batch_request_sha256, b.created_at::text, e.event_sequence::text, e.status, e.event_code, e.event_sha256, l.source_relation, l.source_primary_key_sha256, l.canonical_source_sha256, l.target_id, l.target_logical_sha256, l.outcome, l.outcome_code, l.created_at::text AS ledger_created_at FROM migration_admission.migration_batches b JOIN migration_admission.migration_batch_events e ON e.batch_id = b.batch_id LEFT JOIN migration_admission.migration_row_ledger l ON l.batch_id = b.batch_id ORDER BY e.event_sequence, l.source_relation"));
    const snapshot = validateBusinessFoundationShadowAdmissionFixture(input);
    assert.strictEqual(persisted.rows.filter(row => row.event_sequence === '1').length, 12);
    assert.strictEqual(persisted.rows.filter(row => row.event_sequence === '2').length, 12);
    for (const row of persisted.rows) {
      assert.strictEqual(row.batch_id, snapshot.batch.batchId);
      assert.strictEqual(row.source_snapshot_sha256, snapshot.batch.sourceSnapshotSha256);
      assert.strictEqual(row.source_inventory_before_sha256, snapshot.batch.sourceInventoryBeforeSha256);
      assert.strictEqual(row.source_inventory_after_sha256, snapshot.batch.sourceInventoryAfterSha256);
      assert.strictEqual(row.source_catalog_sha256, snapshot.batch.sourceCatalogSha256);
      assert.strictEqual(row.source_contract_sha256, snapshot.batch.sourceContractSha256);
      assert.strictEqual(row.source_schema_sha256, snapshot.batch.sourceSchemaSha256);
      assert.strictEqual(row.business_manifest_sha256, snapshot.batch.businessManifestSha256);
      assert.strictEqual(row.mapper_set_sha256, snapshot.batch.mapperSetSha256);
      assert.strictEqual(row.consent_sha256, snapshot.batch.consentSha256);
      assert.strictEqual(row.shadow_target_identity_sha256, snapshot.batch.shadowTargetIdentitySha256);
      assert.strictEqual(row.batch_request_sha256, snapshot.batch.batchRequestSha256);
      assert.strictEqual(new Date(row.created_at).toISOString(), snapshot.batch.createdAt);
      assert.strictEqual(new Date(row.ledger_created_at).toISOString(), snapshot.batch.createdAt);
      assert.deepStrictEqual([row.event_sequence, row.status, row.event_code], row.event_sequence === '1' ? ['1', 'prepared', 'PREPARED'] : ['2', 'running', 'RUNNING']);
      assert.strictEqual(row.event_sha256, stableSha256({ batchId: snapshot.batch.batchId, sequence: Number(row.event_sequence), status: row.status, code: row.event_code, createdAt: snapshot.batch.createdAt }));
      const sourceRows = Object.prototype.hasOwnProperty.call(snapshot, row.source_relation)
        ? snapshot[row.source_relation]
        : snapshot.coreScheduling[row.source_relation];
      const sourceRow = sourceRows.find(candidate => candidate.id === row.target_id);
      assert.ok(sourceRow);
      assert.strictEqual(row.source_primary_key_sha256, stableSha256(`${row.source_relation}:${sourceRow.id}`));
      assert.strictEqual(row.canonical_source_sha256, stableSha256(sourceRow));
      assert.match(row.target_logical_sha256, /^[0-9a-f]{64}$/u);
      assert.deepStrictEqual([row.outcome, row.outcome_code], ['admitted', 'ADMITTED']);
    }
    const replayTrace = createVNextPg17BusinessFoundationShadowAdmissionTrace(runtime, handle);
    armVNextPg17BusinessFoundationShadowAdmissionTrace(replayTrace);
    assert.deepStrictEqual(
      await boundary.admit(handle, input),
      { admitted: false, replayed: true, relationCounts: CORE_RELATION_COUNTS },
    );
    const replayQueries = inspectVNextPg17BusinessFoundationShadowAdmissionTrace(replayTrace).queries;
    assert.ok(replayQueries.length > 0 && replayQueries.every(query => !/^INSERT INTO (?:business|migration_admission)\./u.test(query)));
    const changedCanonical = fixture();
    changedCanonical.tenants[0].name = 'Changed canonical tenant';
    await assert.rejects(
      () => boundary.admit(handle, changedCanonical),
      error => error && error.code === 'VNEXT_PG17_ADMISSION_CANONICAL_HASH_CONFLICT',
    );
    const reconciliationTrace = createVNextPg17BusinessFoundationShadowAdmissionTrace(runtime, handle);
    armVNextPg17BusinessFoundationShadowAdmissionTrace(reconciliationTrace);
    assert.deepStrictEqual(
      await boundary.reconcile(handle, { batchId: input.batch.batchId }),
      { reconciled: true, relationCounts: CORE_LEDGER_RELATION_COUNTS },
    );
    assert.deepStrictEqual(inspectVNextPg17BusinessFoundationShadowAdmissionTrace(reconciliationTrace).queries, SHADOW_RECONCILIATION_TRACE);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query("UPDATE business.tenants SET name = 'tampered' WHERE id = 'tenant-synthetic-1'"));
    await assert.rejects(
      () => boundary.admit(handle, input),
      error => error && error.code === 'VNEXT_PG17_ADMISSION_RECONCILIATION_MISMATCH',
    );
    const mismatchTrace = createVNextPg17BusinessFoundationShadowAdmissionTrace(runtime, handle);
    armVNextPg17BusinessFoundationShadowAdmissionTrace(mismatchTrace);
    await assert.rejects(
      () => boundary.reconcile(handle, { batchId: input.batch.batchId }),
      error => error && error.code === 'VNEXT_PG17_ADMISSION_RECONCILIATION_MISMATCH',
    );
    assert.deepStrictEqual(inspectVNextPg17BusinessFoundationShadowAdmissionTrace(mismatchTrace).queries, [
      ...SHADOW_RECONCILIATION_TRACE.slice(0, 5),
      'ROLLBACK',
    ]);
    assert.deepStrictEqual(
      (await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query("SELECT COUNT(*)::text AS count FROM business.tenants"))).rows,
      [{ count: '1' }],
    );
    assert.deepStrictEqual(await boundary.rollbackSyntheticTarget(handle), { destroyed: true });
    await assert.rejects(() => boundary.admit(handle, fixture()), error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID');
    handle = null;
  } finally {
    if (handle) await runtime.disposeHandle(handle);
  }

  const obsoleteHandle = await runtime.createIsolatedHandle();
  try {
    await controlCatalog.apply(obsoleteHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await businessCatalog.apply(obsoleteHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await admissionCatalog.apply(obsoleteHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await boundary.admit(obsoleteHandle, fixtureWithApprovedLegacySentinels());
    const quarantined = await withVNextPg17SyntheticQuery(obsoleteHandle, 'fixture-provisioner', facade => facade.query("SELECT (SELECT COUNT(*)::text FROM business.schedules) AS schedules, (SELECT COUNT(*)::text FROM business.students) AS students, (SELECT COUNT(*)::text FROM migration_admission.migration_row_ledger) AS ledger, (SELECT COUNT(*)::text FROM migration_admission.migration_quarantine) AS quarantine, (SELECT COUNT(*)::text FROM migration_admission.migration_quarantine WHERE reason_code = 'USER_DECLARED_OBSOLETE_LEGACY_SCHEDULE') AS declared_obsolete"));
    assert.deepStrictEqual(quarantined.rows, [{ schedules: '3', students: '1', ledger: '30', quarantine: '18', declared_obsolete: '18' }]);
  } finally {
    await runtime.disposeHandle(obsoleteHandle);
  }

  const unapprovedSentinelHandle = await runtime.createIsolatedHandle();
  try {
    await controlCatalog.apply(unapprovedSentinelHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await businessCatalog.apply(unapprovedSentinelHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await admissionCatalog.apply(unapprovedSentinelHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    const trace = createVNextPg17BusinessFoundationShadowAdmissionTrace(runtime, unapprovedSentinelHandle);
    armVNextPg17BusinessFoundationShadowAdmissionTrace(trace);
    await boundary.admit(unapprovedSentinelHandle, fixtureWithLegacySentinels(1));
    const traceQueries = inspectVNextPg17BusinessFoundationShadowAdmissionTrace(trace).queries;
    assert.ok(traceQueries.includes(QUARANTINED_LEDGER_INSERT));
    assert.ok(traceQueries.includes(QUARANTINE_INSERT));
    assert.ok(traceQueries.every(query => QUARANTINE_ADMISSION_SQL.has(query)));
    const quarantined = await withVNextPg17SyntheticQuery(unapprovedSentinelHandle, 'fixture-provisioner', facade => facade.query("SELECT (SELECT COUNT(*)::text FROM business.schedules) AS schedules, (SELECT COUNT(*)::text FROM business.students) AS students, (SELECT COUNT(*)::text FROM migration_admission.migration_row_ledger) AS ledger, (SELECT COUNT(*)::text FROM migration_admission.migration_quarantine) AS quarantine, (SELECT COUNT(*)::text FROM migration_admission.migration_quarantine WHERE reason_code = 'LEGACY_COPY_UNBOUND_PARTICIPANT') AS generic_sentinel"));
    assert.deepStrictEqual(quarantined.rows, [{ schedules: '3', students: '1', ledger: '13', quarantine: '1', generic_sentinel: '1' }]);
  } finally {
    await runtime.disposeHandle(unapprovedSentinelHandle);
  }

  const unorderedRosterHandle = await runtime.createIsolatedHandle();
  try {
    await controlCatalog.apply(unorderedRosterHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await businessCatalog.apply(unorderedRosterHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await admissionCatalog.apply(unorderedRosterHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    const unordered = fixtureWithUnsortedRosters();
    await boundary.admit(unorderedRosterHandle, unordered);
    assert.deepStrictEqual(
      await boundary.reconcile(unorderedRosterHandle, { batchId: unordered.batch.batchId }),
      { reconciled: true, relationCounts: { tenants: 1, institutions: 1, schools: 1, rooms: 1, teachers: 1, students: 2, courses: 3, schedules: 3 } },
      'logical hashes must be independent of legacy JSON roster order because PostgreSQL re-reads roster rows in canonical student-id order',
    );
  } finally {
    await runtime.disposeHandle(unorderedRosterHandle);
  }

  for (const stages of [['writeCommit'], ['writeFail', 'rollback']]) {
    const faultHandle = await runtime.createIsolatedHandle();
    let peer;
    try {
      await controlCatalog.apply(faultHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
      await businessCatalog.apply(faultHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
      await admissionCatalog.apply(faultHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
      peer = await runtime.createPeerHandle(faultHandle);
      const faultPlan = createVNextPg17BusinessFoundationShadowAdmissionFaultPlan(runtime, faultHandle, stages);
      armVNextPg17BusinessFoundationShadowAdmissionFaultPlan(faultHandle, faultPlan);
      await assert.rejects(
        () => boundary.admit(faultHandle, fixture()),
        error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
      );
      await assert.rejects(() => boundary.admit(peer, fixture()), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => controlCatalog.apply(peer, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' }), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => businessCatalog.apply(peer, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' }), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => admissionCatalog.apply(peer, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' }), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => businessCatalog.assert(peer), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => businessCatalog.assertZeroSeed(peer), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => admissionCatalog.assert(peer), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(() => admissionCatalog.assertZeroSeed(peer), error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE');
      await assert.rejects(
        () => withVNextPg17SyntheticQuery(peer, 'business-verifier', facade => facade.query('SELECT 1')),
        error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
      );
    } finally {
      if (peer) await runtime.disposeHandle(peer);
      await runtime.disposeHandle(faultHandle);
    }
  }

  for (const scenario of ['reconcileCommit', 'reconcileRollback']) {
    const faultHandle = await runtime.createIsolatedHandle();
    let peer;
    try {
      await controlCatalog.apply(faultHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
      await businessCatalog.apply(faultHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
      await admissionCatalog.apply(faultHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
      const input = fixture();
      await boundary.admit(faultHandle, input);
      if (scenario === 'reconcileRollback') {
        await withVNextPg17SyntheticQuery(faultHandle, 'fixture-provisioner', facade => facade.query("UPDATE business.tenants SET name = 'tampered' WHERE id = 'tenant-synthetic-1'"));
      }
      peer = await runtime.createPeerHandle(faultHandle);
      const faultPlan = createVNextPg17BusinessFoundationShadowAdmissionFaultPlan(runtime, faultHandle, [scenario]);
      armVNextPg17BusinessFoundationShadowAdmissionFaultPlan(faultHandle, faultPlan);
      await assert.rejects(
        () => boundary.reconcile(faultHandle, { batchId: input.batch.batchId }),
        error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
      );
      await assert.rejects(
        () => boundary.reconcile(peer, { batchId: input.batch.batchId }),
        error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
      );
      await assert.rejects(
        () => withVNextPg17SyntheticQuery(peer, 'business-verifier', facade => facade.query('SELECT 1')),
        error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
      );
    } finally {
      if (peer) await runtime.disposeHandle(peer);
      await runtime.disposeHandle(faultHandle);
    }
  }

  const rollbackHandle = await runtime.createIsolatedHandle();
  let rollbackPeer;
  try {
    await controlCatalog.apply(rollbackHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await businessCatalog.apply(rollbackHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await admissionCatalog.apply(rollbackHandle, { appliedAt: '2026-08-21T00:00:00.000Z', appliedBy: 'shadow-admission-test' });
    await assert.rejects(() => boundary.rollbackSyntheticTarget(rollbackHandle), error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID');
    await boundary.admit(rollbackHandle, fixture());
    rollbackPeer = await runtime.createPeerHandle(rollbackHandle);
    await assert.rejects(() => boundary.rollbackSyntheticTarget(rollbackPeer), error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID');
    await assert.rejects(() => boundary.rollbackSyntheticTarget(rollbackHandle), error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID');
    assert.deepStrictEqual(
      (await withVNextPg17SyntheticQuery(rollbackHandle, 'fixture-provisioner', facade => facade.query('SELECT COUNT(*)::text AS count FROM business.tenants'))).rows,
      [{ count: '1' }],
    );
    await runtime.disposeHandle(rollbackPeer);
    rollbackPeer = null;
    assert.deepStrictEqual(await boundary.rollbackSyntheticTarget(rollbackHandle), { destroyed: true });
  } finally {
    if (rollbackPeer) await runtime.disposeHandle(rollbackPeer);
    try { await runtime.disposeHandle(rollbackHandle); } catch (error) {
      if (!error || error.code !== 'VNEXT_PG17_HANDLE_INVALID') throw error;
    }
  }
}

if (require.main === module) {
  const runtime = createDisposablePg17Runtime();
  runtime.start()
    .then(() => runBusinessFoundationShadowAdmissionCases(runtime))
    .then(() => runtime.stop())
    .then(() => process.stdout.write('vNext business foundation shadow-admission checks passed\n'))
    .catch(async error => {
      try { await runtime.stop(); } catch (_) { /* retain failure */ }
      process.stderr.write(`${error.name}: ${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { runBusinessFoundationShadowAdmissionCases };
