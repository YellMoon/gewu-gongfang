'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildFinanceView}=require('./ledger'),{parseAlipayWalletBalanceRows}=require('./alipayWalletStatement');
const {addCombinedCreditWalletBridges:add}=require('./combinedCreditWalletBridges');
const BANK='\u5e7f\u53d1\u94f6\u884c',ALIPAY='\u652f\u4ed8\u5b9d';
function fixture(){
 const date='2015-04-23',refs=['2015042321001001250203909759','2015042321001001250212789459'];
 const orders=['14068','60'].map((amountMinor,i)=>({id:'order'+i,sourceIdentity:'order'+i,sourceVersionOrdinal:1,sourceTransactionId:refs[i],financialAccountId:'wallet',provider:'alipay',date,occurredAt:date+'T23:49:27+08:00',currency:'CNY',status:'completed',kind:'expense',direction:'debit',amountMinor,description:['Recorder','Shipping insurance'][i],counterparty:'Seller'+i,category:'Shopping',paymentChannel:BANK,paymentAccountHint:'',relatedReference:'T200P10000'+i,principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{'\u4ea4\u6613\u65f6\u95f4':date+' 23:49:27','\u6536/\u652f':'\u652f\u51fa','\u91d1\u989d':i?'0.60':'140.68','\u4ea4\u6613\u8ba2\u5355\u53f7':refs[i],'\u5546\u54c1\u8bf4\u660e':['Recorder','Shipping insurance'][i],'\u6536/\u4ed8\u6b3e\u65b9\u5f0f':BANK,'\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f'}}));
 const raw=[[refs[1],date+' 23:49:56','\u5728\u7ebf\u652f\u4ed8','','-0.60','0.00',ALIPAY,''],[refs[0],date+' 23:49:56','\u5728\u7ebf\u652f\u4ed8','','-140.68','0.60',ALIPAY,''],['20150423736646***43',date+' 23:49:55','\u5145\u503c','141.28','','141.28',BANK,'']],parsed=parseAlipayWalletBalanceRows(raw);assert.deepEqual(parsed.errors,[]);
 return{accounts:[{id:'wallet',label:'Alipay',provider:'alipay',type:'wallet',status:'active',currency:'CNY',historicalCardBindings:{schema:'historical-card-bindings-v1',rules:[{channel:BANK,institution:BANK,type:'credit_card',maskedIdentifier:'9755',financialAccountId:'card',periodStart:'2013-01-01',periodEnd:'2017-12-31',confirmedAt:'2026-10-21T02:44:41Z',confidence:'owner_recalled'}]}},{id:'card',label:'CGB9755',provider:BANK,type:'credit_card',status:'active',currency:'CNY',maskedIdentifier:'9755'}],observations:[...orders,...parsed.records.map((o,i)=>({...o,id:'cash'+i,sourceIdentity:'cash'+i,sourceVersionOrdinal:1,financialAccountId:'wallet',provider:'alipay',importId:'native'}))],imports:[],annotations:[],links:[],balanceSnapshots:[]};
}
test('one original card top-up split across two orders adds transit once without new debt or consumption',()=>{
 const l=fixture(),raw=JSON.stringify(l),v=buildFinanceView(l),t=v.transactions.find(t=>t.id==='order0');
 assert.equal(v.transactions.length,2);assert.equal(v.currencyTotals.CNY.consumptionMinor,'14128');assert.equal(v.currencyTotals.CNY.incomeMinor,'0');assert.equal(v.accountStats.card.cashOutMinor,'0');assert.equal(v.transactions.reduce((n,t)=>n+BigInt(t.balanceEffects.card||0),0n),-14128n);
 assert.equal(t.walletIntermediaryPostings[0].path,'combined_credit_top_up_and_exact_order_payments');assert.deepEqual(t.balanceEffectEvents.wallet.map(e=>e.deltaMinor),['14128','-14068','-60']);assert.equal(v.transactions[1].walletIntermediaryPostings,undefined);
 assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);assert.equal(JSON.stringify(l),raw);assert.equal(add(l,v.transactions,new Map()).size,0);
});
test('selection keeps purchase statistics on the card and native wallet transit has zero net cash',()=>{
 const l=fixture(),wallet=buildFinanceView(l,{accountIds:['wallet']}),card=buildFinanceView(l,{accountIds:['card']});
 assert.equal(wallet.currencyTotals.CNY.consumptionMinor,'0');assert.equal(wallet.currencyTotals.CNY.incomeMinor,'0');assert.equal(wallet.accountStats.wallet.cashInMinor,'0');assert.equal(wallet.accountStats.wallet.cashOutMinor,'0');assert.equal(card.currencyTotals.CNY.consumptionMinor,'14128');
});
test('missing identity, changed original cash, nonunique orders, owner decisions and existing bank debit veto transit',()=>{
 const changes=[
  l=>delete l.accounts[0].historicalCardBindings,
  l=>l.observations[1].occurredAt='2015-04-23T23:49:28+08:00',
  l=>l.observations[3].relatedReference='2015042321001001250203909760',
  l=>l.observations[3].rawFields['\u652f\u51fa']='-140.67',
  l=>l.observations.push({...l.observations[0],id:'rival',sourceIdentity:'rival'}),
  l=>l.observations.push({...l.observations[2],id:'version-conflict'}),
  l=>l.annotations.push({observationId:'order1',revision:'1',patch:{category:'Owner purpose'}}),
  l=>l.annotations.push({observationId:'cash1',revision:'1',patch:{category:'Owner proof choice'}}),
  l=>l.links.push({type:'distinct',status:'active',observationIds:['order0','cash0']}),
  l=>l.links.push({type:'duplicate',status:'deleted',observationIds:['order0','cash0']}),
  l=>l.observations.push({...l.observations[0],id:'bank',sourceIdentity:'bank',financialAccountId:'card',provider:'cgb',amountMinor:'14128',bankStatement:{schema:'bank-credit-detail-v1'}})
 ];
 for(const change of changes){const l=fixture();change(l);const v=buildFinanceView(l);assert(!v.transactions.some(t=>t.walletIntermediaryPostings?.some(p=>p.path==='combined_credit_top_up_and_exact_order_payments')),change.toString());}
});
test('removing an association is reversible and source data are retained',()=>{
 const l=fixture(),raw=JSON.stringify(l.observations);assert.equal(buildFinanceView(l).balanceReconciliation.summary.differenceIntervalCount,0);
 l.links.push({id:'undo',type:'distinct',status:'active',observationIds:['order0','cash0']});assert(buildFinanceView(l).balanceReconciliation.summary.differenceIntervalCount>0);assert.equal(JSON.stringify(l.observations),raw);
 l.links[0].status='deleted';assert.equal(buildFinanceView(l).balanceReconciliation.summary.differenceIntervalCount,0);
});
