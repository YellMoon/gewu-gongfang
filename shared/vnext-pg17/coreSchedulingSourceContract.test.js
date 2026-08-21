'use strict';

const assert = require('assert');
let sourceContract = {};
try {
  sourceContract = require('./coreSchedulingSourceContract');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const INVENTORY_SHA256 = '1'.repeat(64);
const AT = '2026-07-01T00:00:00.000Z';
const LATER = '2026-07-01T01:00:00.000Z';
const SCHEDULE_START = '2026-07-01 08:00';
const SCHEDULE_END = '2026-07-01 09:00';

function teacher() {
  return {
    id: 'teacher-a', tenant_id: 'tenant-a', name: 'Teacher A', phone: null, subject: null,
    hourly_rate: 50, notes: null, deleted: 0, created_at: AT, updated_at: AT,
  };
}

function student(id) {
  return {
    id, tenant_id: 'tenant-a', name: id, phone: null, school: null, grade_year: null,
    grade_current: null, source_type: 1, institution_id: 'institution-a', parent_name: null,
    parent_wechat: null, student_source: null, balance_hours: 0, balance_money: 0, notes: null,
    deleted: 0, created_at: AT, updated_at: AT, is_institution_student: 0, parent_phone: null,
    parent_phone_normalized: null, parent_relation: null,
  };
}

function course(id, studentPricings) {
  return {
    id, tenant_id: 'tenant-a', name: id, year: 2026, semester: 'summer', display_name: id,
    type: 1, source_type: 1, institution_id: 'institution-a', price_tuition: 100, price_teacher: 50,
    billing_unit: 1, teacher_fee_mode: 1, student_pricings: studentPricings, room_id: null,
    room_name: null, teacher_id: 'teacher-a', teacher_name: 'Teacher A', active: 1,
    default_duration_minutes: 60, notes: null, deleted: 0, created_at: AT, updated_at: AT,
  };
}

function schedule(id, courseId, studentPricings) {
  return {
    id, tenant_id: 'tenant-a', course_id: courseId, start_time: SCHEDULE_START, end_time: SCHEDULE_END,
    recurring_rule: null, status: 1, room: null, service_type: 1, student_ids: null,
    student_pricings: studentPricings, calculated_tuition: 0, calculated_teacher_fee: 0,
    notes: null, deleted: 0, created_at: AT, updated_at: AT,
  };
}

function fixture() {
  return {
    sourceInventorySha256: INVENTORY_SHA256,
    teachers: [teacher()],
    students: [student('student-a'), student('student-b')],
    courses: [
      course('course-default', '[{"student_id":"student-a","tuition":100,"teacher_fee":50}]'),
      course('course-empty', null),
    ],
    schedules: [
      schedule('schedule-override', 'course-default', '[{"student_id":"student-b","tuition":120,"teacher_fee":60,"status":3}]'),
      schedule('schedule-default', 'course-default', null),
      schedule('schedule-no-roster', 'course-empty', null),
    ],
  };
}

assert.strictEqual(
  typeof sourceContract.normalizeCoreSchedulingSource,
  'function',
  'the source contract must expose a closed normalizer before any shadow admission can consume scheduling rows'
);
const normalized = sourceContract.normalizeCoreSchedulingSource(fixture());
assert.deepStrictEqual(
  normalized.schedules.map(row => [row.id, row.courseId, row.startAt, row.endAt, row.status, row.calculatedTuition, row.calculatedTeacherFee, row.effectiveRosterSource, row.effectiveRoster]),
  [
    ['schedule-override', 'course-default', '2026-07-01T00:00:00.000Z', '2026-07-01T01:00:00.000Z', 1, '0', '0', 'schedule_override', [{ studentId: 'student-b', tuition: '120', teacherFee: '60', attendanceStatus: 3 }]],
    ['schedule-default', 'course-default', '2026-07-01T00:00:00.000Z', '2026-07-01T01:00:00.000Z', 1, '0', '0', 'course_default', [{ studentId: 'student-a', tuition: '100', teacherFee: '50', attendanceStatus: 1 }]],
    ['schedule-no-roster', 'course-empty', '2026-07-01T00:00:00.000Z', '2026-07-01T01:00:00.000Z', 1, '0', '0', 'none', []],
  ],
  'the contract must convert Shanghai wall-clock schedule times and preserve every target scheduling field while applying the roster precedence rule'
);
assert.deepStrictEqual(
  normalized.schedules[0],
  {
    id: 'schedule-override', tenantId: 'tenant-a', courseId: 'course-default',
    startAt: '2026-07-01T00:00:00.000Z', endAt: '2026-07-01T01:00:00.000Z',
    recurringRule: null, status: 1, roomDisplay: null, serviceType: 1,
    calculatedTuition: '0', calculatedTeacherFee: '0', notes: null, legacyDeleted: false,
    createdAt: AT, updatedAt: AT, effectiveRosterSource: 'schedule_override',
    effectiveRoster: [{ studentId: 'student-b', tuition: '120', teacherFee: '60', attendanceStatus: 3 }],
  },
  'a normalized schedule must retain all non-JSON scheduling facts required by the later fixed shadow SQL'
);

const sentinel = fixture();
sentinel.schedules.push(schedule(
  'schedule-obsolete',
  'course-empty',
  '[{"student_id":"__institution_unbound__","tuition":0,"teacher_fee":0,"status":1}]'
));
const unapproved = sourceContract.normalizeCoreSchedulingSource(sentinel);
assert.deepStrictEqual(
  unapproved.quarantines,
  [{ scheduleId: 'schedule-obsolete', outcome: 'LEGACY_COPY_UNBOUND_PARTICIPANT' }],
  'a copied sentinel participant remains quarantined at the source-contract stage; the user-declared eighteen-row exclusion is a later shadow-admission concern'
);
assert.ok(!unapproved.schedules.some(row => row.id === 'schedule-obsolete'), 'a copied sentinel must never create a target schedule or a fake student');

const secondsFixture = fixture();
secondsFixture.schedules[0].start_time = '2026-07-01 08:00:30';
secondsFixture.schedules[0].end_time = '2026-07-01 09:00:30';
assert.deepStrictEqual(
  sourceContract.normalizeCoreSchedulingSource(secondsFixture).schedules[0].startAt,
  '2026-07-01T00:00:30.000Z',
  'the minority legacy wall-clock values with seconds must use the same fixed Asia/Shanghai conversion'
);

const unresolvedRoomFixture = fixture();
unresolvedRoomFixture.courses[0].room_id = 'legacy-room-not-in-rooms-table';
assert.strictEqual(
  sourceContract.normalizeCoreSchedulingSource(unresolvedRoomFixture).courses[0].room_id,
  'legacy-room-not-in-rooms-table',
  'a legacy course room reference must be retained as a snapshot and must not be guessed as a current room foreign key'
);

assert.throws(
  () => sourceContract.normalizeCoreSchedulingSource({ ...fixture(), schedules: new Proxy([], {}) }),
  error => error && error.code === 'VNEXT_PG17_CORE_SCHEDULING_SOURCE_INVALID',
  'proxy source collections must fail before any getter or source record is consumed'
);

for (const [label, mutate] of [
  ['a schedule status outside the legacy closed set', value => { value.schedules[0].status = 9; }],
  ['malformed schedule override JSON', value => { value.schedules[0].student_pricings = '['; }],
  ['an unknown override student', value => { value.schedules[0].student_pricings = '[{"student_id":"student-missing","tuition":120,"teacher_fee":60,"status":1}]'; }],
  ['an amount that loses approved decimal scale', value => { value.courses[0].student_pricings = '[{"student_id":"student-a","tuition":"1.1234567","teacher_fee":50}]'; }],
  ['an extra source field', value => { value.teachers[0].unexpected = true; }],
]) {
  const invalid = fixture();
  mutate(invalid);
  assert.throws(
    () => sourceContract.normalizeCoreSchedulingSource(invalid),
    error => error && error.code === 'VNEXT_PG17_CORE_SCHEDULING_SOURCE_INVALID',
    `${label} must fail closed before a target row can be prepared`
  );
}

const accessorFixture = fixture();
let accessorReads = 0;
Object.defineProperty(accessorFixture.students, '0', {
  enumerable: true,
  get() {
    accessorReads += 1;
    return student('student-a');
  },
});
assert.throws(
  () => sourceContract.normalizeCoreSchedulingSource(accessorFixture),
  error => error && error.code === 'VNEXT_PG17_CORE_SCHEDULING_SOURCE_INVALID',
  'array accessors must fail closed'
);
assert.strictEqual(accessorReads, 0, 'source getters must never run while validating an exact input snapshot');

console.log('vNext core scheduling source-contract checks passed');
