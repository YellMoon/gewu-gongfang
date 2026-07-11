const roleLabels = Object.freeze({
  super_admin: '\u8d85\u7ea7\u7ba1\u7406\u5458', admin: '\u666e\u901a\u7ba1\u7406\u5458',
  teacher: '\u8001\u5e08', student: '\u5b66\u751f', pending: '\u5f85\u5206\u7c7b',
});
const statusLabels = Object.freeze({ pending: '\u5f85\u5ba1\u6838', approved: '\u5df2\u901a\u8fc7', rejected: '\u5df2\u62d2\u7edd' });

function bindingPresentation(user) {
  if (user.role !== 'teacher') return { bindingState: 'not-applicable', teacherBindingLabel: '\u4e0d\u9002\u7528' };
  if (user.binding_error === 'DUPLICATE_TEACHER_PHONE') return { bindingState: 'duplicate-teacher-phone', teacherBindingLabel: '\u624b\u673a\u53f7\u5339\u914d\u5230\u591a\u4e2a\u6559\u5e08' };
  if (!user.teacher_id) return { bindingState: 'teacher-not-found', teacherBindingLabel: '\u672a\u627e\u5230\u5339\u914d\u6559\u5e08' };
  return { bindingState: 'bound', teacherBindingLabel: `\u5df2\u7ed1\u5b9a ${user.teacher_id}` };
}

export function createAuthorizationPresentation({ capabilities = [], users = [] } = {}) {
  const canReview = capabilities.includes('users:review');
  const rows = users.map(user => {
    const disabled = Number(user.status) !== 1 || Number(user.login_enabled) !== 1 && user.review_status === 'approved';
    return { ...user, ...bindingPresentation(user), roleLabel: roleLabels[user.role] || '\u672a\u5206\u7c7b',
      statusLabel: disabled ? '\u5df2\u505c\u7528' : statusLabels[user.review_status] || '\u672a\u77e5\u72b6\u6001',
      disabled, canReview: canReview && !disabled && user.role !== 'super_admin' };
  });
  return { canReview, rows };
}

export function authorizationEmptyText({ search = '', role = '', status = '' } = {}) {
  return search || role || status ? '\u6ca1\u6709\u7b26\u5408\u7b5b\u9009\u6761\u4ef6\u7684\u7528\u6237' : '\u6682\u65e0\u7528\u6237\u8bb0\u5f55';
}

export function authorizationErrorText(code) {
  const messages = {
    SUPER_ADMIN_REQUIRED: '\u4ec5\u8d85\u7ea7\u7ba1\u7406\u5458\u53ef\u4ee5\u5ba1\u6838\u7528\u6237',
    TEACHER_NOT_FOUND: '\u8be5\u624b\u673a\u53f7\u672a\u5339\u914d\u5230\u6559\u5e08\uff0c\u65e0\u6cd5\u8bbe\u4e3a\u8001\u5e08',
    DUPLICATE_TEACHER_PHONE: '\u8be5\u624b\u673a\u53f7\u5339\u914d\u5230\u591a\u4e2a\u6559\u5e08\uff0c\u8bf7\u5148\u6e05\u7406\u91cd\u590d\u6570\u636e',
    AUTHORIZATION_USER_NOT_FOUND: '\u7528\u6237\u4e0d\u5b58\u5728\u6216\u5df2\u5220\u9664',
  };
  return messages[code] || '\u7528\u6237\u6570\u636e\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5';
}

export { roleLabels, statusLabels };
