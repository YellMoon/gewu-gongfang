const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { normalizePhone } = require('./authorizationPolicy');

const ACTIVE_APPLICATION_STATUSES = Object.freeze([
  'submitted',
  'provisioning',
  'manual_resolution_required',
]);

const STUDENT_FIELDS = new Set([
  'studentName',
  'studentPhone',
  'school',
  'currentGrade',
  'gradeYear',
  'parentRelation',
  'parentPhone',
  'parentName',
  'parentWechat',
  'studentSource',
  'notes',
  'guardianConfirmation',
  'applicantAgeConfirmation',
  'verifiedPhone',
]);
const TEACHER_FIELDS = new Set(['name', 'phone', 'subject', 'notes', 'verifiedPhone']);
const GRADES = Object.freeze({
  '\u9ad8\u4e00': 0,
  '\u9ad8\u4e8c': 1,
  '\u9ad8\u4e09': 2,
  '\u9ad8\u590d': 3,
});
const PARENT_RELATIONS = new Set(['\u7238\u7238', '\u5988\u5988']);
const PHONE_PATTERN = /^1\d{10}$/;

function applicationError(code, details) {
  const error = new Error(code);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function assertRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw applicationError('APPLICATION_PAYLOAD_INVALID');
  }
}

function assertAllowedFields(input, allowed) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw applicationError('APPLICATION_FIELD_FORBIDDEN');
  }
}

function textField(value, field, { required = false, min = 0, max }) {
  if (value === undefined || value === null) {
    if (required) throw applicationError('APPLICATION_FIELD_REQUIRED', { field });
    return undefined;
  }
  if (typeof value !== 'string') throw applicationError('APPLICATION_FIELD_INVALID', { field });
  const normalized = value.trim();
  if (!normalized) {
    if (required) throw applicationError('APPLICATION_FIELD_REQUIRED', { field });
    return undefined;
  }
  if (normalized.length < min || normalized.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw applicationError('APPLICATION_FIELD_INVALID', { field });
  }
  return normalized;
}

function plainNotes(value) {
  const normalized = textField(value, 'notes', { max: 500 });
  if (normalized && (/[<>]/.test(normalized) || /(?:data:|file:|javascript:)/i.test(normalized))) {
    throw applicationError('APPLICATION_TEXT_NOT_PLAIN', { field: 'notes' });
  }
  return normalized;
}

function validPhone(value, field) {
  const normalized = normalizePhone(value);
  if (!PHONE_PATTERN.test(normalized)) throw applicationError('APPLICATION_PHONE_INVALID', { field });
  return normalized;
}

function chinaCalendarParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw applicationError('APPLICATION_DATE_INVALID');
  const china = new Date(date.getTime() + (8 * 60 * 60 * 1000));
  return { year: china.getUTCFullYear(), month: china.getUTCMonth() + 1 };
}

function gradeYearFor(currentGrade, now = new Date()) {
  if (!Object.prototype.hasOwnProperty.call(GRADES, currentGrade)) {
    throw applicationError('CURRENT_GRADE_INVALID');
  }
  const { year, month } = chinaCalendarParts(now);
  const schoolYear = month >= 9 ? year : year - 1;
  return schoolYear - GRADES[currentGrade];
}

function assignOptional(target, key, value) {
  if (value !== undefined) target[key] = value;
}

function validateStudentApplication(input, options = {}) {
  assertRecord(input);
  assertAllowedFields(input, STUDENT_FIELDS);
  const studentPhone = validPhone(input.studentPhone, 'studentPhone');
  const parentPhone = validPhone(input.parentPhone, 'parentPhone');
  const verifiedPhone = validPhone(input.verifiedPhone, 'verifiedPhone');
  if (studentPhone === parentPhone) throw applicationError('STUDENT_PARENT_PHONE_MUST_DIFFER');

  let applicantIdentityKind;
  if (verifiedPhone === studentPhone) applicantIdentityKind = 'student';
  else if (verifiedPhone === parentPhone) applicantIdentityKind = 'parent';
  else throw applicationError('VERIFIED_PHONE_NOT_IN_STUDENT_APPLICATION');

  if (applicantIdentityKind === 'student' && input.applicantAgeConfirmation !== true) {
    throw applicationError('STUDENT_AGE_CONFIRMATION_REQUIRED');
  }
  if (applicantIdentityKind === 'parent' && input.guardianConfirmation !== true) {
    throw applicationError('GUARDIAN_CONFIRMATION_REQUIRED');
  }

  const currentGrade = textField(input.currentGrade, 'currentGrade', { required: true, max: 2 });
  const computedGradeYear = gradeYearFor(currentGrade, options.now || new Date());
  if (input.gradeYear !== undefined && Number(input.gradeYear) !== computedGradeYear) {
    throw applicationError('GRADE_YEAR_MISMATCH');
  }
  const parentRelation = textField(input.parentRelation, 'parentRelation', { required: true, max: 2 });
  if (!PARENT_RELATIONS.has(parentRelation)) throw applicationError('PARENT_RELATION_INVALID');

  const payload = {
    studentName: textField(input.studentName, 'studentName', { required: true, min: 2, max: 50 }),
    studentPhone,
    school: textField(input.school, 'school', { required: true, min: 2, max: 100 }),
    currentGrade,
    gradeYear: computedGradeYear,
    parentRelation,
    parentPhone,
  };
  assignOptional(payload, 'parentName', textField(input.parentName, 'parentName', { max: 50 }));
  assignOptional(payload, 'parentWechat', textField(input.parentWechat, 'parentWechat', { max: 100 }));
  assignOptional(payload, 'studentSource', textField(input.studentSource, 'studentSource', { max: 100 }));
  assignOptional(payload, 'notes', plainNotes(input.notes));
  payload.guardianConfirmation = input.guardianConfirmation === true;
  payload.applicantAgeConfirmation = input.applicantAgeConfirmation === true;

  return { applicantIdentityKind, payload, studentPhone, parentPhone, verifiedPhone };
}

