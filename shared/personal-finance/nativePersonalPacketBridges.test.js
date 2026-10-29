'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{buildFinanceView}=require('./ledger'),{parseAlipayWalletBalanceRows}=require('./alipayWalletStatement');
function fixture(){
 const date='2015-05-16',ref='20150516200040031100250001241016',title='\u53d1\u4e2a\u4eba\u7ea2\u5305\u2014\u73b0\u91d1',s={id:'packet',sourceIdentity:'packet',sourceVersionOrdinal:1,provider:'alipay',financialAccountId:'wallet',sourceTransactionId:ref,date,occurredAt:date+'T07:11:57+08:00',amountMinor:'50000',currency:'CNY',kind:'transfer',direction:'debit',status:'completed',description:title,counterparty:'Family',paymentChannel:'\u4f59\u989d\u5b9d',paymentAccountHint:'',principalMinor:null,interestMinor:null,feeMinor:null,accountRelations:[{product:'alipay_yuebao',role:'funding',activity:'funding_outflow',financialAccountId:'fund'}],rawFields:{'\u4ea4\u6613\u65f6\u95f4':date+' 07:11:57','\u4ea4\u6613\u8ba2\u5355\u53f7':ref,'\u5546\u54c1\u8bf4\u660e':title,'\u6536/\u652f':'\u652f\u51fa','\u6536/\u4ed8\u6b3e\u65b9\u5f0f':'\u4f59\u989d\u5b9d','\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f','\u91d1\u989d':'500.00'}};
 const parsed=parseAlipayWalletBalanceRows([['20150516200040011100250015374014',date+' 07:12:03','\u53d1\u7ea2\u5305','','-500.00','1000.00','\u652f\u4ed8\u5b9d',''],['20150516000251052500371***30',date+' 07:12:03','\u7406\u8d22\u8d4e\u56de\u8d44\u91d1\u8f6c\u5165\u652f\u4ed8\u5b9d\u8d26\u6237\u4f59\u989d\u5b9d\u652f\u4ed8','500.00','','1500.00','\u5929\u5f18\u57fa\u91d1','']]);assert.deepEqual(parsed.errors,[]);
 return{accounts:[{id:'wallet',label:'Wallet',type:'wallet',provider:'alipay',status:'active',currency:'CNY'},{id:'fund',label:'Yuebao',type:'investment',provider:'alipay',sourceProduct:'alipay_yuebao',status:'active',currency:'CNY'}],observations:[s,...parsed.records.map((o,i)=>({...o,id:'native'+i,sourceIdentity:'native'+i,sourceVersionOrdinal:1,importId:'cash',financialAccountId:'wallet',provider:'alipay'}))],annotations:[],links:[],imports:[],balanceSnapshots:[]};
}
test('different packet business IDs remain disclosed while original fund money and family purpose are preserved',()=>{
 const l=fixture(),raw=JSON.stringify(l),before=buildFinanceView({...l,observations:[l.observations[0]]}),v=buildFinanceView(l),t=v.transactions[0],p=t.walletIntermediaryPostings[0];
 assert.equal(v.transactions.length,1);assert.equal(p.path,'funded_personal_packet_via_wallet');assert.equal(p.personalPacketMatchEvidence.sourceOrderReferenceMatched,false);assert.equal(p.personalPacketMatchEvidence.reciprocalUnique,true);assert.equal(p.personalPacketMatchEvidence.confidence,'owner_authorized_inferred');assert.equal(p.personalPacketMatchEvidence.orderToRedemptionDelaySeconds,6);assert.equal(t.kind,before.transactions[0].kind);assert.equal(t.consumptionMinor,before.transactions[0].consumptionMinor);assert.equal(t.balanceEffects.fund,'-50000');assert.equal(t.cashEffects.fund,'-50000');assert.deepEqual(t.balanceEffectEvents.wallet.map(e=>e.deltaMinor),['50000','-50000']);assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);assert.equal(JSON.stringify(l),raw);
});
test('packet inference requires reciprocal uniqueness, original funded cash and unedited personal packet purpose',()=>{
 for(const change of[
  l=>l.observations.push({...l.observations[0],id:'second-packet',sourceIdentity:'second-packet',sourceTransactionId:'20150516200040031100250001241017'}),
  l=>l.observations.push({...l.observations[1],id:'tied-native'}),
  l=>l.observations[0].description='\u53d1\u7fa4\u7ea2\u5305',
  l=>l.observations[0].occurredAt='2015-05-16T07:00:00+08:00',
  l=>l.observations[0].paymentChannel='\u4f59\u989d',
  l=>l.observations[1].rawFields['\u6536\u5165']='499.99',
  l=>l.annotations.push({observationId:'packet',revision:'1',patch:{kind:'expense',category:'Owner purpose'}}),
  l=>l.annotations.push({observationId:'native0',revision:'1',patch:{category:'Owner cash'}}),
  l=>l.links.push({type:'distinct',status:'active',observationIds:['packet','native1']}),
  l=>l.links.push({type:'duplicate',status:'deleted',observationIds:['packet','native1']})
 ]){const l=fixture();change(l);assert(!buildFinanceView(l).transactions.some(t=>t.walletIntermediaryPostings?.some(p=>p.path==='funded_personal_packet_via_wallet')),change.toString());}
});
test('owner undo restores original source-only state without changing raw records',()=>{
 const l=fixture(),raw=JSON.stringify(l.observations);assert(buildFinanceView(l).transactions[0].walletIntermediaryPostings);l.links.push({id:'undo',type:'distinct',status:'active',observationIds:['packet','native1']});assert.equal(buildFinanceView(l).transactions[0].walletIntermediaryPostings,undefined);assert.equal(JSON.stringify(l.observations),raw);l.links[0].status='deleted';assert(buildFinanceView(l).transactions[0].walletIntermediaryPostings);
});
