const assert = require('assert');

const {
  SUPER_ADMIN_PHONE,
  CANONICAL_SUPER_ADMIN_ID,
  ROLES,
  normalizePhone,
  roleForUser,
  canReviewUsers,
  resolveTeacherBinding,
  scopeForUser,
} = require('./authorizationPolicy');

assert.strictEqual(SUPER_ADMIN_PHONE, '13732250653');
assert.strictEqual(CANONICAL_SUPER_ADMIN_ID, 'miniapp-admin-13732250653');
assert.deepStrictEqual(ROLES, ['super_admin', 'admin', 'teacher', 'student', 'pending']);
assert.strictEqual(normalizePhone('137 3225 0653'), '13732250653');

assert.strictEqual(
  roleForUser({ phone: '137 3225 0653', role: 'admin' }),
  'super_admin',
  'the fixed phone must always be promoted server-side'
);
assert.strictEqual(roleForUser({ user_type: 'teacher' }), 'teacher');
assert.strictEqual(roleForUser({ role: 'legacy_admin' }), 'pending');
assert.strictEqual(
  roleForUser({ role: 'legacy_admin', user_type: 'admin' }),
  'pending',
  'an explicit invalid role must not fall back to user_type'
);
assert.strictEqual(roleForUser(null), 'pending');
assert.strictEqual(canReviewUsers({ phone: '137 3225 0653', role: 'admin' }), false);
assert.strictEqual(roleForUser({
  id: 'duplicate-fixed-phone', phone: '13732250653', role: 'pending', status: 1,
  login_enabled: 1, review_status: 'approved', deleted: 0,
}), 'pending', 'a persisted duplicate fixed-phone user must not be promoted');
assert.strictEqual(roleForUser({
  id: CANONICAL_SUPER_ADMIN_ID, phone: '13732250653', role: 'super_admin', status: 1,
  login_enabled: 1, review_status: 'approved', deleted: 0,
}), 'super_admin');
assert.strictEqual(canReviewUsers({
  id: CANONICAL_SUPER_ADMIN_ID, phone: '13732250653', role: 'super_admin', status: 1,
  login_enabled: 1, review_status: 'approved', deleted: 0,
}), true);
assert.strictEqual(canReviewUsers({
  id: CANONICAL_SUPER_ADMIN_ID, phone: '13732250653', role: 'super_admin', status: 0,
  login_enabled: 1, review_status: 'approved', deleted: 0,
}), false);
assert.strictEqual(canReviewUsers({ phone: '18257136756', role: 'admin' }), false);
assert.strictEqual(canReviewUsers(null), false);

const teachers = [
  { id: 'teacher-1', phone: '138 0000 0000' },
  { id: 'teacher-2', phone: '13900000000' },
];
assert.deepStrictEqual(
  resolveTeacherBinding({ phone: '13800000000' }, teachers),
  { ok: true, teacherId: 'teacher-1' }
);

assert.deepStrictEqual(
  resolveTeacherBinding(
    { phone: '13800000000' },
    [...teachers, { id: 'teacher-3', phone: '138-0000-0000' }]
  ),
  { ok: false, code: 'TEACHER_PHONE_NOT_UNIQUE' }
);
assert.deepStrictEqual(
  resolveTeacherBinding({ phone: '13600000000' }, teachers),
  { ok: false, code: 'TEACHER_NOT_FOUND' }
);
assert.deepStrictEqual(
  resolveTeacherBinding({ phone: '---' }, [{ id: 'teacher-empty-phone' }]),
  { ok: false, code: 'TEACHER_NOT_FOUND' },
  'empty normalized phones must never bind'
);
assert.deepStrictEqual(
  resolveTeacherBinding({ phone: '13800000000' }, [{ phone: '13800000000' }]),
  { ok: false, code: 'TEACHER_BINDING_INVALID' },
  'a unique teacher without an id is not a valid binding'
);
assert.deepStrictEqual(
  resolveTeacherBinding(null, teachers),
  { ok: false, code: 'TEACHER_NOT_FOUND' }
);
assert.deepStrictEqual(
  resolveTeacherBinding({ phone: '13800000000' }, null),
  { ok: false, code: 'TEACHER_NOT_FOUND' }
);
assert.deepStrictEqual(
  resolveTeacherBinding({ phone: '13800000000' }, [null, 'teacher', teachers[0]]),
  { ok: true, teacherId: 'teacher-1' },
  'invalid teacher entries must be ignored without throwing'
);
assert.deepStrictEqual(
  resolveTeacherBinding(
    { phone: '13800000000' },
    [
      { id: 'teacher-deleted', phone: '13800000000', deleted: 1 },
      { id: 'teacher-deleted-boolean', phone: '13800000000', deleted: true },
      { id: 'teacher-active', phone: '13800000000', deleted: 0 },
    ]
  ),
  { ok: true, teacherId: 'teacher-active' },
  'deleted teachers must not participate in phone binding'
);

assert.deepStrictEqual(
  scopeForUser({ user_type: 'teacher', teacher_id: 'teacher-1' }),
  { kind: 'teacher', teacherId: 'teacher-1' }
);
assert.deepStrictEqual(scopeForUser({ role: 'teacher' }), { kind: 'none' });
assert.deepStrictEqual(scopeForUser({ role: 'pending' }), { kind: 'none' });
assert.deepStrictEqual(scopeForUser(null), { kind: 'none' });
assert.deepStrictEqual(scopeForUser({ role: 'admin' }), { kind: 'all' });
assert.deepStrictEqual(
  scopeForUser({ user_type: 'student', student_id: 'student-1' }),
  { kind: 'student', studentId: 'student-1' }
);

console.log('authorization policy checks passed');
