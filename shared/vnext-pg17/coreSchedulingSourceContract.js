'use strict';

const { types } = require('util');

const ERROR_CODE = 'VNEXT_PG17_CORE_SCHEDULING_SOURCE_INVALID';
const SCHEDULE_STATUSES = new Set([1, 2, 3, 4]);
const ATTENDANCE_STATUSES = new Set([1, 3, 4]);
const SENTINEL_STUDENT_ID = '__institution_unbound__';
const SHA256 = /^[a-f0-9]{64}$/u;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u;
const SHANGHAI_WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/u;

const FIELDS = Object.freeze({
  teachers: Object.freeze(['id', 'tenant_id', 'name', 'phone', 'subject', 'hourly_rate', 'notes', 'deleted', 'created_at', 'updated_at']),
  students: Object.freeze([
    'id', 'tenant_id', 'name', 'phone', 'school', 'grade_year', 'grade_current', 'source_type', 'institution_id',
    'parent_name', 'parent_wechat', 'student_source', 'balance_hours', 'balance_money', 'notes', 'deleted', 'created_at',
    'updated_at', 'is_institution_student', 'parent_phone', 'parent_phone_normalized', 'parent_relation',
  ]),
  courses: Object.freeze([
    'id', 'tenant_id', 'name', 'year', 'semester', 'display_name', 'type', 'source_type', 'institution_id', 'price_tuition',
    'price_teacher', 'billing_unit', 'teacher_fee_mode', 'student_pricings', 'room_id', 'room_name', 'teacher_id', 'teacher_name',
    'active', 'default_duration_minutes', 'notes', 'deleted', 'created_at', 'updated_at',
  ]),
  schedules: Object.freeze([
    'id', 'tenant_id', 'course_id', 'start_time', 'end_time', 'recurring_rule', 'status', 'room', 'service_type', 'student_ids',
    'student_pricings', 'calculated_tuition', 'calculated_teacher_fee', 'notes', 'deleted', 'created_at', 'updated_at',
  ]),
});

function sourceInvalid() {
  return Object.assign(new Error(ERROR_CODE), { code: ERROR_CODE });
}

function exactObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw sourceInvalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) throw sourceInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot = {};
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw sourceInvalid();
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

function exactArray(value) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) throw sourceInvalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length))) throw sourceInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.freeze(Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw sourceInvalid();
    return descriptor.value;
  }));
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim() === value && value.length > 0;
}

function nullableText(value) {
  return value === null || typeof value === 'string';
}

function finiteInstant(value) {
  if (typeof value !== 'string') return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value;
}

function shanghaiWallClockToUtc(value) {
  if (typeof value !== 'string') throw sourceInvalid();
  const match = SHANGHAI_WALL_CLOCK.exec(value);
  if (!match) throw sourceInvalid();
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = Number(match[6] || '0');
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day
    || local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second) throw sourceInvalid();
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second)).toISOString();
}

function legacyFlag(value) {
  return value === 0 || value === 1;
}

function nullableInteger(value) {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647);
}

function decimal(value) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || !DECIMAL.test(text)) throw sourceInvalid();
  return text;
}

function nullableDecimal(value) {
  return value === null ? null : decimal(value);
}

function parseJsonArray(value) {
  if (value === null || value === '') return [];
  if (typeof value !== 'string') throw sourceInvalid();
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw sourceInvalid();
    return exactArray(parsed);
  } catch (error) {
    if (error && error.code === ERROR_CODE) throw error;
    throw sourceInvalid();
  }
}

function pricingRows(value, includeAttendance) {
  const fields = includeAttendance ? ['student_id', 'tuition', 'teacher_fee', 'status'] : ['student_id', 'tuition', 'teacher_fee'];
  const ids = new Set();
  return Object.freeze(parseJsonArray(value).map(raw => {
    const row = exactObject(raw, fields);
    if (!nonBlank(row.student_id) || ids.has(row.student_id)) throw sourceInvalid();
    ids.add(row.student_id);
    if (includeAttendance && !ATTENDANCE_STATUSES.has(row.status)) throw sourceInvalid();
    return Object.freeze({
      studentId: row.student_id,
      tuition: decimal(row.tuition),
      teacherFee: decimal(row.teacher_fee),
      attendanceStatus: includeAttendance ? row.status : 1,
    });
  }));
}

