import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceAnalysisClient } from './personalFinanceAnalysisClient.mjs';

test('worker transport coalesces queued scopes, binds exact ledger identity and terminates on session changes', async () => {
  const workers = [], make = () => { const w = { sent: [], terminated: false, postMessage(v) { this.sent.push(v); }, terminate() { this.terminated = true; }, reply(result) { this.onmessage({ data: { id: this.sent.at(-1).id, result } }); } }; workers.push(w); return w; };
  const c = createFinanceAnalysisClient({ createWorker: make }), ledger = { revision: '1', observations: [] };
  const a = c.analyze(ledger, {}, 'owner-A'), b = c.analyze(ledger, { accountIds: ['A'] }, 'owner-A');
  const rejected = assert.rejects(b, { code: 'FINANCE_ANALYSIS_SUPERSEDED' });
  const d = c.analyze(ledger, { accountIds: ['A', 'B'] }, 'owner-A'); await rejected;
  assert.equal(workers[0].sent.length, 1); assert.equal(workers[0].sent[0].ledger, ledger);
  workers[0].reply('all'); assert.equal(await a, 'all'); assert.equal(workers[0].sent.length, 2); assert(!('ledger' in workers[0].sent[1]));
  workers[0].reply('combination'); assert.equal(await d, 'combination');
  const freshLedger = { ...ledger }, e = c.analyze(freshLedger, {}, 'owner-A'); assert.equal(workers[0].sent[2].ledger, freshLedger); workers[0].reply('fresh'); await e;
  const pending = c.analyze(ledger, {}, 'owner-A'), cancelled = assert.rejects(pending, { code: 'FINANCE_ANALYSIS_SUPERSEDED' });
  const other = c.analyze(ledger, {}, 'owner-B'); await cancelled; assert(workers[0].terminated); assert.equal(workers[1].sent[0].ledger, ledger); workers[0].onerror(); assert.equal(workers[1].terminated,false); workers[1].reply('other'); await other;
  c.dispose(); assert(workers[1].terminated); await assert.rejects(c.analyze(ledger, {}, 'owner-B'), { code: 'FINANCE_ANALYSIS_SUPERSEDED' });
});
