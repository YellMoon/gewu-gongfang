'use strict';
// UTF-8: execute the actual REST projection's teacher expression in disposable PostgreSQL.
const assert = require('node:assert/strict');
const { createCloudBusinessApp } = require('../src/app');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

(async () => {
  let source;
  const empty = { students: [], studentContacts: [], teachers: [], courses: [], schedules: [], institutions: [], schools: [], rooms: [], assetRecords: [], assetCategories: [], payments: [], consumptions: [] };
  const app = createCloudBusinessApp({ businessTenantId: 'own-tenant', query: async (sql, values) => {
    source = sql;
    assert.deepEqual(values, ['own-tenant', 'teacher', 'self', 'account']);
    return { rows: [{ projection: empty }] };
  }, desktopRegistration: { begin: async () => {}, register: async () => {}, sessionContext: async () => ({
    roles: ['teacher'], profile: { type: 'teacher', id: 'self' }, accountId: 'account',
  }) } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/business/desktop-projection`, { headers: { authorization: 'Bearer desktop.ticket' } });
    assert.equal(response.status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
  const begin = source.indexOf("'teachers',") + "'teachers',".length;
  const end = source.indexOf(", 'courses',", begin);
  assert(begin > 10 && end > begin, 'must isolate the exact expression used by the runtime, not a test reimplementation');
  const expression = source.slice(begin, end);
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    const receipt = { appliedAt: '2026-09-08T00:00:00.000Z', appliedBy: 'teacher-self-projection-test' };
    await createVNextPg17CatalogBoundary(runtime).apply(handle, receipt);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, receipt);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('own-tenant','Test',false,now(),now()),('other-tenant','Other',false,now(),now())");
      for (const [id, tenant, deleted] of [['self', 'own-tenant', false], ['other', 'own-tenant', false], ['deleted', 'own-tenant', true], ['foreign', 'other-tenant', false]]) {
        await facade.query('INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$1,$3,now(),now())', [id, tenant, deleted]);
      }
      const query = `WITH bound_profile AS (SELECT $3::text AS id), scoped_courses AS (SELECT unnest($4::text[]) AS teacher_id) SELECT ${expression} AS teachers`;
      for (const [role, profile, courseTeachers, ids] of [
        ['teacher', 'self', [], ['self']],
        ['teacher', 'self', ['self'], ['self']],
        ['teacher', 'deleted', [], []],
        ['teacher', 'foreign', [], []],
        ['student', 'self', [], []],
        ['student', 'self', ['other'], ['other']],
        ['manager', null, [], ['other', 'self']],
      ]) {
        const result = await facade.query(query, ['own-tenant', role, profile, courseTeachers]);
        assert.deepEqual(result.rows[0].teachers.map(row => row.id), ids, `${role}/${profile}: no-course self visibility must preserve tenant, deleted and student boundaries`);
      }
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('actual teacher projection PostgreSQL no-course self and scoped visibility checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
