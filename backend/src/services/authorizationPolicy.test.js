const assert = require('assert');

const {
  SUPER_ADMIN_PHONE,
  ROLES,
  normalizePhone,
  roleForUser,
  canReviewUsers,
  resolveTeacherBinding,
  scopeForUser,
} = require('./authorizationPolicy');

assert.strictEqual(SUPER_ADMIN_PHONE, '13732250653');
assert.deepStrictEqual(ROLES, ['super_admin', 'admin', 'teacher', 'student', 'pending']);
assert.strictEqual(normalizePhone('137 3225 0653'), '13732250653');

assert.strictEqual(
  roleForUser({ phone: '137 3225 0653', role: 'admin' }),
  'super_admin',
  'the fixed phone must always be promoted server-side'
);
assert.strictEqual(roleForUser({ user_type: 'teacher' }), 'teacher');
assert.strictEqual(roleForUser({ role: 'legacy_admin' }), 'pending');
assert.strictEqual(canReviewUsers({ phone: '137 3225 0653', role: 'admin' }), true);
assert.strictEqual(canReviewUsers({ phone: '18257136756', role: 'admin' }), false);

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
assert.deepStrictEqual(scopeForUser({ role: 'admin' }), { kind: 'all' });
assert.deepStrictEqual(
  scopeForUser({ user_type: 'student', student_id: 'student-1' }),
  { kind: 'student', studentId: 'student-1' }
);

console.log('authorization policy checks passed');
