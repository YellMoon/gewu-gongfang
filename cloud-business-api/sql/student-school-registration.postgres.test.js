'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const APPLY = { appliedAt: '2026-09-07T00:00:00.000Z', appliedBy: 'student-school-test' };
const migration = path.join(__dirname, '20260907-student-school-registration.sql');
const createSql = 'SELECT * FROM business.vnext_create_student_record_v1($1,$2,$3,$4,NULL,NULL,NULL,NULL,NULL,1,NULL,NULL,$5::jsonb)';
const updateSql = 'SELECT * FROM business.vnext_update_student_record_v4($1,$2,$3::timestamptz,$4,$5,NULL,NULL,NULL,NULL,NULL,1,NULL,$6::jsonb)';
async function desktopRoundTrip(writer, admin) {
  const { createCloudBusinessApp } = require('../src/app');
  const { createBusinessStudentLifecycleMutations } = require('../src/businessStudentLifecycleMutationService');
  const { createBusinessStudentRecordUpdate } = require('../src/businessStudentRecordMutationService');
  const { createDesktopIdentityClient } = await import('../../src/services/desktopIdentityClient.mjs');
  const { createDesktopCloudBusinessDraftAdapter } = await import('../../src/services/desktopCloudBusinessDraft.mjs');
  const { createDesktopAuthorityClient } = await import('../../src/services/desktopAuthorityClient.mjs');
  const { createDesktopCommandOutbox } = await import('../../src/services/desktopCommandOutbox.mjs');
  const query = (sql, values) => writer(db => db.query(sql, values));
  let role = 'teacher';
  let miniappOnly = false;
  const app = createCloudBusinessApp({
    query, businessTenantId: 't1',
    businessStudentLifecycleMutations: createBusinessStudentLifecycleMutations({ query }),
    businessStudentRecordUpdate: createBusinessStudentRecordUpdate({ query }),
    desktopRegistration: { begin: async () => {}, register: async () => {}, sessionContext: async () => {
      if (miniappOnly) throw new Error('not a desktop session');
      return { roles: [role], teacherId: 'http-teacher' };
    } },
    miniappCloudAccount: { login: async () => {}, context: async () => ({ roles: ['super_admin'] }) },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    let requests = 0;
    const cloudClient = createDesktopIdentityClient({ desktopIdentity: { status: async () => ({}) }, fetchImpl: (...args) => { requests++; return fetch(...args); } });
    const adapter = createDesktopCloudBusinessDraftAdapter({ cloudClient, baseUrl: `http://127.0.0.1:${server.address().port}`, sha256: value => require('node:crypto').createHash('sha256').update(value).digest('hex') });
    let storage = '';
    let sequence = 0;
    const outbox = createDesktopCommandOutbox({
      store: { read: async () => storage, write: async value => { storage = value; } },
      // Test-only in-memory codec; this test does not claim encryption coverage.
      codec: { seal: async value => JSON.stringify(value), open: async value => JSON.parse(value) },
      createId: () => `school-draft-${++sequence}`, now: () => '2026-09-07T00:00:00.000Z',
    });
    const client = createDesktopAuthorityClient({ outbox, createCloudBusinessCommand: adapter.createCommand, submitCloudBusiness: adapter.submit });
    const draft = await client.appendDraft({ type: 'student.create.v1', payload: { record: { id: 'http-student', name: 'Student', school: 'HTTP school', grade_year: 2024, source_type: 1, phone: '13800138000' } } });
    assert.equal(draft.status, 'awaiting_confirmation');
    assert.equal(await client.submit(draft.id, { sessionToken: 'eyJ2IjoxfQ.signature' }), undefined);
    assert.equal(requests, 0, 'having connectivity/session does not submit unconfirmed drafts');
    const result = await client.confirmAndSubmit(draft.id, { sessionToken: 'eyJ2IjoxfQ.signature' });
    assert.equal(result.transportUsed, 'cloud-business-authority');
    assert.equal(requests, 1, 'school registration requires no second REST request');
    assert.equal((await outbox.get(draft.id)).status, 'completed');
    assert(!storage.includes('eyJ2IjoxfQ.signature'));
    const read = () => admin(async db => (await db.query("SELECT s.updated_at,s.school_legacy,h.name FROM business.students s JOIN business.schools h ON h.tenant_id=s.tenant_id AND h.name=s.school_legacy AND h.legacy_deleted=false WHERE s.id='http-student'")).rows[0]);
    const created = await read();
    assert.equal(created.name, 'HTTP school');
    await admin(async db => assert.equal((await db.query("SELECT created_by_teacher_id FROM business.students WHERE id='http-student'")).rows[0].created_by_teacher_id, 'http-teacher'));
    const update = await client.appendDraft({ type: 'student.update.v1', payload: { id: 'http-student', expectedVersion: created.updated_at.toISOString(), changes: { name: 'Student', school: 'HTTP changed school', source_type: 1, contacts: [] } } });
    await client.confirmAndSubmit(update.id, { sessionToken: 'eyJ2IjoxfQ.signature' });
    assert.equal((await read()).name, 'HTTP changed school');
    // UTF-8: real page handler -> REST -> restricted PostgreSQL writer, then a failed readback.
    const ts = require('typescript');
    const source = ts.createSourceFile('StudentList.tsx', fs.readFileSync(path.join(__dirname, '../../src/pages/StudentList.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let createHandler;
    function findHandler(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'submitNewStudentToAuthority') createHandler = node.initializer.getText(source);
      ts.forEachChild(node, findHandler);
    }
    findHandler(source); assert(createHandler);
    let repeatedDrafts = 0; const warnings = []; const requestsBeforeReadFailure = requests;
    const dependencies = {
      window: { desktopIdentitySessionProvider: { createCloudStudentRecord: input => cloudClient.createCloudStudentRecord({
        baseUrl: `http://127.0.0.1:${server.address().port}`, currentSession: { token: 'eyJ2IjoxfQ.signature', offline: false }, ...input,
      }) } },
      dbService: { createStudent: () => repeatedDrafts++, refreshAuthorityProjection: async () => { throw new TypeError('Failed to fetch'); } },
      studentContactCommands: () => [], calculateGrade: () => '高一',
      message: { success() {}, warning: text => warnings.push(text), error(text) { throw new Error(text); } },
    };
    const saveStudent = new Function(...Object.keys(dependencies), ts.transpileModule(`return (${createHandler});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText)(...Object.values(dependencies));
    assert.equal(await saveStudent({ name: 'Readback acknowledged student', school: 'Readback school', grade_year: 2026, source_type: 1 }), true);
    assert.equal(requests - requestsBeforeReadFailure, 1, 'exactly one student write, no hidden retry');
    assert.equal(repeatedDrafts, 0, 'actual persisted student cannot generate a duplicate draft after read failure');
    assert(warnings.some(text => text.includes('已保存') && text.includes('刷新')));
    await admin(async db => {
      const rows = (await db.query("SELECT grade_year,grade_current,school_legacy FROM business.students WHERE name='Readback acknowledged student'")).rows;
      assert.deepEqual(rows, [{ grade_year: 2026, grade_current: '高一', school_legacy: 'Readback school' }]);
    });
    for (const access of ['visitor', 'student', 'miniapp']) {
      role = access; miniappOnly = access === 'miniapp';
      const denied = await client.appendDraft({ type: 'student.create.v1', payload: { record: { id: `denied-${access}`, name: 'Student', school: 'Denied HTTP school', source_type: 1, contacts: [] } } });
      const rejection = await client.confirmAndSubmit(denied.id, { sessionToken: 'eyJ2IjoxfQ.signature' });
      assert.equal(rejection.rejected, true);
      assert.equal(rejection.receipt.result.error.code, 'CLOUD_BUSINESS_ACCESS_DENIED');
      assert.equal((await outbox.get(denied.id)).status, 'conflict');
    }
    await admin(async db => assert.equal((await db.query("SELECT id FROM business.schools WHERE name='Denied HTTP school'")).rows.length, 0));
  } finally { await new Promise(resolve => server.close(resolve)); }
}
(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  const admin = work => withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', work);
  const writer = work => withVNextPg17SyntheticQuery(handle, 'writer', work);
  const schools = () => admin(async db => (await db.query('SELECT tenant_id,name,legacy_count FROM business.schools WHERE legacy_deleted=false ORDER BY tenant_id,name')).rows);
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, APPLY);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, APPLY);
    await admin(async db => {
      await db.query('CREATE ROLE gewu_cloud_schedule_reader');
      for (const file of ['20260823-student-contact-directory.sql', '20260825-business-student-contact-unbind.sql', '20260823-zz-student-lifecycle.sql', '20260901-student-contact-phone-required.sql']) {
        await db.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      }
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('t1','Tenant 1',false,now(),now()),('t2','Tenant 2',false,now(),now())");
      await db.query("INSERT INTO business.schools(id,tenant_id,name,legacy_count,legacy_deleted,created_at,updated_at) VALUES ('historical','t1','Existing school',7,false,now(),now())");
      await db.query(fs.readFileSync(migration, 'utf8'));
      await db.query(fs.readFileSync(path.join(__dirname, '20260907-z-teacher-student-write-scope.sql'), 'utf8'));
      await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('http-teacher','t1','Teacher',false,now(),now())");
    });
    let version;
    await writer(async db => {
      const result = await db.query(createSql, ['t1', 's1', 'Student', 'New school', '[]']);
      version = result.rows[0].updated_at.toISOString();
    });
    assert.deepEqual(await schools(), [{ tenant_id: 't1', name: 'Existing school', legacy_count: 7 }, { tenant_id: 't1', name: 'New school', legacy_count: 1 }], 'saving a student must register the school in the same cloud transaction');
    await writer(async db => {
      const stale = await db.query(updateSql, ['t1', 's1', '2000-01-01Z', 'Student', 'Rejected school', '[]']);
      assert.equal(stale.rows.length, 0);
      const changed = await db.query(updateSql, ['t1', 's1', version, 'Student', 'Existing school', '[]']);
      version = changed.rows[0].updated_at.toISOString();
      // The contact insert fails AFTER the student UPDATE and its school trigger.
      await assert.rejects(() => db.query(updateSql, ['t1', 's1', version, 'Rejected', 'Rolled back school', JSON.stringify([{ slot: 1, relationship: 'student', phone: null, wechat: 'invalid', expected_updated_at: null }])]), e => e.code === '23514');
      await assert.rejects(() => db.query(createSql, ['t1', 'invalid-student', 'Rejected', 'Failed create school', JSON.stringify([{ slot: 1, relationship: 'student', phone: null, wechat: 'invalid' }])]), e => e.code === '23514');
    });
    assert.equal((await schools()).length, 2, 'stale writes and failed contacts must not leak school records');
    assert.equal((await schools())[0].legacy_count, 7, 'existing historical usage must not be recalculated');
    await admin(async db => {
      assert.deepEqual((await db.query("SELECT name,school_legacy FROM business.students WHERE id='s1'")).rows, [{ name: 'Student', school_legacy: 'Existing school' }]);
      assert.equal((await db.query("SELECT id FROM business.students WHERE id='invalid-student'")).rows.length, 0);
    });
    await Promise.all(['s2', 's3'].map(id => writer(db => db.query(createSql, ['t1', id, 'Student', 'Shared new school', '[]']))));
    await writer(async db => {
      await db.query(createSql, ['t2', 's4', 'Student', 'Shared new school', '[]']);
      await db.query(createSql, ['t1', 's5', 'Student', ' ', '[]']);
      await db.query(createSql, ['t1', 's6', 'Student', null, '[]']);
      await assert.rejects(() => db.query("INSERT INTO business.schools(id,tenant_id,name) VALUES ('bypass','t1','Bypass')"), e => e.code === '42501');
    });
    assert.equal((await schools()).length, 4, 'concurrent same-tenant saves deduplicate; tenant boundaries remain separate; blank names add nothing');
    await withVNextPg17SyntheticQuery(handle, 'verifier', async db => {
      await assert.rejects(() => db.query(createSql, ['t1', 'forbidden', 'Student', 'Forbidden school', '[]']), e => e.code === '42501');
    });
    await admin(async db => {
      const before = await schools();
      await db.query("INSERT INTO business.students(id,tenant_id,name,school_legacy,legacy_source_type,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('imported','t1','Imported','Historical missing school',1,false,false,now(),now())");
      assert.deepEqual(await schools(), before, 'owner backup/migration imports must not acquire new business side effects');
    });
    await desktopRoundTrip(writer, admin);
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('student school registration PostgreSQL atomicity, concurrency and privilege checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
