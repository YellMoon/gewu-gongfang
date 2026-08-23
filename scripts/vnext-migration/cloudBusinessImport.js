'use strict';

const crypto = require('crypto');
const { BUSINESS_FOUNDATION_MIGRATIONS } = require('../../shared/vnext-pg17/businessFoundationManifest');
const { isApprovedObsoleteScheduleSet } = require('../../shared/vnext-pg17/coreSchedulingLegacyExceptionManifest');

function inputInvalid() {
  return Object.assign(new Error('cloud business import input is invalid'), { code: 'VNEXT_CLOUD_BUSINESS_IMPORT_INVALID' });
}

function sqlText(value) {
  if (value === null) return 'NULL';
  if (typeof value !== 'string') throw inputInvalid();
  return `'${value.replace(/'/gu, "''")}'`;
}

function sqlNumber(value) {
  if (value === null) return 'NULL';
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(text)) throw inputInvalid();
  return text;
}

function sqlInteger(value) {
  if (value === null) return 'NULL';
  if (!Number.isSafeInteger(value)) throw inputInvalid();
  return String(value);
}

function sqlBoolean(value) {
  if (typeof value !== 'boolean') throw inputInvalid();
  return value ? 'TRUE' : 'FALSE';
}

function sqlDatabaseIdentifier(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/u.test(value)) throw inputInvalid();
  return `"${value}"`;
}

function insert(relation, fields, values) {
  if (fields.length !== values.length) throw inputInvalid();
  return `INSERT INTO ${relation} (${fields.join(', ')}) VALUES (${values.join(', ')});`;
}

function projectCore(core) {
  if (!core || typeof core !== 'object' || !Array.isArray(core.teachers) || !Array.isArray(core.students) || !Array.isArray(core.courses) || !Array.isArray(core.schedules)) throw inputInvalid();
  return core;
}

