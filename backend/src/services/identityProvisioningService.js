const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { normalizePhone } = require('./authorizationPolicy');
const { gradeYearFor } = require('./miniappApplicationService');

const PHONE_PATTERN = /^1\d{10}$/;
const OUTER_FIELDS = new Set([
  'applicationId',
  'revision',
  'applicationType',
  'payload',
  'reviewedBy',
  'tenantId',
  'requestHash',
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
]);
const TEACHER_FIELDS = new Set(['name', 'phone', 'subject', 'notes']);
const PARENT_RELATIONS = new Set(['\u7238\u7238', '\u5988\u5988']);

function provisioningError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value) {
  if (!isRecord(value)) throw provisioningError('IDENTITY_PROVISIONING_INPUT_INVALID');
}

function assertAllowedFields(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw provisioningError('IDENTITY_PROVISIONING_FIELD_FORBIDDEN');
  }
}

function cleanText(value, options = {}) {
  if (value === undefined || value === null) {
    if (options.required) throw provisioningError('IDENTITY_PROVISIONING_INPUT_INVALID');
    return null;
  }
  if (typeof value !== 'string') throw provisioningError('IDENTITY_PROVISIONING_INPUT_INVALID');
  const result = value.trim();
  if (options.required && !result) throw provisioningError('IDENTITY_PROVISIONING_INPUT_INVALID');
  if (result.length > (options.max || 200)) throw provisioningError('IDENTITY_PROVISIONING_INPUT_INVALID');
  if (options.plain && result && (/[<>]/.test(result) || /(?:data:|file:|javascript:)/i.test(result))) {
    throw provisioningError('IDENTITY_PROVISIONING_INPUT_INVALID');
  }
  return result || null;
}

function validPhone(value) {
  const phone = normalizePhone(value);
  if (!PHONE_PATTERN.test(phone)) throw provisioningError('APPLICATION_PHONE_INVALID');
  return phone;
}

function isEmpty(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function normalizedTenant(value) {
  return cleanText(value === undefined ? 'default' : value, { required: true, max: 100 });
}

function dateValue(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw provisioningError('IDENTITY_PROVISIONING_TIME_INVALID');
  return date;
}

function gradeCurrentFor(gradeYear, now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw provisioningError('IDENTITY_PROVISIONING_TIME_INVALID');
  const china = new Date(date.getTime() + (8 * 60 * 60 * 1000));
  const schoolYear = china.getUTCMonth() + 1 >= 9 ? china.getUTCFullYear() : china.getUTCFullYear() - 1;
  const yearsSinceEnrollment = schoolYear - Number(gradeYear);
  if (yearsSinceEnrollment === 0) return '\u9ad8\u4e00';
  if (yearsSinceEnrollment === 1) return '\u9ad8\u4e8c';
  if (yearsSinceEnrollment === 2) return '\u9ad8\u4e09';
  if (yearsSinceEnrollment >= 3) return '\u9ad8\u590d\u751f';
  throw provisioningError('GRADE_YEAR_MISMATCH');
}

function validateOuterInput(input) {
  assertRecord(input);
  assertAllowedFields(input, OUTER_FIELDS);
  const applicationId = cleanText(input.applicationId, { required: true, max: 200 });
  const revision = Number(input.revision);
  if (!Number.isInteger(revision) || revision < 1) throw provisioningError('IDENTITY_PROVISIONING_INPUT_INVALID');
  const applicationType = cleanText(input.applicationType, { required: true, max: 20 });
  if (!['student', 'teacher'].includes(applicationType)) {
    throw provisioningError('IDENTITY_PROVISIONING_INPUT_INVALID');
  }
  const requestHash = cleanText(input.requestHash, { required: true, max: 64 }).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(requestHash)) throw provisioningError('IDENTITY_PROVISIONING_INPUT_INVALID');
  assertRecord(input.payload);
  return {
    applicationId,
    revision,
    applicationType,
    requestHash,
    tenantId: normalizedTenant(input.tenantId),
    reviewedBy: cleanText(input.reviewedBy, { required: true, max: 200 }),
    payload: input.payload,
  };
}

