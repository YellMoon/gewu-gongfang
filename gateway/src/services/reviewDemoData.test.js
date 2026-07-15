'use strict';

const assert = require('assert');
const {
  REVIEW_DEMO_QUESTIONS,
  buildReviewQuestionPreview,
  buildReviewSnapshot,
} = require('./reviewDemoData');

const admin = buildReviewSnapshot('admin');
const student = buildReviewSnapshot('student');

assert.ok(admin.students.length >= 2);
assert.strictEqual(student.students.length, 1);
assert.strictEqual(student.students[0].id, 'review-demo-student');
assert.ok(admin.courses.length > student.courses.length);
assert.ok(student.schedules.every(item => item.student_ids.includes('review-demo-student')));
assert.ok(admin.payments.length > 0);
assert.deepStrictEqual(student.payments, []);
assert.deepStrictEqual(student.assetRecords, []);
assert.ok(admin.assetRecords.length > 0);
assert.ok(admin.assetRecords.every(item => (
  String(item.id).startsWith('review-demo-')
  && ['income', 'expense'].includes(item.type)
  && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
  && Number.isFinite(Date.parse(item.created_at))
)));
assert.ok(admin.assetCategories.every(item => (
  String(item.id).startsWith('review-demo-')
  && ['income', 'expense'].includes(item.type)
  && /^#[0-9a-fA-F]{6}$/.test(item.color)
)));
assert.ok(Array.isArray(admin.questions) && admin.questions.length >= 4);
assert.strictEqual(JSON.stringify(admin).includes('13732250653'), false);
assert.strictEqual(/"(phone|openid|phone_normalized)"/.test(JSON.stringify(admin)), false);

function isTimestamp(value) {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

for (const item of admin.students) {
  assert.ok([1, 2].includes(item.source_type));
  assert.ok(Number.isFinite(item.balance_hours));
  assert.ok(Number.isFinite(item.balance_money));
  assert.ok(isTimestamp(item.created_at));
  assert.ok(isTimestamp(item.updated_at));
}
for (const item of admin.teachers) {
  assert.ok(Number.isFinite(item.hourly_rate));
  assert.ok(isTimestamp(item.created_at));
  assert.ok(isTimestamp(item.updated_at));
}
for (const item of admin.institutions) assert.ok(isTimestamp(item.created_at));
for (const item of admin.schools) {
  assert.ok(Number.isInteger(item.count) && item.count >= 0);
  assert.ok(isTimestamp(item.created_at));
  assert.ok(isTimestamp(item.updated_at));
}
for (const item of admin.rooms) {
  assert.ok(Number.isInteger(item.count) && item.count >= 0);
  assert.ok(isTimestamp(item.created_at));
  assert.ok(isTimestamp(item.updated_at));
}
for (const item of admin.courses) {
  assert.ok([1, 2, 3, 4].includes(item.type));
  assert.ok([1, 2, 3].includes(item.source_type));
  assert.ok([1, 2].includes(item.billing_unit));
  assert.ok([1, 2].includes(item.teacher_fee_mode));
  assert.ok(Number.isFinite(item.price_tuition));
  assert.ok(Number.isFinite(item.price_teacher));
  assert.ok(typeof item.teacher_name === 'string' && item.teacher_name.length > 0);
  assert.ok(typeof item.room_name === 'string' && item.room_name.length > 0);
  assert.ok(Array.isArray(item.student_pricings) && item.student_pricings.length > 0);
  assert.ok(isTimestamp(item.created_at));
  assert.ok(isTimestamp(item.updated_at));
}
for (const item of admin.schedules) {
  assert.ok([1, 2, 3, 4].includes(item.status));
  assert.ok(typeof item.room === 'string' && item.room.length > 0);
  assert.ok(isTimestamp(item.start_time));
  assert.ok(isTimestamp(item.end_time));
  assert.ok(isTimestamp(item.created_at));
  assert.ok(isTimestamp(item.updated_at));
  assert.ok(admin.courses.some(course => course.id === item.course_id));
}
for (const item of admin.enrollments) {
  assert.ok(admin.schedules.some(schedule => schedule.id === item.schedule_id));
  assert.ok(Number.isFinite(item.hours_consumed));
  assert.ok(Number.isInteger(item.status));
  assert.ok(isTimestamp(item.created_at));
}
for (const item of admin.consumptions) {
  assert.ok(admin.schedules.some(schedule => schedule.id === item.schedule_id));
  assert.ok(Number.isFinite(item.hours));
  assert.ok(Number.isFinite(item.amount));
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(item.consumption_date));
  assert.ok(isTimestamp(item.created_at));
}
for (const item of admin.payments) {
  assert.ok([1, 2].includes(item.payment_type));
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(item.payment_date));
  assert.ok(isTimestamp(item.created_at));
}

// Exercise the exact field operations used by the current miniapp pages.
assert.doesNotThrow(() => [...admin.payments].sort((a, b) => b.created_at.localeCompare(a.created_at)));
assert.doesNotThrow(() => admin.students.map(item => item.created_at.split('T')[0]));
const completedRevenue = admin.schedules
  .filter(item => item.status === 2)
  .reduce((sum, item) => sum + Number(item.calculated_tuition || 0), 0);
assert.ok(completedRevenue > 0, 'review statistics need at least one completed, revenue-bearing schedule');

const adminPreview = buildReviewQuestionPreview('admin');
const studentPreview = buildReviewQuestionPreview('student');
assert.strictEqual(adminPreview.sandboxAvailable, true);
assert.strictEqual(studentPreview.sandboxAvailable, true);
assert.deepStrictEqual(adminPreview.questions.map(item => item.id), REVIEW_DEMO_QUESTIONS.map(item => item.id));
assert.ok(studentPreview.questions.length > 0);
assert.ok(studentPreview.questions.every(item => item.status === 'published'));
const externalQuestionSets = [admin.questions, student.questions, adminPreview.questions, studentPreview.questions];
for (const questions of externalQuestionSets) {
  for (const question of questions) {
    assert.strictEqual(Object.hasOwn(question, 'exportStem'), false);
    assert.strictEqual(Object.hasOwn(question, 'exportKnowledgePoint'), false);
    assert.strictEqual(Object.hasOwn(question, 'exportExplanation'), false);
  }
}

admin.students[0].name = 'mutated';
assert.notStrictEqual(buildReviewSnapshot('admin').students[0].name, 'mutated');

console.log('review demo data checks passed');
