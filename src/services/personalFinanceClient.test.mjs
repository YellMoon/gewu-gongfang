import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalFinanceClient } from './personalFinanceClient.mjs';
test('finance transport authenticates, carries idempotency, and rejects switched sessions', async () => {
  let token = 'Bearer one'; let call;
  const session = () => ({ authorization: token, authContext: { userId: 'owner', activeRole: 'teacher' } });
  const client = createPersonalFinanceClient({ readSession: session, fetch: async (url, options) => { call = { url, options }; return { ok: true, json: async () => ({ ok: true, ledger: { accounts: [] } }) }; } });
  assert.deepEqual((await client.getLedger()).ledger.accounts, []);
  await client.importFile({ filename: 'bill.csv', base64: 'eA==', financialAccountId: 'a' }, 'key');
  assert.equal(call.options.headers.Authorization, token);
  assert.equal(call.options.headers['x-idempotency-key'], 'key');
  const late = createPersonalFinanceClient({ readSession: session, fetch: async () => { token = 'Bearer two'; return { ok: true, json: async () => ({ ok: true, ledger: { private: 1 } }) }; } });
  await assert.rejects(late.getLedger(), /FINANCE_SESSION_CHANGED/);
});
test('integer money preserves precision and null balances remain uncalibrated', async () => {
  const { formatMinor, parseMoney } = await import('./personalFinanceClient.mjs');
  assert.equal(formatMinor('900719925474099123'), '9007199254740991.23');
  assert.equal(formatMinor('-1'), '-0.01');
  assert.equal(formatMinor(null), '未校准');
  assert.equal(parseMoney('9007199254740991.23'), '900719925474099123');
  assert.equal(parseMoney('-0.01'), '-1');
  assert.throws(() => parseMoney('1.001'), /FINANCE_AMOUNT_INVALID/);
});
