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
  questionBasketCacheKey,
  questionPaperTaskCacheKey,
  usesLimitedQuestionProjection,
  createQuestionPaperTaskCacheRuntime,
} = require('./miniappAuthorizationRuntime');

const capabilities = {
  super_admin: ['business:all', 'question-bank:view'],
  teacher: ['business:teacher-scope', 'question-bank:view'],
  student: ['question-bank:view'],
};

for (const role of Object.keys(capabilities)) {
  const user = { id: `${role}-1`, user_type: role, teacher_id: role === 'teacher' ? 'teacher-1' : undefined };
  const access = deriveAccess(user, {
    status: 'loaded', identityKey: permissionIdentityKey(user), capabilities: capabilities[role],
  });
  assert.strictEqual(access.role, role);
  assert.strictEqual(Object.hasOwn(access, 'canReviewUsers'), false, 'miniapp access must not expose a role-approval capability');
  assert.strictEqual(Object.hasOwn(access, 'canReadUsers'), false, 'miniapp access must not expose a user-management capability');
  assert.strictEqual(Object.hasOwn(access, 'canEditQuestionBank'), false, 'miniapp access must not expose direct question editing');
  assert.strictEqual(access.canDeleteCommittedQuestions, false);
}

const superAdmin = { id: 'super-admin-1', user_type: 'super_admin' };
assert.deepStrictEqual(deriveAccess(superAdmin, {
  status: 'loaded', identityKey: permissionIdentityKey(superAdmin), capabilities: [],
}).modules, [], 'empty server capabilities must fail closed');
assert.deepStrictEqual(deriveAccess(superAdmin, { status: 'error', identityKey: permissionIdentityKey(superAdmin), capabilities: [] }).modules, [], 'permission fetch failure must fail closed');
assert.deepStrictEqual(deriveAccess(superAdmin, { status: 'idle', identityKey: permissionIdentityKey(superAdmin), capabilities: [] }).modules, [], 'permissions must remain closed before loading');
assert.deepStrictEqual(deriveAccess(superAdmin, {
  status: 'loaded', identityKey: 'other-user:super-admin', capabilities: capabilities.super_admin,
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
const legacyPendingScoped = scopeDashboardCollections({ id: 'pending-user', user_type: 'pending' }, collections);
assert.deepStrictEqual(legacyPendingScoped, { students: [], courses: [], schedules: [] }, 'legacy pending records must not read business cache');
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
assert.strictEqual(usesLimitedQuestionProjection({ id: 'retired-user', user_type: 'retired' }), true, 'retired admin identities must never receive a business projection');
assert.strictEqual(businessCacheIdentityKey({ id: 'pending-user', user_type: 'pending' }), '', 'legacy pending identities must not have a business cache namespace');
const normalStudentScope = { id: 'student-user', user_type: 'student', tenant_id: 'tenant-a', student_id: 'student-a', linked_student_ids: ['student-c', 'student-b'], review_status: 'approved', status: 1, login_enabled: 1 };
assert.strictEqual(usesLimitedQuestionProjection(normalStudentScope), true, 'students retain a read-only question preview even after their teaching profile is linked');
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
assert.strictEqual(typeof questionBasketCacheKey, 'function', 'question selection must have a normal scope-aware basket key helper');
assert.notStrictEqual(questionPaperTaskCacheKey(normalStudentScope), questionPaperTaskCacheKey({ ...normalStudentScope, tenant_id: 'tenant-b' }), 'normal task history must not cross tenant scope');
assert.notStrictEqual(questionPaperTaskCacheKey(normalStudentScope), questionPaperTaskCacheKey({ ...normalStudentScope, linked_student_ids: ['student-z'] }), 'normal task history must not cross student bindings');
const teacherBasketScope = { id: 'teacher-basket-user', user_type: 'teacher', teacher_id: 'teacher-basket-1', tenant_id: 'tenant-a' };
assert.notStrictEqual(questionBasketCacheKey(teacherBasketScope), questionBasketCacheKey({ ...teacherBasketScope, tenant_id: 'tenant-b' }), 'question basket must not cross tenant scope');
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

for (const legacyUser of [
  { id: 'retired-1', user_type: 'retired' },
  { id: 'pending-1', user_type: 'pending' },
  { id: 'unsupported-1', user_type: 'student', account_state: 'unsupported', token_use: 'unsupported-token' },
]) {
  const legacyAccess = deriveAccess(legacyUser, {
    status: 'loaded', identityKey: permissionIdentityKey(legacyUser), capabilities: ['business:all'],
  });
  assert.strictEqual(legacyAccess.role, 'visitor', 'retired account categories must normalize to the only non-formal role');
  assert.deepStrictEqual(legacyAccess.modules, [], 'retired account categories must fail closed until the user signs in again');
  assert.strictEqual(businessCacheIdentityKey(legacyUser), '', 'retired account categories must never open a business cache');
  assert.strictEqual(accountExperiencePolicy(legacyUser), null, 'retired account categories must not retain a parallel account experience');
  assert.strictEqual(canUserSubmitMiniappWrite(legacyUser, 'asset-import', ['asset-import']), false);
}

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
assert.strictEqual(Object.hasOwn(visitorAccess, 'canReadUsers'), false);
assert.strictEqual(Object.hasOwn(visitorAccess, 'canEditQuestionBank'), false);
assert.strictEqual(businessCacheIdentityKey(visitor), '', 'visitor must never open a raw business cache');
assert.ok(permissionIdentityKey(visitor).startsWith('visitor:visitor-1:authority-1'));
const visitorPolicy = accountExperiencePolicy(visitor);
assert.strictEqual(visitorPolicy.readonlyScope, 'authority-projection');
assert.strictEqual(visitorPolicy.experienceOnly, true);
assert.deepStrictEqual(visitorPolicy.modules, VISITOR_MODULES);
assert.deepStrictEqual(visitorPolicy.allowedWriteTasks, []);
assert.strictEqual(canUserSubmitMiniappWrite(visitor, 'asset-import', ['asset-import']), false);

const invalidIdentity = { id: 'invalid-identity', user_type: 'retired', account_state: 'invalid', token_use: 'invalid-token' };
const legacyAccess = deriveAccess(invalidIdentity, {
  status: 'loaded', identityKey: permissionIdentityKey(invalidIdentity), capabilities: ['business:all'],
});
assert.deepStrictEqual(legacyAccess.modules, [], 'legacy review identities must fail closed');
assert.deepStrictEqual(legacyAccess.capabilities, []);
assert.strictEqual(permissionIdentityKey(invalidIdentity), '');
assert.strictEqual(businessCacheIdentityKey(invalidIdentity), '');
assert.strictEqual(accountExperiencePolicy(invalidIdentity), null);
assert.strictEqual(canUserSubmitMiniappWrite({ id: 'teacher-1', user_type: 'teacher' }, 'asset-import', ['asset-import']), true, 'formal write policy must remain unchanged');
assert.strictEqual(canUserSubmitMiniappWrite({ id: 'student-1', user_type: 'student' }, 'asset-import', ['asset-import']), false, 'students must not be offered a personal-asset import that cloud policy rejects');
assert.strictEqual(canUserSubmitMiniappWrite({ id: 'student-1', user_type: 'student' }, 'paper-export-pdf', ['paper-export-pdf']), false, 'students must not be offered an export task that cloud policy rejects');

console.log('miniapp authorization runtime checks passed');
