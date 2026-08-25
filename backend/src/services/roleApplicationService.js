const crypto = require('crypto');

const REQUESTABLE_ROLES = new Set(['student', 'teacher']);

function roleApplicationError(code, statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
}

function requiredText(value, code, maxLength = 128) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw roleApplicationError(code);
  return normalized;
}

function optionalText(value, maxLength = 128) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw roleApplicationError('ROLE_APPLICATION_BINDING_HINT_INVALID');
  return normalized;
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName));
}

function actorRoles(actor = {}) {
  return new Set(Array.isArray(actor.roles) ? actor.roles.map(String) : [String(actor.role || '')]);
}

function rowApplication(row) {
  if (!row) return null;
  return Object.freeze({
    applicationId: row.application_id,
    authorityId: row.authority_id,
    userId: row.user_id,
    requestedRole: row.requested_role,
    bindingHint: row.binding_hint || null,
    status: row.status,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function rowGrant(row) {
  if (!row) return null;
  return Object.freeze({
    bindingId: row.binding_id,
    authorityId: row.authority_id,
    userId: row.user_id,
    role: row.role,
    subjectType: row.subject_type || null,
    subjectId: row.subject_id || null,
    status: row.status,
    grantVersion: Number(row.grant_version),
    grantedBy: row.granted_by || null,
  });
}

function createRoleApplicationService({
  db,
  now = () => new Date().toISOString(),
  createId = prefix => `${prefix}-${crypto.randomUUID()}`,
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw roleApplicationError('ROLE_APPLICATION_DATABASE_REQUIRED', 500);
  }
  const findAccount = db.prepare(
    "SELECT user_id,authority_id,status FROM authority_accounts WHERE authority_id=? AND user_id=?"
  );
  const findApplication = db.prepare(
    'SELECT * FROM authority_role_applications WHERE application_id=?'
  );
  const findActiveGrant = db.prepare(`SELECT * FROM authority_role_bindings
    WHERE authority_id=? AND user_id=? AND role=? AND status='active'`);
  const findActiveProfileBinding = db.prepare(`SELECT * FROM authority_role_bindings
    WHERE authority_id=? AND role=? AND subject_type=? AND subject_id=? AND status='active'`);
  const insertAuthorizationAudit = tableExists(db, 'authorization_audit_log')
    ? db.prepare(`INSERT INTO authorization_audit_log
      (id,actor_user_id,actor_phone,target_user_id,action,before_json,after_json,created_at)
      VALUES(?,?,NULL,?,?,?,?,?)`)
    : null;
  const profileLookup = Object.freeze({
    student: tableExists(db, 'students')
      ? db.prepare('SELECT id FROM students WHERE id=? AND deleted=0')
      : null,
    teacher: tableExists(db, 'teachers')
      ? db.prepare('SELECT id FROM teachers WHERE id=? AND deleted=0')
      : null,
  });

  function currentTime() {
    const value = new Date(now());
    if (!Number.isFinite(value.getTime())) throw roleApplicationError('ROLE_APPLICATION_CLOCK_INVALID', 500);
    return value.toISOString();
  }

  function validatedProfileId(role, bindingHint) {
    const subjectId = optionalText(bindingHint);
    if (!subjectId) return null;
    const lookup = profileLookup[role];
    if (!lookup) throw roleApplicationError('ROLE_APPLICATION_PROFILE_TABLE_REQUIRED', 500);
    if (!lookup.get(subjectId)) throw roleApplicationError('ROLE_APPLICATION_BINDING_PROFILE_NOT_FOUND', 404);
    return subjectId;
  }

  function assertProfileUnclaimed({ authorityId, role, subjectId, userId }) {
    const existing = findActiveProfileBinding.get(authorityId, role, role, subjectId);
    if (existing && existing.user_id !== userId) {
      throw roleApplicationError('ROLE_APPLICATION_BINDING_ALREADY_CLAIMED', 409);
    }
    return existing;
  }

  function submit({ authorityId, userId, requestedRole, bindingHint } = {}) {
    const authority = requiredText(authorityId, 'ROLE_APPLICATION_AUTHORITY_REQUIRED');
    const user = requiredText(userId, 'ROLE_APPLICATION_USER_REQUIRED');
    const role = String(requestedRole || '').trim();
    if (!REQUESTABLE_ROLES.has(role)) throw roleApplicationError('ROLE_APPLICATION_FORBIDDEN', 403);
    const account = findAccount.get(authority, user);
    if (!account || account.status !== 'active') throw roleApplicationError('ROLE_APPLICATION_ACCOUNT_INACTIVE', 403);
    if (findActiveGrant.get(authority, user, role)) {
      throw roleApplicationError('ROLE_ALREADY_GRANTED', 409);
    }
    const subjectId = validatedProfileId(role, bindingHint);
    if (subjectId) {
      assertProfileUnclaimed({ authorityId: authority, role, subjectId, userId: user });
    }
    const timestamp = currentTime();
    const applicationId = requiredText(createId('role-application'), 'ROLE_APPLICATION_ID_INVALID');
    try {
      db.prepare(`INSERT INTO authority_role_applications
        (application_id,authority_id,user_id,requested_role,binding_hint,status,reviewed_by,reviewed_at,created_at,updated_at)
        VALUES(?,?,?,?,?,'pending',NULL,NULL,?,?)`)
        .run(applicationId, authority, user, role, subjectId, timestamp, timestamp);
    } catch (error) {
      if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
        throw roleApplicationError('ROLE_APPLICATION_ALREADY_PENDING', 409);
      }
      throw error;
    }
    return rowApplication(findApplication.get(applicationId));
  }

  function requireHostSuperAdmin(actor = {}, authorityId, { forbiddenCode, hostCode }) {
    const reviewer = requiredText(actor.userId || actor.id, 'ROLE_APPLICATION_REVIEWER_REQUIRED');
    if (!actorRoles(actor).has('super_admin')) {
      throw roleApplicationError(forbiddenCode, 403);
    }
    if (String(actor.authorityId || '').trim() !== authorityId || actor.isAuthorityHost !== true) {
      throw roleApplicationError(hostCode, 403);
    }
    return reviewer;
  }

  const approveTransaction = db.transaction(({ actor, applicationId }) => {
    const id = requiredText(applicationId, 'ROLE_APPLICATION_ID_REQUIRED');
    const application = findApplication.get(id);
    if (!application) throw roleApplicationError('ROLE_APPLICATION_NOT_FOUND', 404);
    const reviewer = requireHostSuperAdmin(actor, application.authority_id, {
      forbiddenCode: 'ROLE_APPLICATION_REVIEW_FORBIDDEN',
      hostCode: 'ROLE_APPLICATION_HOST_REVIEW_REQUIRED',
    });
    if (application.status === 'approved') {
      return Object.freeze({
        application: rowApplication(application),
        grant: rowGrant(findActiveGrant.get(application.authority_id, application.user_id, application.requested_role)),
      });
    }
    if (application.status !== 'pending') throw roleApplicationError('ROLE_APPLICATION_NOT_PENDING', 409);
    const timestamp = currentTime();
    const existing = findActiveGrant.get(
      application.authority_id,
      application.user_id,
      application.requested_role
    );
    let binding = existing;
    if (!binding) {
      const bindingId = requiredText(createId('role-binding'), 'ROLE_BINDING_ID_INVALID');
      const subjectId = validatedProfileId(application.requested_role, application.binding_hint);
      if (subjectId) {
        assertProfileUnclaimed({
          authorityId: application.authority_id,
          role: application.requested_role,
          subjectId,
          userId: application.user_id,
        });
      }
      db.prepare(`INSERT INTO authority_role_bindings
        (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,granted_by,created_at,updated_at,revoked_at)
        VALUES(?,?,?,?,?,?,'active',1,?,?,?,NULL)`)
        .run(
          bindingId,
          application.authority_id,
          application.user_id,
          application.requested_role,
          subjectId ? application.requested_role : null,
          subjectId,
          reviewer,
          timestamp,
          timestamp
        );
      binding = findActiveGrant.get(
        application.authority_id,
        application.user_id,
        application.requested_role
      );
    }
    db.prepare(`UPDATE authority_role_applications
      SET status='approved',reviewed_by=?,reviewed_at=?,updated_at=? WHERE application_id=?`)
      .run(reviewer, timestamp, timestamp, id);
    return Object.freeze({
      application: rowApplication(findApplication.get(id)),
      grant: rowGrant(binding),
    });
  });

  const rejectTransaction = db.transaction(({ actor, applicationId }) => {
    const id = requiredText(applicationId, 'ROLE_APPLICATION_ID_REQUIRED');
    const application = findApplication.get(id);
    if (!application) throw roleApplicationError('ROLE_APPLICATION_NOT_FOUND', 404);
    const reviewer = requireHostSuperAdmin(actor, application.authority_id, {
      forbiddenCode: 'ROLE_APPLICATION_REVIEW_FORBIDDEN',
      hostCode: 'ROLE_APPLICATION_HOST_REVIEW_REQUIRED',
    });
    if (application.status === 'rejected') return rowApplication(application);
    if (application.status !== 'pending') throw roleApplicationError('ROLE_APPLICATION_NOT_PENDING', 409);
    const timestamp = currentTime();
    db.prepare(`UPDATE authority_role_applications
      SET status='rejected',reviewed_by=?,reviewed_at=?,updated_at=? WHERE application_id=?`)
      .run(reviewer, timestamp, timestamp, id);
    return rowApplication(findApplication.get(id));
  });

  function list({ authorityId, actor, status } = {}) {
    const authority = requiredText(authorityId, 'ROLE_APPLICATION_AUTHORITY_REQUIRED');
    requireHostSuperAdmin(actor, authority, {
      forbiddenCode: 'ROLE_APPLICATION_REVIEW_FORBIDDEN',
      hostCode: 'ROLE_APPLICATION_HOST_REVIEW_REQUIRED',
    });
    const normalizedStatus = String(status || '').trim();
    const rows = normalizedStatus
      ? db.prepare('SELECT * FROM authority_role_applications WHERE authority_id=? AND status=? ORDER BY created_at')
        .all(authority, normalizedStatus)
      : db.prepare('SELECT * FROM authority_role_applications WHERE authority_id=? ORDER BY created_at')
        .all(authority);
    return Object.freeze(rows.map(rowApplication));
  }

  return Object.freeze({
    approve: input => approveTransaction(input || {}),
    list,
    reject: input => rejectTransaction(input || {}),
    submit,
  });
}

module.exports = { createRoleApplicationService, roleApplicationError };
