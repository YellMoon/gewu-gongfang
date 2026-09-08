'use strict';
// UTF-8: real desktop REST client and production room service against disposable PostgreSQL.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createCloudBusinessApp } = require('../src/app');
const { createBusinessRoomLifecycleMutations } = require('../src/businessRoomLifecycleMutationService');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

(async () => {
  const { createDesktopIdentityClient } = await import('../../src/services/desktopIdentityClient.mjs');
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    const receipt = { appliedAt: '2026-09-08T00:00:00.000Z', appliedBy: 'room-lifecycle-test' };
    await createVNextPg17CatalogBoundary(runtime).apply(handle, receipt);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, receipt);
    await withQuery(handle, 'fixture-provisioner', async db => {
      for (const file of ['20260823-zzzz-room-lifecycle.sql', '20260823-zzzzz-course-lifecycle.sql',
        '20260827-lifecycle-delete-qualified.sql', '20260907-teacher-course-write-scope.sql']) {
        await db.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      }
      const fix = fs.readFileSync(path.join(__dirname, '20260908-room-update-qualified.sql'), 'utf8');
      await db.query(fix);
      await db.query(fix);
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant','Test',false,now(),now())");
    });
    await withQuery(handle, 'writer', async db => {
      const mutations = createBusinessRoomLifecycleMutations({ query: (sql, values) => db.query(sql, values) });
      // The direct service call must execute SQL, not merely match source text or mock a successful row.
      const seed = await mutations.create({ actorScope: { role: 'super_admin', teacherId: null }, tenantId: 'tenant', roomId: 'room', name: '春禾教室', address: '春禾路一号' });
      const saved = await mutations.update({ tenantId: 'tenant', roomId: 'room', expectedUpdatedAt: seed.updatedAt, name: '春禾二楼', address: '春禾路二号' });
      assert.equal(saved.id, 'room');
      const app = createCloudBusinessApp({ query: async () => ({ rows: [] }), businessTenantId: 'tenant', businessRoomLifecycleMutations: mutations,
        desktopRegistration: { begin: async () => {}, register: async () => {}, sessionContext: async () => ({ roles: ['super_admin'] }) } });
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const client = createDesktopIdentityClient({ desktopIdentity: { status: async () => ({}) }, fetchImpl: fetch });
      const session = { baseUrl: `http://127.0.0.1:${server.address().port}`, currentSession: { token: 'desktop.ticket' } };
      try {
        const second = await client.createCloudRoom({ ...session, roomId: 'second', name: '第二教室', address: null });
        await assert.rejects(() => client.updateCloudRoom({ ...session, roomId: 'room', expectedUpdatedAt: saved.updatedAt, name: '第二教室', address: null }), error => error.code === 'CLOUD_BUSINESS_ROOM_NAME_EXISTS');
        await assert.rejects(() => client.updateCloudRoom({ ...session, roomId: 'room', expectedUpdatedAt: '2000-01-01T00:00:00.000Z', name: '旧版本覆盖', address: null }), error => error.code === 'CLOUD_BUSINESS_ROOM_CONFLICT');
        // UTF-8: rejected changes retain the old row, while reusing this record's own name is valid.
        await withQuery(handle, 'fixture-provisioner', async verify => {
          const result = await verify.query("SELECT name,address_legacy FROM business.rooms WHERE tenant_id='tenant' AND id='room'");
          assert.deepEqual(result.rows, [{ name: '春禾二楼', address_legacy: '春禾路二号' }]);
        });
        const changed = await client.updateCloudRoom({ ...session, roomId: 'room', expectedUpdatedAt: saved.updatedAt, name: '春禾三楼', address: '春禾路三号' });
        const sameName = await client.updateCloudRoom({ ...session, roomId: 'room', expectedUpdatedAt: changed.updatedAt, name: '春禾三楼', address: '春禾路三号' });
        await withQuery(handle, 'fixture-provisioner', async verify => {
          const result = await verify.query("SELECT name,address_legacy FROM business.rooms WHERE tenant_id='tenant' AND id='room'");
          assert.deepEqual(result.rows, [{ name: '春禾三楼', address_legacy: '春禾路三号' }]);
          await verify.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,legacy_room_id,legacy_active,legacy_deleted,created_at,updated_at) VALUES ('course','tenant','Test','Test',1,1,100,60,1,1,'room',true,false,now(),now())");
        });
        await assert.rejects(() => client.deleteCloudRoom({ ...session, roomId: 'room', expectedUpdatedAt: sameName.updatedAt }), error => error.code === 'CLOUD_BUSINESS_ROOM_REFERENCED');
        assert.equal(await mutations.update({ tenantId: 'foreign', roomId: 'room', expectedUpdatedAt: sameName.updatedAt, name: '越界', address: null }), null);
        await client.deleteCloudRoom({ ...session, roomId: 'second', expectedUpdatedAt: second.updatedAt });
        await withQuery(handle, 'fixture-provisioner', async verify => {
          const result = await verify.query("SELECT id,name,address_legacy,legacy_deleted FROM business.rooms ORDER BY id");
          assert.deepEqual(result.rows, [
            { id: 'room', name: '春禾三楼', address_legacy: '春禾路三号', legacy_deleted: false },
            { id: 'second', name: '第二教室', address_legacy: null, legacy_deleted: true },
          ]);
        });
        await assert.rejects(() => db.query("UPDATE business.rooms SET name='direct' WHERE id='room'"), error => error.code === '42501');
      } finally { await new Promise(resolve => server.close(resolve)); }
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('room actual service and desktop REST PostgreSQL lifecycle, duplicate, conflict and reference checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
