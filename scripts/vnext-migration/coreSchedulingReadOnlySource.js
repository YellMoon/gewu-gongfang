'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { types } = require('util');
const Database = require('better-sqlite3');
const { normalizeCoreSchedulingSource } = require('../../shared/vnext-pg17/coreSchedulingSourceContract');

const CORE_SOURCE_ERROR = 'VNEXT_CORE_SCHEDULING_SOURCE_INVALID';
const SOURCE_RELATIONS = Object.freeze(['tenants', 'institutions', 'schools', 'rooms', 'teachers', 'students', 'courses', 'schedules']);
const SOURCE_COLUMNS = Object.freeze({
  tenants: Object.freeze(['id', 'name', 'status', 'plan', 'archive_before', 'deleted', 'created_at', 'updated_at']),
  institutions: Object.freeze(['id', 'tenant_id', 'name', 'contact_person', 'contact_phone', 'revenue_share', 'notes', 'deleted', 'created_at', 'updated_at']),
  schools: Object.freeze(['id', 'tenant_id', 'name', 'count', 'deleted', 'created_at', 'updated_at']),
  rooms: Object.freeze(['id', 'tenant_id', 'name', 'address', 'count', 'deleted', 'created_at', 'updated_at']),
  teachers: Object.freeze(['id', 'tenant_id', 'name', 'phone', 'subject', 'hourly_rate', 'notes', 'deleted', 'created_at', 'updated_at']),
  students: Object.freeze(['id', 'tenant_id', 'name', 'phone', 'school', 'grade_year', 'grade_current', 'source_type', 'institution_id', 'parent_name', 'parent_wechat', 'student_source', 'balance_hours', 'balance_money', 'notes', 'deleted', 'created_at', 'updated_at', 'is_institution_student', 'parent_phone', 'parent_phone_normalized', 'parent_relation']),
  courses: Object.freeze(['id', 'tenant_id', 'name', 'year', 'semester', 'display_name', 'type', 'source_type', 'institution_id', 'price_tuition', 'price_teacher', 'billing_unit', 'teacher_fee_mode', 'student_pricings', 'room_id', 'room_name', 'teacher_id', 'teacher_name', 'active', 'default_duration_minutes', 'notes', 'deleted', 'created_at', 'updated_at']),
  schedules: Object.freeze(['id', 'tenant_id', 'course_id', 'start_time', 'end_time', 'recurring_rule', 'status', 'room', 'service_type', 'student_ids', 'student_pricings', 'calculated_tuition', 'calculated_teacher_fee', 'notes', 'deleted', 'created_at', 'updated_at']),
});

function sourceInvalid() {
  return Object.assign(new Error('vNext core scheduling source is invalid'), { code: CORE_SOURCE_ERROR });
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256File(target) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(target, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function exactConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw sourceInvalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || keys.some(key => key !== 'sourceRoot' && key !== 'sourcePath')) throw sourceInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const field of ['sourceRoot', 'sourcePath']) {
    if (!descriptors[field] || !descriptors[field].enumerable || !Object.prototype.hasOwnProperty.call(descriptors[field], 'value') || typeof descriptors[field].value !== 'string') throw sourceInvalid();
  }
  return { sourceRoot: descriptors.sourceRoot.value, sourcePath: descriptors.sourcePath.value };
}

function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

function stableRows(rows) {
  return rows.map(row => Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])));
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.keys(value).map(key => [key, freeze(value[key])] )));
  return value;
}

function numberOrNull(value) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw sourceInvalid();
  return value;
}

function foundation(rows) {
  return {
    tenants: rows.tenants.map(row => ({ id: row.id, name: row.name, legacyStatus: row.status, legacyPlan: row.plan, legacyArchiveBefore: row.archive_before, legacyDeleted: row.deleted === 1, createdAt: row.created_at, updatedAt: row.updated_at })),
    institutions: rows.institutions.map(row => ({ id: row.id, tenantId: row.tenant_id, name: row.name, contactPersonLegacy: row.contact_person, contactPhoneLegacy: row.contact_phone, revenueShare: numberOrNull(row.revenue_share), notes: row.notes, legacyDeleted: row.deleted === 1, createdAt: row.created_at, updatedAt: row.updated_at })),
    schools: rows.schools.map(row => ({ id: row.id, tenantId: row.tenant_id, name: row.name, legacyCount: numberOrNull(row.count), legacyDeleted: row.deleted === 1, createdAt: row.created_at, updatedAt: row.updated_at })),
    rooms: rows.rooms.map(row => ({ id: row.id, tenantId: row.tenant_id, name: row.name, addressLegacy: row.address, legacyCount: numberOrNull(row.count), legacyDeleted: row.deleted === 1, createdAt: row.created_at, updatedAt: row.updated_at })),
  };
}

function readAuthorizedCoreSchedulingSource(value) {
  const config = exactConfig(value);
  let root;
  let source;
  try {
    root = fs.realpathSync(config.sourceRoot);
    source = fs.realpathSync(config.sourcePath);
  } catch (_) {
    throw sourceInvalid();
  }
  if (!fs.statSync(root).isDirectory() || !fs.statSync(source).isFile() || path.relative(root, source) !== path.join('data', 'scheduling.db')) throw sourceInvalid();
  const before = sha256File(source);
  const db = new Database(source, { readonly: true, fileMustExist: true });
  let rows;
  let schema;
  try {
    db.pragma('query_only = ON');
    db.exec('BEGIN');
    schema = {};
    rows = {};
    for (const relation of SOURCE_RELATIONS) {
      const actualColumns = db.prepare(`PRAGMA table_info(${quoteIdentifier(relation)})`).all()
        .sort((left, right) => Number(left.cid) - Number(right.cid))
        .map(row => String(row.name));
      if (JSON.stringify(actualColumns) !== JSON.stringify(SOURCE_COLUMNS[relation])) throw sourceInvalid();
      schema[relation] = actualColumns;
      const columns = SOURCE_COLUMNS[relation].map(quoteIdentifier).join(', ');
      rows[relation] = db.prepare(`SELECT ${columns} FROM ${quoteIdentifier(relation)} ORDER BY "id"`).all();
    }
    db.exec('ROLLBACK');
  } catch (error) {
    if (error && error.code === CORE_SOURCE_ERROR) throw error;
    throw sourceInvalid();
  } finally {
    db.close();
  }
  const after = sha256File(source);
  if (before !== after) throw sourceInvalid();
  const rawCore = { sourceInventorySha256: before, teachers: rows.teachers, students: rows.students, courses: rows.courses, schedules: rows.schedules };
  let normalizedCore;
  try {
    normalizedCore = normalizeCoreSchedulingSource(rawCore);
  } catch (_) {
    throw sourceInvalid();
  }
  const relationCounts = Object.fromEntries(SOURCE_RELATIONS.map(relation => [relation, rows[relation].length]));
  const sourceInventorySha256 = sha256Text(JSON.stringify({ schema, rows: Object.fromEntries(SOURCE_RELATIONS.map(relation => [relation, stableRows(rows[relation])])) }));
  return freeze({
    sourceSnapshotSha256: before,
    sourceInventorySha256,
    sourceSchemaSha256: sha256Text(JSON.stringify(schema)),
    relationCounts,
    foundation: foundation(rows),
    rawCoreScheduling: rawCore,
    coreScheduling: normalizedCore,
    normalizedCoreScheduling: normalizedCore,
  });
}

module.exports = Object.freeze({ readAuthorizedCoreSchedulingSource });
