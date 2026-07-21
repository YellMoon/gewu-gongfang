'use strict';

const APPLICATION_STATES = Object.freeze([
  'loading', 'not_submitted', 'invalid', 'submitting', 'submitted', 'provisioning',
  'manual_resolution_required', 'rejected', 'withdrawn', 'approved_relogin_required',
  'offline', 'network_error',
]);

const STATE_COPY = Object.freeze({
  loading: ['\u6b63\u5728\u8bfb\u53d6\u7533\u8bf7', '\u8bf7\u7a0d\u5019\u3002'],
  not_submitted: ['\u7533\u8bf7\u6b63\u5f0f\u8d26\u53f7', '\u586b\u5199\u771f\u5b9e\u8d44\u6599\u540e\u63d0\u4ea4\u7ba1\u7406\u5458\u5ba1\u6838\u3002'],
  invalid: ['\u8d44\u6599\u5f85\u5b8c\u5584', '\u8bf7\u6838\u5bf9\u5fc5\u586b\u5b57\u6bb5\u4e0e\u624b\u673a\u53f7\u3002'],
  submitting: ['\u6b63\u5728\u63d0\u4ea4', '\u8bf7\u52ff\u91cd\u590d\u64cd\u4f5c\u3002'],
  submitted: ['\u5f85\u7ba1\u7406\u5458\u5ba1\u6838', '\u53ef\u5728\u5ba1\u6838\u524d\u64a4\u56de\u7533\u8bf7\u3002'],
  provisioning: ['\u6b63\u5728\u6570\u636e\u4e3b\u673a\u5efa\u6863', '\u5ba1\u6838\u5df2\u901a\u8fc7\uff0c\u8bf7\u7b49\u5f85\u4e3b\u673a\u5b8c\u6210\u8d44\u6599\u7ed1\u5b9a\u3002'],
  manual_resolution_required: ['\u9700\u8981\u4eba\u5de5\u5904\u7406', '\u4e3b\u673a\u5efa\u6863\u9047\u5230\u51b2\u7a81\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u3002'],
  rejected: ['\u7533\u8bf7\u5df2\u9000\u56de', '\u8bf7\u6309\u9000\u56de\u539f\u56e0\u4fee\u8ba2\u540e\u91cd\u65b0\u63d0\u4ea4\u3002'],
  withdrawn: ['\u7533\u8bf7\u5df2\u64a4\u56de', '\u53ef\u4fee\u8ba2\u8d44\u6599\u540e\u91cd\u65b0\u63d0\u4ea4\u3002'],
  approved_relogin_required: ['\u5efa\u6863\u5df2\u5b8c\u6210', '\u8bf7\u9000\u51fa\u5f53\u524d\u4f53\u9a8c\u4f1a\u8bdd\u5e76\u91cd\u65b0\u767b\u5f55\u3002'],
  offline: ['\u5f53\u524d\u79bb\u7ebf', '\u6062\u590d\u7f51\u7edc\u540e\u53ef\u67e5\u770b\u6216\u63d0\u4ea4\u7533\u8bf7\u3002'],
  network_error: ['\u6682\u65f6\u65e0\u6cd5\u8bfb\u53d6', '\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5\u3002'],
});

function copyForApplicationState(state) {
  const normalized = APPLICATION_STATES.includes(state) ? state : 'invalid';
  const [title, description] = STATE_COPY[normalized];
  return { state: normalized, title, description };
}

function text(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function phone(value, field) {
  const normalized = text(value, field);
  if (!/^1\d{10}$/.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
}

function buildStudentApplicationPayload(input = {}) {
  const applicantKind = input.applicantKind === 'parent' ? 'parent' : 'student';
  const verifiedPhone = phone(input.verifiedPhone, 'verifiedPhone');
  const otherPhone = phone(input.otherPhone, 'otherPhone');
  if (verifiedPhone === otherPhone) throw new Error('student and parent phone must differ');
  if (input.confirmation !== true) throw new Error('applicant confirmation is required');
  const payload = {
    studentName: text(input.studentName, 'studentName'),
    studentPhone: applicantKind === 'student' ? verifiedPhone : otherPhone,
    school: text(input.school, 'school'),
    currentGrade: text(input.currentGrade, 'currentGrade'),
    parentRelation: text(input.parentRelation, 'parentRelation'),
    parentPhone: applicantKind === 'parent' ? verifiedPhone : otherPhone,
    ...(applicantKind === 'student'
      ? { applicantAgeConfirmation: true }
      : { guardianConfirmation: true }),
  };
  const notes = String(input.notes || '').trim();
  if (notes) payload.notes = notes;
  return payload;
}

function buildTeacherApplicationPayload(input = {}) {
  const payload = {
    name: text(input.name, 'name'),
    phone: phone(input.verifiedPhone, 'verifiedPhone'),
  };
  const subject = String(input.subject || '').trim();
  const notes = String(input.notes || '').trim();
  if (subject) payload.subject = subject;
  if (notes) payload.notes = notes;
  return payload;
}

function createApplicationOperationLock() {
  let operation = '';
  return {
    current: () => operation,
    tryAcquire(next) {
      if (operation) return false;
      operation = String(next || 'operation');
      return true;
    },
    release(expected) {
      if (operation === expected) operation = '';
    },
  };
}

module.exports = {
  APPLICATION_STATES,
  buildStudentApplicationPayload,
  buildTeacherApplicationPayload,
  copyForApplicationState,
  createApplicationOperationLock,
};
