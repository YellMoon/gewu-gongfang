'use strict';
const assert = require('node:assert/strict');
const { buildScheduleSnapshotRecoveryPlan } = require('./scheduleSnapshotRecoveryPlan');

const snapshot = { billing_unit: 2, teacher_fee_mode: 1, teacher_id: 'teacher-old', teacher_name: '原任课教师' };
const row = { id: 'lesson-1', course_id: 'course-1', start_time: '2026-06-01 10:00', end_time: '2026-06-01 11:30', status: 1,
  student_ids: ['student-1'], student_pricings: [{ student_id: 'student-1', tuition: 180, teacher_fee: 120, status: 1 }],
  calculated_tuition: 180, calculated_teacher_fee: 120 };
function input() {
  return { tenantId: 'default',
    cacheSchedules: [{ ...structuredClone(row), ...snapshot }],
    sourceSchedules: [{ ...structuredClone(row), tenant_id: 'default', deleted: 0, updated_at: '2026-08-23T05:01:02.123456Z' }],
    cloudSchedules: [{ ...structuredClone(row), deleted: false, start_time: '2026-06-01T02:00:00+00:00', end_time: '2026-06-01T03:30:00.000Z', updated_at: '2026-08-23T05:01:02.123456+00:00' }],
    cloudTeacherIds: ['teacher-old'], evidence: { cacheSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64), cloudSha256: 'c'.repeat(64) } };
}
function decision(change, reason) {
  const data = input(); change(data);
  const result = buildScheduleSnapshotRecoveryPlan(data);
  assert.equal(result.candidates.length, 0, reason);
  assert(result.decisions.some(item => item.reason === reason), JSON.stringify(result.decisions));
}
const data = input();
// Equivalent storage representations and attendance aliases must compare without changing values.
data.sourceSchedules[0].student_ids = JSON.stringify(row.student_ids);
data.sourceSchedules[0].student_pricings = JSON.stringify(row.student_pricings);
data.cloudSchedules[0].student_pricings = [{ student_id: 'student-1', tuition: '180.00', teacher_fee: '120.0', attendance_status: 1 }];
const frozen = JSON.stringify(data);
const plan = buildScheduleSnapshotRecoveryPlan(data);
assert.equal(JSON.stringify(data), frozen, 'planner must not mutate any source');
assert.equal(plan.mode, 'read_only_proposal');
assert.equal(plan.candidates.length, 1);
assert.deepEqual(plan.candidates[0].patch, snapshot, 'restore only explicit four fields; no course-derived values');
assert.equal(plan.candidates[0].expectedUpdatedAt, '2026-08-23T05:01:02.123456+00:00', 'never round the optimistic concurrency token');
assert.match(plan.candidates[0].baselineSha256, /^[a-f0-9]{64}$/);
assert.equal(plan.cloudSnapshotFieldsProjected, false, 'missing projection fields do not prove migration ready');
assert.deepEqual(buildScheduleSnapshotRecoveryPlan(data), plan, 'deterministic evidence');

