'use strict';

const { BOOTSTRAP_SUPER_ADMIN_PHONE, resolveBootstrapAdminAccountId } = require('../src/bootstrapAdminIdentity');
const { hmacPhone } = require('../src/desktopRegistrationService');

function failure() {
  return Object.assign(new Error('CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID'), {
    code: 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID',
  });
}

function resolveFixedSuperAdmin({ recordsJson, phonePepper }) {
  if (typeof recordsJson !== 'string' || typeof phonePepper !== 'string') throw failure();
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
  return Object.freeze({ fixedSuperAdminAccountId: expectedAccountId });
}

function main() {
  const result = resolveFixedSuperAdmin({
    recordsJson: process.env.CLOUD_OPERATOR_PHONE_HMACS,
    phonePepper: process.env.CLOUD_IDENTITY_PHONE_PEPPER,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.code ? error.code : 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_FAILED');
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ resolveFixedSuperAdmin });
