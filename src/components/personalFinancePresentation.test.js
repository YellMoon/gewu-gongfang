'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {statisticsState,trendGranularity,boundedObservationOptions,accountLabel,evidenceLabel}=require('./personalFinancePresentation');
const tx=(patch={})=>({status:'completed',kind:'expense',amountMinor:'10000',incomeMinor:'0',consumptionMinor:'0',sources:[],...patch});

test('zero-valued investment evidence remains a confirmation instead of a zero cash transaction',()=>{
 const t=tx({amountMinor:'0',investmentConfirmations:[{id:'confirmation'}]}),before=JSON.stringify(t);
 assert.equal(statisticsState(t).key,'neutral');
 assert.equal(statisticsState(t).label,'\u786e\u8ba4\u51ed\u8bc1');
 assert.equal(statisticsState({...t,consumptionMinor:'123'}).key,'counted');
 assert.equal(JSON.stringify(t),before);
});
test('zero statistics have distinct explanations without changing original money',()=>{
 const original=tx({amountMinor:'0',sources:[{paymentChannel:'\u5355\u8f66\u9a91\u884c\u5361\u62b5\u6263'}]});
 assert.deepEqual(statisticsState(original),{key:'zero',label:'\u539f\u8d26\u5355\u96f6\u91d1\u989d',detail:'\u539f\u4ed8\u6b3e\u65b9\u5f0f\uff1a\u5355\u8f66\u9a91\u884c\u5361\u62b5\u6263'});
 assert.equal(original.amountMinor,'0');
 assert.equal(statisticsState(tx({kind:'transfer'})).key,'neutral');
 assert.equal(statisticsState(tx({kind:'transfer'}),['withdrawal_net_fee_unknown']).key,'review');
 assert.ok(statisticsState(tx({kind:'transfer'}),['withdrawal_net_fee_unknown']).detail.includes('\u672a\u63a8\u7b97\u624b\u7eed\u8d39'));
 assert.equal(statisticsState(tx({kind:'unknown'})).key,'review');
 assert.equal(statisticsState(tx({kind:'unknown',bankStatement:{nonCash:true}})).key,'neutral');
 assert.equal(statisticsState(tx({kind:'debt_payment'}),['unsplit_debt_payment']).label,'\u672c\u606f\u5f85\u62c6\u5206');
 assert.equal(statisticsState(tx({statisticsExclusions:[{}]})).label,'\u7591\u4f3c\u91cd\u590d\uff0c\u5f85\u6838\u5bf9');
 assert.equal(statisticsState(tx({status:'failed'})).key,'incomplete');
 assert.equal(statisticsState(tx({consumptionMinor:'-300'})).label,'\u9000\u6b3e\u51b2\u51cf\u652f\u51fa');
 assert.equal(statisticsState(tx({consumptionMinor:'500',selectedConsumptionMinor:'0',selectedIncomeMinor:'0',reportingAccountIds:['outside']})).key,'outside');
});
test('explicit successful authorizations explain noncash amounts without masking unresolved payments',()=>{
 const opening=tx({provider:'psbc',status:'completed',kind:'unknown',direction:'neutral',amountMinor:'0',balanceMinor:'0',description:'\u73b0\u91d1\u5f00\u5361',statementFlow:{schema:'psbc-debit-v1'}});
 assert.equal(statisticsState(opening).label,'\u94f6\u884c\u5f00\u6237\u8bb0\u5f55');
 assert.equal(statisticsState({...opening,amountMinor:'100'}).key,'review');
 const authorization=tx({provider:'alipay',kind:'unknown',direction:'neutral',rawFields:{'\u4ea4\u6613\u72b6\u6001':'\u51bb\u7ed3\u6210\u529f'}});
 assert.equal(statisticsState(authorization).key,'neutral');
 assert.equal(statisticsState(authorization).label,'\u51bb\u7ed3\u6216\u89e3\u51bb\u8bb0\u5f55');
 assert.equal(authorization.amountMinor,'10000');
 assert.equal(statisticsState({...authorization,direction:'debit'}).key,'review');
 assert.equal(statisticsState({...authorization,rawFields:{}}).key,'review');
 assert.equal(statisticsState({...authorization,status:'pending'}).key,'incomplete');
 assert.equal(statisticsState({...authorization,amountMinor:'0'}).key,'zero');
});

