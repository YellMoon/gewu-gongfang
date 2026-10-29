'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{buildFinanceView}=require('./ledger'),{parseAlipayWalletBalanceRows}=require('./alipayWalletStatement'),{planNativeBuyerCreditFees:plan}=require('./nativeBuyerCreditFees');
const BANK='\u5e7f\u53d1\u94f6\u884c',ALIPAY='\u652f\u4ed8\u5b9d';
function fixture(){
 const date='2015-01-31',ref='2015013121001001250084707181',source={id:'order',sourceIdentity:'order',sourceVersionOrdinal:1,sourceTransactionId:ref,financialAccountId:'wallet',provider:'alipay',date,occurredAt:date+'T12:49:59+08:00',currency:'CNY',status:'completed',kind:'expense',direction:'debit',amountMinor:'15840',description:'Hiking poles',counterparty:'Retail seller',category:'Shopping',paymentChannel:BANK,paymentAccountHint:'',relatedReference:'T200P965091360529419',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{'\u4ea4\u6613\u65f6\u95f4':date+' 12:49:59','\u6536/\u652f':'\u652f\u51fa','\u91d1\u989d':'158.40','\u4ea4\u6613\u8ba2\u5355\u53f7':ref,'\u5546\u54c1\u8bf4\u660e':'Hiking poles','\u6536/\u4ed8\u6b3e\u65b9\u5f0f':BANK,'\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f'}};
 const raw=[['2015013100013000900046354538',date+' 12:50:52','\u6536\u8d39\u4fe1\u7528\u5361\u652f\u4ed8\u670d\u52a1\u8d39[20150131CCTT8R25]','','-1.58','1000.00',ALIPAY,''],[ref,date+' 12:50:52','\u5728\u7ebf\u652f\u4ed8','','-158.40','1001.58',ALIPAY,''],['20150131369221***34',date+' 12:50:52','\u5145\u503c','159.98','','1159.98',BANK,'']],parsed=parseAlipayWalletBalanceRows(raw);assert.deepEqual(parsed.errors,[]);
 return{accounts:[{id:'wallet',label:'Alipay',provider:'alipay',type:'wallet',status:'active',currency:'CNY',historicalCardBindings:{schema:'historical-card-bindings-v1',rules:[{channel:BANK,institution:BANK,type:'credit_card',maskedIdentifier:'9755',financialAccountId:'card',periodStart:'2013-01-01',periodEnd:'2017-12-31',confirmedAt:'2026-10-21T02:44:41Z',confidence:'owner_recalled'}]}},{id:'card',label:'CGB9755',provider:BANK,type:'credit_card',status:'active',currency:'CNY',maskedIdentifier:'9755'}],observations:[source,...parsed.records.map((o,i)=>({...o,id:'cash'+i,sourceIdentity:'cash'+i,sourceVersionOrdinal:1,financialAccountId:'wallet',provider:'alipay',importId:'native'}))],imports:[],annotations:[],links:[],balanceSnapshots:[]};
}
test('buyer service fee is an extra credit-card cost with exact zero-net wallet transit and unchanged originals',()=>{
 const l=fixture(),raw=JSON.stringify(l),v=buildFinanceView(l),order=v.transactions.find(t=>t.id==='order'),fee=v.transactions.find(t=>t.nativeBuyerCreditFee?.role==='buyer_fee');assert(fee);assert.equal(v.transactions.length,2);assert.equal(order.consumptionMinor,'15840');assert.equal(fee.kind,'fee');assert.equal(fee.consumptionMinor,'158');assert.equal(v.currencyTotals.CNY.consumptionMinor,'15998');assert.equal(v.currencyTotals.CNY.incomeMinor,'0');assert.deepEqual(fee.balanceEffects,{card:'-158'});assert.deepEqual(fee.cashEffects,{});assert.deepEqual(order.balanceEffectEvents.wallet.map(e=>e.deltaMinor),['15998','-15840','-158']);assert.equal(order.nativeBuyerCreditFee.bankFundingConfidence,'inferred_unique_native_cash_sequence_and_owner_card_policy');assert.equal(fee.sources[0].amountMinor,'0');assert.equal(fee.sources[0].balanceEvidence.expenseMinor,'158');assert.equal(fee.nativeBuyerCreditFee.reversible,true);assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);assert.equal(v.review.transactionCount,0);assert.equal(JSON.stringify(l),raw);assert.equal(plan(l,v.transactions).length,0);
});
test('account selection allocates fee and consumption to the card while wallet shows only native transit',()=>{
 const l=fixture(),card=buildFinanceView(l,{accountIds:['card']}),wallet=buildFinanceView(l,{accountIds:['wallet']});assert.equal(card.currencyTotals.CNY.consumptionMinor,'15998');assert.equal(wallet.currencyTotals.CNY.consumptionMinor,'0');assert.equal(wallet.currencyTotals.CNY.incomeMinor,'0');assert.equal(wallet.accountStats.wallet.cashInMinor,'0');assert.equal(wallet.accountStats.wallet.cashOutMinor,'0');
});
test('fees require full order identity, original native continuity, a single sponsor and untouched owner evidence',()=>{
 for(const change of[
  l=>delete l.accounts[0].historicalCardBindings,
  l=>l.observations[3].description='\u6536\u8d39\u7ebf\u4e0a\u652f\u4ed8\u670d\u52a1\u8d39\u2014\u2014\u4fe1\u7528\u5361\u5feb\u6377\u652f\u4ed8[2015013100013000900046354538]',
  l=>l.observations[3].rawFields['\u652f\u51fa']='-1.57',
  l=>l.observations[2].relatedReference='2015013121001001250084707182',
  l=>l.observations[1].balanceEvidence.openingBeforeFirstMinor='1',
  l=>l.observations.push({...l.observations[0],id:'rival-order',sourceIdentity:'rival-order'}),
  l=>l.observations.push({...l.observations[1],id:'same-version-conflict'}),
  l=>l.annotations.push({observationId:'cash2',revision:'1',patch:{category:'Owner fee choice'}}),
  l=>l.links.push({type:'distinct',status:'active',observationIds:['order','cash2']}),
  l=>l.links.push({type:'duplicate',status:'deleted',observationIds:['order','cash2']}),
  l=>l.observations.push({...l.observations[0],id:'actual-bank',sourceIdentity:'actual-bank',financialAccountId:'card',provider:'cgb',amountMinor:'15998',bankStatement:{schema:'bank-credit-detail-v1'}})
 ]){const l=fixture();change(l);assert.equal(buildFinanceView(l).transactions.filter(t=>t.nativeBuyerCreditFee?.role==='buyer_fee').length,0,change.toString());}
});
test('undoing the original inference restores the source-only fee state and never changes the source',()=>{
 const l=fixture(),before=JSON.stringify(l.observations);assert.equal(buildFinanceView(l).transactions.length,2);l.links.push({id:'undo',type:'distinct',status:'active',observationIds:['order','cash2']});assert.equal(buildFinanceView(l).transactions.length,1);assert.equal(JSON.stringify(l.observations),before);l.links[0].status='deleted';assert.equal(buildFinanceView(l).transactions.length,2);
});
