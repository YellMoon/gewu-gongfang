'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{buildFinanceView}=require('./ledger'),{parseUnionpayNetworkCapture,bindUnionpayNetworkAccounts}=require('./unionpayNetworkStatement'),{syntheticCapture}=require('./fixtures/unionpayNetwork.synthetic');
function fixture(){
 const account={id:'card',provider:'\u5174\u4e1a\u94f6\u884c',type:'credit_card',maskedIdentifier:'8547',currency:'CNY',status:'active'},date='2026-10-02',parsed=parseUnionpayNetworkCapture(syntheticCapture([{date,amount:'10.00',title:'Rail purchase',bank:account.provider,tail:'8547'}])),bound=bindUnionpayNetworkAccounts(parsed.records,[account]);assert.deepEqual(bound.errors,[]);
 const native={...bound.records[0],id:'native',financialAccountId:'card',provider:'unionpay',importId:'network',sourceIdentity:'native',sourceVersionOrdinal:1};
 const banks=[1,2,3].map(n=>({id:'bank'+n,sourceIdentity:'bank'+n,sourceVersionOrdinal:1,sourceTransactionId:'original'+n,financialAccountId:'card',provider:'cib',importId:'statement',date,occurredAt:date+'T23:59:59+08:00',amountMinor:'1000',currency:'CNY',kind:'expense',direction:'debit',status:'completed',description:'Rail purchase',counterparty:'Rail purchase',category:'Travel',paymentChannel:'',paymentAccountHint:'',relatedReference:'',balanceMinor:null,principalMinor:null,interestMinor:null,feeMinor:null,bankStatement:{schema:'bank-credit-v1',cardTail:'8547',provider:'cib',nonCash:false,postedDate:date,statementDate:'2026-10-25'},rawFields:{cardTail:'8547',dateBasis:'transaction_date',tradeDate:date,postedDate:date,statementDate:'2026-10-25',statementAmountMinor:'1000',statementCredit:false}}));
 return{accounts:[account],observations:[...banks,native],annotations:[],links:[{id:'owner-choice',type:'duplicate',observationIds:['native','bank3'],source:'manual',status:'active',note:'Owner identifies third purchase after two earlier refunded attempts.',createdAt:'2026-10-26T00:00:00Z'}],imports:[{id:'statement',provider:'cib',createdAt:'2026-10-20T00:00:00Z'},{id:'network',provider:'unionpay',createdAt:'2026-10-25T00:00:00Z'}],balanceSnapshots:[]};
}
test('a specific owner-selected original resolves the evidence row without changing any financial leg',()=>{
 const l=fixture(),raw=JSON.stringify(l),base=buildFinanceView({...l,observations:l.observations.filter(o=>!o.bankNetwork),links:[]}),v=buildFinanceView(l);assert.equal(JSON.stringify(l),raw);assert.equal(v.review.transactionCount,0);assert.equal(v.transactions.length,3);assert.equal(v.networkEvidence.summary.matchedEvidenceRows,1);assert.equal(v.networkEvidence.summary.postedRows||0,0);assert.deepEqual(v.currencyTotals,base.currencyTotals);assert.deepEqual(v.accountStats,base.accountStats);
 const chosen=v.transactions.find(t=>t.id==='bank3');assert.deepEqual(chosen.observationIds,['bank3','native']);const e=chosen.automaticAssociations.find(a=>a.method==='owner_confirmed_native_existing_cash_evidence');assert(e);assert.equal(e.confidence,'owner_confirmed');assert.equal(e.evidence.individualIdentity,'owner_selected_original');assert.equal(e.evidence.ownerSelectionEvidence.bankObservationId,'bank3');assert.equal(e.evidence.ownerSelectionEvidence.nativeDisplayedTimeAccuracyClaimed,false);assert(e.evidence.reversible);
 for(const id of ['bank1','bank2'])assert.deepEqual(v.transactions.find(t=>t.id===id),base.transactions.find(t=>t.id===id));assert.equal(buildFinanceView(l,{startDate:'2026-10-01',endDate:'2026-10-03',accountIds:['card']}).networkEvidence.summary.matchedEvidenceRows,1);
});
test('deleting the choice restores ambiguity, while wrong money/date/card, new edits and conflicting links cannot act as owner evidence',()=>{
 for(const change of[
  x=>x.links[0].status='deleted',
  x=>x.links[0].source='automatic',
  x=>x.links[0].note='',
  x=>x.observations.find(o=>o.id==='bank3').amountMinor='999',
  x=>x.observations.find(o=>o.id==='bank3').date='2026-10-01',
  x=>x.observations.find(o=>o.id==='bank3').status='failed',
  x=>x.links.push({...x.links[0],id:'contradictory',observationIds:['native','bank2']}),
  x=>x.links.push({id:'veto',type:'distinct',status:'active',observationIds:['bank3','bank2']}),
  x=>x.annotations.push({id:'new-purpose',observationId:'native',revision:'1',patch:{kind:'expense'}})
 ]){const l=fixture();change(l);const v=buildFinanceView(l);assert(!v.networkEvidence.matches.some(m=>m.method==='owner_confirmed_native_existing_cash_evidence'),change.toString());assert(v.review.transactionCount>0,change.toString());}
});
