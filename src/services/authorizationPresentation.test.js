const assert = require('assert');

(async () => {
  const { createAuthorizationPresentation, authorizationEmptyText, authorizationErrorText } = await import('./authorizationPresentation.mjs');
  const ordinary = createAuthorizationPresentation({ capabilities: ['scheduling:view'], users: [
    { id: 'admin-1', role: 'admin', review_status: 'approved', status: 1, login_enabled: 1 },
  ] });
  assert.strictEqual(ordinary.canReview, false);
  assert.strictEqual(ordinary.rows[0].roleLabel, '\u666e\u901a\u7ba1\u7406\u5458');
  assert.strictEqual(ordinary.rows[0].statusLabel, '\u5df2\u901a\u8fc7');
  assert.strictEqual(ordinary.rows[0].teacherBindingLabel, '\u4e0d\u9002\u7528');
  assert.strictEqual(ordinary.rows[0].canReview, false);

  const superAdmin = createAuthorizationPresentation({ capabilities: ['users:review'], users: [
    { id: 'pending-1', role: 'pending', review_status: 'pending', status: 1, login_enabled: 0 },
    { id: 'teacher-1', role: 'teacher', review_status: 'approved', teacher_id: 'teacher-42', status: 1, login_enabled: 1 },
    { id: 'teacher-missing', role: 'teacher', review_status: 'approved', teacher_id: null, status: 1, login_enabled: 1 },
    { id: 'disabled-1', role: 'student', review_status: 'approved', status: 0, login_enabled: 0 },
  ] });
  assert.strictEqual(superAdmin.canReview, true);
  assert.strictEqual(superAdmin.rows[0].statusLabel, '\u5f85\u5ba1\u6838');
  assert.strictEqual(superAdmin.rows[0].canReview, true);
  assert.strictEqual(superAdmin.rows[1].teacherBindingLabel, '\u5df2\u7ed1\u5b9a teacher-42');
  assert.strictEqual(superAdmin.rows[2].teacherBindingLabel, '\u672a\u627e\u5230\u5339\u914d\u6559\u5e08');
  assert.strictEqual(superAdmin.rows[2].bindingState, 'teacher-not-found');
  assert.strictEqual(superAdmin.rows[3].statusLabel, '\u5df2\u505c\u7528');
  assert.strictEqual(superAdmin.rows[3].canReview, false);

  const duplicate = createAuthorizationPresentation({ capabilities: ['users:review'], users: [
    { id: 'teacher-duplicate', role: 'pending', review_status: 'pending', binding_error: 'TEACHER_PHONE_NOT_UNIQUE' },
    { id: 'teacher-none', role: 'pending', review_status: 'pending', binding_error: 'TEACHER_NOT_FOUND' },
  ] });
  assert.strictEqual(duplicate.rows[0].teacherBindingLabel, '\u624b\u673a\u53f7\u5339\u914d\u5230\u591a\u4e2a\u6559\u5e08');
  assert.strictEqual(duplicate.rows[0].bindingState, 'duplicate-teacher-phone');
  assert.strictEqual(duplicate.rows[1].teacherBindingLabel, '\u672a\u627e\u5230\u5339\u914d\u6559\u5e08');
  assert.strictEqual(duplicate.rows[1].bindingState, 'teacher-not-found');

  assert.strictEqual(authorizationEmptyText({ search: '' }), '\u6682\u65e0\u7528\u6237\u8bb0\u5f55');
  assert.strictEqual(authorizationEmptyText({ search: '\u5f20' }), '\u6ca1\u6709\u7b26\u5408\u7b5b\u9009\u6761\u4ef6\u7684\u7528\u6237');
  assert.strictEqual(authorizationErrorText('SUPER_ADMIN_REQUIRED'), '\u4ec5\u8d85\u7ea7\u7ba1\u7406\u5458\u53ef\u4ee5\u5ba1\u6838\u7528\u6237');
  assert.strictEqual(authorizationErrorText('TEACHER_NOT_FOUND'), '\u8be5\u624b\u673a\u53f7\u672a\u5339\u914d\u5230\u6559\u5e08\uff0c\u65e0\u6cd5\u8bbe\u4e3a\u8001\u5e08');
  assert.strictEqual(authorizationErrorText('DUPLICATE_TEACHER_PHONE'), '\u8be5\u624b\u673a\u53f7\u5339\u914d\u5230\u591a\u4e2a\u6559\u5e08\uff0c\u8bf7\u5148\u6e05\u7406\u91cd\u590d\u6570\u636e');
  assert.strictEqual(authorizationErrorText('TEACHER_PHONE_NOT_UNIQUE'), '\u8be5\u624b\u673a\u53f7\u5339\u914d\u5230\u591a\u4e2a\u6559\u5e08\uff0c\u8bf7\u5148\u6e05\u7406\u91cd\u590d\u6570\u636e');
  assert.strictEqual(authorizationErrorText('NETWORK_ERROR'), '\u7528\u6237\u6570\u636e\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5');
  console.log('authorization presentation tests passed');
})().catch(error => { console.error(error); process.exit(1); });
