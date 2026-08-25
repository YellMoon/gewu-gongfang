const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { normalizePhone } = require('./authorizationPolicy');
const { resultHash: taskResultHash } = require('./cloudRelayTaskService');
const { payloadHash } = require('./miniappApplicationService');

function reconciliationError(code, message = code) {
  return Object.assign(new Error(message), { code, reconciliationConflict: true });
}

function parseObject(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function enabled(value) {
  return value === 1 || value === true || value === '1' || value === 'true';
}

function active(user) {
  return user && user.deleted !== 1 && user.deleted !== true && !user.disabled_at
    && user.status !== 0 && user.status !== 'inactive' && user.status !== 'disabled';
}

function createMiniappProvisioningReconciler({
  db,
  now = () => new Date(),
  uuid = uuidv4,
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new TypeError('db is required');
  }

  const findTask = db.prepare('SELECT * FROM miniapp_tasks WHERE id=?');
  const findApplication = db.prepare('SELECT * FROM miniapp_role_applications WHERE id=?');
  const findUserById = db.prepare('SELECT * FROM users WHERE id=?');
  const findUserByPhone = db.prepare('SELECT * FROM users WHERE phone_normalized=?');
  const findStudentUsers = db.prepare('SELECT * FROM users WHERE student_id=?');
  const findTeacherUsers = db.prepare('SELECT * FROM users WHERE teacher_id=?');
  const findMembership = db.prepare('SELECT * FROM account_memberships WHERE subject_type=? AND subject_id=?');
  const findAuthorityAccount = db.prepare(`SELECT user_id,authority_id,status
    FROM authority_accounts WHERE user_id=?`);
  const readConfiguredAuthority = db.prepare(
    "SELECT value FROM authority_metadata WHERE key='database_authority_id'"
  );
  const readActiveHostEpochs = db.prepare(`SELECT id,db_authority_id
    FROM primary_host_epochs WHERE status='active' ORDER BY generation DESC,id`);
  const findActiveCanonicalBindings = db.prepare(`SELECT * FROM authority_role_bindings
    WHERE authority_id=? AND user_id=? AND role=? AND status='active'
    ORDER BY binding_id`);
  const insertUser = db.prepare(`INSERT INTO users
    (id, wechat_openid, phone, phone_normalized, name, role, identity_kind, status,
     login_enabled, student_id, teacher_id, review_status, reviewed_by, reviewed_at,
     auth_version, deleted, created_at, updated_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?, 1, 1, ?, ?, 'approved', ?, ?, 1, 0, ?, ?)`);
  const updateUser = db.prepare(`UPDATE users SET
    role=?, identity_kind=?, status=1, login_enabled=1, student_id=?, teacher_id=?,
    review_status='approved', reviewed_by=?, reviewed_at=?, disabled_at=NULL,
    auth_version=auth_version+1, updated_at=?
    WHERE id=?`);
  const insertMembership = db.prepare(`INSERT INTO account_memberships
    (id, subject_type, subject_id, status, source, starts_at, ends_at, created_at, updated_at)
    VALUES (?, ?, ?, 'active', 'admin_approval', ?, NULL, ?, ?)
    ON CONFLICT(subject_type, subject_id) DO UPDATE SET
      status='active', source='admin_approval', ends_at=NULL, updated_at=excluded.updated_at`);
  const insertAuthorityAccount = db.prepare(`INSERT INTO authority_accounts
    (user_id,authority_id,status,created_at,updated_at)
    VALUES (?,?,'active',?,?)`);
  const insertAuthorityBinding = db.prepare(`INSERT INTO authority_role_bindings
    (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,
     granted_by,created_at,updated_at,revoked_at)
    VALUES (?,?,?,?,?,?,'active',1,?,?,?,NULL)`);
  const approveApplication = db.prepare(`UPDATE miniapp_role_applications
    SET status='approved', host_entity_id=?, rejection_reason=NULL, updated_at=?
    WHERE id=? AND revision=? AND host_task_id=? AND status='provisioning'`);
  const manualApplication = db.prepare(`UPDATE miniapp_role_applications
    SET status='manual_resolution_required', host_entity_id=NULL, rejection_reason=?, updated_at=?
    WHERE id=? AND status='provisioning'`);
  const insertAudit = db.prepare(`INSERT INTO authorization_audit_log
    (id, actor_user_id, actor_phone, target_user_id, action, before_json, after_json, created_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`);
  const findAudits = db.prepare(`SELECT after_json FROM authorization_audit_log
    WHERE action=? AND target_user_id=?`);

  function timestamp() {
    const value = now();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }

  function auditExists(action, applicantUserId, applicationId) {
    return findAudits.all(action, applicantUserId).some(row => {
      const value = parseObject(row.after_json);
      return value?.applicationId === applicationId;
    });
  }

  function writeAudit(action, application, task, state, at) {
    if (auditExists(action, application.applicant_user_id, application.id)) return;
    insertAudit.run(
      uuid('application-provisioning-audit'),
      application.reviewed_by || parseObject(task.payload)?.reviewedBy || null,
      application.applicant_user_id,
      action,
      JSON.stringify({ applicationId: application.id, status: application.status }),
      JSON.stringify({ applicationId: application.id, taskId: task.id, ...state }),
      at,
    );
  }

  function markManual(application, task, code) {
    const at = timestamp();
    const update = db.transaction(() => {
      const changed = manualApplication.run(code, at, application.id);
      writeAudit('application_provisioning_manual_resolution', application, task, {
        status: 'manual_resolution_required',
        code,
      }, at);
      return changed.changes;
    })();
    return {
      status: 'manual_resolution_required',
      code,
      applicationId: application.id,
      taskId: task.id,
      replayed: update === 0,
    };
  }

  function validateEnvelope(task, application) {
    if (task.task_type !== 'identity-provisioning' || Number(task.protocol_version) !== 2) {
      throw reconciliationError('PROVISIONING_TASK_TYPE_MISMATCH');
    }
    if (task.status !== 'completed') throw reconciliationError('PROVISIONING_TASK_NOT_COMPLETED');
    const payload = parseObject(task.payload);
    const result = parseObject(task.result_payload);
    if (!payload || !result) throw reconciliationError('PROVISIONING_RESULT_INVALID');
    if (payload.applicationId !== application.id
      || Number(payload.revision) !== Number(application.revision)
      || application.host_task_id !== task.id) {
      throw reconciliationError('PROVISIONING_APPLICATION_TASK_MISMATCH');
    }
    if (payload.applicationType !== application.application_type) {
      throw reconciliationError('PROVISIONING_APPLICATION_TYPE_MISMATCH');
    }
    const applicationPayload = parseObject(application.payload_json);
    if (!applicationPayload || !parseObject(payload.payload)
      || payloadHash(application.application_type, payload.payload) !== application.payload_hash
      || JSON.stringify(payload.payload) !== JSON.stringify(applicationPayload)) {
      throw reconciliationError('PROVISIONING_APPLICATION_PAYLOAD_MISMATCH');
    }
    if (!task.completion_operation_id || !task.completion_result_hash
      || task.completion_result_hash !== taskResultHash(result)) {
      throw reconciliationError('PROVISIONING_RESULT_HASH_MISMATCH');
    }
    const keys = Object.keys(result).sort();
    if (keys.join(',') !== ['entityId', 'entityType', 'receiptId', 'resultHash'].sort().join(',')
      || typeof result.entityId !== 'string' || !result.entityId || result.entityId.length > 128
      || typeof result.receiptId !== 'string' || !result.receiptId || result.receiptId.length > 128
      || typeof result.resultHash !== 'string' || !/^[a-f0-9]{64}$/i.test(result.resultHash)
      || !['student', 'teacher'].includes(result.entityType)) {
      throw reconciliationError('PROVISIONING_RESULT_INVALID');
    }
    const receipt = {
      entityId: String(result.entityId),
      entityType: String(result.entityType),
      receiptId: String(result.receiptId),
    };
    if (sha256(JSON.stringify(receipt)) !== String(result.resultHash).toLowerCase()) {
      throw reconciliationError('PROVISIONING_RECEIPT_HASH_MISMATCH');
    }
    if (result.entityType !== application.application_type) {
      throw reconciliationError('PROVISIONING_RESULT_TYPE_MISMATCH');
    }
    return { payload, result, applicationPayload };
  }

  function exactIdentity(user, { role, kind, entityId }) {
    if (!active(user) || user.role !== role || user.identity_kind !== kind
      || user.review_status !== 'approved' || !enabled(user.login_enabled)) return false;
    if (role === 'student') return user.student_id === entityId && !user.teacher_id;
    return user.teacher_id === entityId && !user.student_id;
  }

  function pendingIdentity(user) {
    if (!active(user) || user.student_id || user.teacher_id) return false;

    // The canonical login service creates an active visitor session immediately
    // after verified WeChat + phone login.  It remains unbound until a reviewed
    // application assigns a teacher or student profile, so it is safe to
    // promote through this reconciler even though login_enabled is already on.
    if (user.role === 'visitor' && user.identity_kind === 'visitor') return true;

    // Retain recovery support for records produced before visitor became the
    // canonical unbound identity.  These records were intentionally unable to
    // log in until the application was provisioned.
    return (user.role === 'pending' || !user.role)
      && (user.identity_kind === 'unrecognized' || !user.identity_kind)
      && user.review_status !== 'approved' && !enabled(user.login_enabled);
  }

  function resolveIdentity({
    phone,
    kind,
    role,
    entityId,
    applicantUserId,
    applicant,
    name,
    reviewer,
    at,
  }) {
    const normalized = normalizePhone(phone);
    if (!/^1\d{10}$/.test(normalized)) throw reconciliationError('IDENTITY_PHONE_INVALID');
    let user = findUserByPhone.get(normalized);
    if (applicant && (!user || user.id !== applicantUserId)) {
      throw reconciliationError('APPLICATION_IDENTITY_CONFLICT');
    }
    if (user && !exactIdentity(user, { role, kind, entityId }) && !pendingIdentity(user)) {
      throw reconciliationError('IDENTITY_PHONE_CONFLICT');
    }
    if (!user) {
      const id = uuid(`provisioned-${kind}-identity`);
      insertUser.run(
        id,
        normalized,
        normalized,
        String(name || '').trim().slice(0, 128) || (kind === 'parent' ? '家长' : '用户'),
        role,
        kind,
        role === 'student' ? entityId : null,
        role === 'teacher' ? entityId : null,
        reviewer,
        at,
        at,
        at,
      );
      return findUserById.get(id);
    }
    if (!exactIdentity(user, { role, kind, entityId })) {
      updateUser.run(
        role,
        kind,
        role === 'student' ? entityId : null,
        role === 'teacher' ? entityId : null,
        reviewer,
        at,
        at,
        user.id,
      );
      user = findUserById.get(user.id);
    }
    return user;
  }

  function resolveProvisioningAuthority(users) {
    const sources = [];
    for (const user of users) {
      const account = findAuthorityAccount.get(user.id);
      if (account) {
        const authorityId = String(account.authority_id || '').trim();
        if (!authorityId) throw reconciliationError('PROVISIONING_AUTHORITY_CONFLICT');
        sources.push(authorityId);
      }
    }
    const configured = String(readConfiguredAuthority.get()?.value || '').trim();
    if (configured) sources.push(configured);
    const activeEpochs = readActiveHostEpochs.all();
    if (activeEpochs.length > 1) throw reconciliationError('PROVISIONING_AUTHORITY_CONFLICT');
    if (activeEpochs.length === 1) {
      const epochAuthority = String(activeEpochs[0].db_authority_id || '').trim();
      if (!epochAuthority) throw reconciliationError('PROVISIONING_AUTHORITY_CONFLICT');
      sources.push(epochAuthority);
    }
    if (!sources.length) throw reconciliationError('PROVISIONING_AUTHORITY_UNAVAILABLE');
    if (new Set(sources).size !== 1) {
      throw reconciliationError('PROVISIONING_AUTHORITY_CONFLICT');
    }
    return sources[0];
  }

  function ensureCanonicalAuthority({ users, role, entityId, reviewer, at }) {
    const authorityId = resolveProvisioningAuthority(users);
    for (const user of users) {
      const account = findAuthorityAccount.get(user.id);
      if (account) {
        if (account.status !== 'active' || account.authority_id !== authorityId) {
          throw reconciliationError('AUTHORITY_ACCOUNT_CONFLICT');
        }
      } else {
        insertAuthorityAccount.run(user.id, authorityId, at, at);
      }
      const bindings = findActiveCanonicalBindings.all(authorityId, user.id, role);
      if (bindings.length > 1) {
        throw reconciliationError('AUTHORITY_ROLE_BINDING_CONFLICT');
      }
      const existing = bindings[0];
      if (existing) {
        if (existing.subject_type !== role || existing.subject_id !== entityId) {
          throw reconciliationError('AUTHORITY_ROLE_BINDING_CONFLICT');
        }
        continue;
      }
      insertAuthorityBinding.run(
        uuid('authority-role-binding'),
        authorityId,
        user.id,
        role,
        role,
        entityId,
        reviewer,
        at,
        at,
      );
    }
  }

  function reconcileStudent(application, context, at) {
    const { payload, result, applicationPayload } = context;
    const studentPhone = normalizePhone(application.student_phone_normalized || applicationPayload.studentPhone);
    const parentPhone = normalizePhone(application.parent_phone_normalized || applicationPayload.parentPhone);
    if (!studentPhone || !parentPhone || studentPhone === parentPhone) {
      throw reconciliationError('STUDENT_IDENTITY_PHONES_INVALID');
    }
    if (studentPhone !== normalizePhone(applicationPayload.studentPhone)
      || parentPhone !== normalizePhone(applicationPayload.parentPhone)) {
      throw reconciliationError('PROVISIONING_APPLICATION_PHONE_MISMATCH');
    }
    const applicantKind = application.applicant_identity_kind;
    if (!['student', 'parent'].includes(applicantKind)) {
      throw reconciliationError('APPLICATION_IDENTITY_KIND_INVALID');
    }
    const expectedApplicantPhone = applicantKind === 'parent' ? parentPhone : studentPhone;
    if (normalizePhone(application.verified_phone_normalized) !== expectedApplicantPhone) {
      throw reconciliationError('APPLICATION_VERIFIED_PHONE_MISMATCH');
    }
    const reviewer = application.reviewed_by || payload.reviewedBy || null;
    const student = resolveIdentity({
      phone: studentPhone,
      kind: 'student',
      role: 'student',
      entityId: result.entityId,
      applicantUserId: application.applicant_user_id,
      applicant: applicantKind === 'student',
      name: applicationPayload.studentName,
      reviewer,
      at,
    });
    const parent = resolveIdentity({
      phone: parentPhone,
      kind: 'parent',
      role: 'student',
      entityId: result.entityId,
      applicantUserId: application.applicant_user_id,
      applicant: applicantKind === 'parent',
      name: applicationPayload.parentName,
      reviewer,
      at,
    });
    const allowed = new Set([student.id, parent.id]);
    const bound = findStudentUsers.all(result.entityId);
    if (bound.some(user => !allowed.has(user.id))
      || bound.filter(user => user.identity_kind === 'student').length !== 1
      || bound.filter(user => user.identity_kind === 'parent').length !== 1) {
      throw reconciliationError('IDENTITY_ENTITY_CONFLICT');
    }
    return { users: [student, parent], role: 'student', reviewer };
  }

  function reconcileTeacher(application, context, at) {
    const { payload, result, applicationPayload } = context;
    const phone = normalizePhone(application.verified_phone_normalized || applicationPayload.phone);
    if (!phone || phone !== normalizePhone(applicationPayload.phone)) {
      throw reconciliationError('APPLICATION_VERIFIED_PHONE_MISMATCH');
    }
    if (application.applicant_identity_kind !== 'teacher') {
      throw reconciliationError('APPLICATION_IDENTITY_KIND_INVALID');
    }
    const teacher = resolveIdentity({
      phone,
      kind: 'teacher',
      role: 'teacher',
      entityId: result.entityId,
      applicantUserId: application.applicant_user_id,
      applicant: true,
      name: applicationPayload.name,
      reviewer: application.reviewed_by || payload.reviewedBy || null,
      at,
    });
    const bound = findTeacherUsers.all(result.entityId);
    if (bound.length !== 1 || bound[0].id !== teacher.id) {
      throw reconciliationError('IDENTITY_ENTITY_CONFLICT');
    }
    return {
      users: [teacher],
      role: 'teacher',
      reviewer: application.reviewed_by || payload.reviewedBy || null,
    };
  }

  const reconcileTransaction = db.transaction((task, application, context) => {
    const at = timestamp();
    const identities = application.application_type === 'student'
      ? reconcileStudent(application, context, at)
      : reconcileTeacher(application, context, at);
    ensureCanonicalAuthority({
      ...identities,
      entityId: context.result.entityId,
      at,
    });
    const membership = findMembership.get(context.result.entityType, context.result.entityId);
    if (!membership || membership.status !== 'active' || membership.source !== 'admin_approval') {
      insertMembership.run(
        membership?.id || uuid('account-membership'),
        context.result.entityType,
        context.result.entityId,
        at,
        membership?.created_at || at,
        at,
      );
    }
    const approved = approveApplication.run(
      context.result.entityId,
      at,
      application.id,
      application.revision,
      task.id,
    );
    if (approved.changes !== 1) throw reconciliationError('APPLICATION_PROVISIONING_STATE_CONFLICT');
    writeAudit('application_provisioning_reconciled', application, task, {
      status: 'approved',
      entityId: context.result.entityId,
      entityType: context.result.entityType,
    }, at);
  });

  function reconcileCompletedTask(taskId) {
    const task = findTask.get(String(taskId || ''));
    if (!task) throw reconciliationError('PROVISIONING_TASK_NOT_FOUND');
    const taskPayload = parseObject(task.payload);
    const application = taskPayload?.applicationId
      ? findApplication.get(String(taskPayload.applicationId))
      : null;
    if (!application) throw reconciliationError('PROVISIONING_APPLICATION_NOT_FOUND');
    if (application.status === 'manual_resolution_required') {
      return {
        status: 'manual_resolution_required',
        code: application.rejection_reason || 'MANUAL_RESOLUTION_REQUIRED',
        applicationId: application.id,
        taskId: task.id,
        replayed: true,
      };
    }
    let context;
    try {
      context = validateEnvelope(task, application);
    } catch (error) {
      if (!error?.reconciliationConflict) throw error;
      if (application.status === 'provisioning') return markManual(application, task, error.code);
      throw error;
    }
    if (application.status === 'approved') {
      if (application.host_entity_id !== context.result.entityId) {
        throw reconciliationError('PROVISIONING_APPROVED_ENTITY_MISMATCH');
      }
      return {
        status: 'approved',
        applicationId: application.id,
        taskId: task.id,
        entityId: context.result.entityId,
        entityType: context.result.entityType,
        replayed: true,
      };
    }
    if (application.status !== 'provisioning') {
      throw reconciliationError('APPLICATION_PROVISIONING_STATE_CONFLICT');
    }
    try {
      reconcileTransaction(task, application, context);
    } catch (error) {
      if (!error?.reconciliationConflict && error?.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
      const code = error?.reconciliationConflict ? error.code : 'IDENTITY_PHONE_CONFLICT';
      return markManual(application, task, code);
    }
    return {
      status: 'approved',
      applicationId: application.id,
      taskId: task.id,
      entityId: context.result.entityId,
      entityType: context.result.entityType,
      replayed: false,
    };
  }

  function reconcilePendingCompletedTasks() {
    return db.prepare(`SELECT task.id FROM miniapp_tasks task
      INNER JOIN miniapp_role_applications application ON application.host_task_id=task.id
      WHERE task.task_type='identity-provisioning' AND task.status='completed'
        AND application.status='provisioning'
      ORDER BY task.created_at, task.id`).all()
      .map(row => reconcileCompletedTask(row.id));
  }

  return { reconcileCompletedTask, reconcilePendingCompletedTasks };
}

module.exports = { createMiniappProvisioningReconciler };
