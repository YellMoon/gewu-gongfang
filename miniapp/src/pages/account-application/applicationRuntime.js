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
  loading: ['正在读取角色申请', '请稍候。'],
  not_submitted: ['申请老师或学生角色', '申请将作为权威命令交由云端超级管理员审核。'],
  invalid: ['申请内容需要调整', '只能申请老师或学生角色，请核对后重试。'],
  submitting: ['正在提交权威命令', '请勿重复操作。'],
  submitted: ['等待云端审核', '申请已经进入持久命令队列，断线后仍会继续处理。'],
  rejected: ['角色申请已拒绝', '如需重新申请，请联系云端管理员确认原因。'],
  approved: ['角色申请已批准', '重新登录后将读取云端签发的最新角色投影。'],
  offline: ['当前离线', '恢复网络后可读取或提交角色申请。'],
  network_error: ['暂时无法读取', '请检查网络后重试。'],
});

function copyForApplicationState(state) {
  const normalized = APPLICATION_STATES.includes(state) ? state : 'invalid';
  const [title, description] = STATE_COPY[normalized];
  return { state: normalized, title, description };
}

function buildRoleApplicationRequest(input = {}) {
  const requestedRole = String(input.requestedRole || '').trim();
  if (!['student', 'teacher'].includes(requestedRole)) {
    throw new Error('requested role must be student or teacher');
  }
  const bindingHint = String(input.bindingHint || '').trim();
  if (bindingHint.length > 128) throw new Error('binding hint must not exceed 128 characters');
  return {
    requestedRole,
    ...(bindingHint ? { bindingHint } : {}),
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
