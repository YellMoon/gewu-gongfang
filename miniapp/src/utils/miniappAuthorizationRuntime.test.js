const assert = require('assert');
const {
  REVIEW_ADMIN_MODULES,
  REVIEW_STUDENT_MODULES,
  canUserSubmitMiniappWrite,
  deriveAccess,
  permissionIdentityKey,
  reviewRolePolicy,
  scopeDashboardCollections,
  businessCacheIdentityKey,
  questionPaperTaskCacheKey,
  createQuestionPaperTaskCacheRuntime,
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
assert.ok(businessCacheIdentityKey({ id: 'teacher-user', user_type: 'teacher', teacher_id: 'teacher-1' }).includes('teacher-1'));
assert.strictEqual(businessCacheIdentityKey({ id: 'pending-user', user_type: 'pending' }), '', 'pending users must not have a business cache namespace');
const normalStudentScope = { id: 'student-user', user_type: 'student', tenant_id: 'tenant-a', student_id: 'student-a', linked_student_ids: ['student-c', 'student-b'], review_status: 'approved', status: 1, login_enabled: 1 };
const normalStudentAliasScope = { id: 'student-user', role: 'student', tenantId: 'tenant-a', studentId: 'student-a', linkedStudentIds: ['student-b', 'student-c', 'student-b'], reviewStatus: 'approved', status: true, loginEnabled: true };
assert.strictEqual(businessCacheIdentityKey(normalStudentScope), businessCacheIdentityKey(normalStudentAliasScope), 'business cache scope aliases and student binding order must normalize stably');
for (const changedScope of [
  { ...normalStudentScope, tenant_id: 'tenant-b' },
  { ...normalStudentScope, linked_student_ids: ['student-d'] },
  { ...normalStudentScope, status: 0 },
]) {
  assert.notStrictEqual(businessCacheIdentityKey(normalStudentScope), businessCacheIdentityKey(changedScope), 'tenant, student binding, and account-state changes must receive a new business cache namespace');
}
assert.strictEqual(typeof questionPaperTaskCacheKey, 'function', 'question-paper task history must have a normal/review scope-aware cache-key helper');
assert.notStrictEqual(questionPaperTaskCacheKey(normalStudentScope), questionPaperTaskCacheKey({ ...normalStudentScope, tenant_id: 'tenant-b' }), 'normal task history must not cross tenant scope');
assert.notStrictEqual(questionPaperTaskCacheKey(normalStudentScope), questionPaperTaskCacheKey({ ...normalStudentScope, linked_student_ids: ['student-z'] }), 'normal task history must not cross student bindings');
assert.strictEqual(typeof createQuestionPaperTaskCacheRuntime, 'function', 'mounted question-bank state needs an atomic scope-aware cache runtime');
const taskStores = new Map();
let currentTaskIdentity = normalStudentScope;
const initialTaskKey = questionPaperTaskCacheKey(normalStudentScope);
const nextTaskIdentity = { ...normalStudentScope, tenant_id: 'tenant-b' };
const nextTaskKey = questionPaperTaskCacheKey(nextTaskIdentity);
taskStores.set(initialTaskKey, [{ localId: 'task-a' }]);
taskStores.set(nextTaskKey, [{ localId: 'task-b' }]);
const taskCacheRuntime = createQuestionPaperTaskCacheRuntime({
  readIdentity: () => currentTaskIdentity,
  read: key => taskStores.get(key) || [],
  write: (key, tasks) => taskStores.set(key, tasks),
});
const initialTaskSnapshot = taskCacheRuntime.snapshot();
assert.deepStrictEqual(initialTaskSnapshot.tasks, [{ localId: 'task-a' }]);
currentTaskIdentity = nextTaskIdentity;
const rejectedTaskWrite = taskCacheRuntime.replace([{ localId: 'stale-task-a' }], initialTaskSnapshot.scopeKey);
assert.strictEqual(rejectedTaskWrite.written, false, 'a mounted old-scope task snapshot must never be written into the newly current scope');
assert.deepStrictEqual(taskStores.get(nextTaskKey), [{ localId: 'task-b' }], 'a rejected old-scope write must leave the new tenant cache untouched');
assert.deepStrictEqual(rejectedTaskWrite.snapshot, { scopeKey: nextTaskKey, tasks: [{ localId: 'task-b' }] }, 'scope switch must atomically reload the new task namespace');

const reviewAdmin = {
  id: 'review-demo:admin:session-a', user_type: 'admin', is_review_demo: true, read_only: true,
  review_demo_session_id: 'session-a', review_status: 'approved', status: 1, login_enabled: 1,
};
const reviewAdminAccess = deriveAccess(reviewAdmin, {
  status: 'loaded',
  identityKey: permissionIdentityKey(reviewAdmin),
  capabilities: [
    'review-demo:read', 'review-demo:admin', 'review-demo:student', 'review-demo:paper-export',
    'question-bank:view', 'question-bank:edit', 'users:review', 'business:all', 'business:teacher-scope',
  ],
});
assert.deepStrictEqual(reviewAdminAccess.modules, REVIEW_ADMIN_MODULES, 'administrator review should map only to existing read-only administrator pages');
assert.deepStrictEqual(reviewAdminAccess.capabilities, [
  'review-demo:read', 'review-demo:admin', 'review-demo:paper-export', 'question-bank:view',
], 'review access must remove poisoned real-user and wrong-role capabilities');
assert.ok(!reviewAdminAccess.modules.includes('admin'), 'administrator review must not expose the user-review workbench');
assert.strictEqual(reviewAdminAccess.canReadUsers, false);
assert.strictEqual(reviewAdminAccess.canReviewUsers, false);
assert.strictEqual(reviewAdminAccess.canEditQuestionBank, false);

const reviewStudent = {
  id: 'review-demo:student:session-s', user_type: 'student', is_review_demo: true, read_only: true,
  review_demo_session_id: 'session-s', student_id: 'review-demo-student', review_status: 'approved', status: 1, login_enabled: 1,
};
const reviewStudentAccess = deriveAccess(reviewStudent, {
  status: 'loaded',
  identityKey: permissionIdentityKey(reviewStudent),
  capabilities: ['review-demo:read', 'review-demo:student', 'review-demo:paper-export', 'question-bank:view'],
});
assert.deepStrictEqual(reviewStudentAccess.modules, REVIEW_STUDENT_MODULES, 'student review should map to scheduling and question bank only');
assert.strictEqual(reviewStudentAccess.canReviewUsers, false);
assert.strictEqual(reviewStudentAccess.canEditQuestionBank, false);
assert.ok(permissionIdentityKey(reviewAdmin).includes('session-a'), 'review permission keys must include the server session identity');
assert.ok(businessCacheIdentityKey(reviewAdmin).includes('session-a'), 'review business-cache keys must include the server session identity');
assert.notStrictEqual(
  businessCacheIdentityKey(reviewAdmin),
  businessCacheIdentityKey({ id: reviewAdmin.id, user_type: 'admin' }),
  'review cache namespaces must never collide with real users',
);
const reviewAdminPolicy = reviewRolePolicy(reviewAdmin);
assert.deepStrictEqual(reviewAdminPolicy.modules, REVIEW_ADMIN_MODULES);
assert.deepStrictEqual(reviewAdminPolicy.allowedWriteTasks, [], 'review role policy must not inherit normal admin write tasks');
assert.deepStrictEqual(reviewAdminPolicy.capabilities, reviewAdminAccess.capabilities);
assert.strictEqual(reviewAdminPolicy.canReadAllSnapshots, false);
assert.strictEqual(reviewAdminPolicy.canReviewUsers, false);
assert.strictEqual(reviewAdminPolicy.canEditQuestionBank, false);
assert.strictEqual(canUserSubmitMiniappWrite(reviewAdmin, 'asset-import', ['asset-import']), false, 'review identities must fail every generic write guard');
const malformedReview = { ...reviewAdmin, id: 'admin-1' };
const malformedAccess = deriveAccess(malformedReview, {
  status: 'loaded', identityKey: permissionIdentityKey(malformedReview), capabilities: ['business:all', 'question-bank:edit'],
});
assert.deepStrictEqual(malformedAccess.modules, [], 'malformed review markers must fail closed instead of falling back to normal admin');
assert.deepStrictEqual(malformedAccess.capabilities, []);
assert.strictEqual(businessCacheIdentityKey(malformedReview), '', 'malformed review identities must not receive a cache namespace');
assert.deepStrictEqual(reviewRolePolicy(malformedReview).allowedWriteTasks, []);
assert.strictEqual(canUserSubmitMiniappWrite({ id: 'admin-1', user_type: 'admin' }, 'asset-import', ['asset-import']), true, 'normal write policy must remain unchanged');

console.log('miniapp authorization runtime checks passed');