test('short periods use daily buckets; long periods are explicit and currency evidence retains scope',()=>{
 assert.equal(trendGranularity('2026-10-01','2026-10-20'),'day');
 assert.equal(trendGranularity('2026-01-01','2026-04-01'),'week');
 assert.equal(trendGranularity('2023-01-01','2026-10-20'),'month');
 assert.equal(trendGranularity('2023-01-01','2026-10-20','day'),'day');
 assert.equal(evidenceLabel({balanceKind:'billed_debt'}),'\u5df2\u51fa\u8d26\u5e94\u8fd8\u6b3e\uff08\u4e0d\u542b\u672a\u51fa\u8d26\uff09');
 assert.equal(accountLabel({type:'wallet',label:'\u5fae\u4fe1\u652f\u4ed8'}),'\u5fae\u4fe1\u96f6\u94b1');
});

test('unverified mortgage references and total prepayments remain explicitly unresolved',()=>{
 const reference=tx({kind:'debt_payment',mortgageSplit:{confidence:'estimated_reference',interestMinor:'464473'}});
 const state=statisticsState(reference,['mortgage_recent_reference_unverified']);
 assert.equal(state.key,'review');
 assert.equal(state.label,'\u8fd1\u671f\u672c\u606f\u53c2\u8003\u8bd5\u7b97');
 assert.ok(state.detail.includes('\u672a\u8ba1\u5165\u5df2\u786e\u8ba4'));
 const prepayment=tx({kind:'debt_payment',amountMinor:'100000000'});
 assert.equal(statisticsState(prepayment,['mortgage_prepayment_split_unknown']).label,'\u63d0\u524d\u8fd8\u6b3e\u672c\u606f\u5f85\u62c6');
 assert.equal(prepayment.amountMinor,'100000000');
 assert.equal(statisticsState({...reference,mortgageSplit:{confidence:'estimated'}}).key,'neutral');
});
test('large original ledgers offer bounded searchable candidates and retain selected items',()=>{
 const originals=Array.from({length:15000},(_,i)=>({id:'o'+i,description:'merchant '+i,date:'2026-10-01'}));
 const initial=boundedObservationOptions(originals,'',['o14999']);
 assert.ok(initial.length<=42);assert.ok(initial.some(o=>o.id==='o14999'));
 const match=boundedObservationOptions(originals,'merchant 14999');
 assert.equal(match.length,1);assert.equal(match[0].id,'o14999');
 assert.equal(originals.length,15000);
});

test('batch bank evidence explains its zero consumption without being marked unresolved',()=>{
 const state=statisticsState({status:'completed',amountMinor:'690',consumptionMinor:'0',incomeMinor:'0',reconciliationGroup:{role:'bank_evidence'}});
 assert.equal(state.key,'neutral');assert.ok(state.detail.includes('\u7ec4\u5185\u5355\u7b14\u5bf9\u5e94\u5173\u7cfb\u672a\u786e\u5b9a'));
});

test('legacy WeChat refunds disclose the missing settlement without calling them completed or failed',()=>{
 const s=statisticsState({provider:'wechat',status:'pending',rawFields:{'\u5f53\u524d\u72b6\u6001':'\u5df2\u8f6c\u5165\u9000\u6b3e'}});assert.equal(s.key,'review');assert.ok(s.detail.includes('\u5c1a\u7f3a\u9000\u6b3e\u5230\u8d26\u51ed\u8bc1'));
});


