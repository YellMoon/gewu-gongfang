'use strict';

const { Pool } = require('pg');
const { BOOTSTRAP_SUPER_ADMIN_PHONE, resolveBootstrapAdminAccountId } = require('../src/bootstrapAdminIdentity');
const { hmacPhone } = require('../src/desktopRegistrationService');
const { resolveRuntimeDatabaseUser } = require('../src/runtimeDatabaseRole');

function failure() {
  return Object.assign(new Error('CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID'), {
    code: 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID',
  });
}

function resolveFixedSuperAdmin({ recordsJson, phonePepper }) {
  const identity = resolveFixedSuperAdminIdentity({ recordsJson, phonePepper });
  return Object.freeze({ fixedSuperAdminAccountId: identity.accountId });
}

function resolveFixedSuperAdminIdentity({ recordsJson, phonePepper }) {
  if (typeof recordsJson !== 'string' || typeof phonePepper !== 'string') throw failure();
  let records;
  try {
    records = JSON.parse(recordsJson);
  } catch (_) {
    throw failure();
  }
  let phoneHmac;
  let expectedAccountId;
  try {
    phoneHmac = hmacPhone(phonePepper, BOOTSTRAP_SUPER_ADMIN_PHONE);
    expectedAccountId = resolveBootstrapAdminAccountId({
      records,
      phoneHmac,
    });
  } catch (_) {
    throw failure();
  }
  if (!expectedAccountId) throw failure();
  const matching = records.filter(record => record.phoneHmac === phoneHmac && record.accountId === expectedAccountId);
  if (matching.length !== 1 || typeof matching[0].authorityId !== 'string' || !matching[0].authorityId.trim()) throw failure();
  return Object.freeze({ authorityId: matching[0].authorityId, accountId: expectedAccountId, phoneHmac });
}

function verifiedCount(value) {
  return value === 1 || value === '1';
}

async function verifyFixedSuperAdminState({ fixedIdentity, queryControlPlane, queryBusiness }) {
  if (!fixedIdentity || typeof fixedIdentity !== 'object' || Array.isArray(fixedIdentity)
    || typeof queryControlPlane !== 'function' || typeof queryBusiness !== 'function') throw failure();
  let control;
  let business;
  try {
    control = await queryControlPlane(
      `SELECT
         (SELECT count(*)::integer FROM vnext_control_plane.vnext_role_grants WHERE role='super_admin' AND status='active') AS "activeSuperAdminCount",
         (SELECT count(*)::integer FROM vnext_control_plane.vnext_role_grants WHERE authority_id=$1 AND account_id=$2 AND role='super_admin' AND status='active') AS "fixedSuperAdminCount",
         (SELECT count(*)::integer FROM vnext_control_plane.vnext_authorities WHERE authority_id=$1 AND status='active') AS "activeAuthorityCount",
         (SELECT count(*)::integer FROM vnext_control_plane.vnext_accounts WHERE authority_id=$1 AND account_id=$2 AND status='active') AS "activeAccountCount",
         (SELECT count(*)::integer FROM vnext_control_plane.vnext_verified_contacts WHERE authority_id=$1 AND account_id=$2 AND contact_type='phone' AND normalized_value_hash=$3 AND verification_state='verified' AND revoked_at IS NULL) AS "verifiedPhoneCount",
         EXISTS (
           SELECT 1 FROM pg_index
            WHERE indexrelid=to_regclass('vnext_control_plane.vnext_role_grants_one_active_super_admin')
              AND indisunique
              AND pg_get_expr(indpred,indrelid) LIKE '%super_admin%'
              AND pg_get_expr(indpred,indrelid) LIKE '%active%'
         ) AS "uniqueSuperAdminIndex"`,
      [fixedIdentity.authorityId, fixedIdentity.accountId, fixedIdentity.phoneHmac],
    );
    business = await queryBusiness(
      `SELECT
         (SELECT count(*)::integer FROM business.miniapp_cloud_role_grants WHERE role='super_admin' AND status='active') AS "activeSuperAdminCount",
         (SELECT count(*)::integer FROM business.miniapp_cloud_role_grants WHERE account_id=$1 AND role='super_admin' AND status='active') AS "fixedSuperAdminCount",
         (SELECT count(*)::integer FROM business.miniapp_cloud_accounts WHERE account_id=$1 AND phone_hmac=$2 AND status='active') AS "activeAccountCount",
         EXISTS (
           SELECT 1 FROM pg_index
            WHERE indexrelid=to_regclass('business.miniapp_cloud_role_grants_one_active_super_admin')
              AND indisunique
              AND pg_get_expr(indpred,indrelid) LIKE '%super_admin%'
              AND pg_get_expr(indpred,indrelid) LIKE '%active%'
         ) AS "uniqueSuperAdminIndex"`,
      [fixedIdentity.accountId, fixedIdentity.phoneHmac],
    );
  } catch (_) {
    throw failure();
  }
  const controlRow = control?.rows?.length === 1 ? control.rows[0] : null;
  const businessRow = business?.rows?.length === 1 ? business.rows[0] : null;
  if (!controlRow || !businessRow
    || !['activeSuperAdminCount', 'fixedSuperAdminCount', 'activeAuthorityCount', 'activeAccountCount', 'verifiedPhoneCount'].every(key => verifiedCount(controlRow[key]))
    || controlRow.uniqueSuperAdminIndex !== true
    || !['activeSuperAdminCount', 'fixedSuperAdminCount', 'activeAccountCount'].every(key => verifiedCount(businessRow[key]))
    || businessRow.uniqueSuperAdminIndex !== true) throw failure();
  return Object.freeze({ fixedSuperAdminAccountId: fixedIdentity.accountId });
}

async function verifyFixedSuperAdminFromEnvironment({ env = process.env, PoolClass = Pool } = {}) {
  const fixedIdentity = resolveFixedSuperAdminIdentity({
    recordsJson: env.CLOUD_OPERATOR_PHONE_HMACS,
    phonePepper: env.CLOUD_IDENTITY_PHONE_PEPPER,
  });
  const database = {
    host: env.POSTGRES_HOST || 'gewu-postgres17',
    port: Number(env.POSTGRES_PORT || 5432),
    database: env.POSTGRES_DB || 'gewu_cloud',
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 5000,
  };
  const controlPool = new PoolClass({ ...database, user: 'vnext_pg17_writer', password: env.COMMAND_WRITER_POSTGRES_PASSWORD });
  const businessPool = new PoolClass({ ...database, user: resolveRuntimeDatabaseUser(env.POSTGRES_USER), password: env.POSTGRES_PASSWORD });
  try {
    return await verifyFixedSuperAdminState({
      fixedIdentity,
      queryControlPlane: (sql, values) => controlPool.query(sql, values),
      queryBusiness: (sql, values) => businessPool.query(sql, values),
    });
  } finally {
    await Promise.allSettled([controlPool.end(), businessPool.end()]);
  }
}

async function main() {
  const result = await verifyFixedSuperAdminFromEnvironment();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.code ? error.code : 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_FAILED');
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  resolveFixedSuperAdmin,
  resolveFixedSuperAdminIdentity,
  verifyFixedSuperAdminState,
  verifyFixedSuperAdminFromEnvironment,
});
