'use strict';

const VISITOR_CAPABILITIES = Object.freeze([
  'projection:read',
  'role-application:read',
  'role-application:submit',
  'question-preview:read',
]);
const FORMAL_ROLES = new Set(['super_admin', 'teacher', 'student']);

function cloudSessionUser(identity) {
  if (!identity || typeof identity !== 'object' || typeof identity.accountId !== 'string' || !identity.accountId
    || !Array.isArray(identity.roles) || !['active', 'visitor'].includes(identity.status)
    || identity.roles.some(role => !FORMAL_ROLES.has(role))) return null;
  const role = identity.roles.includes('super_admin') ? 'super_admin'
    : identity.roles.includes('teacher') ? 'teacher'
      : identity.roles.includes('student') ? 'student' : 'visitor';
  if (role === 'visitor' && identity.status !== 'visitor') return null;
  if (role !== 'visitor' && identity.status !== 'active') return null;
  return Object.freeze(role === 'visitor'
    ? {
      id: identity.accountId,
      cloud_account_id: identity.accountId,
      role: 'visitor',
      user_type: 'visitor',
      identity_kind: 'visitor',
      account_state: 'visitor',
      token_use: 'miniapp-visitor',
      authority_id: `cloud:${identity.accountId}`,
      capabilities: VISITOR_CAPABILITIES.slice(),
    }
    : {
      id: identity.accountId,
      cloud_account_id: identity.accountId,
      role,
      user_type: role,
      account_state: 'formal',
      token_use: 'miniapp-cloud',
    });
}

module.exports = Object.freeze({ VISITOR_CAPABILITIES, cloudSessionUser });
