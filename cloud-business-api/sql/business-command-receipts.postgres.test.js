'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const { createBusinessCommandWriter } = require('../src/businessCommandTransaction');
const { createBusinessRoomLifecycleMutations } = require('../src/businessRoomLifecycleMutationService');
const { createCloudBusinessApp } = require('../src/app');
(async () => {
  const runtime = createDisposablePg17Runtime(); await runtime.start(); const handle = await runtime.createIsolatedHandle();
  const admin = work => withQuery(handle, 'fixture-provisioner', work);
  let server;
  try {
    const receipt = { appliedAt: '2026-10-07T00:00:00.000Z', appliedBy: 'command-receipt-test' };
    await createVNextPg17CatalogBoundary(runtime).apply(handle, receipt);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, receipt);
    await admin(async db => {
      for (const name of ['20260823-zzzz-room-lifecycle.sql','20260823-zzzzz-course-lifecycle.sql','20260827-course-lifecycle-qualified.sql','20260907-teacher-course-write-scope.sql','20260908-created-room-visibility.sql']) await db.query(fs.readFileSync(path.join(__dirname, name), 'utf8'));
      await require('./managedTeacherProfileFixture').applyManagedTeacherProfileFixture(db);
      for (const name of ['20260913-teacher-room-maintenance.sql','20261007-business-command-receipts.sql']) await db.query(fs.readFileSync(path.join(__dirname, name), 'utf8'));
      await db.query(fs.readFileSync(path.join(__dirname, '20261007-business-command-receipts.sql'), 'utf8'));
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES('test','Test',false,now(),now())");
    });
    const clients = [];
    for (const purpose of ['writer','fixture-provisioner']) await withQuery(handle, purpose, async db => {
      if (purpose !== 'writer') await db.query('SET SESSION AUTHORIZATION vnext_pg17_writer');
      clients.push({ query: (sql, values) => db.query(sql, values) });
    });
    const available = [...clients], waiting = [];
    const pool = { async connect() {
      const client = available.shift() || await new Promise(resolve => waiting.push(resolve));
      return { query: client.query, release() { const next = waiting.shift(); if (next) next(client); else available.push(client); } };
    }, async query(sql, values) { const client = await this.connect(); try { return await client.query(sql, values); } finally { client.release(); } } };
    const writer = createBusinessCommandWriter(pool);
    let context = { accountId: 'actor', roles: ['super_admin'] }, effects = 0, failFinish = false;
    const tracking = { transaction: writer.transaction, query: async (sql, values) => {
      if (failFinish && sql.includes('vnext_finish_business_command')) { failFinish = false; throw new Error('receipt outage'); }
      return writer.query(sql, values);
    } };
    const mutation = createBusinessRoomLifecycleMutations({ query: async (sql, values) => { effects++; return writer.query(sql, values); } });
    const app = createCloudBusinessApp({ query: async () => ({ rows: [] }), businessTenantId: 'test', businessCommandWriter: tracking,
      businessRoomLifecycleMutations: mutation, desktopRegistration: { begin: async () => {}, register: async () => {}, sessionContext: async () => { if (!context) throw new Error('revoked'); return context; } } });
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const { createDesktopIdentityClient } = await import('../../src/services/desktopIdentityClient.mjs');
    const { createDesktopCloudBusinessDraftAdapter } = await import('../../src/services/desktopCloudBusinessDraft.mjs');
    let loseResponse = true;
    const client = createDesktopIdentityClient({ desktopIdentity: { status: () => ({}) }, fetchImpl: async (...args) => {
      const response = await fetch(...args);
      if (loseResponse) { loseResponse = false; await response.json(); throw Object.assign(new Error('lost response'), { code: 'ECONNRESET' }); }
      return response;
    } });
    const adapter = createDesktopCloudBusinessDraftAdapter({ cloudClient: client, baseUrl: `http://127.0.0.1:${server.address().port}`,
      sha256: value => require('node:crypto').createHash('sha256').update(value).digest('hex') });
    const create = adapter.createCommand({ id: 'create-room', type: 'room.create.v1', payload: { record: { id: 'room', name: 'Original' } } });
    await assert.rejects(adapter.submit(create, { sessionToken: 'fixture.ticket' }), /lost response/);
    const retried = await adapter.submit(create, { sessionToken: 'fixture.ticket' });
    assert.equal(retried.status, 'committed', JSON.stringify(retried)); assert.equal(effects, 1, 'lost response must replay the committed receipt');
    const update = adapter.createCommand({ id: 'update-room', type: 'room.update.v1', payload: { id: 'room', expectedVersion: retried.result.updatedAt, changes: { name: 'Updated' } } });
    const concurrent = await Promise.all([adapter.submit(update, { sessionToken: 'fixture.ticket' }), adapter.submit(update, { sessionToken: 'fixture.ticket' })]);
    assert.deepEqual(concurrent[0].result, concurrent[1].result); assert.equal(effects, 2, 'duplicate concurrent updates have one effect');
    const altered = { ...update, payload: { ...update.payload, changes: { name: 'Tampered' } } };
    assert.equal((await adapter.submit(altered, { sessionToken: 'fixture.ticket' })).status, 'rejected'); assert.equal(effects, 2);
    failFinish = true;
    const rollback = adapter.createCommand({ id: 'rollback-room', type: 'room.create.v1', payload: { record: { id: 'rollback', name: 'Rollback' } } });
    await assert.rejects(adapter.submit(rollback, { sessionToken: 'fixture.ticket' }), error => error.code === 'CLOUD_ONLINE_IDENTITY_UNAVAILABLE');
    assert.equal((await adapter.submit(rollback, { sessionToken: 'fixture.ticket' })).status, 'committed', 'receipt failure rolls back the mutation and permits a clean retry');
    context = { ...context, profile: { type: 'teacher', id: 'another-profile' } };
    assert.equal((await adapter.submit(create, { sessionToken: 'fixture.ticket' })).status, 'rejected', 'changed canonical profile cannot replay a receipt from a different scope');
    context = null;
    assert.equal((await adapter.submit(create, { sessionToken: 'fixture.ticket' })).status, 'rejected', 'revoked actors cannot replay old receipts');
    await admin(async db => { await db.query('RESET SESSION AUTHORIZATION');
      const rows = (await db.query('SELECT id,name FROM business.rooms ORDER BY id')).rows;
      assert.deepEqual(rows.map(row => row.name), ['Rollback','Updated']);
    });
    await withQuery(handle, 'writer', async db => {
      await assert.rejects(db.query('SELECT * FROM business.desktop_business_command_receipts'), error => error.code === '42501');
    });
    console.log('PostgreSQL atomic business effects/receipts, response-loss replay, duplicate serialization, payload fencing and current authorization passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await runtime.disposeHandle(handle).catch(() => {}); await runtime.stop().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
