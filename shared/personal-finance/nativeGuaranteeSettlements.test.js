'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildFinanceView}=require('./ledger'),{parseAlipayWalletBalanceRows}=require('./alipayWalletStatement');
const helper=require('./nativeGuaranteeSettlements');
function fixture(){
 const parsed=parseAlipayWalletBalanceRows([['BO20140622352336192502','2014-06-22 12:35:04','\u8f6c\u8d26\u4fdd\u8bc1\u91d1\u8f6c\u79fb','','-170.00','830.00','\u652f\u4ed8\u5b9d',''],['BO20140622000000000001','2014-06-22 12:04:14','Prior cash','','-1.00','1000.00','\u652f\u4ed8\u5b9d','']]);
 return{accounts:[{id:'wallet',type:'wallet',provider:'alipay',status:'active',currency:'CNY',openingBalanceMinor:'100000',openingDate:'2014-06-22'},{id:'shop',type:'receivable',provider:'manual',status:'active',currency:'CNY',balanceConvention:'signed',counterpartySettlement:{schema:'counterparty-settlement-v1',counterparty:'Relative'}}],observations:parsed.records.map((o,i)=>({...o,id:'proof'+i,sourceIdentity:'proof'+i,sourceVersionOrdinal:1,financialAccountId:'wallet',provider:'alipay',importId:'native'})),annotations:[{id:'owner',observationId:'proof1',revision:'1',patch:{kind:'transfer',category:'Shop guarantee borne by relative',settlementAccountId:'shop'}}],links:[],imports:[],balanceSnapshots:[]};
}
test('confirmed guarantee bearer offsets shop settlement once, preserving native wallet cash and originals',()=>{
 const l=fixture(),raw=JSON.stringify(l),v=buildFinanceView(l),t=v.transactions.find(t=>t.nativeGuaranteeSettlement);
 assert(t);assert.equal(t.kind,'transfer');assert.equal(t.incomeMinor,'0');assert.equal(t.consumptionMinor,'0');assert.deepEqual(t.balanceEffects,{wallet:'-17000',shop:'17000'});assert.deepEqual(t.cashEffects,{wallet:'-17000'});assert.equal(t.sources[0].amountMinor,'0');assert.equal(t.sources[0].balanceMinor,'83000');assert.equal(t.cashPostingEvidence[0].occurredAt,'2014-06-22T12:35:04+08:00');assert.equal(v.review.pendingTransactionCount,0);assert.equal(v.balanceReconciliation.summary.differenceIntervalCount,0);assert.equal(JSON.stringify(l),raw);
 helper.append(l,v.transactions,new Set(),()=>{throw Error('duplicate cash replay');});assert.equal(v.transactions.filter(t=>t.nativeGuaranteeSettlement).length,1);
});
test('reset restores the unresolved destination without removing the original wallet debit',()=>{
 const l=fixture();l.annotations.push({id:'reset',observationId:'proof1',revision:'2',reset:true,patch:{}});const v=buildFinanceView(l);
 // A reset must restore the original proof planner, not silently erase cash.
 assert.equal(v.transactions.filter(t=>t.nativeGuaranteeSettlement).length,0);
 assert.equal(v.transactions.find(t=>t.id==='proof1')?.balanceEffects.wallet,'-17000');assert.equal(v.review.pendingTransactionCount,1);
});
test('asset register includes the native guarantee in the owner-selected settlement evidence',()=>{
 const l=fixture(),register=require('./assetRegister').buildAssetRegister(l),shop=register.accounts.find(a=>a.id==='shop');assert.equal(shop.evidenceCount,1);assert.equal(shop.firstDate,'2014-06-22');assert.equal(shop.verifiedBalance,null);
});
test('settlement requires an intact unique cash proof and a valid owner-selected settlement account',()=>{
 for(const change of[l=>l.observations[1].balanceMinor='1',l=>l.observations[1].relatedReference='BO20140621352336192502',l=>l.accounts[1].currency='USD',l=>l.accounts[1].status='archived',l=>l.annotations[0].patch.kind='expense',l=>l.annotations[0].patch.feeMinor='0',l=>l.links.push({type:'distinct',observationIds:['proof1','other']})]){const l=fixture();change(l);assert.throws(()=>helper.validateNativeGuaranteeSettlement(l.observations[1],l.annotations[0],l),/NATIVE_GUARANTEE_SETTLEMENT_INVALID/);}
});
