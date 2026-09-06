'use strict';

const assert = require('node:assert/strict');
const { createCloudBusinessApp } = require('./app');

(async () => {
  const calls = [];
  const delivery = { deliveryId: 'question_asset_delivery_12345678', status: 'ready' };
  const contexts = {
    teacher: { accountId: 'teacher-1', status: 'active', roles: ['teacher'] },
    admin: { accountId: 'admin-1', status: 'active', roles: ['super_admin'] },
    student: { accountId: 'student-1', status: 'active', roles: ['teacher', 'student'], activeRole: 'student' },
    visitor: { accountId: 'visitor-1', status: 'visitor', roles: [] },
    suspended: { accountId: 'suspended-1', status: 'suspended', roles: ['teacher'] },
  };
  const app = createCloudBusinessApp({
    query: async () => ({ rows: [{ id: 'question-1' }] }),
    businessTenantId: 'default',
    desktopRegistration: { begin: async () => null, register: async () => null, sessionContext: async ({ sessionToken }) => contexts[sessionToken.split('.')[0]] },
    miniappCloudAccount: { login: async () => null, context: async ({ token }) => contexts[token.split('.')[0]] },
    questionAuthority: { create: async () => null, list: async () => [] },
    questionAssetDeliveries: Object.fromEntries(['request', 'status', 'download'].map(method => [method, async (input, scope) => {
      calls.push({ method, input, scope });
      return method === 'download' ? { ...delivery, bytes: Buffer.from('image'), mimeType: 'image/png' } : delivery;
    }])),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  async function request(path, role, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${role}.signature`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    await response.arrayBuffer();
    return response.status;
  }
  try {
    const desktopPath = `/api/desktop/question-bank/assets/${'a'.repeat(64)}/delivery`;
    for (const role of ['teacher', 'admin']) {
      assert.equal(await request(desktopPath, role, {}), 200);
      assert.deepEqual(calls.at(-1).scope, { includeDrafts: true });
    }
    for (const role of ['student', 'visitor', 'missing']) {
      const before = calls.length;
      assert.equal(await request(desktopPath, role, {}), 403);
      assert.equal(calls.length, before);
    }
    const beforeInjection = calls.length;
    assert.notEqual(await request(desktopPath, 'teacher', { includeDrafts: true }), 200);
    assert.equal(calls.length, beforeInjection, 'draft scope must not come from a request body');
    const miniappPath = `/api/business/miniapp-question-assets/${'a'.repeat(64)}/delivery`;
    for (const role of ['teacher', 'student', 'visitor']) {
      assert.equal(await request(miniappPath, role, { questionId: 'question-1' }), 200);
      assert.equal(calls.at(-1).scope, undefined, 'even miniapp teachers request published assets only');
      for (const suffix of ['', '/download']) {
        assert.equal(await request(`/api/business/miniapp-question-asset-deliveries/${delivery.deliveryId}${suffix}`, role), 200);
        assert.deepEqual(calls.at(-1).scope, { publishedLimit: role === 'visitor' ? 20 : null });
      }
    }
    for (const role of ['missing', 'suspended']) {
      const before = calls.length;
      assert.equal(await request(miniappPath, role, { questionId: 'question-1' }), 403);
      for (const suffix of ['', '/download']) {
        assert.equal(await request(`/api/business/miniapp-question-asset-deliveries/${delivery.deliveryId}${suffix}`, role), 403);
      }
      assert.equal(calls.length, before, 'invalid sessions cannot reach delivery operations');
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log('question asset delivery authorization checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
