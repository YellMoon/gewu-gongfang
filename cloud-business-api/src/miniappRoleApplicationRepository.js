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

function record(row) {
  if (!row || typeof row !== 'object') throw invalid();
  const applicationId = text(row.applicationId, 128);
  const requestedIdentity = text(row.requestedIdentity, 32);
  const profileMode = text(row.profileMode, 16);
  const bindingHint = row.bindingHint === null ? null : (typeof row.bindingHint === 'string' ? row.bindingHint : undefined);
  const status = text(row.status, 16);
  if (!applicationId || !['teacher', 'student', 'family_member'].includes(requestedIdentity)
    || !['existing', 'new'].includes(profileMode) || (requestedIdentity === 'family_member' && profileMode !== 'existing') || bindingHint === undefined || !bindingHint
    || !['submitted', 'approved', 'rejected'].includes(status)) throw invalid();
  const base = { applicationId, requestedIdentity, profileMode, bindingHint, status, submittedAt: instant(row.submittedAt) };
  if (Object.hasOwn(row, 'reviewedAt')) {
    const reviewedAt = row.reviewedAt === null ? null : instant(row.reviewedAt);
    const reviewedByAccountId = row.reviewedByAccountId === null ? null : text(row.reviewedByAccountId, 512);
    const profileId = row.profileId === null ? null : text(row.profileId, 128);
    if ((reviewedAt === null) !== (reviewedByAccountId === null) || profileId === undefined) throw invalid();
    return { ...base, reviewedAt, reviewedByAccountId, profileId };
  }
  return base;
}

const selectColumns = `application_id AS "applicationId",requested_identity AS "requestedIdentity",profile_mode AS "profileMode",binding_hint AS "bindingHint",status,submitted_at AS "submittedAt",reviewed_at AS "reviewedAt",reviewed_by_account_id AS "reviewedByAccountId",profile_id AS "profileId"`;

function createMiniappRoleApplicationRepository({ query, tenantId }) {
  if (typeof query !== 'function' || !text(tenantId, 512)) throw invalid();
  async function readLatest({ accountId }) {
    const normalizedAccountId = text(accountId, 512);
    if (!normalizedAccountId) throw invalid();
    const result = await query(
      `SELECT application_id AS "applicationId",requested_identity AS "requestedIdentity",profile_mode AS "profileMode",binding_hint AS "bindingHint",status,submitted_at AS "submittedAt"
         FROM business.vnext_read_latest_cloud_role_application_v2($1,$2)`,
      [tenantId, normalizedAccountId],
    );
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
    const bindingHint = input?.bindingHint === null ? null : (typeof input?.bindingHint === 'string' && input.bindingHint.length <= 128 ? input.bindingHint : undefined);
    const submittedAt = typeof input?.submittedAt === 'string' && Number.isFinite(Date.parse(input.submittedAt)) ? input.submittedAt : null;
    if (!accountId || !applicationId || !idempotencyKey || !['teacher', 'student', 'family_member'].includes(requestedIdentity)
      || !['existing', 'new'].includes(profileMode) || (requestedIdentity === 'family_member' && profileMode !== 'existing')
      || bindingHint === undefined || !bindingHint || !submittedAt) throw invalid();
    const result = await query(
      `SELECT application_id AS "applicationId",requested_identity AS "requestedIdentity",profile_mode AS "profileMode",binding_hint AS "bindingHint",status,submitted_at AS "submittedAt"
         FROM business.vnext_submit_cloud_role_application_v2($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, accountId, applicationId, idempotencyKey, requestedIdentity, profileMode, bindingHint, submittedAt],
    );
    if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw invalid();
    return record(result.rows[0]);
  }
  async function listSubmitted() {
    const result = await query(
      `SELECT ${selectColumns}
         FROM business.vnext_list_submitted_cloud_role_applications_v2($1)`,
      [tenantId],
    );
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
      || (decision === 'approved' && !profileId) || (decision === 'rejected' && input?.profileId !== null)) throw invalid();
    const result = await query(
      `SELECT ${selectColumns}
         FROM business.vnext_review_cloud_role_application_v2($1,$2,$3,$4,$5,$6)`,
      [tenantId, reviewerAccountId, applicationId, decision, profileId, reviewedAt],
    );
    if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw invalid();
    return record(result.rows[0]);
  }
  return Object.freeze({ readLatest, submit, listSubmitted, review });
}

module.exports = Object.freeze({ createMiniappRoleApplicationRepository });
