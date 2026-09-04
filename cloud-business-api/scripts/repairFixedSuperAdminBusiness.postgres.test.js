'use strict';

const assert = require('assert');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { repairFixedSuperAdminBusiness } = require('./repairFixedSuperAdminBusiness');

const identity = Object.freeze({ authorityId: 'authority-fixed', accountId: 'account-fixed', phoneHmac: 'a'.repeat(64) });

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('CREATE SCHEMA business');
      await facade.query("CREATE TABLE business.miniapp_cloud_accounts(account_id text PRIMARY KEY,phone_hmac char(64) NOT NULL,status text NOT NULL); CREATE TABLE business.miniapp_cloud_role_grants(account_id text NOT NULL,role text NOT NULL,status text NOT NULL,updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(account_id,role))");
      await facade.query("INSERT INTO business.miniapp_cloud_accounts VALUES ('account-fixed',$1,'active'),('account-extra',$2,'active')", [identity.phoneHmac, 'b'.repeat(64)]);
      await facade.query("INSERT INTO business.miniapp_cloud_role_grants(account_id,role,status) VALUES ('account-fixed','super_admin','active'),('account-extra','super_admin','active')");

      const report = await repairFixedSuperAdminBusiness({ client: facade, identity });
      assert.deepStrictEqual({ mode: report.mode, extras: report.extraActiveSuperAdminCountBefore, committed: report.committed }, {
        mode: 'report', extras: 1, committed: false,
      });
      let rows = await facade.query("SELECT account_id,status FROM business.miniapp_cloud_role_grants ORDER BY account_id");
      assert.deepStrictEqual(rows.rows, [
        { account_id: 'account-extra', status: 'active' },
        { account_id: 'account-fixed', status: 'active' },
      ]);

      const rehearsal = await repairFixedSuperAdminBusiness({ client: facade, identity, repair: true, rollback: true, backupEvidenceProvided: true });
      assert.strictEqual(rehearsal.revokedGrantCount, 1);
      rows = await facade.query("SELECT account_id,status FROM business.miniapp_cloud_role_grants ORDER BY account_id");
      assert.strictEqual(rows.rows[0].status, 'active');

      const repaired = await repairFixedSuperAdminBusiness({ client: facade, identity, repair: true, backupEvidenceProvided: true });
      assert.deepStrictEqual({ revoked: repaired.revokedGrantCount, active: repaired.activeSuperAdminCountAfter, committed: repaired.committed }, {
        revoked: 1, active: 1, committed: true,
      });
      rows = await facade.query("SELECT account_id,status FROM business.miniapp_cloud_role_grants ORDER BY account_id");
      assert.deepStrictEqual(rows.rows, [
        { account_id: 'account-extra', status: 'revoked' },
        { account_id: 'account-fixed', status: 'active' },
      ]);
      const accounts = await facade.query('SELECT account_id,status FROM business.miniapp_cloud_accounts ORDER BY account_id');
      assert.deepStrictEqual(accounts.rows, [
        { account_id: 'account-extra', status: 'active' },
        { account_id: 'account-fixed', status: 'active' },
      ], 'repairing the grant must not delete or disable either account');
      assert.strictEqual(rows.rows.length, 2, 'the repair must not invent a replacement role');

      const repeated = await repairFixedSuperAdminBusiness({ client: facade, identity, repair: true, backupEvidenceProvided: true });
      assert.strictEqual(repeated.revokedGrantCount, 0, 'the repair must be idempotent');
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('fixed super administrator business repair PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