function buildCloudBusinessImportSql(source) {
  if (!source || typeof source !== 'object' || !source.foundation || !source.coreScheduling) throw inputInvalid();
  const foundation = source.foundation;
  const core = projectCore(source.coreScheduling);
  const targetDatabase = sqlDatabaseIdentifier(source.targetDatabase || 'gewu_cloud');
  for (const relation of ['tenants', 'institutions', 'schools', 'rooms']) if (!Array.isArray(foundation[relation])) throw inputInvalid();
  const lines = [
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vnext_pg17_business_owner') THEN CREATE ROLE vnext_pg17_business_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vnext_pg17_business_verifier') THEN CREATE ROLE vnext_pg17_business_verifier NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$;",
    'GRANT vnext_pg17_business_owner TO gewu_app;',
    `GRANT CREATE ON DATABASE ${targetDatabase} TO vnext_pg17_business_owner;`,
    'SET LOCAL ROLE vnext_pg17_business_owner;',
  ];
  for (const migration of BUSINESS_FOUNDATION_MIGRATIONS) {
    lines.push(migration.sql);
    lines.push(insert('business.business_schema_migrations', ['migration_id', 'semantic_version', 'manifest_sha256', 'applied_at', 'applied_by'], [sqlText(migration.migrationId), sqlInteger(migration.semanticVersion), sqlText(migration.manifestSha256), 'transaction_timestamp()', sqlText('gewu-cloud-initial-import')]));
  }
  for (const row of foundation.tenants) lines.push(insert('business.tenants', ['id', 'name', 'legacy_status', 'legacy_plan', 'legacy_archive_before', 'legacy_deleted', 'created_at', 'updated_at'], [sqlText(row.id), sqlText(row.name), sqlText(row.legacyStatus), sqlText(row.legacyPlan), sqlText(row.legacyArchiveBefore), sqlBoolean(row.legacyDeleted), sqlText(row.createdAt), sqlText(row.updatedAt)]));
  for (const row of foundation.institutions) lines.push(insert('business.institutions', ['id', 'tenant_id', 'name', 'contact_person_legacy', 'contact_phone_legacy', 'revenue_share', 'notes', 'legacy_deleted', 'created_at', 'updated_at'], [sqlText(row.id), sqlText(row.tenantId), sqlText(row.name), sqlText(row.contactPersonLegacy), sqlText(row.contactPhoneLegacy), sqlNumber(row.revenueShare), sqlText(row.notes), sqlBoolean(row.legacyDeleted), sqlText(row.createdAt), sqlText(row.updatedAt)]));
  for (const row of foundation.schools) lines.push(insert('business.schools', ['id', 'tenant_id', 'name', 'legacy_count', 'legacy_deleted', 'created_at', 'updated_at'], [sqlText(row.id), sqlText(row.tenantId), sqlText(row.name), sqlInteger(row.legacyCount), sqlBoolean(row.legacyDeleted), sqlText(row.createdAt), sqlText(row.updatedAt)]));
  for (const row of foundation.rooms) lines.push(insert('business.rooms', ['id', 'tenant_id', 'name', 'address_legacy', 'legacy_count', 'legacy_deleted', 'created_at', 'updated_at'], [sqlText(row.id), sqlText(row.tenantId), sqlText(row.name), sqlText(row.addressLegacy), sqlInteger(row.legacyCount), sqlBoolean(row.legacyDeleted), sqlText(row.createdAt), sqlText(row.updatedAt)]));
  for (const row of core.teachers) lines.push(insert('business.teachers', ['id', 'tenant_id', 'name', 'phone_legacy', 'subject', 'hourly_rate', 'notes', 'legacy_deleted', 'created_at', 'updated_at'], [sqlText(row.id), sqlText(row.tenant_id), sqlText(row.name), sqlText(row.phone), sqlText(row.subject), sqlNumber(row.hourly_rate), sqlText(row.notes), sqlBoolean(row.deleted === 1), sqlText(row.created_at), sqlText(row.updated_at)]));
  for (const row of core.students) lines.push(insert('business.students', ['id', 'tenant_id', 'name', 'phone_legacy', 'school_legacy', 'grade_year', 'grade_current', 'legacy_source_type', 'institution_id', 'parent_name_legacy', 'parent_wechat_legacy', 'student_source_legacy', 'legacy_balance_hours', 'legacy_balance_money', 'notes', 'legacy_is_institution_student', 'parent_phone_legacy', 'parent_phone_normalized_legacy', 'parent_relation_legacy', 'legacy_deleted', 'created_at', 'updated_at'], [sqlText(row.id), sqlText(row.tenant_id), sqlText(row.name), sqlText(row.phone), sqlText(row.school), sqlInteger(row.grade_year), sqlText(row.grade_current), sqlInteger(row.source_type), sqlText(row.institution_id), sqlText(row.parent_name), sqlText(row.parent_wechat), sqlText(row.student_source), sqlNumber(row.balance_hours), sqlNumber(row.balance_money), sqlText(row.notes), sqlBoolean(row.is_institution_student === 1), sqlText(row.parent_phone), sqlText(row.parent_phone_normalized), sqlText(row.parent_relation), sqlBoolean(row.deleted === 1), sqlText(row.created_at), sqlText(row.updated_at)]));
  for (const row of core.courses) lines.push(insert('business.courses', ['id', 'tenant_id', 'name', 'year', 'semester', 'display_name', 'course_type', 'legacy_source_type', 'institution_id', 'price_tuition', 'price_teacher', 'billing_unit', 'teacher_fee_mode', 'legacy_room_id', 'room_name_snapshot', 'teacher_id', 'teacher_name_snapshot', 'legacy_active', 'default_duration_minutes', 'notes', 'legacy_deleted', 'created_at', 'updated_at'], [sqlText(row.id), sqlText(row.tenant_id), sqlText(row.name), sqlInteger(row.year), sqlText(row.semester), sqlText(row.display_name), sqlInteger(row.type), sqlInteger(row.source_type), sqlText(row.institution_id), sqlNumber(row.price_tuition), sqlNumber(row.price_teacher), sqlInteger(row.billing_unit), sqlInteger(row.teacher_fee_mode), sqlText(row.room_id), sqlText(row.room_name), sqlText(row.teacher_id), sqlText(row.teacher_name), sqlBoolean(row.active === 1), sqlInteger(row.default_duration_minutes), sqlText(row.notes), sqlBoolean(row.deleted === 1), sqlText(row.created_at), sqlText(row.updated_at)]));
  for (const row of core.courses) for (const pricing of row.defaultRoster || []) lines.push(insert('business.course_student_pricings', ['tenant_id', 'course_id', 'student_id', 'tuition', 'teacher_fee'], [sqlText(row.tenant_id), sqlText(row.id), sqlText(pricing.studentId), sqlNumber(pricing.tuition), sqlNumber(pricing.teacherFee)]));
  for (const row of core.schedules) lines.push(insert('business.schedules', ['id', 'tenant_id', 'course_id', 'start_at', 'end_at', 'recurring_rule_json', 'status', 'room_display_snapshot', 'service_type', 'calculated_tuition', 'calculated_teacher_fee', 'notes', 'legacy_deleted', 'created_at', 'updated_at'], [sqlText(row.id), sqlText(row.tenantId), sqlText(row.courseId), sqlText(row.startAt), sqlText(row.endAt), sqlText(row.recurringRule), sqlInteger(row.status), sqlText(row.roomDisplay), sqlInteger(row.serviceType), sqlNumber(row.calculatedTuition), sqlNumber(row.calculatedTeacherFee), sqlText(row.notes), sqlBoolean(row.legacyDeleted), sqlText(row.createdAt), sqlText(row.updatedAt)]));
  for (const row of core.schedules) if (row.effectiveRosterSource === 'schedule_override') for (const pricing of row.effectiveRoster || []) lines.push(insert('business.schedule_student_overrides', ['tenant_id', 'schedule_id', 'student_id', 'attendance_status', 'tuition', 'teacher_fee'], [sqlText(row.tenantId), sqlText(row.id), sqlText(pricing.studentId), sqlInteger(pricing.attendanceStatus), sqlNumber(pricing.tuition), sqlNumber(pricing.teacherFee)]));
  lines.push('RESET ROLE;');
  lines.push(`REVOKE CREATE ON DATABASE ${targetDatabase} FROM vnext_pg17_business_owner;`);
  lines.push('REVOKE vnext_pg17_business_owner FROM gewu_app;');
  lines.push('COMMIT;');
  const relationCounts = Object.freeze({
    tenants: foundation.tenants.length, institutions: foundation.institutions.length, schools: foundation.schools.length, rooms: foundation.rooms.length,
    teachers: core.teachers.length, students: core.students.length, courses: core.courses.length,
    course_student_pricings: core.courses.reduce((count, row) => count + (row.defaultRoster || []).length, 0), schedules: core.schedules.length,
    schedule_student_overrides: core.schedules.reduce((count, row) => count + (row.effectiveRosterSource === 'schedule_override' ? (row.effectiveRoster || []).length : 0), 0),
  });
  return Object.freeze({ sql: `${lines.join('\n')}\n`, relationCounts, quarantinedScheduleCount: Array.isArray(core.quarantines) ? core.quarantines.length : 0, sourceSnapshotSha256: source.sourceSnapshotSha256, sourceInventorySha256: source.sourceInventorySha256, sourceSchemaSha256: source.sourceSchemaSha256 });
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hash(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) throw inputInvalid();
  return value;
}

