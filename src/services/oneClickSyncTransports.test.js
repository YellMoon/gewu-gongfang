const assert = require('assert');

async function main() {
  const {
    createDirectSyncTransport,
    createCloudRelaySyncTransport,
    discoverLanDirectSyncTransports,
    normalizeApiBaseUrl,
  } = await import('./oneClickSyncTransports.mjs');

  assert.strictEqual(normalizeApiBaseUrl('http://host:3001'), 'http://host:3001');
  assert.strictEqual(normalizeApiBaseUrl('http://host:3001/'), 'http://host:3001');
  assert.strictEqual(normalizeApiBaseUrl('http://host:3001/api'), 'http://host:3001');

  const directCalls = [];
  const direct = createDirectSyncTransport({
    baseUrl: 'http://lan-host:3001',
    deviceId: 'desktop_test',
    authorization: 'Bearer session-test',
    authContext: { userId: 'u1', deviceId: 'desktop_test' },
    fetchImpl: async (url, options = {}) => {
      directCalls.push({ url, options });
      if (String(url).endsWith('/api/health')) return jsonResponse({ ok: true });
      if (String(url).includes('/api/sync/devices/register')) return jsonResponse({ success: true });
      if (String(url).includes('/api/sync/authorize')) {
        return jsonResponse({ success: true, authorization: { token: 'auth_1' } });
      }
      if (String(url).includes('/api/sync/push')) return jsonResponse({ success: true, serverTimestamp: 10, applied: 1 });
      if (String(url).includes('/api/sync?')) {
        return jsonResponse({
          success: true,
          changes: [{ table: 'students', action: 'update', data: { id: 'stu1' } }],
          serverTimestamp: 10,
        });
      }
      throw new Error(`unexpected direct url ${url}`);
    },
  });

  assert.strictEqual((await direct.check()).ok, true);
  assert.strictEqual((await direct.preview({ lastSyncTime: 0, deviceId: 'desktop_test' })).incomingChanges.length, 1);
  assert.strictEqual((await direct.pushSyncBatch({
    changes: [{ table: 'students', action: 'update', data: { id: 'stu1' } }],
    deviceId: 'desktop_test',
    tenantId: 'default',
  })).success, true);
  assert.ok(directCalls.some(call => String(call.url).includes('/api/sync/authorize')), 'direct push should request short authorization');
  await direct.pushSyncBatch({ changes: [{ table:'students', action:'update', data:{id:'stu2'} }], deviceId:'desktop_test', tenantId:'default' });
  assert.strictEqual(directCalls.filter(call => String(call.url).includes('/api/sync/authorize')).length, 2,
    'every direct push must obtain a fresh one-time authorization');

  const cloudCalls = [];
  const cloud = createCloudRelaySyncTransport({
    baseUrl: 'https://cloud.example.com/scheduling',
    deviceId: 'desktop_test',
    desktopSyncToken: 'sync_secret_test',
    authorization: 'Bearer session-test',
    authContext: { userId: 'u1', deviceId: 'desktop_test' },
    fetchImpl: async (url, options = {}) => {
      cloudCalls.push({ url, options });
      if (String(url).includes('/api/cloud/host/status')) return jsonResponse({ success: true, online: true });
      if (String(url).includes('/api/cloud/desktop-sync/devices/register')) return jsonResponse({ success:true, device:{id:'desktop_test'} });
      if (String(url).includes('/api/cloud/desktop-sync/requests')) {
        return jsonResponse({ success: true, request: { id: 'desktop_sync_1', status: 'pending_host' } });
      }
      if (String(url).includes('/api/cloud/desktop-sync/requests/desktop_sync_1/result')) {
        return jsonResponse({ success: true, request: { id: 'desktop_sync_1', status: 'pending_host' } });
      }
      throw new Error(`unexpected cloud url ${url}`);
    },
  });

  assert.strictEqual(cloud.queueOnly, true, 'cloud relay should be queued instead of pretending instant host writes');
  assert.strictEqual((await cloud.check()).ok, true);
  assert.strictEqual((await cloud.submitSyncRequest({ pendingChanges: [{ id: 'c1' }] })).requestId, 'desktop_sync_1');
  assert.strictEqual((await cloud.pollSyncRequest('desktop_sync_1')).status, 'pending_host');
  assert.ok(cloudCalls.some(call => String(call.url).includes('/api/cloud/desktop-sync/requests')), 'cloud should submit desktop sync requests');
  assert.ok(cloudCalls.every(call => call.options.headers['x-gewu-desktop-sync-token'] === 'sync_secret_test'), 'cloud requests should include desktop sync token');
  await assert.rejects(() => createCloudRelaySyncTransport({ baseUrl: 'https://cloud.example.com', fetchImpl: async () => jsonResponse({}) })
    .submitSyncRequest({ pendingChanges: [{}] }), error => error.code === 'AUTHORIZATION_CONTEXT_REQUIRED');

  const discovered = await discoverLanDirectSyncTransports({
    baseUrl: 'https://cloud.example.com/scheduling',
    deviceId: 'desktop_test',
    desktopSyncToken: 'sync_secret_test',
    fetchImpl: async (url) => {
      if (String(url).includes('/api/cloud/host/status')) {
        return jsonResponse({
          success: true,
          online: true,
          host: {
            base_url: 'http://127.0.0.1:3001',
            lan_urls: JSON.stringify(['http://192.168.31.8:3001', 'http://192.168.31.8:3001/', 'http://127.0.0.1:3001']),
          },
        });
      }
      throw new Error(`unexpected discovery url ${url}`);
    },
  });
  assert.strictEqual(discovered.length, 1, 'LAN discovery should ignore local/self URLs and de-duplicate candidates');
  assert.strictEqual(discovered[0].baseUrl, 'http://192.168.31.8:3001');

  console.log('one-click sync transport checks passed');
}

function jsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