function validateTeacherApplication(input) {
  assertRecord(input);
  assertAllowedFields(input, TEACHER_FIELDS);
  const phone = validPhone(input.phone, 'phone');
  const verifiedPhone = validPhone(input.verifiedPhone, 'verifiedPhone');
  if (phone !== verifiedPhone) throw applicationError('TEACHER_PHONE_MUST_MATCH_VERIFIED_PHONE');
  const payload = {
    name: textField(input.name, 'name', { required: true, min: 2, max: 50 }),
    phone,
  };
  assignOptional(payload, 'subject', textField(input.subject, 'subject', { max: 50 }));
  assignOptional(payload, 'notes', plainNotes(input.notes));
  return { applicantIdentityKind: 'teacher', payload, verifiedPhone };
}

function payloadHash(applicationType, payload) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ applicationType, payload }), 'utf8')
    .digest('hex');
}

function presentApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    applicationType: row.application_type,
    status: row.status,
    revision: row.revision,
    payload: JSON.parse(row.payload_json),
    applicantIdentityKind: row.applicant_identity_kind,
    hostTaskId: row.host_task_id || null,
    hostEntityId: row.host_entity_id || null,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    rejectionReason: row.rejection_reason || null,
    submittedAt: row.submitted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stateFor(row) {
  if (!row) return 'not_submitted';
  return row.status === 'approved' ? 'approved_relogin_required' : row.status;
}

