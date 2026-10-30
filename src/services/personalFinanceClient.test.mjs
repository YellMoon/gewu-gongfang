import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalFinanceClient } from './personalFinanceClient.mjs';
test('tuition list is read-only and confirmed submissions retain the retry key and session binding',async()=>{
 const calls=[],client=createPersonalFinanceClient({readSession:()=>({authorization:'Bearer owner',authContext:{userId:'owner',activeRole:'super_admin'}}),fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({ok:true})};}});
 await client.tuitionReviewState();assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.body,undefined);assert(calls[0].url.endsWith('/tuition-review'));
 const payload={expectedRevision:'7',confirmed:true,rows:[]};await client.submitTuitionReview(payload,'retry-key');assert(calls[1].url.endsWith('/tuition-review/submit'));assert.equal(calls[1].options.headers['x-idempotency-key'],'retry-key');assert.deepEqual(JSON.parse(calls[1].options.body),payload);
});
test('current readers restore complete reset history without mutating legacy transport data', async () => {
  const annotations = [{ observationId: 'x', revision: '1', patch: { kind: 'transfer' } }, { observationId: 'x', revision: '2', patch: {}, reset: true }];
  const original = { ok: true, ledger: { revision: '2', annotations: [], annotationHistory: annotations } };
  const client = createPersonalFinanceClient({ readSession: () => ({ authorization: 'Bearer owner', authContext: { userId: 'owner', activeRole: 'teacher' } }), fetch: async () => ({ ok: true, json: async () => original }) });
  const { ledger } = await client.getLedger();
  assert.deepEqual(ledger.annotations, annotations);
  assert.equal(ledger.annotationHistory, undefined);
  assert.deepEqual(original.ledger.annotations, []);
  assert.equal(original.ledger.annotationHistory, annotations);
});
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
