'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { verifyFixedSuperAdminState } = require('../scripts/verifyFixedSuperAdmin');

const SQL = fs.readFileSync(path.join(__dirname, '20260901-fixed-super-admin-business-invariant.sql'), 'utf8');
const fixedIdentity = Object.freeze({ authorityId: 'authority-1', accountId: 'account-fixed', phoneHmac: 'a'.repeat(64) });

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('CREATE SCHEMA vnext_control_plane; CREATE SCHEMA business');
      await facade.query("CREATE TABLE vnext_control_plane.vnext_authorities(authority_id text,status text); CREATE TABLE vnext_control_plane.vnext_accounts(authority_id text,account_id text,status text); CREATE TABLE vnext_control_plane.vnext_verified_contacts(authority_id text,account_id text,contact_type text,normalized_value_hash text,verification_state text,revoked_at timestamptz); CREATE TABLE vnext_control_plane.vnext_role_grants(authority_id text,account_id text,role text,status text)");
      await facade.query('CREATE TABLE business.miniapp_cloud_accounts(account_id text PRIMARY KEY,phone_hmac char(64),status text); CREATE TABLE business.miniapp_cloud_role_grants(account_id text,role text,status text,PRIMARY KEY(account_id,role))');
      await facade.query("INSERT INTO vnext_control_plane.vnext_authorities VALUES ('authority-1','active'); INSERT INTO vnext_control_plane.vnext_accounts VALUES ('authority-1','account-fixed','active')");
      await facade.query("INSERT INTO vnext_control_plane.vnext_verified_contacts VALUES ('authority-1','account-fixed','phone',$1,'verified',NULL)", [fixedIdentity.phoneHmac]);
      await facade.query("INSERT INTO vnext_control_plane.vnext_role_grants VALUES ('authority-1','account-fixed','super_admin','active')");
      await facade.query("INSERT INTO business.miniapp_cloud_accounts VALUES ('account-fixed',$1,'active')", [fixedIdentity.phoneHmac]);
      await facade.query("INSERT INTO business.miniapp_cloud_role_grants VALUES ('account-fixed','super_admin','active')");
      await facade.query('CREATE UNIQUE INDEX vnext_role_grants_one_active_super_admin ON vnext_control_plane.vnext_role_grants(authority_id) WHERE role=\'super_admin\' AND status=\'active\'');
      await facade.query(SQL);
      assert.deepStrictEqual(await verifyFixedSuperAdminState({
        fixedIdentity,
        queryControlPlane: (sql, values) => facade.query(sql, values),
        queryBusiness: (sql, values) => facade.query(sql, values),
      }), { fixedSuperAdminAccountId: 'account-fixed' });
      await facade.query("INSERT INTO business.miniapp_cloud_accounts VALUES ('account-other',$1,'active')", ['b'.repeat(64)]);
      await assert.rejects(
        () => facade.query("INSERT INTO business.miniapp_cloud_role_grants VALUES ('account-other','super_admin','active')"),
        error => error?.code === '23505',
      );
      await facade.query("UPDATE business.miniapp_cloud_role_grants SET status='revoked' WHERE account_id='account-fixed'; INSERT INTO business.miniapp_cloud_role_grants VALUES ('account-other','super_admin','active')");
      await assert.rejects(() => verifyFixedSuperAdminState({
        fixedIdentity,
        queryControlPlane: (sql, values) => facade.query(sql, values),
        queryBusiness: (sql, values) => facade.query(sql, values),
      }), error => error?.code === 'CLOUD_FIXED_SUPER_ADMIN_VERIFICATION_INVALID');
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('fixed super administrator PostgreSQL invariant checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
