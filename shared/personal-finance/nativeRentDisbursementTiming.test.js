'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{buildFinanceView}=require('./ledger'),{parseAlipayWalletBalanceRows}=require('./alipayWalletStatement');
function fixture(){
 const title='\u8f6c\u8d26\u5230\u94f6\u884c\u5361-\u623f\u79df+\u6c34\u7535\u71c3\u6c14\u8d39',ref='20130930000040011100250019196564',s={id:'rent',sourceIdentity:'rent',sourceVersionOrdinal:1,sourceTransactionId:ref,financialAccountId:'wallet',provider:'alipay',date:'2013-09-30',occurredAt:'2013-09-30T12:01:38+08:00',amountMinor:'926331',currency:'CNY',direction:'debit',kind:'expense',description:title,counterparty:'Landlord',category:'Rent',paymentChannel:'',paymentAccountHint:'',status:'completed',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{'\u4ea4\u6613\u65f6\u95f4':'2013-09-30 12:01:38','\u4ea4\u6613\u8ba2\u5355\u53f7':ref,'\u5546\u54c1\u8bf4\u660e':title,'\u4ea4\u6613\u5bf9\u65b9':'Landlord','\u6536/\u4ed8\u6b3e\u65b9\u5f0f':'','\u6536/\u652f':'\u652f\u51fa','\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f','\u91d1\u989d':'9263.31'}};
 const parsed=parseAlipayWalletBalanceRows([['1182979470','2013-10-01 12:39:31','\u63d0\u73b0\u6797\u6708\u9ec4','','-9263.31','1451.28','\u4e2d\u4fe1\u94f6\u884c',''],['20130930000251052500004***73','2013-09-30 12:04:41','\u7406\u8d22\u8d4e\u56de\u8d44\u91d1\u8f6c\u5165\u652f\u4ed8\u5b9d\u8d26\u6237\u4f59\u989d\u5b9d\u8f6c\u51fa','9263.31','','10714.59','\u5929\u5f18\u57fa\u91d1','']]);assert.deepEqual(parsed.errors,[]);
 return{accounts:[{id:'wallet',label:'Wallet',type:'wallet',provider:'alipay',currency:'CNY',status:'active'},{id:'fund',label:'Yuebao',type:'investment',provider:'alipay',sourceProduct:'alipay_yuebao',currency:'CNY',status:'active'}],observations:[s,...parsed.records.map((o,i)=>({...o,id:'native'+i,sourceIdentity:'native'+i,sourceVersionOrdinal:1,financialAccountId:'wallet',provider:'alipay',importId:'native'}))],annotations:[],links:[],imports:[{id:'native',provider:'alipay',financialAccountId:'wallet',templateId:'alipay-wallet-balance-table-v1',fileHash:'a'.repeat(64),recordCount:2,observationIds:['native0','native1'],sourceEvidence:{kind:'owner_authenticated_browser_table',url:'https://lab.alipay.com/consume/record/items.htm',periodStart:'2013-09-01',periodEnd:'2013-10-31',sourceRows:2,sourcePages:1}}],balanceSnapshots:[]};
}
test('unique rent order keeps economic date while actual next-day cash and the existing fund redemption balance independently',()=>{
 const l=fixture(),raw=JSON.stringify(l),v=buildFinanceView(l),t=v.transactions.find(t=>t.id==='rent');assert(t.nativeRentDisbursementTiming);assert.equal(t.date,'2013-09-30');assert.equal(t.occurredAt,'2013-09-30T12:01:38+08:00');assert.equal(t.counterparty,'Landlord');assert.equal(t.consumptionMinor,'926331');assert.equal(t.incomeMinor,'0');assert.equal(t.cashEffects.wallet,'-926331');assert.equal(t.balanceEffects.wallet,'-926331');assert.equal(t.cashEffectEvents.wallet[0].date,'2013-10-01');assert.equal(t.balanceEffectTimes.wallet,'2013-10-01T12:39:31+08:00');assert.equal(t.nativeRentDisbursementTiming.sourceOrderReferenceMatched,false);assert.equal(t.nativeRentDisbursementTiming.nativeBankAndNameNotUsedAsRecipientIdentity,true);assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);assert.equal(v.transactions.filter(t=>BigInt(t.balanceEffects.fund||0)===-926331n).length,1);assert.equal(JSON.stringify(l),raw);
});
test('date ranges show expense on the order day and actual wallet cash on the disbursement day',()=>{
 const l=fixture(),order=buildFinanceView(l,{accountIds:['wallet'],startDate:'2013-09-30',endDate:'2013-09-30'}),paid=buildFinanceView(l,{accountIds:['wallet'],startDate:'2013-10-01',endDate:'2013-10-01'});assert.equal(order.currencyTotals.CNY.consumptionMinor,'926331');assert.equal(order.accountStats.wallet.cashOutMinor,'0');assert.equal(order.accountStats.wallet.cashInMinor,'926331');assert.equal(paid.currencyTotals.CNY.consumptionMinor,'0');assert.equal(paid.accountStats.wallet.cashOutMinor,'926331');assert(paid.transactions.some(t=>t.id==='rent'));
});
test('full-width plus has the same purpose while raw source characters remain untouched',()=>{
 const l=fixture();l.observations[0].description=l.observations[0].description.replace('+','\uff0b');l.observations[0].rawFields['\u5546\u54c1\u8bf4\u660e']=l.observations[0].description;const raw=JSON.stringify(l),v=buildFinanceView(l);assert(v.transactions.find(t=>t.id==='rent').nativeRentDisbursementTiming);assert.equal(JSON.stringify(l),raw);
});
test('rent cash timing rejects altered original money, rival orders, proof edits and a missing independently booked fund credit',()=>{
 for(const change of[
  l=>l.observations.push({...l.observations[0],id:'rival',sourceIdentity:'rival',sourceTransactionId:'20130930000040011100250019196565'}),
  l=>l.observations[0].rawFields['\u91d1\u989d']='9263.30',
  l=>l.observations[0].description='\u8f6c\u8d26\u5230\u94f6\u884c\u5361',
  l=>l.observations[1].rawFields['\u6536\u5165']='9263.30',
  l=>l.observations[2].relatedReference='20130930000040011100250019196564',
  l=>l.annotations.push({observationId:'native0',revision:'1',patch:{category:'Owner cash'}}),
  l=>l.annotations.push({observationId:'rent',revision:'1',patch:{category:'Owner purpose'}}),
  l=>l.links.push({type:'distinct',status:'active',observationIds:['rent','native1']}),
  l=>l.links.push({type:'duplicate',status:'deleted',observationIds:['rent','native1']}),
  l=>l.accounts[1].status='closed'
  ,l=>l.imports=[]
  ,l=>l.imports[0].sourceEvidence.sourceRows=3
  ,l=>l.imports[0].sourceEvidence.periodEnd='2013-09-30'
 ]){const l=fixture();change(l);assert(!buildFinanceView(l).transactions.find(t=>t.id==='rent')?.nativeRentDisbursementTiming,change.toString());}
});
test('revoking the inferred association restores original timing without deleting any originals',()=>{
 const l=fixture(),raw=JSON.stringify(l.observations);assert(buildFinanceView(l).transactions.find(t=>t.id==='rent').nativeRentDisbursementTiming);l.links.push({id:'undo',type:'distinct',status:'active',observationIds:['rent','native1']});const v=buildFinanceView(l),t=v.transactions.find(t=>t.id==='rent');assert.equal(t.nativeRentDisbursementTiming,undefined);assert.equal(t.balanceEffectTimes.wallet,'2013-09-30T12:01:38+08:00');assert(v.balanceReconciliation.summary.differenceIntervalCount>0);assert.equal(JSON.stringify(l.observations),raw);l.links[0].status='deleted';assert(buildFinanceView(l).transactions.find(t=>t.id==='rent').nativeRentDisbursementTiming);
});
