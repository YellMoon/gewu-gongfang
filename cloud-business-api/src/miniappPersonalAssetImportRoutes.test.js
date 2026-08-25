'use strict';

const assert = require('assert');
const { createCloudBusinessApp } = require('./app');

async function request(app, path, options = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: options.method || 'POST',
      headers: { authorization: 'Bearer miniapp-admin.signature', 'content-type': 'application/json', 'x-idempotency-key': 'asset-import-route-1', ...(options.headers || {}) },
      body: JSON.stringify(options.body || {}),
    });
    return { status: response.status, body: await response.json() };
  } finally { await new Promise(resolve => server.close(resolve)); }
}

async function main() {
  const calls = [];
  const app = createCloudBusinessApp({
    query: async () => ({ rows: [] }), businessTenantId: 'default',
    miniappCloudAccount: { login: async () => null, pendingAccounts: async () => [], assignRole: async () => null, context: async () => ({ accountId: 'super-admin-1', roles: ['super_admin'] }) },
    personalAssetImports: { import: async input => { calls.push(input); return { importId: 'asset_import_12345678', recordCount: 1, createdAt: '2026-08-23T00:00:00.000Z', replayed: false }; } },
  });
  const result = await request(app, '/api/business/miniapp-personal-assets/import', { body: { records: [{ date: '2026-08-01', type: 'income', amount: 88.5, category: 'Tuition', note: '' }] } });
  assert.strictEqual(result.status, 202);
  assert.strictEqual(result.body.receipt.importId, 'asset_import_12345678');
  assert.deepStrictEqual(calls[0], { tenantId: 'default', actor: { accountId: 'super-admin-1', roles: ['super_admin'] }, idempotencyKey: 'asset-import-route-1', records: [{ date: '2026-08-01', type: 'income', amount: 88.5, category: 'Tuition', note: '' }] });
  console.log('miniapp personal asset import route checks passed');
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
