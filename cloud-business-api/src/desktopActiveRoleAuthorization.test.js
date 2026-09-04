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

  let projectionQueried = false;
  const projectionApp = createCloudBusinessApp({
    query: async () => { projectionQueried = true; return { rows: [] }; },
    desktopRegistration,
    businessTenantId: 'default',
  });
  const projection = await request(projectionApp, '/api/business/desktop-projection');
  assert.deepStrictEqual(
    { status: projection.status, body: projection.body },
    { status: 403, body: { ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' } },
    'selecting the teacher role must not retain super-admin projection access',
  );
  assert.strictEqual(projectionQueried, false, 'a downgraded desktop session must be rejected before a privileged query runs');

  console.log('desktop active-role authorization tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
