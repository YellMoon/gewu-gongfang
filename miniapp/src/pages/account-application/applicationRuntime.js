'use strict';

const APPLICATION_STATES = Object.freeze([
  'loading',
  'not_submitted',
  'invalid',
  'submitting',
  'submitted',
  'rejected',
  'approved',
  'offline',
  'network_error',
]);

const STATE_COPY = Object.freeze({
  loading: ['正在读取申请状态', '请稍候。'],
  not_submitted: ['申请角色', '请选择教师、学生或家庭成员，按提示填写信息。'],
  invalid: ['请检查填写内容', '可申请教师、学生或家庭成员；家庭成员需填写学生姓名和已绑定的手机号。'],
  submitting: ['正在提交申请', '请勿重复操作。'],
  submitted: ['等待审核', '申请已提交；审核通过后会自动更新可用功能。'],
  rejected: ["申请未通过", "请调整资料后重新提交。"],
  approved: ['申请已通过', '请重新登录以更新可用功能。'],
  offline: ['当前离线', '恢复网络后可查看或提交申请。'],
  network_error: ['暂时无法读取', '请检查网络后重试。'],
});

function copyForApplicationState(state) {
  const normalized = APPLICATION_STATES.includes(state) ? state : 'invalid';
  const [title, description] = STATE_COPY[normalized];
  return { state: normalized, title, description };
}

function buildRoleApplicationRequest(input = {}) {
  const requestedIdentity = String(input.requestedIdentity || '').trim();
  if (!['teacher', 'student', 'family_member'].includes(requestedIdentity)) {
    throw new Error('requested identity must be teacher, student, or family_member');
  }
  const profileMode = String(input.profileMode || '').trim();
  if (!['existing', 'new'].includes(profileMode)) throw new Error('profile mode must be existing or new');
  if (requestedIdentity === 'family_member' && profileMode !== 'existing') {
    throw new Error('family_member requires existing profile mode');
  }
  const profileName = String(input.profileName || '').trim();
  const contactPhone = String(input.contactPhone || '').replace(/[\s-]/g, '');
  if (!profileName || profileName.length > 64) throw new Error('profile name is required and must not exceed 64 characters');
  if (!/^1[3-9]\d{9}$/.test(contactPhone)) throw new Error('a valid mainland China mobile phone is required');
  return {
    requestedIdentity,
    profileMode,
    // The cloud repository currently records a single review note. Keep the
    // storage detail private to the client while requiring human-recognizable
    // information instead of an internal profile identifier.
    bindingHint: `\u59d3\u540d\uff1a${profileName}\uff1b\u624b\u673a\u53f7\uff1a${contactPhone}`,
  };
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
  buildRoleApplicationRequest,
  copyForApplicationState,
  createApplicationOperationLock,
};
