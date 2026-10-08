'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { describeOperation, safeDetail } = require('./operationAudit');
const { createCloudBusinessApp } = require('./app');
test('both finance surfaces participate in durable audit with source and credentials redacted', () => {
  for (const surface of ['personal-finance', 'miniapp-personal-finance']) {
    const operation = describeOperation({ method: 'POST', path: `/api/business/${surface}/imports`, body: { filename: 'statement.csv', base64: 'private', apiKey: 'secret', financialAccountId: 'a' } });
    assert.ok(operation);
    assert.equal(operation.miniapp, surface.startsWith('miniapp'));
    assert.equal(operation.detail.request.base64, '[redacted]');
  }
  assert.equal(safeDetail({ apiKey: 'secret' }).apiKey, '[redacted]');
});
test('actual cloud app mounts ledger, mailbox, PATCH CORS and isolates miniapp writes', async () => {
  const actor = { accountId: 'owner', roles: ['teacher'], activeRole: 'teacher' };
  const app = createCloudBusinessApp({ query: async () => ({ rows: [] }), businessTenantId: 'tenant', desktopRegistration: { begin: async () => {}, register: async () => {}, sessionContext: async () => actor }, personalFinance: { getLedger: async input => ({ accounts: [], owner: input.actor.accountId }) }, billMailbox: { status: ({ actor: value }) => ({ address: value.accountId + '@example.test' }) } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ledger = await fetch(base + '/api/business/personal-finance/ledger', { headers: { Authorization: 'Bearer desktop.test' } });
    assert.equal(ledger.status, 200); assert.equal((await ledger.json()).ledger.owner, 'owner');
    const mailbox = await fetch(base + '/api/business/personal-finance/mailbox', { headers: { Authorization: 'Bearer desktop.test' } });
    assert.equal((await mailbox.json()).mailbox.address, 'owner@example.test');
    const cors = await fetch(base + '/api/business/personal-finance/accounts/a', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'PATCH' } });
    assert.match(cors.headers.get('Access-Control-Allow-Methods'), /PATCH/);
    const forbidden = await fetch(base + '/api/business/miniapp-personal-finance/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(forbidden.status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
