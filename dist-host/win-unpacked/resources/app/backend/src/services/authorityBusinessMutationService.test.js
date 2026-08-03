const assert = require('assert');
const {
  BUSINESS_COMMAND_TYPES,
  createAuthorityBusinessMutationHandlers,
  isAuthorityBusinessCommandAllowed,
} = require('./authorityBusinessMutationService');

const calls = [];
const rows = {
  students: new Map(),
  schedules: new Map([
    ['schedule-own', { id: 'schedule-own', course_id: 'course-own', updated_at: 'v1' }],
    ['schedule-other', { id: 'schedule-other', course_id: 'course-other', updated_at: 'v1' }],
  ]),
  courses: new Map([
    ['course-own', { id: 'course-own', teacher_id: 'teacher-1' }],
    ['course-other', { id: 'course-other', teacher_id: 'teacher-2' }],
  ]),
};
const database = {
  getStudentById(id) { return rows.students.get(id) || null; },
  createStudent(record, options) {
    calls.push({ kind: 'student-create', record, options });
    rows.students.set(record.id, { ...record, updated_at: 'v1' });
    return rows.students.get(record.id);
  },
  updateStudent(id, changes, options) {
    calls.push({ kind: 'student-update', id, changes, options });
    const next = { ...rows.students.get(id), ...changes, updated_at: 'v2' };
    rows.students.set(id, next);
    return next;
  },
  deleteStudent(id, options) {
    calls.push({ kind: 'student-delete', id, options });
    return rows.students.delete(id);
  },
  getScheduleById(id) { return rows.schedules.get(id) || null; },
  updateSchedule(id, changes, options) {
    calls.push({ kind: 'schedule-update', id, changes, options });
    return { ...rows.schedules.get(id), ...changes };
  },
  getCourseById(id) { return rows.courses.get(id) || null; },
};
const questionBank = {
  getQuestion(_db, id) {
    return id === 'question-1'
      ? { id, storage_state: 'host_committed', source_device_id: 'host-device', owner_user_id: 'admin-1' }
      : null;
  },
  deleteQuestion(_db, id, tenantId, context) {
    calls.push({ kind: 'question-delete', id, tenantId, context });
    return true;
  },
  createQuestion(_db, record) {
    calls.push({ kind: 'question-create-row', record });
    return { ...record, storage_state: 'local_draft' };
  },
};
const questionStorageService = {
  createTrustedAuthorityExecutorStorageContext(input) {
    calls.push({ kind: 'question-storage-credential', input });
    return Object.freeze({ kind: 'trusted-authority-executor' });
  },
  commitQuestionToBoundStore(id, input) {
    calls.push({ kind: 'question-storage-commit', id, input });
    return { questionId: id, storageState: 'host_committed' };
  },
  deleteCommittedQuestion(id, input) {
    calls.push({ kind: 'question-storage-delete', id, input });
    return { deleted: true, operationId: `delete-${id}` };
  },
};
const personalAssetRecordService = {
  create(input) {
    calls.push({ kind: 'asset-record-create', input });
    return { id: input.record.id, ownerUserId: input.actor.userId };
  },
};

const handlers = createAuthorityBusinessMutationHandlers({
  database,
  questionBank,
  questionStorageService,
  personalAssetRecordService,
});
const admin = {
  authorityId: 'authority-1',
  hostEpochId: 'epoch-1',
  hostDeviceId: 'host-device',
  scope: { kind: 'admin', userId: 'admin-1', authorityId: 'authority-1' },
};
const teacher = {
  authorityId: 'authority-1',
  hostEpochId: 'epoch-1',
  hostDeviceId: 'host-device',
  scope: {
    kind: 'teacher',
    userId: 'teacher-user',
    teacherId: 'teacher-1',
    authorityId: 'authority-1',
  },
};

assert.throws(
  () => handlers['student.create.v1']({
    authorityId: 'authority-1',
    actor: { userId: 'admin-1', deviceId: 'desktop-1', role: 'admin' },
    payload: {
      record: {
        id: 'student-draft-1',
        name: 'Draft student',
        balance_hours: 0,
        tenant_id: 'forbidden',
      },
    },
  }, admin),
  error => error?.code === 'AUTHORITY_COMMAND_FIELD_FORBIDDEN',
);

const created = handlers['student.create.v1']({
  authorityId: 'authority-1',
  actor: { userId: 'admin-1', deviceId: 'desktop-1', role: 'admin' },
  payload: {
    record: {
      id: 'student-draft-1',
      name: 'Draft student',
      balance_hours: 0,
      balance_money: 0,
    },
  },
}, admin);
assert.strictEqual(created.id, 'student-draft-1');
assert.deepStrictEqual(calls.find(call => call.kind === 'student-create'), {
  kind: 'student-create',
  record: {
    id: 'student-draft-1',
    name: 'Draft student',
    balance_hours: 0,
    balance_money: 0,
  },
  options: { tenantId: 'default', authorityCommand: true },
});

