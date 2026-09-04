'use strict';

const VISITOR_CAPABILITIES = Object.freeze([
  'projection:read',
  'role-application:read',
  'role-application:submit',
  'question-preview:read',
]);
const FORMAL_ROLES = new Set(['super_admin', 'teacher', 'student', 'family_member']);

function profileId(identity, role) {
  const profile = identity && identity.profile;
  if (role === 'super_admin') return profile === null || profile === undefined ? null : null;
  const expectedProfileType = role === 'family_member' ? 'student' : role;
  const expectedRelationship = role === 'student' ? 'student' : role === 'family_member' ? 'guardian' : null;
  if (!profile || typeof profile !== 'object' || profile.type !== expectedProfileType
    || typeof profile.id !== 'string' || !profile.id.trim()
    || (profile.relationship ?? null) !== expectedRelationship) return null;
  return profile.id.trim();
}

function cloudSessionUser(identity) {
  if (!identity || typeof identity !== 'object' || typeof identity.accountId !== 'string' || !identity.accountId
    || !Array.isArray(identity.roles) || !['active', 'visitor'].includes(identity.status)
    || identity.roles.some(role => !FORMAL_ROLES.has(role))) return null;
  const role = identity.roles.includes('super_admin') ? 'super_admin'
    : identity.roles.includes('teacher') ? 'teacher'
      : identity.roles.includes('student') ? 'student'
        : identity.roles.includes('family_member') ? 'family_member' : 'visitor';
  if (role === 'visitor' && identity.status !== 'visitor') return null;
  if (role !== 'visitor' && identity.status !== 'active') return null;
  const scopedProfileId = profileId(identity, role);
  if ((role === 'teacher' || role === 'student' || role === 'family_member') && !scopedProfileId) return null;
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
      ...(role === 'family_member' ? { identity_kind: 'family_member', student_relationship: 'guardian' } : {}),
      account_state: 'formal',
      token_use: 'miniapp-cloud',
      ...(role === 'teacher' ? { teacher_id: scopedProfileId } : {}),
      ...((role === 'student' || role === 'family_member') ? { student_id: scopedProfileId, linked_student_ids: [scopedProfileId] } : {}),
    });
}

module.exports = Object.freeze({ VISITOR_CAPABILITIES, cloudSessionUser });
