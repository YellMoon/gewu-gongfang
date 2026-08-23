'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

const SQL = fs.readFileSync(path.join(__dirname, '20260823-student-contact-directory.sql'), 'utf8');
const APPLY = Object.freeze({ appliedAt: '2026-08-23T00:00:00.000Z', appliedBy: 'student-contact-directory-test' });

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
      await facade.query("UPDATE business.students SET phone_legacy='13800138000',parent_phone_legacy='13900139000',parent_wechat_legacy='guardian-handle' WHERE id='student-1'");
      await facade.query('CREATE ROLE gewu_cloud_schedule_reader');
      await facade.query(SQL);
      const migrated = await facade.query("SELECT contact_slot,relationship,phone_value,wechat_handle FROM business.student_contact_directory WHERE student_id='student-1' ORDER BY contact_slot");
      assert.deepStrictEqual(migrated.rows.map(row => ({ slot: row.contact_slot, relationship: row.relationship, phone: row.phone_value, wechat: row.wechat_handle })), [
        { slot: 1, relationship: 'student', phone: '13800138000', wechat: null },
        { slot: 2, relationship: 'guardian', phone: '13900139000', wechat: 'guardian-handle' },
      ]);
      await facade.query("INSERT INTO business.student_contact_directory(contact_id,student_id,contact_slot,relationship,wechat_handle,status) VALUES ('contact-3','student-1',3,'guardian','second-guardian','active')");
      await assert.rejects(
        () => facade.query("INSERT INTO business.student_contact_directory(contact_id,student_id,contact_slot,relationship,phone_value,status) VALUES ('contact-duplicate','student-1',3,'guardian','13900139000','active')"),
        error => error && error.code === '23505',
      );
      await assert.rejects(
        () => facade.query("INSERT INTO business.student_contact_directory(contact_id,student_id,contact_slot,relationship,phone_value,status) VALUES ('contact-slot-four','student-1',4,'guardian','13900139000','active')"),
        error => error && error.code === '23514',
      );
      await assert.rejects(
        () => facade.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student-2','tenant-1','Student two',false,false,transaction_timestamp(),transaction_timestamp()); INSERT INTO business.student_contact_directory(contact_id,student_id,contact_slot,relationship,status) VALUES ('contact-empty','student-2',1,'student','active')"),
        error => error && error.code === '23514',
      );
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('student contact directory PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