function studentIds(value) {
  const ids = new Set();
  for (const raw of parseJsonArray(value)) {
    if (!nonBlank(raw) || ids.has(raw)) throw sourceInvalid();
    ids.add(raw);
  }
  return ids;
}

function validateCommon(row) {
  if (!nonBlank(row.id) || !nonBlank(row.tenant_id) || !legacyFlag(row.deleted)
    || !finiteInstant(row.created_at) || !finiteInstant(row.updated_at) || row.updated_at < row.created_at) throw sourceInvalid();
}

function snapshotRows(relation, sourceRows, validate) {
  const ids = new Set();
  return Object.freeze(exactArray(sourceRows).map(raw => {
    const row = exactObject(raw, FIELDS[relation]);
    validateCommon(row);
    if (ids.has(row.id)) throw sourceInvalid();
    ids.add(row.id);
    return Object.freeze(validate(row));
  }));
}

function validateTeacher(row) {
  if (!nonBlank(row.name) || !nullableText(row.phone) || !nullableText(row.subject)
    || !nullableText(row.notes)) throw sourceInvalid();
  return { ...row, hourly_rate: nullableDecimal(row.hourly_rate) };
}

function validateStudent(row) {
  if (!nonBlank(row.name) || !nullableText(row.phone) || !nullableText(row.school)
    || !nullableInteger(row.grade_year) || !nullableText(row.grade_current) || !nullableInteger(row.source_type)
    || !nullableText(row.institution_id) || !nullableText(row.parent_name) || !nullableText(row.parent_wechat)
    || !nullableText(row.student_source) || !nullableText(row.notes) || !legacyFlag(row.is_institution_student)
    || !nullableText(row.parent_phone) || !nullableText(row.parent_phone_normalized) || !nullableText(row.parent_relation)) throw sourceInvalid();
  return { ...row, balance_hours: nullableDecimal(row.balance_hours), balance_money: nullableDecimal(row.balance_money) };
}

function validateCourse(row) {
  if (!nonBlank(row.name) || !nonBlank(row.display_name) || !nullableInteger(row.year) || !nullableText(row.semester)
    || !Number.isSafeInteger(row.type) || !Number.isSafeInteger(row.source_type) || !nullableText(row.institution_id)
    || !Number.isSafeInteger(row.billing_unit) || !Number.isSafeInteger(row.teacher_fee_mode) || !nullableText(row.room_id)
    || !nullableText(row.room_name) || !nullableText(row.teacher_id) || !nullableText(row.teacher_name)
    || !legacyFlag(row.active) || !nullableInteger(row.default_duration_minutes) || !nullableText(row.notes)) throw sourceInvalid();
  return {
    ...row,
    price_tuition: nullableDecimal(row.price_tuition),
    price_teacher: nullableDecimal(row.price_teacher),
    defaultRoster: pricingRows(row.student_pricings, false),
  };
}

function validateSchedule(row) {
  const startAt = shanghaiWallClockToUtc(row.start_time);
  const endAt = shanghaiWallClockToUtc(row.end_time);
  if (!nonBlank(row.course_id) || endAt <= startAt || !SCHEDULE_STATUSES.has(row.status) || !nullableText(row.recurring_rule)
    || !nullableText(row.room) || !nullableInteger(row.service_type) || !nullableText(row.notes)) throw sourceInvalid();
  if (row.recurring_rule !== null && row.recurring_rule !== '') parseJsonArray(row.recurring_rule);
  return {
    ...row,
    explicitRoster: pricingRows(row.student_pricings, true),
    listedStudentIds: studentIds(row.student_ids),
    calculated_tuition: decimal(row.calculated_tuition),
    calculated_teacher_fee: decimal(row.calculated_teacher_fee),
    startAt,
    endAt,
  };
}

