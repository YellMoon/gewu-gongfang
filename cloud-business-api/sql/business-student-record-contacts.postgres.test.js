'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

const CONTACT_SQL = fs.readFileSync(path.join(__dirname, '20260823-student-contact-directory.sql'), 'utf8');
const RECORD_SQL = fs.readFileSync(path.join(__dirname, '20260823-z-business-student-record-contacts.sql'), 'utf8');
const UNBIND_SQL = fs.readFileSync(path.join(__dirname, '20260825-business-student-contact-unbind.sql'), 'utf8');
const APPLY = Object.freeze({ appliedAt: '2026-08-23T00:00:00.000Z', appliedBy: 'business-student-record-contacts-test' });

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, APPLY);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, APPLY);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('CREATE ROLE gewu_cloud_schedule_reader');
      await facade.query(CONTACT_SQL);
      await facade.query(RECORD_SQL);
      await facade.query(UNBIND_SQL);
      await facade.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Tenant',false,transaction_timestamp(),transaction_timestamp())");
      await facade.query("INSERT INTO business.students(id,tenant_id,name,legacy_source_type,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student-1','tenant-1','Student old',1,false,false,'2026-08-20T00:00:00.000Z','2026-08-20T00:00:00.000Z')");
    });
    let updatedAt;
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      const contacts = JSON.stringify([{ slot: 1, relationship: 'student', phone: '13800138000', wechat: null, expected_updated_at: null }]);
      const result = await facade.query(
        'SELECT * FROM business.vnext_update_student_record_v4($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)',
        ['tenant-1', 'student-1', '2026-08-20T00:00:00.000Z', 'Student new', null, null, null, null, null, null, 1, 'Referral', contacts],
      );
      assert.strictEqual(result.rows.length, 1);
      updatedAt = result.rows[0].updated_at.toISOString();
      const staleContact = await facade.query(
        'SELECT * FROM business.vnext_update_student_record_v4($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)',
        ['tenant-1', 'student-1', updatedAt, 'Must not apply', null, null, null, null, null, null, 1, 'Referral', JSON.stringify([{ slot: 1, relationship: 'student', phone: '13900139000', wechat: null, expected_updated_at: '2026-08-20T00:00:00.000Z' }])],
      );
      assert.deepStrictEqual(staleContact.rows, []);
    });
    let contactUpdatedAt;
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      const rows = await facade.query("SELECT s.name,d.phone_value,d.updated_at FROM business.students s JOIN business.student_contact_directory d ON d.student_id=s.id WHERE s.id='student-1'");
      contactUpdatedAt = rows.rows[0].updated_at.toISOString();
      delete rows.rows[0].updated_at;
      assert.deepStrictEqual(rows.rows, [{ name: 'Student new', phone_value: '13800138000' }]);
    });
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      const removed = await facade.query(
        'SELECT * FROM business.vnext_update_student_record_v4($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)',
        ['tenant-1', 'student-1', updatedAt, 'Student without contact', null, null, null, null, null, null, 1, 'Referral', JSON.stringify([{ slot: 1, relationship: 'student', phone: null, wechat: null, expected_updated_at: contactUpdatedAt }])],
      );
      assert.strictEqual(removed.rows.length, 1);
      updatedAt = removed.rows[0].updated_at.toISOString();
    });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      const rows = await facade.query("SELECT s.name,d.phone_value FROM business.students s LEFT JOIN business.student_contact_directory d ON d.student_id=s.id WHERE s.id='student-1'");
      assert.deepStrictEqual(rows.rows, [{ name: 'Student without contact', phone_value: null }]);
    });
    await withVNextPg17SyntheticQuery(handle, 'verifier', async facade => {
      await assert.rejects(
        () => facade.query('SELECT * FROM business.vnext_update_student_record_v4($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)', ['tenant-1', 'student-1', updatedAt, 'Rejected', null, null, null, null, null, null, 1, null, '[]']),
        error => error && error.code === '42501',
      );
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('business student record contacts PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