function validateStudentPayload(payload, now) {
  assertAllowedFields(payload, STUDENT_FIELDS);
  const currentGrade = cleanText(payload.currentGrade, { required: true, max: 3 });
  const gradeYear = Number(payload.gradeYear);
  if (!Number.isInteger(gradeYear) || gradeYearFor(currentGrade, now) !== gradeYear) {
    throw provisioningError('GRADE_YEAR_MISMATCH');
  }
  const studentPhone = validPhone(payload.studentPhone);
  const parentPhone = validPhone(payload.parentPhone);
  if (studentPhone === parentPhone) throw provisioningError('STUDENT_PHONE_CROSS_OCCUPIED');
  const parentRelation = cleanText(payload.parentRelation, { required: true, max: 2 });
  if (!PARENT_RELATIONS.has(parentRelation)) throw provisioningError('IDENTITY_PROVISIONING_INPUT_INVALID');
  return {
    studentName: cleanText(payload.studentName, { required: true, max: 50 }),
    studentPhone,
    parentPhone,
    parentRelation,
    school: cleanText(payload.school, { required: true, max: 100 }),
    gradeYear,
    gradeCurrent: gradeCurrentFor(gradeYear, now),
    parentName: cleanText(payload.parentName, { max: 50 }),
    parentWechat: cleanText(payload.parentWechat, { max: 100 }),
    studentSource: cleanText(payload.studentSource, { max: 100 }),
    notes: cleanText(payload.notes, { max: 500, plain: true }),
  };
}

function validateTeacherPayload(payload) {
  assertAllowedFields(payload, TEACHER_FIELDS);
  return {
    name: cleanText(payload.name, { required: true, max: 50 }),
    phone: validPhone(payload.phone),
    subject: cleanText(payload.subject, { max: 50 }),
    notes: cleanText(payload.notes, { max: 500, plain: true }),
  };
}

function sameText(existing, incoming) {
  return String(existing).trim() === String(incoming).trim();
}

function ensureCompatible(existing, incoming, compare = sameText) {
  return isEmpty(existing) || compare(existing, incoming);
}

function receiptResult(row) {
  return {
    entityId: row.entity_id,
    entityType: row.entity_type,
    receiptId: row.id,
    resultHash: row.result_hash,
  };
}

