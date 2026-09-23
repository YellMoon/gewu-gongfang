'use strict';

const APPLICATION_STATES = Object.freeze([
  'loading',
  'not_submitted',
  'invalid',
  'submit_error',
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
  invalid: ['请检查填写内容', '请填写姓名和正确的手机号。'],
  // UTF-8: An unavailable response is not evidence that valid inputs are wrong.
  submit_error: ['暂时无法确认提交结果', '填写内容已保留，请稍后重试。'],
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

// UTF-8: Only local validation messages and known service codes are user-facing.
class ApplicationInputError extends Error {}

function applicationErrorState(error) {
  return error instanceof ApplicationInputError || error?.code === 'CLOUD_ROLE_APPLICATION_VERIFIED_PHONE_REQUIRED'
    ? 'invalid' : 'submit_error';
}

function applicationErrorMessage(error) {
  if (error instanceof ApplicationInputError) return error.message;
  const messages = {
    CLOUD_ROLE_APPLICATION_VERIFIED_PHONE_REQUIRED: '填写的手机号与当前账号已验证手机号不一致',
  };
  return Object.hasOwn(messages, error?.code) ? messages[error.code] : '暂时无法提交申请，请稍后重试';
}

function buildRoleApplicationRequest(input = {}) {
  const requestedIdentity = String(input.requestedIdentity || '').trim();
  if (!['teacher', 'student', 'family_member'].includes(requestedIdentity)) {
    throw new ApplicationInputError('请选择学生、教师或家庭成员');
  }
  const profileMode = String(input.profileMode || '').trim();
  if (!['existing', 'new'].includes(profileMode)) throw new ApplicationInputError('请选择申请方式');
  if (requestedIdentity === 'family_member' && profileMode !== 'existing') {
    throw new ApplicationInputError('家庭成员需要关联已有学生');
  }
  const profileName = String(input.profileName || '').trim();
  const contactPhone = String(input.contactPhone || '').replace(/[\s-]/g, '');
  if (!profileName) throw new ApplicationInputError('请填写姓名');
  if (profileName.length > 64) throw new ApplicationInputError('姓名不能超过64个字');
  if (!/^1[3-9]\d{9}$/.test(contactPhone)) throw new ApplicationInputError('请输入正确的11位手机号');
  return {
    requestedIdentity,
    profileMode,
    profileName,
    profilePhone: contactPhone,
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
  applicationErrorMessage,
  applicationErrorState,
  copyForApplicationState,
  createApplicationOperationLock,
};
