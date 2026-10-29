'use strict';
const assert = require('node:assert/strict');
const { findLoanWalletReceipts } = require('./loanWalletReceipts');
const { findClosedLoanWalletGroups } = require('./closedLoanWalletGroups');
const accounts = [
  { id: 'wallet', type: 'wallet', status: 'active' },
  { id: 'loan', sourceProduct: 'alipay_jiebei' },
  { id: 'fund', sourceProduct: 'alipay_yuebao' },
];
const balance = '\u4f59\u989d', sweepDescription = '\u4f59\u989d\u5b9d-\u5355\u6b21\u8f6c\u5165';
function row(id, time, amount, patch = {}) {
  const date = '2016-07-03';
  return { id, provider: 'alipay', financialAccountId: 'wallet', date, occurredAt: date + 'T' + time + '+08:00',
    rawFields: { '\u4ea4\u6613\u65f6\u95f4': date + ' ' + time }, status: 'completed', currency: 'CNY',
    sourceIdentity: id, amountMinor: amount, kind: 'transfer', direction: 'debit', paymentChannel: balance, ...patch };
}
function fixture() {
  const relation = { role: 'target', activity: 'loan_drawdown', product: 'alipay_jiebei', financialAccountId: 'loan' };
  return [
    row('loan1', '17:23:16', '1000000', { kind: 'loan_drawdown', direction: 'neutral', paymentChannel: '', accountRelations: [relation] }),
    row('use1', '17:25:08', '518000'),
    row('failed', '17:26:34', '566000', { status: 'failed' }),
    row('loan2', '17:27:07', '200000', { kind: 'loan_drawdown', direction: 'neutral', paymentChannel: '', accountRelations: [relation] }),
    row('use2', '17:28:08', '566000'),
    row('sweep', '17:32:29', '116000', { direction: 'neutral', description: sweepDescription,
      accountRelations: [{ role: 'target', activity: 'investment_deposit', product: 'alipay_yuebao', financialAccountId: 'fund' }] }),
    row('otherProduct', '17:29:00', '150000', { paymentChannel: '\u4f59\u989d\u5b9d' }),
  ];
}
const actualLoanDrawEvidence = new Map([['loan1', ['proof1']], ['loan2', ['proof2']]]);
const run = (rows = fixture(), options = {}) => findLoanWalletReceipts(rows, accounts, { actualLoanDrawEvidence, ...options });
const result = run();
assert.equal(result.size, 2);
assert.deepEqual([...result.keys()].sort(), ['loan1', 'loan2']);
for (const receipt of result.values()) {
  assert.equal(receipt.basis, 'actual_loan_proofs_and_closed_wallet_use_group');
  assert.equal(receipt.confidence, 'inferred');
  assert.equal(receipt.groupLoanTotalMinor, '1200000');
  assert.deepEqual(receipt.evidenceObservationIds, ['loan1', 'loan2', 'sweep', 'use1', 'use2']);
  assert.deepEqual(receipt.loanProofObservationIds, ['proof1', 'proof2']);
  assert.equal(receipt.separateEconomicTransactions, true);
}
assert.equal(run(fixture(), { actualLoanDrawEvidence: new Map() }).size, 0);
assert.equal(run(fixture(), { actualLoanDrawEvidence: new Map([['loan1', ['proof1']]]) }).size, 0);
assert.equal(run(fixture().map(o => o.id === 'sweep' ? { ...o, amountMinor: '116001' } : o)).size, 0);
assert.equal(run([...fixture(), row('competingCredit', '17:30:00', '1', { direction: 'credit' })]).size, 0);
assert.equal(run([...fixture(), row('bankCredit', '00:00:00', '1000000', { provider: 'ccb', financialAccountId: 'bank',
  direction: 'credit', statementFlow: { schema: 'ccb-debit-v1' } })]).size, 0);
assert.equal(run(fixture(), { annotatedIds: new Set(['use1']) }).size, 0);
assert.equal(run(fixture(), { links: [{ type: 'distinct', observationIds: ['loan1', 'use2'] }] }).size, 0);
assert.equal(run(fixture(), { links: [{ type: 'group_distinct', observationIds: ['loan1', 'outside'] }] }).size, 0);
assert.equal(run(fixture(), { links: [{ type: 'duplicate', status: 'deleted', observationIds: ['loan1', 'use2'] }] }).size, 0);
assert.equal(run(fixture().filter(o => o.id !== 'sweep')).size, 0);
assert.equal(run(fixture().map(o => o.id === 'use1' ? { ...o, amountMinor: '1100000' }
  : o.id === 'use2' ? { ...o, amountMinor: '10000' } : o.id === 'sweep' ? { ...o, amountMinor: '90000' } : o)).size, 0);
assert.equal(run(fixture().map(o => o.id === 'use1' ? { ...o, rawFields: {} } : o)).size, 0);
const identity = o => o.id, rows = fixture();
assert.equal(findClosedLoanWalletGroups(rows, accounts, { identity, byId: new Map(rows.map(o => [o.id, o])),
  actualLoanDrawEvidence, occupied: new Set(['use1']) }).size, 0);
// A regular one-to-one receipt is still inferred once and never consumed by a group.
const single = [fixture()[0], row('singleUse', '17:24:16', '1000000')];
assert.equal(run(single).size, 1);
assert.equal(run(single).get('loan1').basis, 'actual_loan_proof_and_unique_following_wallet_use');
console.log('closed loan wallet groups: actual proofs, exact cash closure, conflicts, vetoes and failed payments verified');