function createIdentityProvisioningService(options = {}) {
  const db = options.db;
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new TypeError('identity provisioning requires a writable SQLite database');
  }
  const now = options.now || (() => new Date());
  const uuid = options.uuid || (() => uuidv4());

  function ensureSchool(tenantId, name, timestamp) {
    const existing = db.prepare(`SELECT id, count FROM schools
      WHERE tenant_id=? AND name=? AND deleted=0 ORDER BY created_at, id LIMIT 1`).get(tenantId, name);
    if (existing) {
      db.prepare('UPDATE schools SET count=?, updated_at=? WHERE id=?')
        .run(Number(existing.count || 0) + 1, timestamp, existing.id);
      return existing.id;
    }
    const id = uuid('school');
    db.prepare(`INSERT INTO schools
      (id, tenant_id, name, count, deleted, created_at, updated_at)
      VALUES (?, ?, ?, 1, 0, ?, ?)`).run(id, tenantId, name, timestamp, timestamp);
    return id;
  }

  function provisionStudent(tenantId, payload, currentDate, timestamp) {
    const input = validateStudentPayload(payload, currentDate);
    const studentRows = db.prepare('SELECT * FROM students WHERE deleted=0').all();
    const teacherRows = db.prepare('SELECT phone FROM teachers WHERE deleted=0').all();
    if (teacherRows.some(row => [input.studentPhone, input.parentPhone].includes(normalizePhone(row.phone)))) {
      throw provisioningError('STUDENT_PHONE_CROSS_OCCUPIED');
    }

    const indexed = studentRows.map(row => ({
      row,
      studentPhone: normalizePhone(row.phone),
      rawParentPhone: normalizePhone(row.parent_phone),
      normalizedParentPhone: normalizePhone(row.parent_phone_normalized),
      parentPhones: new Set([
        normalizePhone(row.parent_phone),
        normalizePhone(row.parent_phone_normalized),
      ].filter(Boolean)),
    }));
    if (indexed.some(item => item.parentPhones.has(input.studentPhone) || item.studentPhone === input.parentPhone)) {
      throw provisioningError('STUDENT_PHONE_CROSS_OCCUPIED');
    }
    const matches = indexed.filter(item => (
      item.studentPhone === input.studentPhone || item.parentPhones.has(input.parentPhone)
    ));
    if (matches.some(item => (
      item.rawParentPhone
      && item.normalizedParentPhone
      && item.rawParentPhone !== item.normalizedParentPhone
    ))) {
      throw provisioningError('STUDENT_PROFILE_CONFLICT');
    }
    if (matches.length > 1) throw provisioningError('STUDENT_PROFILE_CONFLICT');

    if (matches.length === 0) {
      const id = uuid('student');
      db.prepare(`INSERT INTO students
        (id, tenant_id, name, phone, parent_phone, parent_phone_normalized, parent_relation,
         school, grade_year, grade_current, source_type, institution_id, is_institution_student,
         parent_name, parent_wechat, student_source, balance_hours, balance_money, notes,
         deleted, created_at, updated_at)
        VALUES
        (@id, @tenantId, @name, @phone, @parentPhone, @parentPhoneNormalized, @parentRelation,
         @school, @gradeYear, @gradeCurrent, 1, NULL, 0,
         @parentName, @parentWechat, @studentSource, 0, 0, @notes,
         0, @createdAt, @updatedAt)`).run({
        id,
        tenantId,
        name: input.studentName,
        phone: input.studentPhone,
        parentPhone: input.parentPhone,
        parentPhoneNormalized: input.parentPhone,
        parentRelation: input.parentRelation,
        school: input.school,
        gradeYear: input.gradeYear,
        gradeCurrent: input.gradeCurrent,
        parentName: input.parentName,
        parentWechat: input.parentWechat,
        studentSource: input.studentSource,
        notes: input.notes,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      ensureSchool(tenantId, input.school, timestamp);
      return id;
    }

    const existing = matches[0].row;
    const existingTenant = normalizedTenant(existing.tenant_id);
    const compatible = existingTenant === tenantId
      && ensureCompatible(existing.name, input.studentName)
      && ensureCompatible(existing.phone, input.studentPhone, (left, right) => normalizePhone(left) === right)
      && ensureCompatible(existing.parent_phone, input.parentPhone, (left, right) => normalizePhone(left) === right)
      && ensureCompatible(existing.parent_relation, input.parentRelation)
      && ensureCompatible(existing.school, input.school)
      && ensureCompatible(existing.grade_year, input.gradeYear, (left, right) => Number(left) === right);
    if (!compatible) throw provisioningError('STUDENT_PROFILE_CONFLICT');

    const updates = {};
    if (isEmpty(existing.name)) updates.name = input.studentName;
    if (isEmpty(existing.phone)) updates.phone = input.studentPhone;
    if (isEmpty(existing.parent_phone)) updates.parent_phone = input.parentPhone;
    if (isEmpty(existing.parent_phone_normalized)) updates.parent_phone_normalized = input.parentPhone;
    if (isEmpty(existing.parent_relation)) updates.parent_relation = input.parentRelation;
    if (isEmpty(existing.school)) updates.school = input.school;
    if (isEmpty(existing.grade_year)) updates.grade_year = input.gradeYear;
    if (isEmpty(existing.grade_current)) updates.grade_current = input.gradeCurrent;
    if (isEmpty(existing.parent_name) && input.parentName) updates.parent_name = input.parentName;
    if (isEmpty(existing.parent_wechat) && input.parentWechat) updates.parent_wechat = input.parentWechat;
    if (isEmpty(existing.student_source) && input.studentSource) updates.student_source = input.studentSource;
    if (isEmpty(existing.notes) && input.notes) updates.notes = input.notes;
    if (Object.keys(updates).length > 0) {
      const assignments = Object.keys(updates).map(key => `${key}=@${key}`).join(', ');
      db.prepare(`UPDATE students SET ${assignments}, updated_at=@updated_at
        WHERE id=@id AND deleted=0`).run({ ...updates, updated_at: timestamp, id: existing.id });
    }
    if (isEmpty(existing.school)) ensureSchool(tenantId, input.school, timestamp);
    return existing.id;
  }

  function provisionTeacher(tenantId, payload, timestamp) {
    const input = validateTeacherPayload(payload);
    const studentRows = db.prepare(`SELECT phone, parent_phone, parent_phone_normalized
      FROM students WHERE deleted=0`).all();
    if (studentRows.some(row => (
      normalizePhone(row.phone) === input.phone
      || normalizePhone(row.parent_phone_normalized || row.parent_phone) === input.phone
    ))) {
      throw provisioningError('TEACHER_PROFILE_CONFLICT');
    }
    const matches = db.prepare('SELECT * FROM teachers WHERE deleted=0').all()
      .filter(row => normalizePhone(row.phone) === input.phone);
    if (matches.length > 1) throw provisioningError('TEACHER_PROFILE_CONFLICT');
    if (matches.length === 0) {
      const id = uuid('teacher');
      db.prepare(`INSERT INTO teachers
        (id, tenant_id, name, phone, subject, hourly_rate, notes, deleted, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?, ?)`)
        .run(id, tenantId, input.name, input.phone, input.subject, input.notes, timestamp, timestamp);
      return id;
    }

    const existing = matches[0];
    if (normalizedTenant(existing.tenant_id) !== tenantId || !ensureCompatible(existing.name, input.name)) {
      throw provisioningError('TEACHER_PROFILE_CONFLICT');
    }
    const updates = {};
    if (isEmpty(existing.name)) updates.name = input.name;
    if (isEmpty(existing.phone)) updates.phone = input.phone;
    if (isEmpty(existing.subject) && input.subject) updates.subject = input.subject;
    if (isEmpty(existing.notes) && input.notes) updates.notes = input.notes;
    if (Object.keys(updates).length > 0) {
      const assignments = Object.keys(updates).map(key => `${key}=@${key}`).join(', ');
      db.prepare(`UPDATE teachers SET ${assignments}, updated_at=@updated_at
        WHERE id=@id AND deleted=0`).run({ ...updates, updated_at: timestamp, id: existing.id });
    }
    return existing.id;
  }

  const provisionTransaction = db.transaction(rawInput => {
    const input = validateOuterInput(rawInput);
    const currentDate = dateValue(now);
    const timestamp = currentDate.toISOString();
    const exactReceipt = db.prepare(`SELECT * FROM identity_provisioning_receipts
      WHERE application_id=? AND revision=? AND request_hash=?`)
      .get(input.applicationId, input.revision, input.requestHash);
    if (exactReceipt) return receiptResult(exactReceipt);
    const conflictingReceipt = db.prepare(`SELECT id FROM identity_provisioning_receipts
      WHERE application_id=? AND revision=? LIMIT 1`).get(input.applicationId, input.revision);
    if (conflictingReceipt) throw provisioningError('APPLICATION_REVISION_HASH_CONFLICT');

    const entityId = input.applicationType === 'student'
      ? provisionStudent(input.tenantId, input.payload, currentDate, timestamp)
      : provisionTeacher(input.tenantId, input.payload, timestamp);
    const receiptId = uuid('receipt');
    const result = { entityId, entityType: input.applicationType, receiptId };
    const resultHash = crypto.createHash('sha256').update(JSON.stringify(result), 'utf8').digest('hex');
    db.prepare(`INSERT INTO identity_provisioning_receipts
      (id, application_id, revision, request_hash, entity_type, entity_id, result_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(receiptId, input.applicationId, input.revision, input.requestHash,
        input.applicationType, entityId, resultHash, timestamp, timestamp);
    return { ...result, resultHash };
  });

  return { provision: provisionTransaction };
}

module.exports = {
  createIdentityProvisioningService,
  gradeCurrentFor,
};
