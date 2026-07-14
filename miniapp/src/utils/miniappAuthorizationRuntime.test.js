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
