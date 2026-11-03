'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {marketValueMinor,closingCutoff,parseEastmoney,parseTencent,valueRegister,createSecurityMarketDataService}=require('./securityMarketDataService');
const response=(code='513180',date='2026-11-03',price='0.481')=>({rc:0,data:{code,market:1,name:'ETF',klines:[`${date},0.480,${price},0.490,0.470,100`]}});
const register={financialAccountId:'broker',positions:[{securityCode:'513180',units:'653900',costMinor:'48129112'}],cashBalanceComplete:true,cashBalanceMinor:'1079',cashBalanceAsOf:'2026-10-20',historyCoverage:{periodEnd:'2026-10-20'}};
const projection=()=>({status:'ready',revision:'3890',view:{securities:[structuredClone(register)],balanceGroups:[{key:'securities',accountIds:['broker'],currency:'CNY',knownCount:0,unknownCount:1}],currencyTotals:{CNY:{incomeMinor:'12',consumptionMinor:'34'}}}});
test('exact decimal valuation preserves ETF precision and rounds only the final minor unit',()=>{
 assert.equal(marketValueMinor('653900','0.481'),'31452590');assert.equal(marketValueMinor('1.234567890123','1.234567890123'),'152');assert.equal(marketValueMinor('0.1','0.05'),'1');assert.throws(()=>marketValueMinor('-1','1'));
 const valued=valueRegister(register,new Map([['513180',{closePrice:'0.481',date:'2026-11-03',provider:'eastmoney'}]]));assert.equal(valued.portfolioValueMinor,'31453669');assert.equal(valued.unrealizedGainMinor,'-16676522');assert.equal(valued.holdingsAsOf,'2026-10-20');assert.equal(register.positions[0].marketValueMinor,undefined);
});
test('partial, unknown or pending holdings never publish an incomplete account total',()=>{
 for(const position of [{...register.positions[0],units:null},{...register.positions[0],pendingAllocation:true},{...register.positions[0],securityCode:'513330'}])assert.equal(valueRegister({...register,positions:[position]},new Map([['513180',{closePrice:'0.481',date:'2026-11-03'}]])).portfolioValueMinor,null);
 assert.equal(valueRegister({...register,cashBalanceComplete:false},new Map([['513180',{closePrice:'0.481',date:'2026-11-03'}]])).portfolioValueMinor,null);
});
test('intraday bars are excluded until the exchange close is safely available, including weekends',()=>{
 assert.equal(closingCutoff(new Date('2026-11-04T06:59:00Z')),'2026-11-03');assert.equal(closingCutoff(new Date('2026-11-04T08:01:00Z')),'2026-11-04');
 const data=response();data.data.klines.push('2026-11-04,0.5,0.999,1,0.4,100');assert.equal(parseEastmoney(data,'513180','2026-11-03').closePrice,'0.481');assert.equal(parseEastmoney(data,'513180','2026-11-07').date,'2026-11-04');
 assert.throws(()=>parseEastmoney(response('513330'),'513180','2026-11-03'));assert.throws(()=>parseEastmoney(response('513180','2026-02-30'),'513180','2026-11-03'));assert.throws(()=>parseEastmoney(response('513180','2026-11-03','0'),'513180','2026-11-03'));
 assert.throws(()=>parseTencent({code:0,data:{sh513180:{day:[['2026-11-03','1','1']],qt:{sh513180:['1','ETF','513330']}}}},'513180','2026-11-03'));
});
test('persisted public quotes and inflight requests are reused without reading or changing business originals',async()=>{
 let fetches=0,writes=0;const query=async(sql)=>{assert(!/personal_finance_observations|personal_finance_annotations/.test(sql));if(sql.startsWith('INSERT'))writes++;return{rows:[]};};
 const service=createSecurityMarketDataService({query,now:()=>new Date('2026-11-03T18:00:00Z'),fetchImpl:async url=>{fetches++;assert(url.includes('fqt=0'));return new Response(JSON.stringify(response()));}}),before=projection(),raw=JSON.stringify(before);
 const[first,second]=await Promise.all([service.enrich(before),service.enrich(before)]);assert.equal(fetches,1);assert.equal(writes,1);assert.equal(first.view.securities[0].portfolioValueMinor,'31453669');assert.equal(second.view.balanceGroups[0].knownBalanceMinor,'31453669');assert.equal(JSON.stringify(before),raw);assert.deepEqual(first.view.currencyTotals,before.view.currencyTotals);
 await service.enrich(before);assert.equal(fetches,1);const historical=await service.enrich(before,{endDate:'2025-12-31'});assert.equal(historical.view.balanceGroups[0].knownCount,0);assert.equal(historical.view.balanceGroups[0].unknownCount,1);
});
test('service restarts use fresh persisted quotes; stale quotes survive network failure with explicit stale state',async()=>{
 const row={security_code:'513180',quote_date:'2026-11-03',provider:'eastmoney',close_price:'0.481',security_name:'ETF',source_url:'https://push2his.eastmoney.com/',fetched_at:'2026-11-03T18:00:00Z'};let fetches=0;const options={query:async()=>({rows:[row]}),now:()=>new Date('2026-11-03T18:01:00Z'),fetchImpl:async()=>{fetches++;throw Error('offline');}};
 assert.equal((await createSecurityMarketDataService(options).enrich(projection())).view.securities[0].marketValueMinor,'31452590');assert.equal(fetches,0);
 const stale=await createSecurityMarketDataService({...options,now:()=>new Date('2026-11-04T18:00:00Z')}).enrich(projection());assert.equal(stale.view.securities[0].portfolioValueMinor,'31453669');assert.equal(stale.view.securities[0].valuationStale,true);assert.equal(fetches,2);
});
