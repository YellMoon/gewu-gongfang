const assert = require('assert');
const {
  UNRECOGNIZED_MODULES,
  VISITOR_MODULES,
  canUserSubmitMiniappWrite,
  deriveAccess,
  permissionIdentityKey,
  accountExperiencePolicy,
  scopeDashboardCollections,
  businessCacheIdentityKey,
  questionPaperTaskCacheKey,
  usesLimitedQuestionProjection,
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
const unboundStudent = { id: 'student-1', user_type: 'student', student_id: null, studentId: '' };
assert.strictEqual(usesLimitedQuestionProjection(unboundStudent), true);
assert.strictEqual(
  businessCacheIdentityKey(unboundStudent),
  '',
  'an unbound student must not receive a business cache namespace even when the account id equals a student profile id',
);
assert.deepStrictEqual(
  scopeDashboardCollections(unboundStudent, collections),
  { students: [], courses: [], schedules: [] },
  'an account id must never be used as a fallback student profile id',
);
const unboundTeacher = { id: 'teacher-1', user_type: 'teacher', teacher_id: null, teacherId: '' };
assert.strictEqual(usesLimitedQuestionProjection(unboundTeacher), true);
assert.strictEqual(businessCacheIdentityKey(unboundTeacher), '', 'an unbound teacher must not receive a business cache namespace');
assert.deepStrictEqual(
  scopeDashboardCollections(unboundTeacher, collections),
  { students: [], courses: [], schedules: [] },
  'an unbound teacher must not read cached courses or schedules',
);
assert.ok(businessCacheIdentityKey({ id: 'teacher-user', user_type: 'teacher', teacher_id: 'teacher-1' }).includes('teacher-1'));
assert.strictEqual(usesLimitedQuestionProjection({ id: 'teacher-user', user_type: 'teacher', teacher_id: 'teacher-1' }), false);
assert.strictEqual(usesLimitedQuestionProjection({ id: 'visitor-user', user_type: 'visitor' }), true);
assert.strictEqual(usesLimitedQuestionProjection({ id: 'admin-user', user_type: 'admin' }), false);
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
assert.strictEqual(typeof questionPaperTaskCacheKey, 'function', 'question-paper task history must have a normal scope-aware cache-key helper');
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

const unrecognized = {
  id: 'unrecognized-1', user_type: 'student', role: 'student', account_state: 'unrecognized',
  token_use: 'unrecognized-student', capabilities: [
    'experience:read', 'profile-application:read', 'profile-application:submit',
    'sample-questions:view', 'sample-paper-export',
  ],
};
const unrecognizedAccess = deriveAccess(unrecognized, {
  status: 'loaded', identityKey: permissionIdentityKey(unrecognized), capabilities: unrecognized.capabilities,
});
assert.deepStrictEqual(unrecognizedAccess.modules, UNRECOGNIZED_MODULES);
assert.strictEqual(unrecognizedAccess.experienceOnly, true);
assert.strictEqual(unrecognizedAccess.canReadUsers, false);
assert.strictEqual(unrecognizedAccess.canReviewUsers, false);
assert.strictEqual(unrecognizedAccess.canEditQuestionBank, false);
assert.strictEqual(businessCacheIdentityKey(unrecognized), '', 'unrecognized identities must never open a formal business cache');
assert.strictEqual(questionPaperTaskCacheKey(unrecognized), '', 'experience tasks stay in the isolated experience page');
const unrecognizedPolicy = accountExperiencePolicy(unrecognized);
assert.deepStrictEqual(unrecognizedPolicy.modules, UNRECOGNIZED_MODULES);
assert.strictEqual(unrecognizedPolicy.readonlyScope, 'account-experience');
assert.deepStrictEqual(unrecognizedPolicy.allowedWriteTasks, []);
assert.strictEqual(canUserSubmitMiniappWrite(unrecognized, 'asset-import', ['asset-import']), false);

const visitor = {
  id: 'visitor-1', user_type: 'visitor', role: 'visitor', identity_kind: 'visitor',
  account_state: 'visitor', token_use: 'miniapp-visitor', authority_id: 'authority-1',
  capabilities: [
    'projection:read', 'role-application:read', 'role-application:submit', 'question-preview:read',
  ],
};
const visitorAccess = deriveAccess(visitor, {
  status: 'idle', identityKey: '', capabilities: [],
});
assert.strictEqual(visitorAccess.role, 'visitor');
assert.deepStrictEqual(visitorAccess.modules, VISITOR_MODULES);
assert.strictEqual(visitorAccess.experienceOnly, true);
assert.strictEqual(visitorAccess.canReadUsers, false);
assert.strictEqual(visitorAccess.canEditQuestionBank, false);
assert.strictEqual(businessCacheIdentityKey(visitor), '', 'visitor must never open a raw business cache');
assert.ok(permissionIdentityKey(visitor).startsWith('visitor:visitor-1:authority-1'));
const visitorPolicy = accountExperiencePolicy(visitor);
assert.strictEqual(visitorPolicy.readonlyScope, 'authority-projection');
assert.deepStrictEqual(visitorPolicy.modules, VISITOR_MODULES);
assert.deepStrictEqual(visitorPolicy.allowedWriteTasks, []);
assert.strictEqual(canUserSubmitMiniappWrite(visitor, 'asset-import', ['asset-import']), false);

const legacyReview = { id: 'review-demo:admin:legacy', user_type: 'admin', is_review_demo: true };
const legacyAccess = deriveAccess(legacyReview, {
  status: 'loaded', identityKey: permissionIdentityKey(legacyReview), capabilities: ['business:all'],
});
assert.deepStrictEqual(legacyAccess.modules, [], 'legacy review identities must fail closed');
assert.deepStrictEqual(legacyAccess.capabilities, []);
assert.strictEqual(permissionIdentityKey(legacyReview), '');
assert.strictEqual(businessCacheIdentityKey(legacyReview), '');
assert.deepStrictEqual(accountExperiencePolicy(legacyReview).allowedWriteTasks, []);
assert.strictEqual(canUserSubmitMiniappWrite({ id: 'admin-1', user_type: 'admin' }, 'asset-import', ['asset-import']), true, 'normal write policy must remain unchanged');

console.log('miniapp authorization runtime checks passed');
