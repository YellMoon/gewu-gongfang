const assert = require('assert');

const {
  buildMiniappLoginUser,
  getMiniappLoginDenialReason,
} = require('./miniappAuthPolicy');

assert.strictEqual(
  getMiniappLoginDenialReason(null),
  'MINIAPP_USER_NOT_PREAUTHORIZED',
  'unknown miniapp users must be denied instead of auto-created'
);

assert.strictEqual(
  getMiniappLoginDenialReason({ role: 'teacher', login_enabled: 1, deleted: 0 }),
  'MINIAPP_TEACHER_NOT_LINKED',
  'teacher login must be bound to a local teacher record'
);

assert.strictEqual(
  getMiniappLoginDenialReason({ role: 'teacher', login_enabled: 1, deleted: 0, teacher_id: 'teacher-1' }),
  '',
  'enabled linked teachers should be allowed'
);

assert.strictEqual(
  getMiniappLoginDenialReason({ role: 'student', login_enabled: 0, deleted: 0, student_id: 'stu-1' }),
  'MINIAPP_LOGIN_DISABLED',
  'disabled student login must be denied'
);

assert.strictEqual(
  getMiniappLoginDenialReason({ role: 'student', login_enabled: 1, deleted: 0 }),
  'MINIAPP_STUDENT_NOT_LINKED',
  'student login must be bound to at least one local student record'
);

assert.strictEqual(
  getMiniappLoginDenialReason({ role: 'student', login_enabled: 1, deleted: 0, student_id: 'stu-1' }),
  '',
  'enabled linked students should be allowed'
);

const superAdminPayload = buildMiniappLoginUser({
  id: 'super-admin-1',
  role: 'super_admin',
  nickname: 'Super Admin',
  avatar_url: 'https://example.com/a.png',
  phone: '13800000000',
  login_enabled: 1,
});

assert.deepStrictEqual(superAdminPayload, {
  id: 'super-admin-1',
  name: 'Super Admin',
  nickname: 'Super Admin',
  avatar: 'https://example.com/a.png',
  avatarUrl: 'https://example.com/a.png',
  phone: '13800000000',
  role: 'super_admin',
  user_type: 'super_admin',
  student_id: null,
  linked_student_ids: [],
});

const studentPayload = buildMiniappLoginUser({
  id: 'user-1',
  role: 'student',
  nickname: 'Student',
  login_enabled: 1,
  student_id: 'stu-1',
  linked_student_ids: JSON.stringify(['stu-1', 'stu-2']),
});

assert.strictEqual(studentPayload.user_type, 'student');
assert.deepStrictEqual(studentPayload.linked_student_ids, ['stu-1', 'stu-2']);

console.log('miniapp auth policy checks passed');
