'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {statisticsState,trendGranularity,boundedObservationOptions,accountLabel,evidenceLabel}=require('./personalFinancePresentation');
const tx=(patch={})=>({status:'completed',kind:'expense',amountMinor:'10000',incomeMinor:'0',consumptionMinor:'0',sources:[],...patch});
test('zero statistics have distinct explanations without changing original money',()=>{
 const original=tx({amountMinor:'0',sources:[{paymentChannel:'\u5355\u8f66\u9a91\u884c\u5361\u62b5\u6263'}]});
 assert.deepEqual(statisticsState(original),{key:'zero',label:'\u539f\u8d26\u5355\u96f6\u91d1\u989d',detail:'\u539f\u4ed8\u6b3e\u65b9\u5f0f\uff1a\u5355\u8f66\u9a91\u884c\u5361\u62b5\u6263'});
 assert.equal(original.amountMinor,'0');
 assert.equal(statisticsState(tx({kind:'transfer'})).key,'neutral');
 assert.equal(statisticsState(tx({kind:'unknown'})).key,'review');
 assert.equal(statisticsState(tx({kind:'debt_payment'}),['unsplit_debt_payment']).label,'\u672c\u606f\u5f85\u62c6\u5206');
 assert.equal(statisticsState(tx({statisticsExclusions:[{}]})).label,'\u7591\u4f3c\u91cd\u590d\uff0c\u5f85\u6838\u5bf9');
 assert.equal(statisticsState(tx({status:'failed'})).key,'incomplete');
 assert.equal(statisticsState(tx({consumptionMinor:'-300'})).label,'\u9000\u6b3e\u51b2\u51cf\u652f\u51fa');
 assert.equal(statisticsState(tx({consumptionMinor:'500',selectedConsumptionMinor:'0',selectedIncomeMinor:'0',reportingAccountIds:['outside']})).key,'outside');
});
test('short periods use daily buckets; long periods are explicit and currency evidence retains scope',()=>{
 assert.equal(trendGranularity('2026-10-01','2026-10-20'),'day');
 assert.equal(trendGranularity('2026-01-01','2026-04-01'),'week');
 assert.equal(trendGranularity('2023-01-01','2026-10-20'),'month');
 assert.equal(trendGranularity('2023-01-01','2026-10-20','day'),'day');
 assert.equal(evidenceLabel({balanceKind:'billed_debt'}),'\u5df2\u51fa\u8d26\u5e94\u8fd8\u6b3e\uff08\u4e0d\u542b\u672a\u51fa\u8d26\uff09');
 assert.equal(accountLabel({type:'wallet',label:'\u5fae\u4fe1\u652f\u4ed8'}),'\u5fae\u4fe1\u96f6\u94b1');
});
test('large original ledgers offer bounded searchable candidates and retain selected items',()=>{
 const originals=Array.from({length:15000},(_,i)=>({id:'o'+i,description:'merchant '+i,date:'2026-10-01'}));
 const initial=boundedObservationOptions(originals,'',['o14999']);
 assert.ok(initial.length<=42);assert.ok(initial.some(o=>o.id==='o14999'));
 const match=boundedObservationOptions(originals,'merchant 14999');
 assert.equal(match.length,1);assert.equal(match[0].id,'o14999');
 assert.equal(originals.length,15000);
});

