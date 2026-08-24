'use strict';

const assert = require('assert');
const { verifyFixedSuperAdmin } = require('./verifyFixedSuperAdmin');
const { hmacPhone } = require('../src/desktopRegistrationService');

const pepper = 'fixed-admin-phone-pepper-for-tests';
const expectedAccountId = 'account-fixed-admin';
const recordsJson = JSON.stringify([{
  authorityId: 'authority-1',
  accountId: expectedAccountId,
  phoneHmac: hmacPhone(pepper, '13732250653'),
}]);

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