decision(d => delete d.cacheSchedules[0].teacher_id, 'CACHE_SNAPSHOT_INCOMPLETE');
decision(d => { for (const key of Object.keys(snapshot)) delete d.cacheSchedules[0][key]; }, 'NO_EXPLICIT_CACHE_SNAPSHOT');
decision(d => d.cacheSchedules[0].billing_unit = 3, 'CACHE_SNAPSHOT_INVALID');
decision(d => d.cacheSchedules.push(structuredClone(d.cacheSchedules[0])), 'DUPLICATE_CACHE_ID');
decision(d => d.sourceSchedules.push(structuredClone(d.sourceSchedules[0])), 'DUPLICATE_SOURCE_ID');
decision(d => d.cloudSchedules.push(structuredClone(d.cloudSchedules[0])), 'DUPLICATE_CLOUD_ID');
decision(d => d.sourceSchedules[0].tenant_id = 'other', 'SOURCE_TENANT_MISMATCH');
decision(d => d.sourceSchedules[0].deleted = 1, 'SOURCE_DELETED');
decision(d => d.cloudSchedules = [], 'CLOUD_RECORD_MISSING');
decision(d => d.sourceSchedules = [], 'SOURCE_RECORD_MISSING');
decision(d => d.cloudSchedules[0].deleted = true, 'CLOUD_DELETED');
decision(d => d.cacheSchedules[0].start_time = '2026-02-30 10:00', 'CACHE_BASELINE_INVALID');
decision(d => d.cacheSchedules[0].status = 4, 'CACHE_SOURCE_DIFFERENCE');
decision(d => d.cloudSchedules[0].calculated_tuition = 181, 'SOURCE_CLOUD_DIFFERENCE');
decision(d => d.cloudSchedules[0].student_pricings[0].status = 4, 'SOURCE_CLOUD_DIFFERENCE');
decision(d => d.cloudSchedules[0].student_pricings[0].attendance_status = 3, 'CLOUD_BASELINE_INVALID');
decision(d => d.cacheSchedules[0].student_pricings[0].status = null, 'CACHE_BASELINE_INVALID');
decision(d => d.cacheSchedules[0].student_ids = ['different'], 'CACHE_BASELINE_INVALID');
decision(d => d.cacheSchedules[0].calculated_tuition = null, 'CACHE_BASELINE_INVALID');
decision(d => d.cloudSchedules[0].updated_at = 'not-a-version', 'CLOUD_VERSION_MISSING_OR_INVALID');
decision(d => delete d.sourceSchedules[0].updated_at, 'SOURCE_VERSION_INVALID');
decision(d => d.cloudTeacherIds = [], 'SNAPSHOT_TEACHER_NOT_IN_CLOUD');
decision(d => d.cloudSchedules[0].billing_unit = 1, 'CLOUD_SNAPSHOT_CONFLICT');
decision(d => Object.assign(d.cloudSchedules[0], snapshot), 'ALREADY_RESTORED');
decision(d => { Object.assign(d.cloudSchedules[0], snapshot); d.sourceSchedules[0].updated_at = '2026-01-01T00:00:00Z'; }, 'ALREADY_RESTORED');
const restored = input();
Object.assign(restored.cloudSchedules[0], Object.fromEntries(Object.keys(snapshot).map(key => [key, null])));
assert.equal(buildScheduleSnapshotRecoveryPlan(restored).cloudSnapshotFieldsProjected, true);
assert.equal(buildScheduleSnapshotRecoveryPlan(restored).candidates.length, 1);
const inherited = input();
inherited.sourceSchedules[0].student_ids = null;
inherited.sourceSchedules[0].student_pricings = null;
inherited.sourceCourses = [{ id: 'course-1', tenant_id: 'default', deleted: 0,
  student_pricings: JSON.stringify([{ student_id: 'student-1', tuition: 180, teacher_fee: 120 }]) }];
inherited.evidence.sourceCoursesSha256 = 'd'.repeat(64);
assert.equal(buildScheduleSnapshotRecoveryPlan(inherited).candidates.length, 1, 'original migration explicitly inherited course pricing when no lesson override exists');
inherited.sourceCourses[0].tenant_id = 'other';
assert.equal(buildScheduleSnapshotRecoveryPlan(inherited).candidates.length, 0, 'never inherit another tenant roster');
inherited.sourceCourses[0].tenant_id = 'default';
inherited.sourceCourses[0].student_pricings = '[]';
assert.equal(buildScheduleSnapshotRecoveryPlan(inherited).candidates.length, 0, 'do not infer omitted roster from cache');
decision(d => { d.sourceSchedules[0].updated_at = '2026-08-23T05:01:02.123455Z'; }, 'CLOUD_VERSION_DIVERGED');
decision(d => { d.cloudSchedules[0].tenant_id = 'other'; }, 'CLOUD_TENANT_MISMATCH');
assert.throws(() => buildScheduleSnapshotRecoveryPlan({ ...input(), evidence: {} }), /EVIDENCE_REQUIRED/);
console.log('schedule snapshot recovery proposal checks passed');
