'use strict';

const assert = require('assert');
const { resolveFixedSuperAdmin, resolveFixedSuperAdminIdentity, verifyFixedSuperAdminState } = require('./verifyFixedSuperAdmin');
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
const fixedIdentity = resolveFixedSuperAdminIdentity({ recordsJson, phonePepper: pepper });
assert.deepStrictEqual(fixedIdentity, {
  authorityId: 'authority-1', accountId: expectedAccountId, phoneHmac: hmacPhone(pepper, '13732250653'),
});
assert.throws(
  () => resolveFixedSuperAdmin({ recordsJson: '[]', phonePepper: pepper }),
  error => error && error.code === 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID',
);

(async () => {
  const queries = [];
  const result = await verifyFixedSuperAdminState({
    fixedIdentity,
    queryControlPlane: async (sql, values) => {
      queries.push(['control', sql, values]);
      return { rows: [{ activeSuperAdminCount: 1, fixedSuperAdminCount: 1, activeAuthorityCount: 1, activeAccountCount: 1, verifiedPhoneCount: 1, uniqueSuperAdminIndex: true }] };
    },
    queryBusiness: async (sql, values) => {
      queries.push(['business', sql, values]);
      return { rows: [{ activeSuperAdminCount: 1, fixedSuperAdminCount: 1, activeAccountCount: 1, uniqueSuperAdminIndex: true }] };
    },
  });
  assert.deepStrictEqual(result, { fixedSuperAdminAccountId: expectedAccountId });
  assert.match(queries[0][1], /vnext_control_plane\.vnext_role_grants/u);
  assert.match(queries[0][1], /vnext_control_plane\.vnext_verified_contacts/u);
  assert.deepStrictEqual(queries[0][2], ['authority-1', expectedAccountId, fixedIdentity.phoneHmac]);
  assert.match(queries[1][1], /business\.miniapp_cloud_role_grants/u);
  assert.match(queries[1][1], /business\.miniapp_cloud_accounts/u);
  assert.deepStrictEqual(queries[1][2], [expectedAccountId, fixedIdentity.phoneHmac]);

  await assert.rejects(() => verifyFixedSuperAdminState({
    fixedIdentity,
    queryControlPlane: async () => ({ rows: [{ activeSuperAdminCount: 1, fixedSuperAdminCount: 1, activeAuthorityCount: 1, activeAccountCount: 1, verifiedPhoneCount: 1, uniqueSuperAdminIndex: true }] }),
    queryBusiness: async () => ({ rows: [{ activeSuperAdminCount: 2, fixedSuperAdminCount: 1, activeAccountCount: 1, uniqueSuperAdminIndex: true }] }),
  }), error => error?.code === 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID');
  await assert.rejects(() => verifyFixedSuperAdminState({
    fixedIdentity,
    queryControlPlane: async () => ({ rows: [{ activeSuperAdminCount: 1, fixedSuperAdminCount: 1, activeAuthorityCount: 1, activeAccountCount: 1, verifiedPhoneCount: 0, uniqueSuperAdminIndex: true }] }),
    queryBusiness: async () => ({ rows: [{ activeSuperAdminCount: 1, fixedSuperAdminCount: 1, activeAccountCount: 1, uniqueSuperAdminIndex: true }] }),
  }), error => error?.code === 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID');
  await assert.rejects(() => verifyFixedSuperAdminState({
    fixedIdentity,
    queryControlPlane: async () => ({ rows: [{ activeSuperAdminCount: 1, fixedSuperAdminCount: 1, activeAuthorityCount: 1, activeAccountCount: 1, verifiedPhoneCount: 1, uniqueSuperAdminIndex: false }] }),
    queryBusiness: async () => ({ rows: [{ activeSuperAdminCount: 1, fixedSuperAdminCount: 1, activeAccountCount: 1, uniqueSuperAdminIndex: true }] }),
  }), error => error?.code === 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID');
  await assert.rejects(() => verifyFixedSuperAdminState({
    fixedIdentity,
    queryControlPlane: async () => ({ rows: [{ activeSuperAdminCount: 1, fixedSuperAdminCount: 1, activeAuthorityCount: 1, activeAccountCount: 1, verifiedPhoneCount: 1, uniqueSuperAdminIndex: true }] }),
    queryBusiness: async () => ({ rows: [{ activeSuperAdminCount: 1, fixedSuperAdminCount: 1, activeAccountCount: 1, uniqueSuperAdminIndex: false }] }),
  }), error => error?.code === 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID');
  console.log('fixed super administrator verification tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
