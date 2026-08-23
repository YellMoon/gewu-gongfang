'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

const SQL = fs.readFileSync(path.join(__dirname, '20260823-business-student-update-source-fields.sql'), 'utf8');
const APPLY = Object.freeze({ appliedAt: '2026-08-23T00:00:00.000Z', appliedBy: 'business-student-update-test' });

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, APPLY);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, APPLY);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query(SQL);
      await facade.query(
        'INSERT INTO business.tenants(id,name,legacy_status,legacy_plan,legacy_archive_before,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz)',
        ['tenant-1', 'Tenant one', null, null, null, false, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'],
      );
      await facade.query(
        'INSERT INTO business.institutions(id,tenant_id,name,contact_person_legacy,contact_phone_legacy,revenue_share,notes,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz)',
        ['institution-1', 'tenant-1', 'Institution one', null, null, null, null, false, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'],
      );
      await facade.query(
        'INSERT INTO business.students(id,tenant_id,name,school_legacy,grade_year,grade_current,institution_id,parent_name_legacy,notes,legacy_source_type,student_source_legacy,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15::timestamptz)',
        ['student-1', 'tenant-1', 'Student one', 'School old', 2023, 'Grade one', 'institution-1', 'Parent old', 'note old', 1, 'Old referral', false, false, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'],
      );
    });
    let updatedAt;
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      const absent = await facade.query(
        'SELECT * FROM business.vnext_update_student_v2($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        ['tenant-absent', 'student-absent', '2026-08-20T00:00:00.000Z', 'Absent', null, null, null, null, null, null, null, null],
      );
      assert.deepStrictEqual(absent.rows, []);
      const updated = await facade.query(
        'SELECT * FROM business.vnext_update_student_v2($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        ['tenant-1', 'student-1', '2026-08-20T00:00:00.000Z', 'Student updated', 'School new', 2024, 'Grade two', 'institution-1', 'Parent new', 'note new', 2, 'New referral'],
      );
      assert.strictEqual(updated.rows.length, 1);
      assert.strictEqual(updated.rows[0].id, 'student-1');
      updatedAt = updated.rows[0].updated_at.toISOString();
      assert.notStrictEqual(updatedAt, '2026-08-20T00:00:00.000Z');
      const stale = await facade.query(
        'SELECT * FROM business.vnext_update_student_v2($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        ['tenant-1', 'student-1', '2026-08-20T00:00:00.000Z', 'Must not apply', null, null, null, null, null, null, null, null],
      );
      assert.deepStrictEqual(stale.rows, []);
      await assert.rejects(
        () => facade.query("UPDATE business.students SET name='direct-write' WHERE id='student-1'"),
        error => error && error.code === '42501',
      );
    });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      const result = await facade.query('SELECT name,school_legacy,grade_year,grade_current,institution_id,parent_name_legacy,notes,legacy_source_type,student_source_legacy,updated_at FROM business.students WHERE tenant_id=$1 AND id=$2', ['tenant-1', 'student-1']);
      assert.deepStrictEqual(result.rows.map(row => ({
        name: row.name, school: row.school_legacy, gradeYear: row.grade_year, gradeCurrent: row.grade_current,
        institutionId: row.institution_id, parentName: row.parent_name_legacy, notes: row.notes, sourceType: row.legacy_source_type, studentSource: row.student_source_legacy, updatedAt: row.updated_at.toISOString(),
      })), [{
        name: 'Student updated', school: 'School new', gradeYear: 2024, gradeCurrent: 'Grade two',
        institutionId: 'institution-1', parentName: 'Parent new', notes: 'note new', sourceType: 2, studentSource: 'New referral', updatedAt,
      }]);
    });
    await withVNextPg17SyntheticQuery(handle, 'verifier', async facade => {
      await assert.rejects(
        () => facade.query('SELECT * FROM business.vnext_update_student_v2($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12)', ['tenant-1', 'student-1', updatedAt, 'Rejected', null, null, null, null, null, null, null, null]),
        error => error && error.code === '42501',
      );
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('business student update PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
