'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildFinanceView,validateRecord}=require('./ledger'),{parseUnionpayNetworkCapture,bindUnionpayNetworkAccounts}=require('./unionpayNetworkStatement'),{syntheticCapture}=require('./fixtures/unionpayNetwork.synthetic');
const account={id:'bank',provider:'\u62db\u5546\u94f6\u884c',maskedIdentifier:'1234',label:'Synthetic card',type:'credit_card',currency:'CNY',status:'active',openingBalanceMinor:null,openingDate:null,balanceConvention:'signed'};
function network(events=[{}]){const p=parseUnionpayNetworkCapture(syntheticCapture(events));assert.deepEqual(p.errors,[]);const b=bindUnionpayNetworkAccounts(p.records,[account]);assert.deepEqual(b.errors,[]);return b.records.map((r,i)=>({...r,id:'network-'+i,provider:'unionpay',financialAccountId:'bank',importId:'capture',sourceOrdinal:i+1}));}
function original(extra={}){return {sourceTransactionId:'original',date:'2026-10-01',occurredAt:'2026-10-01T23:59:59+08:00',amountMinor:'1234',currency:'CNY',direction:'debit',kind:'expense',description:'Synthetic merchant',counterparty:'Synthetic merchant',category:'Test',paymentChannel:'',paymentAccountHint:'',balanceMinor:null,relatedReference:'',status:'completed',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{},id:'old',provider:'synthetic',financialAccountId:'bank',importId:'old-import',sourceOrdinal:1,...extra};}
const ledger=observations=>({accounts:[account],observations,imports:[],annotations:[],links:[],balanceSnapshots:[]});
test('production view attaches unique network evidence without changing any original financial result',()=>{
 const base=ledger([original()]),before=JSON.stringify(base),old=buildFinanceView(base),full={...base,observations:[...base.observations,...network()]},snapshot=JSON.stringify(full);const view=buildFinanceView(full);
 assert.equal(view.networkEvidence.summary.matchedEvidenceRows,1);assert.equal(view.transactions.length,old.transactions.length);assert.deepEqual(view.currencyTotals,old.currencyTotals);assert.deepEqual(view.accountStats,old.accountStats);assert.deepEqual(view.balanceReconciliation,old.balanceReconciliation);assert.deepEqual(view.review,old.review);const t=view.transactions[0];assert.deepEqual(t.balanceEffects,old.transactions[0].balanceEffects);assert.deepEqual(t.cashEffects,old.transactions[0].cashEffects);assert.deepEqual(t.observationIds,['old','network-0']);assert.equal(t.sources.length,2);assert.equal(t.automaticAssociations.at(-1).evidence.noNewCash,true);assert.equal(JSON.stringify(full),snapshot);assert.equal(JSON.stringify(base),before);
});
test('unmatched native rows remain visible and counted as unresolved without duplicate cash',()=>{
 const l=ledger(network()),view=buildFinanceView(l);assert.equal(view.transactions.length,1);const t=view.transactions[0];assert.equal(t.networkEvidenceStatus,'held_for_reconciliation');assert.equal(t.amountMinor,'1234');assert.equal(t.sources[0].direction,'debit');assert.deepEqual(t.balanceEffects,{});assert.deepEqual(t.cashEffects,{});assert.equal(t.incomeMinor,'0');assert.equal(t.consumptionMinor,'0');assert.equal(view.review.transactionCount,1);assert.equal(view.review.groups[0].issues[0].basis,'network_evidence_requires_reconciliation_before_financial_posting');
});
test('freeze keeps its face amount and native status but contributes neither money nor pending purpose',()=>{
 const view=buildFinanceView(ledger(network([{frozen:true,amount:'26.00'}])));assert.equal(view.networkEvidence.summary.nonCashRows,1);assert.equal(view.transactions[0].amountMinor,'2600');assert.equal(view.transactions[0].networkEvidenceStatus,'noncash_authorization');assert.equal(view.review.transactionCount,0);assert.equal(view.currencyTotals.CNY.incomeMinor,'0');assert.equal(view.currencyTotals.CNY.consumptionMinor,'0');assert.equal(view.accountStats.bank.balanceMinor,null);
});
test('owner rejection makes supplemental evidence visible for review instead of silently relinking it',()=>{
 const l=ledger([original(),...network()]);l.links=[{id:'veto',type:'distinct',observationIds:['old','network-0']}];const view=buildFinanceView(l);assert.equal(view.networkEvidence.matches.length,0);assert.equal(view.review.transactionCount,1);assert.equal(view.transactions.length,2);assert.equal(view.currencyTotals.CNY.consumptionMinor,'1234');
});
test('deleting a native rejection restores the association while preserving all actual financial effects',()=>{
 const l=ledger([original(),...network()]),before=buildFinanceView(l);l.links=[{id:'veto',type:'distinct',observationIds:['old','network-0'],status:'active'}];assert.equal(buildFinanceView(l).networkEvidence.matches.length,0);l.links[0].status='deleted';l.links[0].deletedAt='2026-10-03T00:00:00Z';const restored=buildFinanceView(l);assert.deepEqual(restored.networkEvidence.matches,before.networkEvidence.matches);assert.deepEqual(restored.currencyTotals,before.currencyTotals);assert.deepEqual(restored.accountStats,before.accountStats);assert.equal(restored.review.transactionCount,0);
});
test('date and account filters cannot change the full-history association decision',()=>{
 const l=ledger([original(),...network()]),a=buildFinanceView(l),b=buildFinanceView(l,{startDate:'2026-11-01'});assert.deepEqual(b.networkEvidence,a.networkEvidence);assert.equal(b.transactions.length,0);assert.equal(b.review.transactionCount,0);
 const c=buildFinanceView(l,{accountIds:[]});assert.deepEqual(c.networkEvidence,a.networkEvidence);assert.equal(c.transactions.length,0);
});
test('bankNetwork cannot bypass record validation or owned card identity checks',()=>{
 const r=network()[0];validateRecord(r);const bad=structuredClone(r);bad.direction='credit';assert.throws(()=>validateRecord(bad));for(const change of [x=>x.financialAccountId='other',x=>x.bankAccount.type='debit_card',x=>x.provider='alipay']){const x=structuredClone(r);change(x);assert.throws(()=>buildFinanceView(ledger([x])));}
});
test('archiving an already imported card preserves its historical channel evidence',()=>{
 const l=ledger([original(),...network()]);l.accounts=[{...account,status:'archived'}];const view=buildFinanceView(l);assert.equal(view.networkEvidence.summary.matchedEvidenceRows,1);assert.equal(view.review.transactionCount,0);assert.deepEqual(view.transactions[0].observationIds,['old','network-0']);assert.equal(view.currencyTotals.CNY.consumptionMinor,'1234');
});
test('refund evidence does not turn a credit-account refund into ordinary income',()=>{
 const old=original({kind:'refund',direction:'credit'}),view=buildFinanceView(ledger([old,...network([{refund:true,direction:'credit'}])])),base=buildFinanceView(ledger([old]));assert.equal(view.networkEvidence.summary.matchedEvidenceRows,1);assert.deepEqual(view.currencyTotals,base.currencyTotals);assert.equal(view.currencyTotals.CNY.incomeMinor,'0');assert.deepEqual(view.transactions[0].balanceEffects,base.transactions[0].balanceEffects);
});
