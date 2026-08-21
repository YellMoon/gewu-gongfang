'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

let reader = {};
try {
  reader = require('./coreSchedulingReadOnlySource');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const AT = '2026-08-21T00:00:00.000Z';
const TABLE_COLUMNS = Object.freeze({
  tenants: ['id', 'name', 'status', 'plan', 'archive_before', 'deleted', 'created_at', 'updated_at'],
  institutions: ['id', 'tenant_id', 'name', 'contact_person', 'contact_phone', 'revenue_share', 'notes', 'deleted', 'created_at', 'updated_at'],
  schools: ['id', 'tenant_id', 'name', 'count', 'deleted', 'created_at', 'updated_at'],
  rooms: ['id', 'tenant_id', 'name', 'address', 'count', 'deleted', 'created_at', 'updated_at'],
  teachers: ['id', 'tenant_id', 'name', 'phone', 'subject', 'hourly_rate', 'notes', 'deleted', 'created_at', 'updated_at'],
  students: ['id', 'tenant_id', 'name', 'phone', 'school', 'grade_year', 'grade_current', 'source_type', 'institution_id', 'parent_name', 'parent_wechat', 'student_source', 'balance_hours', 'balance_money', 'notes', 'deleted', 'created_at', 'updated_at', 'is_institution_student', 'parent_phone', 'parent_phone_normalized', 'parent_relation'],
  courses: ['id', 'tenant_id', 'name', 'year', 'semester', 'display_name', 'type', 'source_type', 'institution_id', 'price_tuition', 'price_teacher', 'billing_unit', 'teacher_fee_mode', 'student_pricings', 'room_id', 'room_name', 'teacher_id', 'teacher_name', 'active', 'default_duration_minutes', 'notes', 'deleted', 'created_at', 'updated_at'],
  schedules: ['id', 'tenant_id', 'course_id', 'start_time', 'end_time', 'recurring_rule', 'status', 'room', 'service_type', 'student_ids', 'student_pricings', 'calculated_tuition', 'calculated_teacher_fee', 'notes', 'deleted', 'created_at', 'updated_at'],
});

function sha256File(target) {
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function makeRows() {
  const common = { tenant_id: 'tenant-a', deleted: 0, created_at: AT, updated_at: AT };
  return {
    tenants: [{ id: 'tenant-a', name: 'Tenant', status: 'active', plan: null, archive_before: null, deleted: 0, created_at: AT, updated_at: AT }],
    institutions: [{ id: 'institution-a', ...common, name: 'Institution', contact_person: null, contact_phone: null, revenue_share: 0, notes: null }],
    schools: [{ id: 'school-a', ...common, name: 'School', count: 1 }],
    rooms: [{ id: 'room-a', ...common, name: 'Room', address: null, count: 1 }],
    teachers: [{ id: 'teacher-a', ...common, name: 'Teacher', phone: null, subject: null, hourly_rate: 60, notes: null }],
    students: [{ id: 'student-a', ...common, name: 'Student', phone: null, school: null, grade_year: null, grade_current: null, source_type: 1, institution_id: 'institution-a', parent_name: null, parent_wechat: null, student_source: null, balance_hours: 0, balance_money: 0, notes: null, is_institution_student: 0, parent_phone: null, parent_phone_normalized: null, parent_relation: null }],
    courses: [{ id: 'course-a', ...common, name: 'Course', year: 2026, semester: 'summer', display_name: 'Course', type: 1, source_type: 1, institution_id: 'institution-a', price_tuition: 100, price_teacher: 60, billing_unit: 1, teacher_fee_mode: 1, student_pricings: '[{"student_id":"student-a","tuition":100,"teacher_fee":60}]', room_id: 'missing-legacy-room', room_name: 'Legacy room', teacher_id: 'teacher-a', teacher_name: 'Teacher', active: 1, default_duration_minutes: 60, notes: null }],
    schedules: [{ id: 'schedule-a', ...common, course_id: 'course-a', start_time: '2026-08-21 09:00', end_time: '2026-08-21 10:00', recurring_rule: null, status: 1, room: null, service_type: 1, student_ids: '["student-a"]', student_pricings: '[]', calculated_tuition: 100, calculated_teacher_fee: 60, notes: null }],
  };
}

function createSource(root, { extraTeacherColumn = false } = {}) {
  const sourceDir = path.join(root, 'data');
  fs.mkdirSync(sourceDir, { recursive: true });
  const source = path.join(sourceDir, 'scheduling.db');
  const db = new Database(source);
  try {
    for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
      const extra = table === 'teachers' && extraTeacherColumn ? ', unexpected TEXT' : '';
      db.exec(`CREATE TABLE "${table}" (${columns.map(column => `"${column}"`).join(', ')}${extra})`);
      const row = makeRows()[table][0];
      const statement = db.prepare(`INSERT INTO "${table}" (${columns.map(column => `"${column}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
      statement.run(columns.map(column => row[column]));
    }
    db.exec('CREATE TABLE questions (id TEXT, payload TEXT)');
    db.prepare('INSERT INTO questions (id, payload) VALUES (?, ?)').run('question-never-read', 'question-bank-sentinel');
  } finally {
    db.close();
  }
  return source;
}

assert.strictEqual(typeof reader.readAuthorizedCoreSchedulingSource, 'function', 'the local-only reader must exist before a real source rehearsal can use it');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-core-source-'));
try {
  const source = createSource(root);
  const before = sha256File(source);
  const loaded = reader.readAuthorizedCoreSchedulingSource({ sourceRoot: root, sourcePath: source });
  const after = sha256File(source);
  assert.strictEqual(before, after, 'the reader must not mutate its SQLite source');
  assert.ok(Object.isFrozen(loaded));
  assert.deepStrictEqual(loaded.relationCounts, { tenants: 1, institutions: 1, schools: 1, rooms: 1, teachers: 1, students: 1, courses: 1, schedules: 1 });
  assert.deepStrictEqual(loaded.coreScheduling.schedules.map(row => row.id), ['schedule-a']);
  assert.strictEqual(loaded.coreScheduling.schedules[0].effectiveRosterSource, 'course_default');
  assert.match(loaded.sourceSnapshotSha256, /^[0-9a-f]{64}$/u);
  assert.match(loaded.sourceInventorySha256, /^[0-9a-f]{64}$/u);
  assert.match(loaded.sourceSchemaSha256, /^[0-9a-f]{64}$/u);
  assert.throws(
    () => reader.readAuthorizedCoreSchedulingSource({ sourceRoot: root, sourcePath: path.join(root, 'questions.db') }),
    error => error && error.code === 'VNEXT_CORE_SCHEDULING_SOURCE_INVALID',
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-core-source-drift-'));
try {
  const source = createSource(driftRoot, { extraTeacherColumn: true });
  assert.throws(
    () => reader.readAuthorizedCoreSchedulingSource({ sourceRoot: driftRoot, sourcePath: source }),
    error => error && error.code === 'VNEXT_CORE_SCHEDULING_SOURCE_INVALID',
    'the reader must reject a changed approved-table schema instead of silently dropping a source field',
  );
} finally {
  fs.rmSync(driftRoot, { recursive: true, force: true });
}

process.stdout.write('vNext core scheduling read-only source checks passed\n');
