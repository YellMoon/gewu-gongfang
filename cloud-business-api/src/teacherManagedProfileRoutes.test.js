'use strict';
// UTF-8: teaching profiles are created with the authenticated creator, never a client-supplied owner.
const assert = require('node:assert/strict');
const { createCloudBusinessApp } = require('./app');
(async () => {
  let context = { roles: ['teacher'], teacherId: 'owner' };
  const calls = [];
  const mutate = action => async input => {
    calls.push({ action, ...input });
    if (input.teacherId === 'foreign') throw Object.assign(new Error('VNEXT_TEACHER_PROFILE_SCOPE_DENIED'), { code: '42501' });
    return { id: input.teacherId, updatedAt: '2026-09-08T08:00:00.000Z' };
  };
  const app = createCloudBusinessApp({ query: async () => { throw new Error('no account provisioning'); }, businessTenantId: 'tenant',
    desktopRegistration: { begin: async () => {}, register: async () => {}, sessionContext: async () => context },
    businessTeacherLifecycleMutations: { create: mutate('create'), update: mutate('update'), remove: mutate('delete') },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { createDesktopIdentityClient } = await import('../../src/services/desktopIdentityClient.mjs');
  const client = createDesktopIdentityClient({ desktopIdentity: { status: async () => ({}) }, fetchImpl: fetch });
  const session = { baseUrl: `http://127.0.0.1:${server.address().port}`, currentSession: { token: 'desktop.ticket' } };
  const fields = { teacherId: 'managed', name: '教学用老师', phone: null, subject: '物理', hourlyRate: 120, notes: null };
  try {
    const created = await client.createCloudTeacher({ ...session, ...fields });
    assert.equal(created.id, 'managed');
    assert.deepEqual(calls[0], { action: 'create', tenantId: 'tenant', actorScope: { role: 'teacher', teacherId: 'owner' }, ...fields });
    await client.updateCloudTeacher({ ...session, ...fields, name: '教学用老师修改', expectedUpdatedAt: created.updatedAt });
    await client.deleteCloudTeacher({ ...session, teacherId: 'managed', expectedUpdatedAt: created.updatedAt });
    for (const action of ['updateCloudTeacher', 'deleteCloudTeacher']) {
      await assert.rejects(() => client[action]({ ...session, ...fields, teacherId: 'foreign', expectedUpdatedAt: created.updatedAt }), error => error.code === 'CLOUD_BUSINESS_ACCESS_DENIED');
    }
    const before = calls.length;
    for (const denied of [{ roles: ['teacher'] }, { roles: ['student'], teacherId: 'owner' }, { roles: ['family_member'] }, { roles: [] }]) {
      context = denied;
      await assert.rejects(() => client.createCloudTeacher({ ...session, ...fields }), error => error.code === 'CLOUD_BUSINESS_ACCESS_DENIED');
    }
    assert.equal(calls.length, before, 'unbound/non-teacher callers never reach a write');
    context = { roles: ['teacher'], teacherId: 'owner' };
    const forged = await fetch(session.baseUrl + '/api/business/teachers', { method: 'POST', headers: { authorization: 'Bearer desktop.ticket', 'content-type': 'application/json' }, body: JSON.stringify({ ...fields, actorScope: { role: 'super_admin' } }) });
    assert.equal(forged.status, 400);
    assert.equal(calls.length, before);
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('teacher managed profile REST creator scope and no-account-provisioning checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
