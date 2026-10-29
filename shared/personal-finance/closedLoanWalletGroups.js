'use strict';
const { actualSecond } = require('./mixedPayments');

// Missing wallet receipts only; loans and each payment remain separate.
function findClosedLoanWalletGroups(rows, accounts, {
  identity, byId, links = [], annotatedKeys = new Set(),
  actualLoanDrawEvidence = new Map(), occupied = new Set(),
}) {
  const accountMap = new Map(accounts.map(a => [a.id, a]));
  const precise = o => o.status === 'completed' && actualSecond(o);
  const excluded = o => o.loanProof || o.balanceEvidence || o.investmentTrade;
  const available = o => precise(o) && !excluded(o) && !annotatedKeys.has(identity(o)) && !occupied.has(identity(o));
  const target = (o, activity, product) => {
    const matches = (o.accountRelations || []).filter(r => r.role === 'target' && r.activity === activity && r.product === product);
    return matches.length === 1 && accountMap.get(matches[0].financialAccountId)?.sourceProduct === product;
  };
  const draw = o => available(o) && o.provider === 'alipay' && o.kind === 'loan_drawdown'
    && ['neutral', 'credit'].includes(o.direction) && !o.paymentChannel && !o.paymentAccountHint
    && BigInt(o.amountMinor) > 0n && actualLoanDrawEvidence.get(o.id)?.length > 0
    && accountMap.get(o.financialAccountId)?.type === 'wallet' && accountMap.get(o.financialAccountId)?.status === 'active'
    && target(o, 'loan_drawdown', 'alipay_jiebei');
  const sweep = o => available(o) && o.provider === 'alipay' && o.kind === 'transfer' && o.direction === 'neutral'
    && o.description === '\u4f59\u989d\u5b9d-\u5355\u6b21\u8f6c\u5165' && o.paymentChannel === '\u4f59\u989d' && !o.paymentAccountHint
    && BigInt(o.amountMinor) > 0n && target(o, 'investment_deposit', 'alipay_yuebao');
  const use = o => available(o) && o.provider === 'alipay' && o.paymentChannel === '\u4f59\u989d' && !o.paymentAccountHint
    && BigInt(o.amountMinor) > 0n && (['transfer', 'expense', 'debt_payment'].includes(o.kind) && o.direction === 'debit' || sweep(o));
  const activeLinks = new Set(links.filter(l => l.status !== 'deleted').map(l => [...l.observationIds].sort().join('|')));
  const vetoes = links.filter(l => l.status !== 'deleted' && ['distinct', 'group_distinct'].includes(l.type)
    || l.status === 'deleted' && l.type === 'duplicate' && !activeLinks.has([...l.observationIds].sort().join('|')));
  const blocked = members => {
    const keys = new Set(members.map(identity));
    return vetoes.some(l => {
      const refs = l.observationIds.map(id => byId.get(id)).filter(Boolean).map(identity);
      return l.type === 'group_distinct' ? refs.some(id => keys.has(id))
        : refs.length === l.observationIds.length && refs.every(id => keys.has(id));
    });
  };
  const proposals = [], sweeps = rows.filter(sweep);
  for (const first of rows.filter(draw)) for (const end of sweeps) {
    const seconds = (Date.parse(end.occurredAt) - Date.parse(first.occurredAt)) / 1000;
    if (end.financialAccountId !== first.financialAccountId || end.currency !== first.currency || end.date !== first.date
      || !Number.isInteger(seconds) || seconds <= 0 || seconds > 900) continue;
    const window = rows.filter(o => o.status === 'completed' && o.financialAccountId === first.financialAccountId
      && o.currency === first.currency && o.occurredAt >= first.occurredAt && o.occurredAt <= end.occurredAt && !excluded(o));
    const loans = window.filter(draw), uses = window.filter(use), members = [...loans, ...uses];
    if (loans.length < 2 || loans.length > 4 || uses.length < 2 || uses.length > 12 || uses.filter(sweep).length !== 1) continue;
    // Other product-funded debits cannot consume wallet funds. Unknown events block inference.
    if (window.some(o => !members.includes(o) && !(available(o) && o.direction === 'debit'
      && o.kind !== 'loan_drawdown' && o.paymentChannel && o.paymentChannel !== '\u4f59\u989d'))) continue;
    const loanTotal = loans.reduce((n, o) => n + BigInt(o.amountMinor), 0n);
    if (loanTotal !== uses.reduce((n, o) => n + BigInt(o.amountMinor), 0n) || blocked(members)) continue;
    if (rows.some(o => o.statementFlow && o.direction === 'credit' && o.currency === first.currency
      && Math.abs(Date.parse(o.date) - Date.parse(first.date)) <= 86400000
      && (BigInt(o.amountMinor) === loanTotal || loans.some(p => p.amountMinor === o.amountMinor)))) continue;
    if (new Set(members.map(identity)).size !== members.length || new Set(members.map(o => o.occurredAt)).size !== members.length) continue;
    let running = 0n, negative = false;
    for (const o of members.slice().sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
      running += loans.includes(o) ? BigInt(o.amountMinor) : -BigInt(o.amountMinor);
      if (running < 0n) negative = true;
    }
    if (!negative && running === 0n) proposals.push({ end, loans, uses, members, loanTotal });
  }
  const counts = new Map();
  for (const p of proposals) for (const o of p.members) counts.set(identity(o), (counts.get(identity(o)) || 0) + 1);
  const result = new Map();
  for (const p of proposals.filter(p => p.members.every(o => counts.get(identity(o)) === 1))) {
    const evidenceObservationIds = p.members.map(o => o.id).sort();
    for (const o of p.loans) result.set(o.id, {
      method: 'inferred_loan_wallet_receipt', confidence: 'inferred',
      basis: 'actual_loan_proofs_and_closed_wallet_use_group',
      financialAccountId: o.financialAccountId, amountMinor: o.amountMinor,
      groupId: 'closed-loan-wallet:' + evidenceObservationIds.join('|'), evidenceObservationIds,
      loanProofObservationIds: [...new Set(p.loans.flatMap(x => actualLoanDrawEvidence.get(x.id)))].sort(),
      groupLoanTotalMinor: String(p.loanTotal), groupWalletUseTotalMinor: String(p.loanTotal),
      loanCount: p.loans.length, walletUseCount: p.uses.length,
      secondsUntilFinalWalletSweep: (Date.parse(p.end.occurredAt) - Date.parse(o.occurredAt)) / 1000,
      reciprocalUnique: true, separateEconomicTransactions: true,
    });
  }
  return result;
}
module.exports = { findClosedLoanWalletGroups };
