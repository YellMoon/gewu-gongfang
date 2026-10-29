'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseAlipayWalletBalanceRows}=require('./alipayWalletStatement');
const {findWalletStatementTopUpFunding,validatedWalletProofs}=require('./walletStatementTopUps');
const {buildFinanceView}=require('./ledger');
const bank='\u6c5f\u82cf\u94f6\u884c',topup='\u5145\u503c-\u666e\u901a\u5145\u503c';
function original(id,date,amount,reference){return{id,sourceIdentity:id,sourceTransactionId:reference,sourceVersionOrdinal:1,financialAccountId:'wallet',provider:'alipay',importId:'original',date,occurredAt:date+'T14:43:23+08:00',amountMinor:amount,currency:'CNY',kind:'transfer',direction:'neutral',status:'completed',description:topup,counterparty:'**A',category:'\u8f6c\u8d26\u7ea2\u5305',paymentChannel:'\u4f59\u989d',paymentAccountHint:'',relatedReference:'',balanceMinor:null,rawFields:{'\u4ea4\u6613\u8ba2\u5355\u53f7':reference,'\u5546\u54c1\u8bf4\u660e':topup,'\u6536/\u4ed8\u6b3e\u65b9\u5f0f':'\u4f59\u989d','\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f','\u6536/\u652f':'\u4e0d\u8ba1\u6536\u652f','\u91d1\u989d':(BigInt(amount)/100n)+'.'+String(BigInt(amount)%100n).padStart(2,'0')}};}
function fixture(){
 const current=original('current','2018-03-05','120000','20180305200040011100250031132521'),prior=original('prior','2020-08-10','540000','20200810200040011100250072895298');
 const binding={channel:'\u4f59\u989d',institution:bank,type:'debit_card',maskedIdentifier:'2110',financialAccountId:'bank',periodStart:prior.date,periodEnd:prior.date,confirmedAt:'2026-10-21T00:00:00Z',confidence:'owner_confirmed',usage:'funding',identityBasis:'owner_confirmed_top_up_source',sourceTransactionIds:[prior.sourceTransactionId]};
 const accounts=[{id:'wallet',type:'wallet',provider:'alipay',status:'active',currency:'CNY',label:'Wallet',historicalCardBindings:{schema:'historical-card-bindings-v1',rules:[binding]},walletWithdrawalDestinations:{schema:'wallet-withdrawal-destinations-v1',rules:[{institution:bank,financialAccountId:'bank',confirmedAt:'2026-10-21T00:00:00Z',feeHandling:'owner_confirmed_zero'}]}},{id:'bank',type:'debit_card',provider:bank,status:'active',currency:'CNY',label:'Studio2110',maskedIdentifier:'2110',fundsRole:'studio_public'}];
 const parsed=parseAlipayWalletBalanceRows([[current.sourceTransactionId,'2018-03-05 14:43:23','\u5145\u503c\u5230\u4f59\u989d','1200.00','','1200.00',bank,'']]);assert.deepEqual(parsed.errors,[]);
 const proof={...parsed.records[0],id:'proof',sourceIdentity:'proof',sourceVersionOrdinal:1,importId:'proof-import',financialAccountId:'wallet',provider:parsed.provider};
 return{accounts,observations:[current,prior,proof],annotations:[],links:[],imports:[],balanceSnapshots:[]};
}
const run=(l,extra={})=>findWalletStatementTopUpFunding(l.observations,l.accounts,{annotatedIds:new Set(l.annotations.map(a=>a.observationId)),links:l.links,...extra});
test('an actual wallet recharge bank plus the confirmed studio identity closes one transfer',()=>{
 const l=fixture(),before=JSON.stringify(l);assert.equal(validatedWalletProofs(l.observations,new Map(l.accounts.map(a=>[a.id,a]))).length,1,JSON.stringify(l.observations[2]));const match=run(l).get('current');assert(match);assert.equal(match.financialAccountId,'bank');assert.equal(match.confidence,'inferred');assert.equal(match.bankCardTailPrinted,false);assert.deepEqual(match.evidenceObservationIds,['current','proof']);assert.equal(match.reversible,true);
 const view=buildFinanceView(l),row=view.transactions.find(t=>t.observationIds.includes('current'));
 assert.deepEqual(row.cashEffects,{wallet:'120000',bank:'-120000'});assert.equal(row.consumptionMinor,'0');assert.equal(row.incomeMinor,'0');assert(!view.unresolvedAssociations.some(a=>a.observationId==='current'));assert.equal(JSON.stringify(l),before);
});
test('bank names do not choose among cards or replace missing owner identity',()=>{
 for(const change of[
  l=>l.accounts.push({...l.accounts[1],id:'another',maskedIdentifier:'2111'}),
  l=>delete l.accounts[1].fundsRole,l=>delete l.accounts[0].walletWithdrawalDestinations,
  l=>delete l.accounts[0].historicalCardBindings,l=>l.observations.splice(1,1),
  l=>l.accounts[0].historicalCardBindings.rules[0].confidence='owner_recalled',
  l=>l.observations[2].rawFields['\u8d44\u91d1\u6e20\u9053']='\u5176\u4ed6\u94f6\u884c',
 ]){const l=fixture();change(l);assert.equal(run(l).size,0);}
});
test('bank processing delay preserves creation time and uses actual wallet posting time',()=>{
 const l=fixture(),proof=l.observations[2];proof.occurredAt='2018-03-05T14:43:31+08:00';proof.rawFields['\u65f6\u95f4']='2018-03-0514:43:31';const match=run(l).get('current');assert.equal(match.postingDelaySeconds,8);assert.equal(match.orderOccurredAt,l.observations[0].occurredAt);const row=buildFinanceView(l).transactions.find(t=>t.observationIds.includes('current'));assert.equal(row.occurredAt,l.observations[0].occurredAt);assert.equal(row.balanceEffectTimes.wallet,proof.occurredAt);
});
test('order identity, amount, time, annotations, competition and vetoes remain authoritative',()=>{
 for(const change of[
  l=>l.observations[0].sourceTransactionId='different',l=>l.observations[0].amountMinor='120001',
  l=>l.observations[2].occurredAt='2018-03-05T15:43:23+08:00',
  l=>l.observations[2].balanceMinor='120001',
  l=>l.annotations.push({observationId:'current',revision:'1',patch:{kind:'transfer',category:'Custom'}}),
  l=>l.observations.push({...l.observations[0],id:'competing',sourceIdentity:'competing'}),
  l=>l.links.push({type:'distinct',observationIds:['current','proof']}),
  l=>l.links.push({type:'duplicate',status:'deleted',observationIds:['current','proof']}),
 ]){const l=fixture();change(l);assert.equal(run(l).size,0);}
});
test('a corrupt adjacent original balance cannot certify an otherwise valid recharge row',()=>{
 const l=fixture(),proof=l.observations[2];l.observations.push({...proof,id:'bad',sourceIdentity:'bad',relatedReference:'20180305200040011100250031132522',balanceMinor:'120100',balanceEvidence:{...proof.balanceEvidence,sequence:2,openingBeforeFirstMinor:null}});assert.equal(run(l).size,0);
});