test('a completed fully refunded transfer uses ledger review evidence rather than an isolated final-state label',()=>{
 const t=tx({provider:'wechat',kind:'transfer',direction:'debit',paymentChannel:'\u96f6\u94b1',rawFields:{'\u5f53\u524d\u72b6\u6001':'\u5df2\u5168\u989d\u9000\u6b3e'}});
 assert.equal(statisticsState(t).key,'neutral');const state=statisticsState(t,['legacy_refund_settlement_unknown']);assert.equal(state.key,'review');assert.equal(state.label,'\u5386\u53f2\u9000\u6b3e\u5f85\u6838\u5b9e');
});

test('known repayment card with an unknown gross receipt explains the remaining uncertainty while keeping cash statistics',()=>{
 const state=statisticsState(tx({kind:'debt_payment'}),['credit_repayment_received_amount_unknown']);assert.equal(state.key,'review');assert.equal(state.label,'\u8fd8\u6b3e\u5230\u8d26\u989d\u4e0e\u4f18\u60e0\u5dee\u989d\u5f85\u6838\u5bf9');assert(state.detail.includes('\u5b9e\u4ed8\u5df2\u8bb0\u5f55'));assert(state.detail.includes('\u6536\u6b3e\u5361\u5df2\u786e\u8ba4'));

});
const {billCategory,compareBillAmount,compareBillTime,largeBillThresholds,isLargeBill}=require('./personalFinancePresentation');
test('bill categories recognize purposes and preserve evidence',()=>{
 for(const [description,category] of [['住房贷款还款','房贷'],['汽车金融还款','车贷'],['物业费','物业费'],['房租','房租'],['停车缴费','停车费'],['支付红包抵扣','支付红包与减免'],['商店购物','日常消费']]){
  const original=tx({description,category:'Food'});
  assert.equal(billCategory(original),category);
  assert.equal(original.category,'Food');
 }
 assert.equal(billCategory(tx({kind:'income'})),'工资与其他收入');
 assert.equal(billCategory(tx({kind:'unknown'})),'其他待分类');
 assert.equal(billCategory(tx({category:'房租',description:'停车费'})),'房租');
});
test('bill comparators retain exact money and order times within a day',()=>{
 assert.equal(compareBillAmount({amountMinor:'9007199254740992'},{amountMinor:'9007199254740993'}),-1);
 assert.equal(compareBillAmount({amountMinor:'-25'},{amountMinor:'24'}),1);
 assert.ok(compareBillTime({id:'a',sources:[{occurredAt:'2026-11-08T09:00:00+08:00'}]},{id:'b',sources:[{occurredAt:'2026-11-08T10:00:00+08:00'}]})<0);
});
test('relative large bills isolate categories and currencies and exclude failed entries',()=>{
 const rows=['100','100','100','100','1000'].map((value,index)=>tx({id:String(index),currency:'CNY',amountMinor:value,consumptionMinor:value}));
 const failed=tx({currency:'CNY',amountMinor:'99999',consumptionMinor:'99999',status:'failed'});
 const thresholds=largeBillThresholds([...rows,failed]);
 assert.equal(isLargeBill(rows[4],thresholds),true);
 assert.equal(isLargeBill(rows[0],thresholds),false);
 assert.equal(isLargeBill(failed,thresholds),false);
 assert.equal(isLargeBill({...rows[4],currency:'USD'},thresholds),false);
 assert.equal(isLargeBill({...rows[4],description:'房租'},thresholds),false);
 assert.equal(isLargeBill({...rows[4],kind:'refund',consumptionMinor:'-1000'},thresholds),false);
 assert.equal(isLargeBill(rows[4],largeBillThresholds(rows.slice(1))),false);
 assert.equal(isLargeBill({...rows[4],selectedConsumptionMinor:'0'},thresholds),false);
 assert.equal(isLargeBill(rows[0],largeBillThresholds(rows.map(r=>({...r,consumptionMinor:'100'})))),false);
});
