'use strict';

const VISITOR_CAPABILITIES = Object.freeze([
  'projection:read',
  'role-application:read',
  'role-application:submit',
  'question-preview:read',
]);
const FORMAL_ROLES = new Set(['super_admin', 'teacher', 'student', 'family_member']);

const SESSION_CLEANUP_KEYS = Object.freeze([
  'auth_token',
  'user_info',
  'user_permissions',
]);

function hasExactCapabilities(value, expected = VISITOR_CAPABILITIES) {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  const received = new Set(value.map(String));
  return received.size === expected.length
    && expected.every(capability => received.has(capability));
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

function isFormalIdentity(identity) {
  return Boolean(identity
    && typeof identity === 'object'
    && typeof identity.id === 'string'
    && identity.id.trim()
    && FORMAL_ROLES.has(identity.role || identity.user_type)
    && identity.account_state === 'formal'
    && identity.token_use === 'miniapp-cloud');
}

function accountCapabilities(identity) {
  if (isVisitorIdentity(identity)) return [...VISITOR_CAPABILITIES];
  return [];
}

function resourceId(value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error('account experience operation requires a resource id');
  return encodeURIComponent(normalized);
}

function accountExperiencePath(identity, operation, id) {
  if (!isVisitorIdentity(identity)) throw new Error('role application requires a visitor identity');
  switch (operation) {
    case 'applicationMine': return '/api/miniapp/role-applications/me';
    case 'applicationSubmit': return '/api/miniapp/role-applications';
    default: throw new Error(`unsupported role application operation: ${operation}`);
  }
}

function accountSessionCleanupStorageKeys() {
  return [...SESSION_CLEANUP_KEYS];
}

module.exports = {
  VISITOR_CAPABILITIES,
  accountCapabilities,
  accountExperiencePath,
  accountSessionCleanupStorageKeys,
  isFormalIdentity,
  isVisitorIdentity,
};
