'use strict';
const assert = require('assert');
const { createCloudBusinessApp } = require('./app');

async function request(app, path, method, body) {
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { authorization: 'Bearer desktop.ticket', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  } finally { await new Promise(resolve => server.close(resolve)); }
}

(async () => {
  const calls = [];
  const lifecycle = {
    institutions: {
      create: async input => { calls.push(['institution.create', input]); return { id: input.institutionId, updatedAt: '2026-08-24T04:00:00.000Z' }; },
      update: async input => { calls.push(['institution.update', input]); return { id: input.institutionId, updatedAt: '2026-08-24T04:01:00.000Z' }; },
      remove: async input => { calls.push(['institution.remove', input]); return { id: input.institutionId, updatedAt: '2026-08-24T04:02:00.000Z' }; },
    },
    schools: {
      create: async input => { calls.push(['school.create', input]); return { id: input.schoolId, updatedAt: '2026-08-24T04:00:00.000Z' }; },
      update: async input => { calls.push(['school.update', input]); return { id: input.schoolId, updatedAt: '2026-08-24T04:01:00.000Z' }; },
      remove: async input => { calls.push(['school.remove', input]); return { id: input.schoolId, updatedAt: '2026-08-24T04:02:00.000Z' }; },
    },
  };
  const app = createCloudBusinessApp({ query: async () => ({ rows: [] }), businessFoundationLifecycleMutations: lifecycle, businessTenantId: 'default', desktopRegistration: { begin: async () => null, register: async () => null, sessionContext: async () => ({ roles: ['super_admin'] }) } });
  const institutionData = { name: 'Institution', contactPerson: null, contactPhone: null, revenueShare: 30, notes: null };
  assert.strictEqual((await request(app, '/api/business/institutions', 'POST', { institutionId: 'institution-1', data: institutionData })).status, 201);
  assert.strictEqual((await request(app, '/api/business/institutions/institution-1', 'PUT', { expectedUpdatedAt: '2026-08-24T04:00:00.000Z', ...institutionData })).status, 200);
  assert.strictEqual((await request(app, '/api/business/institutions/institution-1', 'DELETE', { expectedUpdatedAt: '2026-08-24T04:01:00.000Z' })).status, 200);
  const schoolData = { name: 'School', count: 3 };
  assert.strictEqual((await request(app, '/api/business/schools', 'POST', { schoolId: 'school-1', data: schoolData })).status, 201);
  assert.strictEqual((await request(app, '/api/business/schools/school-1', 'PUT', { expectedUpdatedAt: '2026-08-24T04:00:00.000Z', ...schoolData })).status, 200);
  assert.strictEqual((await request(app, '/api/business/schools/school-1', 'DELETE', { expectedUpdatedAt: '2026-08-24T04:01:00.000Z' })).status, 200);
  assert.deepStrictEqual(calls.map(call => call[0]), ['institution.create', 'institution.update', 'institution.remove', 'school.create', 'school.update', 'school.remove']);
  console.log('foundation lifecycle route checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
