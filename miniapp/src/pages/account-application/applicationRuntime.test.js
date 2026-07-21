'use strict';

const assert = require('assert');
const {
  APPLICATION_STATES,
  buildStudentApplicationPayload,
  buildTeacherApplicationPayload,
  copyForApplicationState,
  createApplicationOperationLock,
} = require('./applicationRuntime');

for (const state of [
  'loading', 'not_submitted', 'invalid', 'submitting', 'submitted', 'provisioning',
  'manual_resolution_required', 'rejected', 'withdrawn', 'approved_relogin_required',
  'offline', 'network_error',
]) {
  assert.ok(APPLICATION_STATES.includes(state));
  const copy = copyForApplicationState(state);
  assert.ok(copy.title && copy.description, `${state} needs truthful user-facing copy`);
}

assert.deepStrictEqual(buildStudentApplicationPayload({
  applicantKind: 'student', verifiedPhone: '13800138000', studentName: ' \u5f20\u540c\u5b66 ',
  otherPhone: '13800138001', school: ' \u5b81\u6ce2\u4e2d\u5b66 ', currentGrade: '\u9ad8\u4e00',
  parentRelation: '\u5988\u5988', confirmation: true, notes: ' \u5907\u6ce8 ',
}), {
  studentName: '\u5f20\u540c\u5b66', studentPhone: '13800138000', school: '\u5b81\u6ce2\u4e2d\u5b66', currentGrade: '\u9ad8\u4e00',
  parentRelation: '\u5988\u5988', parentPhone: '13800138001', applicantAgeConfirmation: true, notes: '\u5907\u6ce8',
});

assert.deepStrictEqual(buildStudentApplicationPayload({
  applicantKind: 'parent', verifiedPhone: '13800138001', studentName: '\u5f20\u540c\u5b66',
  otherPhone: '13800138000', school: '\u5b81\u6ce2\u4e2d\u5b66', currentGrade: '\u9ad8\u4e8c',
  parentRelation: '\u7238\u7238', confirmation: true,
}), {
  studentName: '\u5f20\u540c\u5b66', studentPhone: '13800138000', school: '\u5b81\u6ce2\u4e2d\u5b66', currentGrade: '\u9ad8\u4e8c',
  parentRelation: '\u7238\u7238', parentPhone: '13800138001', guardianConfirmation: true,
});

assert.throws(() => buildStudentApplicationPayload({
  applicantKind: 'student', verifiedPhone: '13800138000', studentName: '\u5f20\u540c\u5b66',
  otherPhone: '13800138000', school: '\u5b81\u6ce2\u4e2d\u5b66', currentGrade: '\u9ad8\u4e00',
  parentRelation: '\u5988\u5988', confirmation: true,
}), /must differ/);
assert.throws(() => buildStudentApplicationPayload({
  applicantKind: 'parent', verifiedPhone: '13800138001', studentName: '\u5f20\u540c\u5b66',
  otherPhone: '13800138000', school: '\u5b81\u6ce2\u4e2d\u5b66', currentGrade: '\u9ad8\u4e00',
  parentRelation: '\u5988\u5988', confirmation: false,
}), /confirmation/);

assert.deepStrictEqual(buildTeacherApplicationPayload({
  verifiedPhone: '13800138002', name: ' \u674e\u8001\u5e08 ', subject: '', notes: ' note ',
}), { name: '\u674e\u8001\u5e08', phone: '13800138002', notes: 'note' });
assert.ok(!JSON.stringify(buildTeacherApplicationPayload({
  verifiedPhone: '13800138002', name: '\u674e\u8001\u5e08', subject: '', notes: '',
})).includes('hourly'));

const lock = createApplicationOperationLock();
assert.strictEqual(lock.tryAcquire('submit'), true);
assert.strictEqual(lock.tryAcquire('withdraw'), false);
assert.strictEqual(lock.current(), 'submit');
lock.release('withdraw');
assert.strictEqual(lock.current(), 'submit');
lock.release('submit');
assert.strictEqual(lock.tryAcquire('withdraw'), true);

console.log('account application runtime checks passed');
