'use strict';

function invalid() {
  return Object.assign(new Error('role application repository input is invalid'), { code: 'CLOUD_ROLE_APPLICATION_INVALID' });
}

function text(value, maximum = 512) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= maximum ? value : null;
}

function instant(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw invalid();
  return value.toISOString();
}

function phone(value) {
  return typeof value === 'string' && /^1[3-9][0-9]{9}$/u.test(value) ? value : null;
}

function translateDatabaseError(error) {
  const match = /\bVNEXT_ROLE_APPLICATION_([A-Z_]+)\b/u.exec(String(error?.message || ''));
  if (match) return Object.assign(new Error(`cloud role application ${match[1].toLowerCase()}`), { code: `CLOUD_ROLE_APPLICATION_${match[1]}` });
  if (error?.code === '23505') return Object.assign(new Error('cloud role application conflict'), { code: 'CLOUD_ROLE_APPLICATION_CONFLICT' });
  return error;
}

function record(row) {
  if (!row || typeof row !== 'object') throw invalid();
  const applicationId = text(row.applicationId, 128);
  const requestedIdentity = text(row.requestedIdentity, 32);
  const profileMode = text(row.profileMode, 16);
  const bindingHint = row.bindingHint === null ? null : (typeof row.bindingHint === 'string' ? row.bindingHint : undefined);
  const normalizedProfileName = row.profileName === null ? null : text(row.profileName, 64);
  const normalizedProfilePhone = row.profilePhone === null ? null : phone(row.profilePhone);
  const status = text(row.status, 16);
  if (!applicationId || !['teacher', 'student', 'family_member'].includes(requestedIdentity)
    || !['existing', 'new'].includes(profileMode) || (requestedIdentity === 'family_member' && profileMode !== 'existing') || bindingHint === undefined || !bindingHint
    || normalizedProfileName === undefined || normalizedProfilePhone === undefined
    || (normalizedProfileName === null) !== (normalizedProfilePhone === null)
    || !['submitted', 'approved', 'rejected'].includes(status)) throw invalid();
  const base = { applicationId, requestedIdentity, profileMode, bindingHint, profileName: normalizedProfileName, profilePhone: normalizedProfilePhone, status, submittedAt: instant(row.submittedAt) };
  if (Object.hasOwn(row, 'reviewedAt')) {
    const reviewedAt = row.reviewedAt === null ? null : instant(row.reviewedAt);
    const reviewedByAccountId = row.reviewedByAccountId === null ? null : text(row.reviewedByAccountId, 512);
    const profileId = row.profileId === null ? null : text(row.profileId, 128);
    if ((reviewedAt === null) !== (reviewedByAccountId === null) || profileId === undefined) throw invalid();
    return { ...base, reviewedAt, reviewedByAccountId, profileId };
  }
  return base;
}

const baseColumns = `application_id AS "applicationId",requested_identity AS "requestedIdentity",profile_mode AS "profileMode",binding_hint AS "bindingHint",profile_name AS "profileName",profile_phone AS "profilePhone",status,submitted_at AS "submittedAt"`;
const selectColumns = `${baseColumns},reviewed_at AS "reviewedAt",reviewed_by_account_id AS "reviewedByAccountId",profile_id AS "profileId"`;

function createMiniappRoleApplicationRepository({ query, tenantId }) {
  if (typeof query !== 'function' || !text(tenantId, 512)) throw invalid();
  async function readLatest({ accountId }) {
    const normalizedAccountId = text(accountId, 512);
    if (!normalizedAccountId) throw invalid();
    let result;
    try {
      result = await query(`SELECT ${baseColumns} FROM business.vnext_read_latest_cloud_role_application_v3($1,$2)`, [tenantId, normalizedAccountId]);
    } catch (error) {
      throw translateDatabaseError(error);
    }
    if (!result || !Array.isArray(result.rows)) throw invalid();
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) throw invalid();
    return record(result.rows[0]);
  }
  async function submit(input) {
    const accountId = text(input?.accountId, 512);
    const applicationId = text(input?.applicationId, 128);
    const idempotencyKey = text(input?.idempotencyKey, 256);
    const requestedIdentity = text(input?.requestedIdentity, 32);
    const profileMode = text(input?.profileMode, 16);
    const profileName = text(input?.profileName, 64);
    const profilePhone = phone(input?.profilePhone);
    const profilePhoneHmac = typeof input?.profilePhoneHmac === 'string' && /^[0-9a-f]{64}$/u.test(input.profilePhoneHmac) ? input.profilePhoneHmac : null;
    const requestedProfileId = input?.requestedProfileId === null ? null : text(input?.requestedProfileId, 128);
    const submittedAt = typeof input?.submittedAt === 'string' && Number.isFinite(Date.parse(input.submittedAt)) ? input.submittedAt : null;
    if (!accountId || !applicationId || !idempotencyKey || !['teacher', 'student', 'family_member'].includes(requestedIdentity)
      || !['existing', 'new'].includes(profileMode) || (requestedIdentity === 'family_member' && profileMode !== 'existing')
      || !profileName || !profilePhone || !profilePhoneHmac || !submittedAt
      || (profileMode === 'new' && !requestedProfileId) || (profileMode === 'existing' && input?.requestedProfileId !== null)) throw invalid();
    let result;
    try {
      result = await query(
        `SELECT ${baseColumns} FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [tenantId, accountId, applicationId, idempotencyKey, requestedIdentity, profileMode, profileName, profilePhone, profilePhoneHmac, requestedProfileId, submittedAt],
      );
    } catch (error) {
      throw translateDatabaseError(error);
    }
    if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw invalid();
    return record(result.rows[0]);
  }
  async function listSubmitted() {
    let result;
    try {
      result = await query(`SELECT ${selectColumns} FROM business.vnext_list_submitted_cloud_role_applications_v3($1)`, [tenantId]);
    } catch (error) {
      throw translateDatabaseError(error);
    }
    if (!result || !Array.isArray(result.rows)) throw invalid();
    return result.rows.map(record);
  }
  async function review(input) {
    const applicationId = text(input?.applicationId, 128);
    const decision = text(input?.decision, 16);
    const profileId = input?.profileId === null ? null : text(input?.profileId, 128);
    const reviewedAt = typeof input?.reviewedAt === 'string' && Number.isFinite(Date.parse(input.reviewedAt)) ? input.reviewedAt : null;
    const reviewerAccountId = text(input?.reviewerAccountId, 512);
    if (!applicationId || !['approved', 'rejected'].includes(decision) || !reviewedAt || !reviewerAccountId
      || !Object.hasOwn(input || {}, 'profileId') || (decision === 'approved' && input.profileId !== null && !profileId)
      || (decision === 'rejected' && input?.profileId !== null)) throw invalid();
    let result;
    try {
      result = await query(
        `SELECT ${selectColumns} FROM business.vnext_review_cloud_role_application_v4($1,$2,$3,$4,$5,$6)`,
        [tenantId, reviewerAccountId, applicationId, decision, profileId, reviewedAt],
      );
    } catch (error) {
      throw translateDatabaseError(error);
    }
    if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw invalid();
    return record(result.rows[0]);
  }
  return Object.freeze({ readLatest, submit, listSubmitted, review });
}

module.exports = Object.freeze({ createMiniappRoleApplicationRepository });
