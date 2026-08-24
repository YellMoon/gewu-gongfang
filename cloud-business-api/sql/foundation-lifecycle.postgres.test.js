'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const SQL = fs.readFileSync(path.join(__dirname, '20260824-foundation-lifecycle.sql'), 'utf8');
const APPLY = { appliedAt: '2026-08-24T00:00:00.000Z', appliedBy: 'foundation-lifecycle-test' };

(async () => {
  const runtime = createDisposablePg17Runtime(); await runtime.start(); const handle = await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, APPLY);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, APPLY);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query(SQL);
      await facade.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Tenant',false,transaction_timestamp(),transaction_timestamp())");
      await facade.query("INSERT INTO business.students(id,tenant_id,name,school_legacy,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student-1','tenant-1','Student','Old School',false,false,transaction_timestamp(),transaction_timestamp())");
    });
    let institutionVersion; let schoolVersion;
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      const institution = await facade.query("SELECT * FROM business.vnext_create_institution_v1('tenant-1','institution-1','Institution',NULL,NULL,30,NULL)");
      institutionVersion = institution.rows[0].updated_at.toISOString();
      const school = await facade.query("SELECT * FROM business.vnext_create_school_v1('tenant-1','school-1','Old School',1)");
      schoolVersion = school.rows[0].updated_at.toISOString();
      const renamed = await facade.query('SELECT * FROM business.vnext_update_school_v1($1,$2,$3::timestamptz,$4,$5)', ['tenant-1', 'school-1', schoolVersion, 'New School', 1]);
      schoolVersion = renamed.rows[0].updated_at.toISOString();
      await assert.rejects(() => facade.query('SELECT * FROM business.vnext_soft_delete_school($1,$2,$3::timestamptz)', ['tenant-1', 'school-1', schoolVersion]), error => error?.code === 'P0001');
      const removedInstitution = await facade.query('SELECT * FROM business.vnext_soft_delete_institution($1,$2,$3::timestamptz)', ['tenant-1', 'institution-1', institutionVersion]);
      assert.strictEqual(removedInstitution.rows.length, 1);
    });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      assert.deepStrictEqual((await facade.query("SELECT school_legacy FROM business.students WHERE id='student-1'")).rows, [{ school_legacy: 'New School' }]);
      assert.deepStrictEqual((await facade.query("SELECT legacy_deleted FROM business.institutions WHERE id='institution-1'")).rows, [{ legacy_deleted: true }]);
    });
    await withVNextPg17SyntheticQuery(handle, 'verifier', async facade => {
      await assert.rejects(() => facade.query("SELECT * FROM business.vnext_create_school_v1('tenant-1','school-2','Other',0)"), error => error?.code === '42501');
    });
  } finally { await runtime.disposeHandle(handle).catch(() => {}); await runtime.stop().catch(() => {}); }
  console.log('foundation lifecycle PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
