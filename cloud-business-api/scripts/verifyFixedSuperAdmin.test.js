'use strict';

const assert = require('assert');
const { buildVerifierPoolConfig, verifyFixedSuperAdmin } = require('./verifyFixedSuperAdmin');
const { hmacPhone } = require('../src/desktopRegistrationService');

const pepper = 'fixed-admin-phone-pepper-for-tests';
const expectedAccountId = 'account-fixed-admin';
const recordsJson = JSON.stringify([{
  authorityId: 'authority-1',
  accountId: expectedAccountId,
  phoneHmac: hmacPhone(pepper, '13732250653'),
}]);

assert.deepStrictEqual(buildVerifierPoolConfig({
  POSTGRES_HOST: 'postgres',
  POSTGRES_PORT: '5433',
  POSTGRES_DB: 'authority',
  COMMAND_WRITER_POSTGRES_PASSWORD: 'writer-secret',
}), {
  host: 'postgres', port: 5433, database: 'authority', user: 'vnext_pg17_writer',
  password: 'writer-secret', max: 1, connectionTimeoutMillis: 5000,
});

(async () => {
  const ok = await verifyFixedSuperAdmin({
    recordsJson,
    phonePepper: pepper,
    query: async () => ({ rows: [{ accountId: expectedAccountId }] }),
  });
  assert.deepStrictEqual(ok, { fixedSuperAdminPhone: true });

  const wrong = await verifyFixedSuperAdmin({
    recordsJson,
    phonePepper: pepper,
    query: async () => ({ rows: [{ accountId: 'account-other' }] }),
  });
  assert.deepStrictEqual(wrong, { fixedSuperAdminPhone: false });

  await assert.rejects(
    () => verifyFixedSuperAdmin({ recordsJson: '[]', phonePepper: pepper, query: async () => ({ rows: [] }) }),
    error => error && error.code === 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID',
  );
  console.log('fixed super administrator verification tests passed');
})().catch(error => {
  console.error(error && error.code ? error.code : 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_FAILED');
  process.exitCode = 1;
});
