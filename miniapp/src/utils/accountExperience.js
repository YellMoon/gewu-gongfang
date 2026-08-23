'use strict';

const UNRECOGNIZED_CAPABILITIES = Object.freeze([
  'experience:read',
  'profile-application:read',
  'profile-application:submit',
  'sample-questions:view',
]);
const VISITOR_CAPABILITIES = Object.freeze([
  'projection:read',
  'role-application:read',
  'role-application:submit',
  'question-preview:read',
]);

const SESSION_CLEANUP_KEYS = Object.freeze([
  'auth_token',
  'user_info',
  'user_permissions',
  'unrecognized_session',
  'review_demo_session',
  'review_demo_role',
  'review_demo_code',
]);

function hasExactCapabilities(value, expected = UNRECOGNIZED_CAPABILITIES) {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  const received = new Set(value.map(String));
  return received.size === expected.length
    && expected.every(capability => received.has(capability));
}

function isUnrecognizedIdentity(identity) {
  return Boolean(identity
    && typeof identity === 'object'
    && identity.account_state === 'unrecognized'
    && identity.token_use === 'unrecognized-student'
    && hasExactCapabilities(identity.capabilities));
}

function isVisitorIdentity(identity) {
  return Boolean(identity
    && typeof identity === 'object'
    && identity.role === 'visitor'
    && identity.user_type === 'visitor'
    && identity.identity_kind === 'visitor'
    && identity.account_state === 'visitor'
    && identity.token_use === 'miniapp-visitor'
    && typeof identity.authority_id === 'string'
    && identity.authority_id.trim()
    && hasExactCapabilities(identity.capabilities, VISITOR_CAPABILITIES));
}

function hasLegacyReviewMarker(identity) {
  if (!identity || typeof identity !== 'object') return false;
  const capabilities = Array.isArray(identity.capabilities) ? identity.capabilities : [];
  return identity.token_use === 'review-demo'
    || identity.is_review_demo === true
    || Boolean(identity.review_demo_session_id)
    || String(identity.id || '').startsWith('review-demo:')
    || capabilities.some(capability => String(capability).startsWith('review-demo:'));
}

function accountCapabilities(identity) {
  if (isVisitorIdentity(identity)) return [...VISITOR_CAPABILITIES];
  return isUnrecognizedIdentity(identity) ? [...UNRECOGNIZED_CAPABILITIES] : [];
}

function resourceId(value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error('account experience operation requires a resource id');
  return encodeURIComponent(normalized);
}

function accountExperiencePath(identity, operation, id) {
  if (!isUnrecognizedIdentity(identity)) throw new Error('account experience requires an unrecognized identity');
  switch (operation) {
    case 'questions': return '/api/experience/questions';
    case 'createTask': return '/api/experience/tasks';
    case 'taskResult': return `/api/experience/tasks/${resourceId(id)}/result`;
    case 'cancelTask': return `/api/experience/tasks/${resourceId(id)}/cancel`;
    case 'applicationMine': return '/api/miniapp/applications/me';
    case 'applicationSubmit': return '/api/miniapp/applications';
    case 'applicationWithdraw': return `/api/miniapp/applications/${resourceId(id)}/withdraw`;
    default: throw new Error(`unsupported account experience operation: ${operation}`);
  }
}

function accountSessionCleanupStorageKeys() {
  return [...SESSION_CLEANUP_KEYS];
}

module.exports = {
  UNRECOGNIZED_CAPABILITIES,
  VISITOR_CAPABILITIES,
  accountCapabilities,
  accountExperiencePath,
  accountSessionCleanupStorageKeys,
  hasLegacyReviewMarker,
  isUnrecognizedIdentity,
  isVisitorIdentity,
};
