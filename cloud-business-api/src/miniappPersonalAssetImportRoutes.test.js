'use strict';

const assert = require('assert');
const { createCloudBusinessApp } = require('./app');
const { createPersonalAssetImportRepository } = require('./personalAssetImportRepository');

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
  let currentActor = { accountId: 'teacher-1', roles: ['teacher'] };
  const writes = [];
  const realRepository = createPersonalAssetImportRepository({ transaction: async work => work(async (_sql, values) => {
    writes.push(values);
    return { rows: [{ importId:values[3],recordCount:1,requestHash:values[5],createdAt:new Date('2026-09-23T00:00:00Z'),replayed:false }] };
  }) });
  const integrated = createCloudBusinessApp({query:async()=>({rows:[]}),businessTenantId:'default',
    miniappCloudAccount:{login:async()=>null,pendingAccounts:async()=>[],assignRole:async()=>null,context:async()=>currentActor},personalAssetImports:realRepository});
  const records = [{date:'2026-09-23',type:'expense',amount:2.55,category:'Books',note:''}];
  const teacher = await request(integrated,'/api/business/miniapp-personal-assets/import',{body:{records}});
  assert.equal(teacher.status,202);assert.equal(writes.length,1);assert.equal(writes[0][1],'teacher-1');
  for(const role of ['student','family_member','visitor','admin']) {
    currentActor={accountId:'denied-'+role,roles:[role]};
    assert.equal((await request(integrated,'/api/business/miniapp-personal-assets/import',{body:{records}})).status,403);
  }
  assert.equal(writes.length,1,'denied roles cannot reach the transaction');
  currentActor={accountId:'teacher-1',roles:['teacher']};
  assert.equal((await request(integrated,'/api/business/miniapp-personal-assets/import',{body:{records,accountId:'victim'}})).status,400);
  assert.equal(writes.length,1,'owner cannot be supplied in request body');
  console.log('miniapp personal asset route/repository roles, cents and owner boundary checks passed');
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
