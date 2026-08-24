'use strict';

const { Pool } = require('pg');
const { BOOTSTRAP_SUPER_ADMIN_PHONE, resolveBootstrapAdminAccountId } = require('../src/bootstrapAdminIdentity');
const { hmacPhone } = require('../src/desktopRegistrationService');

function failure() {
  return Object.assign(new Error('CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID'), {
    code: 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID',
  });
}

function buildVerifierPoolConfig(environment) {
  if (!environment || typeof environment !== 'object') throw failure();
  const port = Number(environment.POSTGRES_PORT || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535
    || typeof environment.COMMAND_WRITER_POSTGRES_PASSWORD !== 'string'
    || environment.COMMAND_WRITER_POSTGRES_PASSWORD === '') throw failure();
  return Object.freeze({
    host: environment.POSTGRES_HOST || 'gewu-postgres17',
    port,
    database: environment.POSTGRES_DB || 'gewu_cloud',
    user: 'vnext_pg17_writer',
    password: environment.COMMAND_WRITER_POSTGRES_PASSWORD,
    max: 1,
    connectionTimeoutMillis: 5000,
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
  const pool = new Pool(buildVerifierPoolConfig(process.env));
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

module.exports = Object.freeze({ buildVerifierPoolConfig, verifyFixedSuperAdmin });
