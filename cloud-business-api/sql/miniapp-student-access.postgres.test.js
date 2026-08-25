'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

const SQL = fs.readFileSync(path.join(__dirname, '20260822-miniapp-student-access.sql'), 'utf8');
const APPLY = Object.freeze({ appliedAt: '2026-08-22T00:00:00.000Z', appliedBy: 'student-access-test' });

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, APPLY);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, APPLY);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query("INSERT INTO business.tenants(id,name,legacy_status,legacy_plan,legacy_archive_before,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Tenant',NULL,NULL,NULL,false,transaction_timestamp(),transaction_timestamp())");
      await facade.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student-1','tenant-1','Student',false,false,transaction_timestamp(),transaction_timestamp())");
      await facade.query("CREATE TABLE business.miniapp_cloud_accounts (account_id text PRIMARY KEY, status text NOT NULL CHECK(status IN ('active','disabled')))");
      await facade.query("CREATE TABLE business.miniapp_cloud_role_grants (account_id text NOT NULL REFERENCES business.miniapp_cloud_accounts(account_id), role text NOT NULL CHECK(role IN ('super_admin','teacher','student')), status text NOT NULL CHECK(status IN ('active','revoked')), profile_type text, profile_id text, PRIMARY KEY(account_id,role))");
      await facade.query("CREATE UNIQUE INDEX miniapp_cloud_one_active_role ON business.miniapp_cloud_role_grants(account_id) WHERE status='active'");
      await facade.query(SQL);
      await facade.query("INSERT INTO business.miniapp_cloud_accounts(account_id,status) VALUES ('student-account','active'),('guardian-1','active'),('guardian-2','active'),('guardian-3','active')");
      await facade.query("INSERT INTO business.miniapp_cloud_role_grants(account_id,role,status,profile_type,profile_id,student_relationship) VALUES ('student-account','student','active','student','student-1','student'),('guardian-1','student','active','student','student-1','guardian'),('guardian-2','student','active','student','student-1','guardian')");
      await assert.rejects(
        () => facade.query("INSERT INTO business.miniapp_cloud_role_grants(account_id,role,status,profile_type,profile_id,student_relationship) VALUES ('student-account','teacher','active','teacher','teacher-1',NULL)"),
        error => error && error.code === '23505',
      );
      await assert.rejects(
        () => facade.query("INSERT INTO business.miniapp_cloud_role_grants(account_id,role,status,profile_type,profile_id,student_relationship) VALUES ('guardian-3','student','active','student','student-1','guardian')"),
        error => error && error.code === 'P0001' && /VNEXT_STUDENT_ACCESS_GUARDIAN_LIMIT/u.test(error.message),
      );
      await facade.query("UPDATE business.miniapp_cloud_role_grants SET status='revoked' WHERE account_id='guardian-2' AND role='student'");
      await facade.query("INSERT INTO business.miniapp_cloud_role_grants(account_id,role,status,profile_type,profile_id,student_relationship) VALUES ('guardian-3','student','active','student','student-1','guardian')");
      await assert.rejects(
        () => facade.query("UPDATE business.miniapp_cloud_role_grants SET student_relationship='student' WHERE account_id='guardian-1' AND role='student'"),
        error => error && error.code === 'P0001' && /VNEXT_STUDENT_ACCESS_SELF_CONFLICT/u.test(error.message),
      );
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('miniapp student access PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
