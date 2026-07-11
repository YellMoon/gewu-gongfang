const assert = require('assert');
const {
  deriveAccess,
  permissionIdentityKey,
  scopeDashboardCollections,
  businessCacheIdentityKey,
} = require('./miniappAuthorizationRuntime');

const capabilities = {
  super_admin: ['users:review', 'business:all', 'question-bank:view', 'question-bank:edit'],
  admin: ['business:all', 'question-bank:view', 'question-bank:edit'],
  teacher: ['business:teacher-scope', 'question-bank:view', 'question-bank:edit'],
  student: ['question-bank:view'],
  pending: [],
};

for (const role of Object.keys(capabilities)) {
  const user = { id: `${role}-1`, user_type: role, teacher_id: role === 'teacher' ? 'teacher-1' : undefined };
  const access = deriveAccess(user, {
    status: 'loaded', identityKey: permissionIdentityKey(user), capabilities: capabilities[role],
  });
  assert.strictEqual(access.role, role);
  assert.strictEqual(access.canReviewUsers, role === 'super_admin');
  assert.strictEqual(access.canReadUsers, role === 'super_admin' || role === 'admin');
  assert.strictEqual(access.canEditQuestionBank, ['super_admin', 'admin', 'teacher'].includes(role));
  assert.strictEqual(access.canDeleteCommittedQuestions, false);
  if (role === 'pending') assert.deepStrictEqual(access.modules, []);
}

const admin = { id: 'admin-1', user_type: 'admin' };
assert.deepStrictEqual(deriveAccess(admin, {
  status: 'loaded', identityKey: permissionIdentityKey(admin), capabilities: [],
}).modules, [], 'empty server capabilities must fail closed');
assert.deepStrictEqual(deriveAccess(admin, { status: 'error', identityKey: permissionIdentityKey(admin), capabilities: [] }).modules, [], 'permission fetch failure must fail closed');
assert.deepStrictEqual(deriveAccess(admin, { status: 'idle', identityKey: permissionIdentityKey(admin), capabilities: [] }).modules, [], 'permissions must remain closed before loading');
assert.deepStrictEqual(deriveAccess(admin, {
  status: 'loaded', identityKey: 'other-user:admin', capabilities: capabilities.admin,
}).modules, [], 'cached capabilities from another identity must never be reused');

const collections = {
  students: [{ id: 'student-1' }, { id: 'student-2' }],
  courses: [{ id: 'course-1', teacher_id: 'teacher-1', student_ids: ['student-1'] }, { id: 'course-2', teacher_id: 'teacher-2', student_ids: ['student-2'] }],
  schedules: [{ id: 'schedule-1', teacher_id: 'teacher-1', course_id: 'course-1' }, { id: 'schedule-2', teacher_id: 'teacher-2', course_id: 'course-2' }],
};
const teacherScoped = scopeDashboardCollections({ id: 'teacher-user', user_type: 'teacher', teacher_id: 'teacher-1' }, collections);
assert.deepStrictEqual(teacherScoped.schedules.map(item => item.id), ['schedule-1']);
assert.deepStrictEqual(teacherScoped.courses.map(item => item.id), ['course-1']);
assert.deepStrictEqual(teacherScoped.students.map(item => item.id), ['student-1']);
const pendingScoped = scopeDashboardCollections({ id: 'pending-user', user_type: 'pending' }, collections);
assert.deepStrictEqual(pendingScoped, { students: [], courses: [], schedules: [] }, 'pending users must not read business cache');
assert.strictEqual(businessCacheIdentityKey({ id: 'teacher-user', user_type: 'teacher', teacher_id: 'teacher-1' }), 'teacher-user:teacher:teacher-1');
assert.strictEqual(businessCacheIdentityKey({ id: 'pending-user', user_type: 'pending' }), '', 'pending users must not have a business cache namespace');

console.log('miniapp authorization runtime checks passed');
