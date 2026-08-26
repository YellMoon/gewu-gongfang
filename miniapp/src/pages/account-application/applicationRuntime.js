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
  not_submitted: ['申请身份绑定', '可申请教师、学生或家庭成员；教师和学生可新建或关联已有档案。'],
  invalid: ['申请内容需要调整', '只能申请教师、学生或家庭成员；家庭成员必须关联已有学生档案。'],
  submitting: ['正在提交申请', '请勿重复操作。'],
  submitted: ["等待教师端确认", "申请已提交；教师端确认后会自动更新可用功能。"],
  rejected: ["申请未通过", "请调整资料后重新提交。"],
  approved: ['申请已通过', '请重新登录以更新可用功能。'],
  offline: ['当前离线', '恢复网络后可读取或提交角色申请。'],
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
  const bindingHint = String(input.bindingHint || '').trim();
  if (bindingHint.length > 128) throw new Error('binding hint must not exceed 128 characters');
  if (!bindingHint) throw new Error('existing profile mode requires a binding hint');
  return {
    requestedIdentity,
    profileMode,
    bindingHint: bindingHint || null,
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