function normalizeCoreSchedulingSource(value) {
  const input = exactObject(value, ['sourceInventorySha256', 'teachers', 'students', 'courses', 'schedules']);
  if (!SHA256.test(input.sourceInventorySha256)) throw sourceInvalid();
  const teachers = snapshotRows('teachers', input.teachers, validateTeacher);
  const students = snapshotRows('students', input.students, validateStudent);
  const courses = snapshotRows('courses', input.courses, validateCourse);
  const schedules = snapshotRows('schedules', input.schedules, validateSchedule);
  const teachersById = new Map(teachers.map(row => [row.id, row]));
  const studentsById = new Map(students.map(row => [row.id, row]));
  const coursesById = new Map(courses.map(row => [row.id, row]));
  for (const course of courses) {
    if (course.teacher_id !== null && (!teachersById.has(course.teacher_id) || teachersById.get(course.teacher_id).tenant_id !== course.tenant_id)) throw sourceInvalid();
    for (const pricing of course.defaultRoster) {
      if (pricing.studentId === SENTINEL_STUDENT_ID || !studentsById.has(pricing.studentId)
        || studentsById.get(pricing.studentId).tenant_id !== course.tenant_id) throw sourceInvalid();
    }
  }
  const admittedSchedules = [];
  const quarantines = [];
  const exclusions = [];
  for (const schedule of schedules) {
    const course = coursesById.get(schedule.course_id);
    if (!course || course.tenant_id !== schedule.tenant_id) throw sourceInvalid();
    const containsSentinel = schedule.explicitRoster.some(pricing => pricing.studentId === SENTINEL_STUDENT_ID);
    if (containsSentinel) {
      quarantines.push(Object.freeze({ scheduleId: schedule.id, outcome: 'LEGACY_COPY_UNBOUND_PARTICIPANT' }));
      continue;
    }
    const effectiveRoster = schedule.explicitRoster.length > 0 ? schedule.explicitRoster : course.defaultRoster;
    for (const pricing of effectiveRoster) {
      if (!studentsById.has(pricing.studentId) || studentsById.get(pricing.studentId).tenant_id !== schedule.tenant_id) throw sourceInvalid();
    }
    const expectedIds = new Set(effectiveRoster.map(pricing => pricing.studentId));
    if (schedule.listedStudentIds.size > 0 && (schedule.listedStudentIds.size !== expectedIds.size || [...schedule.listedStudentIds].some(id => !expectedIds.has(id)))) throw sourceInvalid();
    admittedSchedules.push(Object.freeze({
      id: schedule.id,
      tenantId: schedule.tenant_id,
      courseId: schedule.course_id,
      startAt: schedule.startAt,
      endAt: schedule.endAt,
      recurringRule: schedule.recurring_rule,
      status: schedule.status,
      roomDisplay: schedule.room,
      serviceType: schedule.service_type,
      calculatedTuition: schedule.calculated_tuition,
      calculatedTeacherFee: schedule.calculated_teacher_fee,
      notes: schedule.notes,
      legacyDeleted: schedule.deleted === 1,
      createdAt: schedule.created_at,
      updatedAt: schedule.updated_at,
      effectiveRosterSource: schedule.explicitRoster.length > 0 ? 'schedule_override' : course.defaultRoster.length > 0 ? 'course_default' : 'none',
      effectiveRoster: Object.freeze(effectiveRoster.map(pricing => Object.freeze({ ...pricing }))),
    }));
  }
  return Object.freeze({
    sourceInventorySha256: input.sourceInventorySha256,
    teachers: Object.freeze(teachers.map(row => Object.freeze({ ...row }))),
    students: Object.freeze(students.map(row => Object.freeze({ ...row }))),
    courses: Object.freeze(courses.map(row => Object.freeze({ ...row }))),
    schedules: Object.freeze(admittedSchedules),
    quarantines: Object.freeze(quarantines),
    exclusions: Object.freeze(exclusions),
  });
}

module.exports = Object.freeze({ normalizeCoreSchedulingSource });
