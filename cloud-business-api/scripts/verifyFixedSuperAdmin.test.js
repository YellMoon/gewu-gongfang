'use strict';

const assert = require('assert');
const { resolveFixedSuperAdmin } = require('./verifyFixedSuperAdmin');
const { hmacPhone } = require('../src/desktopRegistrationService');

const pepper = 'fixed-admin-phone-pepper-for-tests';
const expectedAccountId = 'account-fixed-admin';
const recordsJson = JSON.stringify([{
  authorityId: 'authority-1',
  accountId: expectedAccountId,
  phoneHmac: hmacPhone(pepper, '13732250653'),
}]);

assert.deepStrictEqual(resolveFixedSuperAdmin({ recordsJson, phonePepper: pepper }), {
  fixedSuperAdminAccountId: expectedAccountId,
});
assert.throws(
  () => resolveFixedSuperAdmin({ recordsJson: '[]', phonePepper: pepper }),
  error => error && error.code === 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID',
);
console.log('fixed super administrator verification tests passed');
