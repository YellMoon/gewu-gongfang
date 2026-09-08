'use strict';
// UTF-8: restore the original self-profile edit without granting access to other teachers.
const assert = require('node:assert/strict');
const { createCloudBusinessApp } = require('./app');
require('../sql/teacher-self-projection.postgres.test');
require('../sql/teacher-update.postgres.test');

(async () => {
  const calls = [];
  const version = '2026-09-08T06:21:02.254223Z';
  const sessions = {
    self: { roles: ['teacher'], profile: { type: 'teacher', id: 'teacher-self' } },
    legacy: { roles: ['teacher'], teacherId: 'teacher-self' },
    unbound: { roles: ['teacher'] },
    otherBinding: { roles: ['teacher'], teacherId: 'teacher-self', profile: { type: 'teacher', id: 'teacher-other' } },
    student: { roles: ['student'], teacherId: 'teacher-self' },
    family: { roles: ['family_member'], teacherId: 'teacher-self' },
    visitor: { roles: [] },
    admin: { roles: ['super_admin'] },
    activeTeacher: { roles: ['super_admin', 'teacher'], activeRole: 'teacher', teacherId: 'teacher-self' },
    activeStudent: { roles: ['super_admin', 'student'], activeRole: 'student', teacherId: 'teacher-self' },
  };
  const app = createCloudBusinessApp({ query: async () => ({ rows: [] }), businessTenantId: 'server-tenant',
    desktopRegistration: { begin: async () => {}, register: async () => {}, sessionContext: async ({ sessionToken }) => {
      const context = sessions[sessionToken.split('.')[1]];
      if (!context) throw new Error('invalid desktop session');
      return context;
    } },
    businessTeacherLifecycleMutations: {
      create: async () => { throw new Error('unexpected creation'); },
      remove: async () => { throw new Error('unexpected deletion'); },
      update: async input => {
        calls.push(input);
        return input.expectedUpdatedAt === version ? { id: input.teacherId, updatedAt: version } : null;
      },
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const body = { expectedUpdatedAt: version, name: '教师本人', phone: '13100000000', subject: '物理', hourlyRate: 120, notes: '原表单资料' };
  const request = (identity, id = 'teacher-self', data = body, method = 'PUT') => fetch(baseUrl + '/api/business/teachers/' + id, {
    method, headers: { authorization: `Bearer eyJ2IjoxfQ.${identity}`, 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  try {
    const { createDesktopIdentityClient } = await import('../../src/services/desktopIdentityClient.mjs');
    const client = createDesktopIdentityClient({ desktopIdentity: { status: async () => ({}) }, fetchImpl: fetch });
    const result = await client.updateCloudTeacher({ baseUrl, currentSession: { token: 'eyJ2IjoxfQ.self' }, teacherId: 'teacher-self', ...body });
    assert.equal(result.id, 'teacher-self');
    assert.deepEqual(calls[0], { tenantId: 'server-tenant', teacherId: 'teacher-self', ...body });
    for (const identity of ['legacy', 'activeTeacher', 'admin']) assert.equal((await request(identity)).status, 200);
    assert.equal((await request('admin', 'teacher-other')).status, 200);
    const before = calls.length;
    for (const identity of ['unbound', 'otherBinding', 'student', 'family', 'visitor', 'activeStudent', 'miniapp', 'expired']) {
      const response = await request(identity);
      assert.equal(response.status, 403, identity);
      assert.equal((await response.json()).code, 'CLOUD_BUSINESS_ACCESS_DENIED');
    }
    for (const identity of ['self', 'legacy', 'activeTeacher']) assert.equal((await request(identity, 'teacher-other')).status, 403);
    for (const field of ['tenantId', 'teacherId', 'actorScope', 'roles']) {
      assert.equal((await request('self', 'teacher-self', { ...body, [field]: 'forged' })).status, 400);
    }
    assert.equal(calls.length, before, 'rejected requests must not reach mutations');
    assert.equal((await fetch(baseUrl + '/api/business/teachers/teacher-self', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })).status, 403, 'missing desktop session is an authorization failure');
    const stale = await request('self', 'teacher-self', { ...body, expectedUpdatedAt: '2026-09-08T06:21:02.254224Z' });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, 'CLOUD_BUSINESS_TEACHER_CONFLICT');
    assert.equal((await request('self', 'teacher-self', { expectedUpdatedAt: version }, 'DELETE')).status, 403,
      'self-profile editing does not authorize deleting a bound teacher');
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('teacher self-update real REST client, active-role and forbidden-scope checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
