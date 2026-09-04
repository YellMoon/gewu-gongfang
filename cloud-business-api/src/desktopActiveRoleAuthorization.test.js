'use strict';

const assert = require('assert');
const { createCloudBusinessApp } = require('./app');

async function request(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: { authorization: 'Bearer desktop-role-ticket.signature' },
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  const queries = [];
  const desktopRegistration = {
    begin: async () => null,
    register: async () => null,
    sessionContext: async () => ({
      authorityId: 'authority-1',
      accountId: 'account-1',
      deviceId: 'device-1',
      installationId: 'installation-1',
      sessionId: 'session-1',
      expiresAt: '2026-09-01T10:00:00.000Z',
      rowVersion: 2,
      roles: ['super_admin', 'teacher'],
      activeRole: 'teacher',
      teacherId: 'teacher-1',
      studentId: null,
    }),
  };
  const app = createCloudBusinessApp({
    query: async (text, values) => {
      queries.push([text, values]);
      return { rows: [] };
    },
    desktopRegistration,
    businessTenantId: 'default',
  });

  const schedules = await request(app, '/api/business/schedules');
  assert.strictEqual(schedules.status, 200);
  assert.deepStrictEqual(queries[0][1], ['default', 'teacher', 'teacher-1'], 'the selected desktop role must constrain schedule reads');

  const projectionQueries = [];
  const projectionApp = createCloudBusinessApp({
    query: async (text, values) => {
      projectionQueries.push([text, values]);
      return { rows: [{ projection: {
        students: [], studentContacts: [], teachers: [], courses: [], schedules: [],
        institutions: [], schools: [], rooms: [], assetRecords: [], assetCategories: [],
      } }] };
    },
    desktopRegistration,
    businessTenantId: 'default',
  });
  const projection = await request(projectionApp, '/api/business/desktop-projection');
  assert.strictEqual(projection.status, 200,
    'a desktop teacher needs its role-scoped projection to operate the teacher client');
  assert.deepStrictEqual(projectionQueries[0][1], ['default', 'teacher', 'teacher-1', 'account-1']);
  assert.ok(projectionQueries[0][0].includes('WITH scoped_schedules AS ('),
    'a desktop teacher must use the scoped projection query, never the tenant-wide desktop projection');
  assert.deepStrictEqual(projection.body.projection, {
    students: [], student_contacts: [], teachers: [], courses: [], schedules: [],
    institutions: [], schools: [], rooms: [], grades: [], payments: [], consumptions: [],
    assetRecords: [], assetCategories: [], taxonomy_systems: [], taxonomy_nodes: [],
  });

  console.log('desktop active-role authorization tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
