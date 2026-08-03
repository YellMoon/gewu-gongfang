const assert = require('assert');
const {
  createAuthorityCommandHandlers,
  createAuthorityCommandPolicy,
} = require('./authorityCommandRegistry');

const calls = [];
const roleApplicationService = {
  submit(input) {
    calls.push({ kind: 'role-submit', input });
    return { applicationId: 'application-1', status: 'pending' };
  },
  approve(input) {
    calls.push({ kind: 'role-approve', input });
    return { application: { applicationId: input.applicationId, status: 'approved' } };
  },
  reject(input) {
    calls.push({ kind: 'role-reject', input });
    return { applicationId: input.applicationId, status: 'rejected' };
  },
  grantAdmin(input) {
    calls.push({ kind: 'role-admin-grant', input });
    return { userId: input.userId, role: 'admin' };
  },
};
const personalAssetAccountService = {
  create(input) {
    calls.push({ kind: 'asset-create', input });
    return { accountId: 'asset-1', ownerUserId: input.actor.userId };
  },
  update(input) {
    calls.push({ kind: 'asset-update', input });
    return { accountId: input.accountId };
  },
};
const database = {
  getScheduleById(id) {
    if (id === 'schedule-other') return { id, course_id: 'course-other' };
    return id === 'schedule-1' ? { id, course_id: 'course-1' } : null;
  },
  getCourseById(id) {
    if (id === 'course-1') return { id, teacher_id: 'teacher-1' };
    if (id === 'course-other') return { id, teacher_id: 'teacher-other' };
    return null;
  },
  updateSchedule(id, changes, options) {
    calls.push({ kind: 'schedule', id, changes, options });
    return { id, ...changes };
  },
  updateCourse(id, changes, options) {
    calls.push({ kind: 'course', id, changes, options });
    return { id, ...changes };
  },
};
const handlers = createAuthorityCommandHandlers({
  database,
  roleApplicationService,
  personalAssetAccountService,
});
const teacherAuthorization = {
  scope: { kind: 'teacher', userId: 'user-1', teacherId: 'teacher-1', authorityId: 'authority-1' },
};

const scheduleResult = handlers['schedule.update.v1']({
  payload: {
    id: 'schedule-1',
    changes: { start_time: '2026-07-29T09:00:00.000Z', notes: 'isolated change' },
  },
}, teacherAuthorization);
assert.strictEqual(scheduleResult.id, 'schedule-1');
assert.deepStrictEqual(calls[0], {
  kind: 'schedule',
  id: 'schedule-1',
  changes: { start_time: '2026-07-29T09:00:00.000Z', notes: 'isolated change' },
  options: { tenantId: 'default', authorityCommand: true },
});
assert.throws(
  () => handlers['schedule.update.v1']({
    payload: { id: 'schedule-other', changes: { notes: 'forbidden' } },
  }, teacherAuthorization),
  error => error?.code === 'AUTHORITY_COMMAND_SCOPE_FORBIDDEN',
);
assert.throws(
  () => handlers['schedule.update.v1']({
    payload: { id: 'schedule-1', changes: { calculated_teacher_fee: 999999 } },
  }, teacherAuthorization),
  error => error?.code === 'AUTHORITY_COMMAND_FIELD_FORBIDDEN',
);

const adminAuthorization = {
  scope: { kind: 'admin', userId: 'admin-1', authorityId: 'authority-1' },
};
const courseResult = handlers['course.update.v1']({
  payload: { id: 'course-other', changes: { notes: 'admin change', active: false } },
}, adminAuthorization);
assert.strictEqual(courseResult.id, 'course-other');

const visitorAuthorization = {
  scope: { kind: 'visitor', userId: 'visitor-1' },
};
const roleApplication = handlers['role-application.submit.v1']({
  authorityId: 'authority-1',
  payload: { requestedRole: 'teacher' },
}, visitorAuthorization);
assert.equal(roleApplication.status, 'pending');
assert.deepStrictEqual(calls.find(call => call.kind === 'role-submit').input, {
  authorityId: 'authority-1',
  userId: 'visitor-1',
  requestedRole: 'teacher',
  bindingHint: undefined,
});
handlers['role-application.review.v1']({
  payload: { applicationId: 'application-1', decision: 'approve' },
}, {
  scope: { kind: 'super_admin', userId: 'super-1', authorityId: 'authority-1' },
});
assert.equal(calls.some(call => call.kind === 'role-approve'), true);
assert.deepStrictEqual(calls.find(call => call.kind === 'role-approve').input, {
  actor: {
    userId: 'super-1',
    roles: ['super_admin'],
    authorityId: 'authority-1',
    isAuthorityHost: true,
  },
  applicationId: 'application-1',
}, 'a review command is only executed by the authority-host runtime');
const directAdminGrant = handlers['role-admin.grant.v1']({
  authorityId: 'authority-1',
  payload: { userId: 'existing-user-1' },
}, {
  scope: { kind: 'super_admin', userId: 'super-1', authorityId: 'authority-1' },
});
assert.deepStrictEqual(directAdminGrant, { userId: 'existing-user-1', role: 'admin' });
assert.deepStrictEqual(calls.find(call => call.kind === 'role-admin-grant').input, {
  actor: {
    userId: 'super-1',
    roles: ['super_admin'],
    authorityId: 'authority-1',
    isAuthorityHost: true,
  },
  authorityId: 'authority-1',
  userId: 'existing-user-1',
}, 'a direct administrator grant must only be executed by the authority-host runtime');

const asset = handlers['personal-asset-account.create.v1']({
  authorityId: 'authority-1',
  payload: { accountType: 'wechat', label: 'wallet' },
}, visitorAuthorization);
assert.equal(asset.ownerUserId, 'visitor-1');

const policy = createAuthorityCommandPolicy();
assert.strictEqual(policy({ type: 'schedule.update.v1', scope: teacherAuthorization.scope }), true);
assert.strictEqual(policy({ type: 'course.update.v1', scope: adminAuthorization.scope }), true);
assert.strictEqual(policy({ type: 'schedule.update.v1', scope: { kind: 'student' } }), false);
assert.strictEqual(policy({ type: 'role-application.submit.v1', scope: visitorAuthorization.scope }), true);
assert.strictEqual(policy({ type: 'role-application.review.v1', scope: { kind: 'admin' } }), false);
assert.strictEqual(policy({ type: 'role-application.review.v1', scope: { kind: 'super_admin' } }), true);
assert.strictEqual(policy({ type: 'role-admin.grant.v1', scope: { kind: 'admin' } }), false);
assert.strictEqual(policy({ type: 'role-admin.grant.v1', scope: { kind: 'super_admin' } }), true);
assert.strictEqual(policy({ type: 'personal-asset-account.create.v1', scope: { kind: 'student' } }), true);
assert.strictEqual(policy({ type: 'legacy.raw-sync.v1', scope: adminAuthorization.scope }), false);

console.log('authorityCommandRegistry tests passed');
