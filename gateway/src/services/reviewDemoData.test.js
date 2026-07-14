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
