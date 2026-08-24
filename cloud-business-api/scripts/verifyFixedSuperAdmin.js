'use strict';

const { Pool } = require('pg');
const { BOOTSTRAP_SUPER_ADMIN_PHONE, resolveBootstrapAdminAccountId } = require('../src/bootstrapAdminIdentity');
const { hmacPhone } = require('../src/desktopRegistrationService');

function failure() {
  return Object.assign(new Error('CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID'), {
    code: 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID',
  });
}

async function verifyFixedSuperAdmin({ recordsJson, phonePepper, query }) {
  if (typeof recordsJson !== 'string' || typeof phonePepper !== 'string' || typeof query !== 'function') throw failure();
  let records;
  try {
    records = JSON.parse(recordsJson);
  } catch (_) {
    throw failure();
  }
  let expectedAccountId;
  try {
    expectedAccountId = resolveBootstrapAdminAccountId({
      records,
      phoneHmac: hmacPhone(phonePepper, BOOTSTRAP_SUPER_ADMIN_PHONE),
    });
  } catch (_) {
    throw failure();
  }
  if (!expectedAccountId) throw failure();
  const result = await query(
    "SELECT account_id AS \"accountId\" FROM vnext_control_plane.vnext_role_grants WHERE role='super_admin' AND status='active' ORDER BY authority_id,account_id",
  );
  if (!result || !Array.isArray(result.rows)) throw failure();
  return Object.freeze({
    fixedSuperAdminPhone: result.rows.length === 1 && result.rows[0].accountId === expectedAccountId,
  });
}

async function main() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'gewu-postgres17',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'gewu_cloud',
    user: process.env.POSTGRES_USER || 'gewu_app',
    password: process.env.POSTGRES_PASSWORD,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    const result = await verifyFixedSuperAdmin({
      recordsJson: process.env.CLOUD_OPERATOR_PHONE_HMACS,
      phonePepper: process.env.CLOUD_IDENTITY_PHONE_PEPPER,
      query: (text, values) => pool.query(text, values),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.code ? error.code : 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_FAILED');
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ verifyFixedSuperAdmin });
