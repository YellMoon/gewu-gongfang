function required(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function timestamp(value) {
  const normalized = value instanceof Date ? value.toISOString() : String(value || '').trim();
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError('now is invalid');
  return normalized;
}

function seedCanonicalAuthorityRole({ db, authorityId, userId, role, subjectId = null, now }) {
  const authority = required(authorityId, 'authorityId');
  const user = required(userId, 'userId');
  const activeRole = required(role, 'role');
  const at = timestamp(now);
  if (!['student', 'teacher', 'admin', 'super_admin'].includes(activeRole)) {
    throw new TypeError('role is invalid');
  }
  const subjectType = ['student', 'teacher'].includes(activeRole) ? activeRole : null;
  const subject = subjectType ? required(subjectId, 'subjectId') : null;
  db.prepare(`INSERT OR IGNORE INTO authority_accounts
    (user_id,authority_id,status,created_at,updated_at)
    VALUES (?,?,'active',?,?)`).run(user, authority, at, at);
  const account = db.prepare(`SELECT authority_id,status FROM authority_accounts
    WHERE user_id=?`).get(user);
  if (!account || account.authority_id !== authority || account.status !== 'active') {
    throw new Error('TEST_AUTHORITY_ACCOUNT_CONFLICT');
  }
  const binding = db.prepare(`SELECT * FROM authority_role_bindings
    WHERE authority_id=? AND user_id=? AND role=? AND status='active'`).get(authority, user, activeRole);
  if (binding && (binding.subject_type !== subjectType || binding.subject_id !== subject)) {
    throw new Error('TEST_AUTHORITY_ROLE_BINDING_CONFLICT');
  }
  if (!binding) {
    db.prepare(`INSERT INTO authority_role_bindings
      (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,
       granted_by,created_at,updated_at,revoked_at)
      VALUES (?,?,?,?,?,?,'active',1,'test-fixture',?,?,NULL)`)
      .run(`test-role:${user}:${activeRole}`, authority, user, activeRole, subjectType, subject, at, at);
  }
  return { authorityId: authority, userId: user, role: activeRole, subjectType, subjectId: subject };
}

function seedCanonicalDesktopActor({ db, authorityId, userId, role, subjectId = null, deviceId, now }) {
  const actor = seedCanonicalAuthorityRole({ db, authorityId, userId, role, subjectId, now });
  const device = required(deviceId, 'deviceId');
  const authorization = db.prepare(`SELECT status,user_id FROM desktop_device_authorizations
    WHERE device_id=?`).get(device);
  if (!authorization || authorization.status !== 'active' || authorization.user_id !== actor.userId) {
    throw new Error('TEST_DESKTOP_AUTHORIZATION_INVALID');
  }
  return { ...actor, deviceId: device };
}

module.exports = {
  seedCanonicalDesktopActor,
};
