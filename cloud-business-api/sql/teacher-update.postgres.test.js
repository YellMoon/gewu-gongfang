'use strict';
// UTF-8: exercise the actual teacher write service as the restricted runtime writer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBusinessTeacherLifecycleMutations } = require('../src/businessTeacherLifecycleMutationService');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    const receipt = { appliedAt: '2026-09-08T00:00:00.000Z', appliedBy: 'teacher-update-test' };
    await createVNextPg17CatalogBoundary(runtime).apply(handle, receipt);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, receipt);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query(fs.readFileSync(path.join(__dirname, '20260823-zzz-teacher-lifecycle.sql'), 'utf8'));
      const fix = fs.readFileSync(path.join(__dirname, '20260908-teacher-update-qualified.sql'), 'utf8');
      await facade.query(fix);
      await facade.query(fix);
      await facade.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant','Test',false,now(),now())");
    });
    let expected;
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      const service = createBusinessTeacherLifecycleMutations({ query: (sql, values) => facade.query(sql, values) });
      const original = { tenantId: 'tenant', teacherId: 'self', name: '原教师', phone: '13100000000', subject: '物理', hourlyRate: 120, notes: null };
      const created = await service.create(original);
      const changed = { ...original, expectedUpdatedAt: created.updatedAt, name: '教师本人', subject: '数学', hourlyRate: 150, notes: '本人维护' };
      const updated = await service.update(changed);
      assert.equal(updated.id, original.teacherId);
      assert.match(updated.updatedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
      assert.equal(await service.update({ ...changed, tenantId: 'foreign' }), null);
      assert.equal(await service.update({ ...changed, expectedUpdatedAt: '2000-01-01T00:00:00.000Z', name: '陈旧覆盖' }), null);
      await assert.rejects(() => facade.query("UPDATE business.teachers SET name='direct' WHERE id='self'"), error => error.code === '42501');
      expected = { name: changed.name, phone_legacy: changed.phone, subject: changed.subject, hourly_rate: '150', notes: changed.notes };
    });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      const result = await facade.query("SELECT name,phone_legacy,subject,hourly_rate::text,notes FROM business.teachers WHERE tenant_id='tenant' AND id='self'");
      assert.deepEqual(result.rows, [expected]);
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('actual teacher lifecycle writer PostgreSQL update, readback and conflict checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
