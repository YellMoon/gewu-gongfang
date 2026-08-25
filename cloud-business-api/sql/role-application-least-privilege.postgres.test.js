'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');

const BASE_SQL = fs.readFileSync(path.join(__dirname, '20260826-cloud-role-applications.sql'), 'utf8');
const LEAST_PRIVILEGE_SQL = fs.readFileSync(path.join(__dirname, '20260826-zz-role-application-least-privilege.sql'), 'utf8');
const NEW_PROFILE_MODE_SQL = fs.readFileSync(path.join(__dirname, '20260826-zzz-role-application-new-profile-mode.sql'), 'utf8');

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('CREATE SCHEMA business');
      await facade.query('GRANT USAGE ON SCHEMA business TO vnext_pg17_writer');
      await facade.query("CREATE TABLE business.miniapp_cloud_role_grants (account_id text NOT NULL,role text NOT NULL,status text NOT NULL,profile_type text NULL,profile_id text NULL,student_relationship text NULL,updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(account_id,role))");
      await facade.query(BASE_SQL);
      await facade.query(LEAST_PRIVILEGE_SQL);
      await facade.query(NEW_PROFILE_MODE_SQL);
      await facade.query("INSERT INTO business.miniapp_cloud_role_grants(account_id,role,status,profile_type,profile_id) VALUES ('account-super-admin','super_admin','active',NULL,NULL)");
    });

    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      const privileges = await facade.query("SELECT has_table_privilege('vnext_pg17_writer','business.cloud_role_applications','SELECT') AS can_select,has_table_privilege('vnext_pg17_writer','business.cloud_role_applications','INSERT') AS can_insert,has_table_privilege('vnext_pg17_writer','business.cloud_role_applications','UPDATE') AS can_update");
      assert.deepStrictEqual(privileges.rows, [{ can_select: false, can_insert: false, can_update: false }]);
      await assert.rejects(
        () => facade.query("SELECT * FROM business.vnext_submit_cloud_role_application_v2('tenant-1','account-visitor','application-1','role-application-1','teacher','existing','teacher-1',transaction_timestamp())"),
        error => error && error.code === '42501',
      );
      await assert.rejects(
        () => facade.query("SELECT * FROM business.vnext_review_cloud_role_application_v2('tenant-1','account-super-admin','application-1','approved','teacher-1',transaction_timestamp())"),
        error => error && error.code === '42501',
      );
    });

    await withVNextPg17SyntheticQuery(handle, 'identity-verifier', async facade => {
      const submitted = await facade.query("SELECT * FROM business.vnext_submit_cloud_role_application_v2('tenant-1','account-visitor','application-1','role-application-1','teacher','existing','teacher-1',transaction_timestamp())");
      assert.strictEqual(submitted.rows.length, 1);
      assert.strictEqual(submitted.rows[0].status, 'submitted');
      const newTeacher = await facade.query("SELECT * FROM business.vnext_submit_cloud_role_application_v2('tenant-1','account-new-teacher','application-new-teacher','role-application-new-teacher','teacher','new','New Teacher',transaction_timestamp())");
      assert.strictEqual(newTeacher.rows[0].profile_mode, 'new');
      await assert.rejects(
        () => facade.query("SELECT * FROM business.vnext_submit_cloud_role_application_v2('tenant-1','account-family','application-family','role-application-family','family_member','new','Family',transaction_timestamp())"),
        error => error && error.code === '22023',
      );
      const latest = await facade.query("SELECT * FROM business.vnext_read_latest_cloud_role_application_v2('tenant-1','account-visitor')");
      assert.strictEqual(latest.rows[0].application_id, 'application-1');
      const reviewed = await facade.query("SELECT * FROM business.vnext_review_cloud_role_application_v2('tenant-1','account-super-admin','application-1','approved','teacher-1',transaction_timestamp())");
      assert.strictEqual(reviewed.rows[0].status, 'approved');
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('role application least-privilege PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