assert.throws(
  () => handlers['student.update.v1']({
    payload: {
      id: 'student-draft-1',
      expectedVersion: 'stale',
      changes: { notes: 'must not apply' },
    },
  }, admin),
  error => error?.code === 'AUTHORITY_COMMAND_VERSION_CONFLICT',
);
handlers['student.update.v1']({
  payload: {
    id: 'student-draft-1',
    expectedVersion: 'v1',
    changes: { notes: 'host checked' },
  },
}, admin);
assert.strictEqual(rows.students.get('student-draft-1').notes, 'host checked');

handlers['schedule.update.v1']({
  payload: { id: 'schedule-own', changes: { notes: 'teacher-owned schedule' } },
}, teacher);
assert.throws(
  () => handlers['schedule.update.v1']({
    payload: { id: 'schedule-other', changes: { notes: 'not owned' } },
  }, teacher),
  error => error?.code === 'AUTHORITY_COMMAND_SCOPE_FORBIDDEN',
);
assert.throws(
  () => handlers['schedule.update.v1']({
    payload: { id: 'schedule-own', changes: { calculated_teacher_fee: 999 } },
  }, teacher),
  error => error?.code === 'AUTHORITY_COMMAND_FIELD_FORBIDDEN',
);

handlers['personal-asset-record.create.v1']({
  authorityId: 'authority-1',
  actor: { userId: 'teacher-user', deviceId: 'desktop-2', role: 'teacher' },
  payload: {
    record: {
      id: 'asset-record-1',
      account_id: 'asset-account-1',
      date: '2026-07-28',
      type: 'expense',
      category_id: 'category-1',
      amount: 88,
    },
  },
}, teacher);
const assetCall = calls.find(call => call.kind === 'asset-record-create');
assert.strictEqual(assetCall.input.actor.userId, 'teacher-user');
assert.strictEqual(JSON.stringify(assetCall.input).includes('owner_user_id'), false);

const createdQuestion = handlers['question.create.v1']({
  authorityId: 'authority-1',
  commandId: 'command-question-create',
  actor: { userId: 'admin-1', deviceId: 'ordinary-device', role: 'admin' },
  payload: {
    record: {
      id: 'question-new',
      type: 'single',
      content: '1+1?',
      answer: '2',
    },
  },
}, admin);
assert.strictEqual(createdQuestion.storageState, 'host_committed');
assert.strictEqual(
  calls.find(call => call.kind === 'question-storage-commit').id,
  'question-new',
);

handlers['question.delete.v1']({
  authorityId: 'authority-1',
  commandId: 'command-question-delete',
  actor: { userId: 'admin-1', deviceId: 'ordinary-device', role: 'admin' },
  payload: { id: 'question-1' },
}, admin);
assert.strictEqual(calls.some(call => call.kind === 'question-storage-delete'), true);

assert.strictEqual(
  isAuthorityBusinessCommandAllowed({
    type: 'schedule.update.v1',
    scope: teacher.scope,
  }),
  true,
);
assert.strictEqual(
  isAuthorityBusinessCommandAllowed({
    type: 'student.create.v1',
    scope: { kind: 'student', userId: 'student-user' },
  }),
  false,
);
assert.strictEqual(
  isAuthorityBusinessCommandAllowed({
    type: 'personal-asset-record.create.v1',
    scope: { kind: 'student', userId: 'student-user' },
  }),
  true,
);
assert.strictEqual(
  isAuthorityBusinessCommandAllowed({
    type: 'legacy.raw-sync.v1',
    scope: admin.scope,
  }),
  false,
);

for (const type of [
  'student.create.v1', 'student.update.v1', 'student.delete.v1',
  'course.create.v1', 'course.update.v1', 'course.delete.v1',
  'schedule.create.v1', 'schedule.update.v1', 'schedule.delete.v1',
  'payment.create.v1', 'payment.update.v1', 'payment.delete.v1',
  'consumption.create.v1', 'consumption.update.v1', 'consumption.delete.v1',
  'teacher.create.v1', 'teacher.update.v1', 'teacher.delete.v1',
  'grade.create.v1', 'grade.delete.v1',
  'room.create.v1', 'room.update.v1', 'room.delete.v1',
  'institution.create.v1', 'institution.update.v1', 'institution.delete.v1',
  'question.create.v1', 'question.update.v1', 'question.delete.v1',
  'taxonomy-system.create.v1', 'taxonomy-system.update.v1', 'taxonomy-system.delete.v1',
  'taxonomy-node.create.v1', 'taxonomy-node.update.v1', 'taxonomy-node.delete.v1',
  'personal-asset-record.create.v1', 'personal-asset-record.update.v1',
  'personal-asset-record.delete.v1', 'personal-asset-category.create.v1',
  'personal-asset-category.delete.v1',
]) {
  assert.strictEqual(BUSINESS_COMMAND_TYPES.has(type), true, `missing business command ${type}`);
  assert.strictEqual(typeof handlers[type], 'function', `missing handler ${type}`);
}

console.log('authorityBusinessMutationService tests passed');
