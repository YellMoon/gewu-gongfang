'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{buildFinanceView}=require('./ledger'),{parseAlipayWalletBalanceRows}=require('./alipayWalletStatement'),{planGroupedWalletWithdrawalPostings:plan}=require('./groupedWalletWithdrawalPostings'),{reconcileIndependentBalances}=require('./balanceReconciliation');
function fixture(){
 const accounts=[{id:'wallet',label:'Alipay',provider:'alipay',type:'wallet',currency:'CNY',status:'active',walletWithdrawalDestinations:{schema:'wallet-withdrawal-destinations-v1',rules:[{institution:'\u6c5f\u82cf\u94f6\u884c',financialAccountId:'bank',confirmedAt:'2026-10-21T01:50:00Z',feeHandling:'unknown'}]}},{id:'bank',label:'JS2110',provider:'\u6c5f\u82cf\u94f6\u884c',maskedIdentifier:'2110',type:'debit_card',currency:'CNY',status:'active',fundsRole:'studio_public'}],date='2019-12-05',refs=['20191205200040011100250097834501','20191205200040011100250097935364'];
 const common={provider:'alipay',financialAccountId:'wallet',date,currency:'CNY',direction:'neutral',kind:'transfer',status:'completed',balanceMinor:null,principalMinor:null,interestMinor:null,feeMinor:null,relatedReference:'',category:'\u8d26\u6237\u5b58\u53d6',paymentAccountHint:'',paymentChannel:'\u4f59\u989d',sourceVersionOrdinal:1,description:'\u63d0\u73b0-\u5feb\u901f\u63d0\u73b0',counterparty:'\u6c5f\u82cf\u94f6\u884c'};
 const withdrawals=['200000','300000'].map((amount,i)=>({...common,id:'w'+i,importId:'original',sourceIdentity:'w'+i,sourceTransactionId:refs[i],amountMinor:amount,occurredAt:date+'T'+(i?'13:00:00':'12:00:00')+'+08:00',rawFields:{'\u4ea4\u6613\u65f6\u95f4':date+' '+(i?'13:00:00':'12:00:00'),'\u4ea4\u6613\u8ba2\u5355\u53f7':refs[i],'\u5546\u54c1\u8bf4\u660e':common.description,'\u4ea4\u6613\u5bf9\u65b9':common.counterparty,'\u6536/\u4ed8\u6b3e\u65b9\u5f0f':'\u4f59\u989d','\u6536/\u652f':'\u4e0d\u8ba1\u6536\u652f','\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f','\u91d1\u989d':i?'3000.00':'2000.00'}}));
 const fee={...common,id:'fee',importId:'fee-import',sourceIdentity:'fee',sourceTransactionId:'fee',amountMinor:'0',occurredAt:date+'T23:59:59+08:00',paymentChannel:'',counterparty:'',description:'\u652f\u4ed8\u5b9d\u63d0\u73b0\u624b\u7eed\u8d39\u6838\u5bf9\u4f9d\u636e',rawFields:{sourceSheet:'\u5b66\u8d39\u6536\u5165'},withdrawalFeeEvidence:{schema:'workbook-withdrawal-fee-v1',platform:'alipay',grossMinor:'500000',feeMinor:'0',sourceSheet:'\u5b66\u8d39\u6536\u5165',sourceRows:[10,11],rawFeeValues:['0','0'],confirmation:'owner_confirmed_actual_fees'}};
 const parsed=parseAlipayWalletBalanceRows([[refs[1],date+' 13:00:00','\u63d0\u73b0\u6797\u6708\u9ec4\u652f\u4ed8\u5b9d\u8f6c\u8d26','','-3000.00','0.00','\u6c5f\u82cf\u94f6\u884c',''],[refs[0],date+' 12:00:00','\u63d0\u73b0\u6797\u6708\u9ec4\u652f\u4ed8\u5b9d\u8f6c\u8d26','','-2000.00','3000.00','\u6c5f\u82cf\u94f6\u884c','']]);assert.deepEqual(parsed.errors,[]);
 const proofs=parsed.records.map((o,i)=>({...o,id:'native'+i,sourceIdentity:'native'+i,sourceVersionOrdinal:1,provider:'alipay',importId:'native-import',financialAccountId:'wallet'}));
 return{accounts,observations:[...withdrawals,fee,...proofs],annotations:[],links:[],balanceSnapshots:[],imports:[{id:'fee-import',financialAccountId:'wallet',provider:'alipay',templateId:'workbook-withdrawal-fees-v1',fileHash:'a'.repeat(64),recordCount:1,observationIds:['fee']}]};
}
test('separate native withdrawal times reconcile balances while the bank receipt remains an undetermined group',()=>{
 const l=fixture(),raw=JSON.stringify(l),v=buildFinanceView(l);assert.equal(JSON.stringify(l),raw);assert.equal(v.transactions.length,1);
 const t=v.transactions[0];assert(t.groupedWalletWithdrawalPostings);assert.equal(t.groupedWalletWithdrawalPostings.withdrawalCount,2);assert.equal(t.groupedWalletWithdrawalPostings.totalMinor,'500000');assert(t.groupedWalletWithdrawalPostings.bankIndividualReceiptsNotInferred);assert(t.groupedWalletWithdrawalPostings.reversible);
 assert.deepEqual(t.balanceEffects,{wallet:'-500000',bank:'500000'});assert.deepEqual(t.cashEffects,t.balanceEffects);assert.equal(t.balanceEffectTimes.bank,'2019-12-05T23:59:59+08:00');assert.equal(t.balanceEffectTimes.wallet,'2019-12-05T13:00:00+08:00');assert.equal(t.cashPostingEvidence.length,2);assert.equal(t.sources.length,3);
 assert.deepEqual(t.balanceEffectEvents.wallet.map(e=>[e.occurredAt,e.deltaMinor]),[['2019-12-05T12:00:00+08:00','-200000'],['2019-12-05T13:00:00+08:00','-300000']]);assert.equal(t.consumptionMinor,t.incomeMinor);assert.equal(t.consumptionMinor,'0');
 assert.equal(v.review.transactionCount,0);assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);assert.equal(v.currencyTotals.CNY.cashInMinor,'500000');assert.equal(v.currencyTotals.CNY.cashOutMinor,'500000');
 const broken=structuredClone(t);delete broken.balanceEffectEvents;broken.balanceEffectTimes.wallet=t.groupedWalletWithdrawalPostings.originalWalletEffectTime;assert.equal(reconcileIndependentBalances(l,[broken]).summary.differenceIntervalCount,1);
 assert.equal(buildFinanceView(l,{accountIds:['bank']}).currencyTotals.CNY.cashInMinor,'500000');assert.equal(buildFinanceView(l,{accountIds:['wallet']}).currencyTotals.CNY.cashOutMinor,'500000');
});
test('already applied or owner-edited groups and native claims are not applied again',()=>{
 const l=fixture(),v=buildFinanceView(l);assert.equal(plan(l,v.transactions).length,0);
 const bare=()=>{const t=structuredClone(v.transactions[0]);delete t.groupedWalletWithdrawalPostings;delete t.balanceEffectEvents;delete t.cashPostingEvidence;t.balanceEffectTimes.wallet='2019-12-05T23:59:59+08:00';return t;};
 assert.equal(plan(l,[bare()]).length,1);
 for(const change of[
  (x,t)=>x.annotations.push({observationId:'w0'}),
  (x,t)=>x.links.push({type:'duplicate',status:'deleted',observationIds:['w0','native0']}),
  (x,t)=>t.cashPostingEvidence=[{proofObservationId:'native0'}],
  (x,t)=>x.observations.find(o=>o.id==='native0').rawFields['\u8d44\u91d1\u6e20\u9053']='unsupported-channel',
  (x,t)=>{x.observations.find(o=>o.id==='native0').balanceMinor='1';},
  (x,t)=>{x.imports[0].fileHash='invalid';},
  (x,t)=>{t.sources[0].rawFields['\u91d1\u989d']='1999.99';},
  (x,t)=>{t.balanceEffects.bank='499999';},
  (x,t)=>{t.sources[0].paymentChannel='\u4f59\u989d\u5b9d';},
  (x,t)=>{t.sources.find(s=>s.id==='fee').withdrawalFeeEvidence.feeMinor='1';},
  (x,t)=>x.observations.push({...x.observations.find(o=>o.id==='native0'),id:'tie',sourceIdentity:'native0'}),
  (x,t)=>x.observations.push({...x.observations.find(o=>o.id==='w0'),id:'rival',sourceIdentity:'rival'})
 ]){const x=structuredClone(l),t=bare();change(x,t);assert.equal(plan(x,[t]).length,0,change.toString());}
});
test('one withdrawal grouped with a zero-fee workbook still keeps its native time instead of the evidence day end',()=>{
 const l=fixture(),removedRef=l.observations.find(o=>o.id==='w0').sourceTransactionId;l.observations=l.observations.filter(o=>o.id!=='w0'&&o.relatedReference!==removedRef);const fee=l.observations.find(o=>o.id==='fee');fee.withdrawalFeeEvidence.grossMinor='300000';
 const native=l.observations.find(o=>o.balanceEvidence);native.balanceEvidence.sequence=1;native.balanceEvidence.openingBeforeFirstMinor='300000';
 const v=buildFinanceView(l),t=v.transactions[0];assert.equal(t.groupedWalletWithdrawalPostings.withdrawalCount,1);assert.equal(t.balanceEffects.wallet,'-300000');assert.equal(t.balanceEffectEvents.wallet[0].occurredAt,'2019-12-05T13:00:00+08:00');assert.equal(t.balanceEffectTimes.bank,'2019-12-05T23:59:59+08:00');assert.equal(t.consumptionMinor,'0');
});
test('full withdrawal references repair only existing wallet cash timing without a workbook or a newly asserted fee',()=>{
 const l=fixture();l.observations=l.observations.filter(o=>o.id!=='fee');l.imports=[];l.accounts[0].walletWithdrawalDestinations.rules[0].feeHandling='owner_confirmed_zero';const raw=JSON.stringify(l),v=buildFinanceView(l);assert.equal(JSON.stringify(l),raw);
 const rows=v.transactions.filter(t=>t.groupedWalletWithdrawalPostings);assert.equal(rows.length,2);
 for(const t of rows){const e=t.groupedWalletWithdrawalPostings;assert.equal(e.feeMinor,null);assert.equal(e.feeEvidenceObservationId,null);assert.equal(e.feeBasis,'existing_ledger_amounts_preserved_no_new_fee_assertion');assert.equal(e.nativeDisbursementChannelUsedToSelectReceivingAccount,false);assert.equal(t.balanceEffectEvents.wallet.length,1);assert.equal(t.balanceEffectEvents.wallet[0].deltaMinor,t.balanceEffects.wallet);assert.equal(t.consumptionMinor,'0');}
 assert.equal(v.currencyTotals.CNY.cashInMinor,'500000');assert.equal(v.currencyTotals.CNY.cashOutMinor,'500000');
 // A different printed disbursement bank must never replace the recipient.
 const cash=l.observations.find(o=>o.balanceEvidence);cash.rawFields['\u8d44\u91d1\u6e20\u9053']='\u7f51\u5546\u94f6\u884c';const renamed=buildFinanceView(l);for(const t of renamed.transactions){assert.equal(t.groupedWalletWithdrawalPostings.bankAccountId,'bank');assert(t.balanceEffects.bank);}
});
