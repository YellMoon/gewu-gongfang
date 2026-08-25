'use strict';

const assert = require('assert');
const { createCloudBusinessApp } = require('./app');

async function request(app, path, { method = 'GET', headers = {}, body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  const calls = [];
  const miniappCloudAccount = {
    login: async () => { throw new Error('not used'); },
    context: async ({ token }) => {
      if (token === 'miniapp-ticket.signature') return { accountId: 'account-1', status: 'active', roles: ['super_admin'], profile: null };
      throw new Error('rejected');
    },
    pendingAccounts: async () => [],
    assignRole: async () => { throw new Error('not used'); },
  };
  const deliveries = {
    request: async input => { calls.push(['request', input]); return { deliveryId: 'delivery_12345678', status: 'queued', artifactId: 'paper_artifact_12345678', fileName: 'paper.pdf', mimeType: 'application/pdf', expiresAt: '2026-08-23T00:15:00.000Z' }; },
    status: async input => { calls.push(['status', input]); return { deliveryId: 'delivery_12345678', status: 'ready', artifactId: 'paper_artifact_12345678', fileName: 'paper.pdf', mimeType: 'application/pdf', expiresAt: '2026-08-23T00:15:00.000Z' }; },
    download: async input => { calls.push(['download', input]); return { deliveryId: 'delivery_12345678', fileName: 'paper.pdf', mimeType: 'application/pdf', bytes: Buffer.from('pdf-bytes') }; },
  };
  const app = createCloudBusinessApp({ query: async () => ({ rows: [] }), miniappCloudAccount, miniappArtifactDeliveries: deliveries, businessTenantId: 'default' });
  const headers = { authorization: 'Bearer miniapp-ticket.signature' };
  const created = await request(app, '/api/business/miniapp-paper-export-tasks/paper_task_12345678/delivery', { method: 'POST', headers, body: {} });
  assert.strictEqual(created.status, 202);
  assert.deepStrictEqual(JSON.parse(created.bytes.toString('utf8')), { ok: true, delivery: { deliveryId: 'delivery_12345678', status: 'queued', artifactId: 'paper_artifact_12345678', fileName: 'paper.pdf', mimeType: 'application/pdf', expiresAt: '2026-08-23T00:15:00.000Z' } });
  const status = await request(app, '/api/business/miniapp-artifact-deliveries/delivery_12345678', { headers });
  assert.strictEqual(status.status, 200);
  const download = await request(app, '/api/business/miniapp-artifact-deliveries/delivery_12345678/download', { headers });
  assert.strictEqual(download.status, 200);
  assert.strictEqual(download.headers.get('cache-control'), 'no-store');
  assert.match(download.headers.get('content-disposition') || '', /attachment/);
  assert.deepStrictEqual(download.bytes, Buffer.from('pdf-bytes'));
  assert.deepStrictEqual(calls.map(item => item[0]), ['request', 'status', 'download']);
  assert.ok(calls.every(([, input]) => input.tenantId === 'default' && input.accountId === 'account-1'));
  const storageCalls = [];
  const storageApp = createCloudBusinessApp({
    query: async () => ({ rows: [] }),
    storageAgent: {
      lease: async () => null, download: async () => null, complete: async () => null,
      leaseArtifactDelivery: async input => { storageCalls.push(['lease', input]); return { deliveryId: 'delivery_12345678' }; },
      uploadArtifactDelivery: async input => { storageCalls.push(['upload', input]); return { deliveryId: input.deliveryId, status: 'ready' }; },
    },
  });
  const agentHeaders = { 'x-gewu-storage-agent-token': 'storage-agent-test-token' };
  const leased = await request(storageApp, '/api/storage-agent/artifact-deliveries/lease', { method: 'POST', headers: agentHeaders, body: { agentId: 'storage-agent-1' } });
  assert.strictEqual(leased.status, 200);
  const server = storageApp.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const uploaded = await fetch(`http://127.0.0.1:${server.address().port}/api/storage-agent/artifact-deliveries/delivery_12345678/upload`, {
      method: 'POST', headers: { ...agentHeaders, 'content-type': 'application/octet-stream', 'x-gewu-storage-agent-id': 'storage-agent-1', 'x-gewu-storage-agent-lease-token': 'lease-token-test-value' }, body: Buffer.from('pdf-bytes'),
    });
    assert.strictEqual(uploaded.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  assert.deepStrictEqual(storageCalls, [
    ['lease', { agentId: 'storage-agent-1', token: 'storage-agent-test-token' }],
    ['upload', { agentId: 'storage-agent-1', token: 'storage-agent-test-token', deliveryId: 'delivery_12345678', leaseToken: 'lease-token-test-value', bytes: Buffer.from('pdf-bytes') }],
  ]);
  console.log('miniapp artifact delivery route checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
