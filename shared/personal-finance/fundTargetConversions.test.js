'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inferConfirmedDayTargetSubscription:infer}=require('./fundTargetConversions');
const {buildFundValuations}=require('./fundValuation');
function fixture(){
 const dates=['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07','2026-08-10','2026-08-11','2026-08-12','2026-08-13'];
 const series=(code,values)=>({schema:'fund-nav-series-v1',fundCode:code,fundName:'Fund '+code,currency:'CNY',periodStart:'2026-08-01',periodEnd:'2026-08-13',coverageComplete:true,sourceDocuments:[{url:'https://www.chinaamc.com/product/nav',sha256:'a'.repeat(64),fetchedAt:'2026-10-29T00:00:00Z'}],quotes:dates.map((date,i)=>({date,unitNav:values[i],accumulatedNav:values[i]}))});
 const sourceSeries=series('024239',['1.1','1.12','1.14','1.16','1.18','1.3','1.31','1.32','1.33']),targetSeries=series('023917',['1','1.1','1.2','1.3','1.4','1.5','1.8','2','2.1']);
 const buy=(id,code,amount,fee,units,confirmedAt)=>({id,provider:'alipay',financialAccountId:'wallet',currency:'CNY',status:'completed',date:'2026-08-03',occurredAt:'2026-08-03T10:00:00+08:00',investmentTrade:{schema:'ant-fund-confirmation-v1',tradeType:'buy',orderId:id==='source_buy'?'202608030000000001':'202608030000000002',fundCode:code,fundName:'Fund '+code,appliedAmountMinor:amount,confirmedAmountMinor:amount,feeMinor:fee,confirmedUnits:units,confirmedAt:confirmedAt+'T00:00:00+08:00'},accountRelations:[{role:'target',product:'alipay_funds',activity:'investment_confirmation',financialAccountId:'funds'}]});
 const sourceBuy=buy('source_buy','024239','11000','0','100.00','2026-08-05'),targetBuy=buy('target_buy','023917','5000000','4995','49950.05','2026-08-04');
 const conversion={id:'conversion',orderId:'202608100000000003',sourceFundCode:'024239',targetFundCode:'023917',appliedAt:'2026-08-10T10:00:00+08:00',confirmedAt:'2026-08-13T00:00:00+08:00',amountMinor:'12935',feeMinor:'0',appliedUnits:'100.00',confirmedInUnits:null,status:'products_matched',evidenceObservationIds:['conversion','platform_conversion']};
 const sourceRecord={id:'conversion',provider:'alipay',financialAccountId:'wallet',currency:'CNY',status:'completed',date:'2026-08-10',occurredAt:conversion.appliedAt,amountMinor:'12935',investmentTrade:{schema:'ant-fund-confirmation-v1',tradeType:'conversion',orderId:conversion.orderId,appliedAmountMinor:'12935',appliedUnits:'100.00',feeMinor:'0',confirmedAt:conversion.confirmedAt,confirmedUnits:null,sourceTradeType:'\u786e\u8ba4\u65e5\u8f6c\u6362,\u8d4e\u56de\u786e\u8ba4\u4e4b\u540e\u53d1\u8d77\u786e\u8ba4\u91d1\u989d\u7684\u7533\u8d2d\u7684\u8f6c\u6362'}};
 const purchaseMatches=[{status:'matched',observationId:'target_buy',units:'49950.05',feeMinor:'4995',grossMinor:'5000000',netMinor:'4995005',navDate:'2026-08-03'}];
 const context={sourceRecord,sourceSeries,targetSeries,purchaseMatches,purchaseSources:[targetBuy]};
 const ledger={accounts:[{id:'wallet',provider:'alipay',type:'wallet',currency:'CNY',status:'active'},{id:'funds',provider:'alipay',sourceProduct:'alipay_funds',type:'investment',currency:'CNY',status:'active',investmentIncomePolicy:{dailyAcquisitionsFrom:'2026-07-01'}}],observations:[sourceBuy,targetBuy,sourceRecord],investmentMarketData:{series:[sourceSeries,targetSeries]}};
 return{conversion,context,ledger,register:{conversions:[conversion]}};
}
test('confirmation-day conversion derives target NAV date from published source T+2 and target T+1, preserving discount assumptions',()=>{
 const f=fixture(),raw=JSON.stringify(f),r=infer(f.conversion,f.context);
 assert.equal(r.cashAvailableDate,'2026-08-10');assert.equal(r.sourceConfirmationDate,'2026-08-12');assert.equal(r.navDate,'2026-08-12');assert.equal(r.confirmedDate,'2026-08-13');assert.equal(r.units,'64.61');assert.equal(r.netMinor,'12922');assert.equal(r.feeMinor,'13');assert.equal(r.ratePpm,'1000');assert.equal(r.confidence,'inferred');assert.equal(r.targetSubscriptionFeeKnown,false);assert.equal(r.requiresVerification,true);assert.equal(r.reversible,true);assert.equal(r.noAdditionalBankOrWalletPosting,true);assert.equal(r.assumptions.length,3);assert.equal(JSON.stringify(f),raw);
});
test('actual target shares, unsupported workflow, wrong owner, mismatched order, absent or zero-fee evidence are never replaced by an estimate',()=>{
 const changes=[f=>f.conversion.confirmedInUnits='64.62',f=>f.context.sourceRecord.investmentTrade.sourceTradeType='ordinary conversion',f=>f.context.purchaseSources[0].financialAccountId='another_owner_wallet',f=>f.context.sourceRecord.investmentTrade.orderId='202608100000000009',f=>f.context.purchaseSources=[],f=>{f.context.purchaseMatches[0].feeMinor='0';f.context.purchaseMatches[0].netMinor='10000';f.context.purchaseSources[0].investmentTrade.feeMinor='0';}];
 for(const change of changes){const f=fixture();change(f);assert.equal(infer(f.conversion,f.context),null);}
});
test('inconsistent observed discounts remain unresolved instead of selecting a convenient rate',()=>{
 const f=fixture(),second=structuredClone(f.context.purchaseSources[0]);second.id='other_buy';second.investmentTrade.orderId='202608030000000005';second.investmentTrade.feeMinor='9980';second.investmentTrade.confirmedUnits='49900.20';f.context.purchaseSources.push(second);f.context.purchaseMatches.push({...f.context.purchaseMatches[0],observationId:second.id,units:'49900.20',feeMinor:'9980',netMinor:'4990020'});assert.equal(infer(f.conversion,f.context),null);
});
test('after-cutoff applications, missing registration days, changed final confirmation date and expired rules remain unresolved',()=>{
 const changes=[f=>f.conversion.appliedAt='2026-08-10T17:00:00+08:00',f=>f.context.sourceSeries.quotes=f.context.sourceSeries.quotes.filter(q=>q.date<='2026-08-11'),f=>{f.conversion.confirmedAt='2026-08-12T00:00:00+08:00';f.context.sourceRecord.investmentTrade.confirmedAt=f.conversion.confirmedAt;},f=>{f.conversion.confirmedAt='2026-10-30T00:00:00+08:00';f.context.sourceRecord.investmentTrade.confirmedAt=f.conversion.confirmedAt;}];
 for(const change of changes){const f=fixture();change(f);assert.equal(infer(f.conversion,f.context),null);}
});
test('estimated target series includes conversion cash in transit and posts the contribution and fee only once without mutating sources',()=>{
 const f=fixture(),raw=JSON.stringify(f),models=buildFundValuations(f.ledger,{assetRegister:f.register}),target=models.find(m=>m.fundCode==='023917');
 assert.equal(target.complete,true);assert.equal(target.scope,'inferred_conversion_trade_cohort');assert.equal(target.requiresVerification,true);assert.equal(target.portfolioCoverageConfirmed,false);assert.equal(target.targetSubscriptionInferences.length,1);assert.equal(target.verificationIssues.length,1);assert.equal(target.units,'50014.66');assert.equal(target.balanceMinor,'10503079');assert.equal(target.cumulativeNetReturnMinor,'5490144');
 const day=date=>target.daily.find(d=>d.date===date);
 assert.equal(day('2026-08-10').pendingConversionCashMinor,'12935');assert.equal(day('2026-08-11').pendingConversionCashMinor,'12935');assert.equal(day('2026-08-10').grossContributionMinor,'12935');assert.equal(day('2026-08-12').pendingConversionCashMinor,'0');assert.equal(day('2026-08-12').grossContributionMinor,'0');assert.equal(day('2026-08-12').feeMinor,'13');assert.equal(day('2026-08-12').basis,'published_nav_inferred_conversion_units');
 assert.equal(target.daily.reduce((n,d)=>n+BigInt(d.grossContributionMinor),0n),5012935n);assert.equal(target.daily.reduce((n,d)=>n+BigInt(d.feeMinor),0n),5008n);assert.equal(target.daily.reduce((n,d)=>n+BigInt(d.netReturnMinor),0n),5490144n);assert(target.daily.every(d=>d.dailyCashIncomePosted===false));assert.equal(JSON.stringify(f),raw);
 const source=models.find(m=>m.fundCode==='024239');assert.equal(source.balanceMinor,'0');assert.equal(source.daily.at(-1).netRedemptionMinor,'12935');
});
test('historical confirmed daily rows remain identical before conversion cash becomes available',()=>{
 const f=fixture(),before=buildFundValuations(f.ledger,{assetRegister:{conversions:[]}}).find(m=>m.fundCode==='023917'),after=buildFundValuations(f.ledger,{assetRegister:f.register}).find(m=>m.fundCode==='023917');
 assert.deepEqual(after.daily.filter(d=>d.date<'2026-08-10'),before.daily.filter(d=>d.date<'2026-08-10'));
});
test('missing fee evidence preserves the original pending conversion and never claims a complete target position',()=>{
 const f=fixture();f.ledger.observations.find(o=>o.id==='target_buy').investmentTrade.feeMinor='0';f.ledger.observations.find(o=>o.id==='target_buy').investmentTrade.confirmedUnits='50000.00';
 const target=buildFundValuations(f.ledger,{assetRegister:f.register}).find(m=>m.fundCode==='023917');assert.equal(target.complete,false);assert.equal(target.units,null);assert.equal(target.balanceMinor,null);assert.equal(target.issues[0].reason,'conversion_nav_units_pending');assert.equal(target.targetSubscriptionInferences,undefined);
});
test('coarse small-buy fee rounding cannot masquerade as a uniquely observed discount rate',()=>{
 const f=fixture(),buy=f.context.purchaseSources[0],match=f.context.purchaseMatches[0];Object.assign(buy.investmentTrade,{appliedAmountMinor:'10000',confirmedAmountMinor:'10000',feeMinor:'10',confirmedUnits:'99.90'});Object.assign(match,{grossMinor:'10000',netMinor:'9990',feeMinor:'10',units:'99.90'});assert.equal(infer(f.conversion,f.context),null);
});
test('currency, original source units, and unpriced target in-transit dates must all be consistent',()=>{
 for(const change of [f=>f.context.sourceRecord.currency='USD',f=>f.context.sourceRecord.investmentTrade.appliedUnits='101.00',f=>f.context.targetSeries.quotes=f.context.targetSeries.quotes.filter(q=>q.date!=='2026-08-10')]){const f=fixture();change(f);assert.equal(infer(f.conversion,f.context),null);}
});
function disabledAnnotation(f,revision='1'){
 const source=f.ledger.observations.find(o=>o.id==='conversion');source.recordFingerprint='c'.repeat(64);
 return{id:'disable_conversion',observationId:source.id,revision,patch:{conversionTargetEstimate:{schema:'fund-conversion-target-estimate-policy-v1',disabled:true,orderId:source.investmentTrade.orderId,sourceFingerprint:source.recordFingerprint}}};
}
test('a source-bound cancellation stops only the target estimate and preserves the original confirmation and source redemption',()=>{
 const f=fixture(),before=buildFundValuations(f.ledger,{assetRegister:f.register});
 f.ledger.annotations=[disabledAnnotation(f)];const raw=JSON.stringify(f.ledger),after=buildFundValuations(f.ledger,{assetRegister:f.register}),target=after.find(m=>m.fundCode==='023917');
 assert.equal(target.complete,false);assert.equal(target.balanceMinor,null);assert.equal(target.targetSubscriptionInferences,undefined);assert.deepEqual(target.issues,[{reason:'conversion_target_estimate_disabled',observationId:'conversion',orderId:f.conversion.orderId,annotationId:'disable_conversion'}]);
 assert(target.daily.every(d=>d.date<'2026-08-10'));assert.deepEqual(after.find(m=>m.fundCode==='024239'),before.find(m=>m.fundCode==='024239'));assert.equal(JSON.stringify(f.ledger),raw);
});
test('numeric latest revision, explicit null and annotation reset restore estimates without erasing unrelated annotations',()=>{
 for(const restore of [{patch:{conversionTargetEstimate:null,category:'User category'}},{patch:{},reset:true}]){
  const f=fixture(),block=disabledAnnotation(f,'9');f.ledger.annotations=[{...block,id:'restore',revision:'10',...restore},block];
  const target=buildFundValuations(f.ledger,{assetRegister:f.register}).find(m=>m.fundCode==='023917');assert.equal(target.complete,true);assert.equal(target.targetSubscriptionInferences.length,1);
 }
 const f=fixture(),block=disabledAnnotation(f,'10');f.ledger.annotations=[block,{...block,id:'older_restore',revision:'9',patch:{conversionTargetEstimate:null}}];assert.equal(buildFundValuations(f.ledger,{assetRegister:f.register}).find(m=>m.fundCode==='023917').issues[0].reason,'conversion_target_estimate_disabled');
});
test('a cancellation on another observation does not disable this conversion and malformed persisted policy stops rather than applying an estimate',()=>{
 const f=fixture(),block=disabledAnnotation(f);block.observationId='unrelated';f.ledger.annotations=[block];assert.equal(buildFundValuations(f.ledger,{assetRegister:f.register}).find(m=>m.fundCode==='023917').complete,true);
 block.observationId='conversion';block.patch.conversionTargetEstimate.sourceFingerprint='d'.repeat(64);const target=buildFundValuations(f.ledger,{assetRegister:f.register}).find(m=>m.fundCode==='023917');assert.equal(target.complete,false);assert.equal(target.issues[0].reason,'conversion_target_estimate_override_invalid');assert.equal(target.targetSubscriptionInferences,undefined);
});
test('revoking an after-cutoff conversion preserves the known valuation on the application day before source cash moves',()=>{
 const f=fixture(),c=f.conversion,o=f.context.sourceRecord;
 c.appliedAt='2026-08-10T17:00:00+08:00';c.confirmedAt='2026-08-14T00:00:00+08:00';c.amountMinor='13034';Object.assign(o,{occurredAt:c.appliedAt,amountMinor:c.amountMinor});Object.assign(o.investmentTrade,{appliedAmountMinor:c.amountMinor,confirmedAt:c.confirmedAt});
 for(const s of f.ledger.investmentMarketData.series){s.periodEnd='2026-08-14';s.quotes.push({date:'2026-08-14',unitNav:s.fundCode==='024239'?'1.34':'2.2',accumulatedNav:s.fundCode==='024239'?'1.34':'2.2'});}
 const before=buildFundValuations(f.ledger,{assetRegister:f.register}),targetBefore=before.find(m=>m.fundCode==='023917');assert.equal(targetBefore.complete,true);assert.equal(targetBefore.targetSubscriptionInferences[0].cashAvailableDate,'2026-08-11');
 f.ledger.annotations=[disabledAnnotation(f)];const after=buildFundValuations(f.ledger,{assetRegister:f.register}),target=after.find(m=>m.fundCode==='023917');assert.equal(target.complete,false);assert.deepEqual(target.daily,targetBefore.daily.filter(d=>d.date<'2026-08-11'));assert.equal(target.daily.at(-1).date,'2026-08-10');assert.deepEqual(after.find(m=>m.fundCode==='024239'),before.find(m=>m.fundCode==='024239'));
});