function createMiniappApplicationService({ db, now = () => new Date(), uuid = uuidv4 } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('db is required');

  const findApplicant = db.prepare(`SELECT id, phone, phone_normalized, role, status, login_enabled,
      review_status, deleted, disabled_at
    FROM users WHERE id = ?`);
  const findIdempotency = db.prepare(`SELECT * FROM miniapp_role_applications
    WHERE applicant_user_id = ? AND idempotency_key = ?`);
  const findActiveForApplicant = db.prepare(`SELECT id FROM miniapp_role_applications
    WHERE applicant_user_id = ? AND status IN ('submitted', 'provisioning', 'manual_resolution_required')
    LIMIT 1`);
  const findActivePhoneOverlap = db.prepare(`SELECT id FROM miniapp_role_applications
    WHERE applicant_user_id <> ?
      AND status IN ('submitted', 'provisioning', 'manual_resolution_required')
      AND (
        verified_phone_normalized IN (?, ?)
        OR student_phone_normalized IN (?, ?)
        OR parent_phone_normalized IN (?, ?)
      )
    LIMIT 1`);
  const findRecognizedPhoneOwner = db.prepare(`SELECT id FROM users
    WHERE id <> ? AND deleted = 0 AND status = 1 AND login_enabled = 1
      AND review_status = 'approved' AND phone_normalized IN (?, ?)
    LIMIT 1`);
  const findRecognizedBusinessPhone = db.prepare(`SELECT id FROM (
      SELECT id FROM students
      WHERE deleted = 0 AND (
        phone IN (?, ?)
        OR parent_phone IN (?, ?)
        OR parent_phone_normalized IN (?, ?)
      )
      UNION ALL
      SELECT id FROM teachers WHERE deleted = 0 AND phone IN (?, ?)
    ) LIMIT 1`);
  const nextRevision = db.prepare(`SELECT COALESCE(MAX(revision), 0) + 1 AS revision
    FROM miniapp_role_applications WHERE applicant_user_id = ?`);
  const insertApplication = db.prepare(`INSERT INTO miniapp_role_applications
    (id, applicant_user_id, application_type, status, revision, payload_json, payload_hash,
     idempotency_key, verified_phone_normalized, student_phone_normalized,
     parent_phone_normalized, applicant_identity_kind, submitted_at, created_at, updated_at)
    VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const findLatest = db.prepare(`SELECT * FROM miniapp_role_applications
    WHERE applicant_user_id = ? ORDER BY revision DESC LIMIT 1`);
  const findOwned = db.prepare(`SELECT * FROM miniapp_role_applications
    WHERE id = ? AND applicant_user_id = ?`);
  const updateWithdrawn = db.prepare(`UPDATE miniapp_role_applications
    SET status = 'withdrawn', updated_at = ?
    WHERE id = ? AND applicant_user_id = ? AND status IN ('submitted', 'rejected')`);

  function validateApplicant(applicantUserId, verifiedPhone) {
    const applicant = findApplicant.get(applicantUserId);
    if (!applicant || applicant.deleted === 1 || applicant.status !== 1 || applicant.disabled_at) {
      throw applicationError('APPLICATION_APPLICANT_NOT_AVAILABLE');
    }
    const persistedPhone = normalizePhone(applicant.phone_normalized || applicant.phone);
    if (!PHONE_PATTERN.test(persistedPhone) || persistedPhone !== verifiedPhone) {
      throw applicationError('APPLICATION_VERIFIED_PHONE_MISMATCH');
    }
    if (applicant.login_enabled === 1 || applicant.review_status === 'approved' || applicant.role !== 'pending') {
      throw applicationError('APPLICATION_NOT_AVAILABLE_FOR_FORMAL_ACCOUNT');
    }
  }

  const submitTransaction = db.transaction(input => {
    const applicationType = String(input.applicationType || '').trim();
    if (!['student', 'teacher'].includes(applicationType)) {
      throw applicationError('APPLICATION_TYPE_NOT_ALLOWED');
    }
    const verifiedPhone = validPhone(input.verifiedPhone, 'verifiedPhone');
    const idempotencyKey = textField(input.idempotencyKey, 'idempotencyKey', {
      required: true,
      max: 128,
    });
    validateApplicant(input.applicantUserId, verifiedPhone);

    const validated = applicationType === 'student'
      ? validateStudentApplication({ ...input.payload, verifiedPhone }, { now: now() })
      : validateTeacherApplication({ ...input.payload, verifiedPhone });
    const hash = payloadHash(applicationType, validated.payload);
    const existingIdempotency = findIdempotency.get(input.applicantUserId, idempotencyKey);
    if (existingIdempotency) {
      if (existingIdempotency.application_type !== applicationType || existingIdempotency.payload_hash !== hash) {
        throw applicationError('IDEMPOTENCY_KEY_REUSED');
      }
      return { application: presentApplication(existingIdempotency), replayed: true };
    }
    if (findActiveForApplicant.get(input.applicantUserId)) {
      throw applicationError('ACTIVE_APPLICATION_EXISTS');
    }

    const studentPhone = validated.studentPhone || verifiedPhone;
    const parentPhone = validated.parentPhone || verifiedPhone;
    if (findActivePhoneOverlap.get(
      input.applicantUserId,
      studentPhone,
      parentPhone,
      studentPhone,
      parentPhone,
      studentPhone,
      parentPhone,
    )) {
      throw applicationError('ACTIVE_APPLICATION_EXISTS');
    }
    if (findRecognizedPhoneOwner.get(input.applicantUserId, studentPhone, parentPhone)) {
      throw applicationError('PHONE_ALREADY_RECOGNIZED');
    }
    if (findRecognizedBusinessPhone.get(
      studentPhone,
      parentPhone,
      studentPhone,
      parentPhone,
      studentPhone,
      parentPhone,
      studentPhone,
      parentPhone,
    )) {
      throw applicationError('PHONE_ALREADY_RECOGNIZED');
    }

    const timestamp = now().toISOString();
    const id = uuid();
    const revision = nextRevision.get(input.applicantUserId).revision;
    insertApplication.run(
      id,
      input.applicantUserId,
      applicationType,
      revision,
      JSON.stringify(validated.payload),
      hash,
      idempotencyKey,
      verifiedPhone,
      applicationType === 'student' ? validated.studentPhone : null,
      applicationType === 'student' ? validated.parentPhone : null,
      validated.applicantIdentityKind,
      timestamp,
      timestamp,
      timestamp,
    );
    return { application: presentApplication(findOwned.get(id, input.applicantUserId)), created: true };
  });

  function submit(input = {}) {
    try {
      return submitTransaction(input);
    } catch (error) {
      if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
        throw applicationError('ACTIVE_APPLICATION_EXISTS');
      }
      throw error;
    }
  }

  function getMine(applicantUserId) {
    const row = findLatest.get(applicantUserId);
    return { state: stateFor(row), application: presentApplication(row) };
  }

  const withdrawTransaction = db.transaction(({ applicantUserId, applicationId }) => {
    const row = findOwned.get(applicationId, applicantUserId);
    if (!row) throw applicationError('APPLICATION_NOT_FOUND');
    if (!['submitted', 'rejected'].includes(row.status)) {
      throw applicationError('APPLICATION_WITHDRAW_NOT_ALLOWED');
    }
    const timestamp = now().toISOString();
    const result = updateWithdrawn.run(timestamp, applicationId, applicantUserId);
    if (result.changes !== 1) throw applicationError('APPLICATION_WITHDRAW_NOT_ALLOWED');
    const updated = findOwned.get(applicationId, applicantUserId);
    return { state: stateFor(updated), application: presentApplication(updated) };
  });

  return { getMine, submit, withdraw: withdrawTransaction };
}

module.exports = {
  ACTIVE_APPLICATION_STATUSES,
  createMiniappApplicationService,
  gradeYearFor,
  validateStudentApplication,
  validateTeacherApplication,
};
