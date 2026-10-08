'use strict';
const assert = require('node:assert/strict');
const { createPersonalFinanceTransport } = require('./personalFinanceTransport');
(async () => {
  let current = true, options;
  const transport = createPersonalFinanceTransport({ capture: () => ({ token: 'token' }), isSameSession: () => current, baseUrl: 'https://example.test', request: async input => { options = input; return { statusCode: 200, data: { ok: true, receipt: { imported: true } } }; } });
  assert.equal((await transport('/imports', 'POST', { financialAccountId: 'a' }, 'idempotency')).receipt.imported, true);
  assert.equal(options.header['x-idempotency-key'], 'idempotency');
  assert.equal(options.header.Authorization, 'Bearer token');
  current = false;
  await assert.rejects(transport('/ledger'), /FINANCE_SESSION_CHANGED/);
  console.log('miniapp finance transport owner fence passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