function instant(value) {
  if (typeof value !== 'string' || new Date(value).toISOString() !== value) throw inputInvalid();
  return value;
}

function text(value, code = 'VNEXT_CLOUD_BUSINESS_IMPORT_INVALID') {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > 512) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return value;
}

function buildBusinessShadowImportPlan({ source, shadowTargetIdentity, consentSha256, createdAt } = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw inputInvalid();
  const sourceSnapshotSha256 = hash(source.sourceSnapshotSha256);
  const sourceInventorySha256 = hash(source.sourceInventorySha256);
  const sourceSchemaSha256 = hash(source.sourceSchemaSha256);
  const target = text(shadowTargetIdentity);
  const consent = hash(consentSha256);
  const timestamp = instant(createdAt);
  const core = projectCore(source.coreScheduling);
  const quarantineIds = Array.isArray(core.quarantines) ? core.quarantines.map(row => String(row?.scheduleId || '')) : [];
  const approvedObsoleteSet = isApprovedObsoleteScheduleSet(core.sourceInventorySha256, quarantineIds);
  const normalizedCore = approvedObsoleteSet
    ? { ...core, quarantines: core.quarantines.map(row => ({ ...row, outcome: 'USER_DECLARED_OBSOLETE_LEGACY_SCHEDULE' })) }
    : core;
  const importResult = buildCloudBusinessImportSql({
    sourceSnapshotSha256,
    sourceInventorySha256,
    sourceSchemaSha256,
    targetDatabase: target,
    foundation: source.foundation,
    coreScheduling: normalizedCore,
  });
  const batchId = `business-shadow-${sourceSnapshotSha256.slice(0, 16)}`;
  return Object.freeze({
    batchId,
    createdAt: timestamp,
    consentSha256: consent,
    shadowTargetIdentity: target,
    sourceSnapshotSha256,
    sourceInventorySha256,
    sourceSchemaSha256,
    relationCounts: importResult.relationCounts,
    quarantinedScheduleCount: importResult.quarantinedScheduleCount,
    quarantines: Object.freeze((normalizedCore.quarantines || []).map(row => Object.freeze({
      scheduleId: String(row.scheduleId), outcome: String(row.outcome),
    }))),
    excludedRelations: Object.freeze([
      'questions', 'question_assets', 'question_contents', 'import_batches', 'import_items',
    ]),
    sql: importResult.sql,
    planSha256: sha256(JSON.stringify({
      batchId, consentSha256: consent, createdAt: timestamp, shadowTargetIdentity: target,
      sourceSnapshotSha256, sourceInventorySha256, sourceSchemaSha256,
      relationCounts: importResult.relationCounts, quarantinedScheduleCount: importResult.quarantinedScheduleCount,
    })),
  });
}

module.exports = Object.freeze({ buildCloudBusinessImportSql, buildBusinessShadowImportPlan });
