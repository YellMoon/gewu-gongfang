'use strict';
const {inferConversionRedemption}=require('./fundRedemptionRules');
const S=1000000000000n,round=(n,d)=>(n+d/2n)/d;
const decimal=s=>{if(typeof s!=='string'||!/^(0|[1-9]\d{0,14})(\.\d{1,12})?$/.test(s))throw Error('FUND_TARGET_DECIMAL_INVALID');const[a,b='']=s.split('.');return BigInt(a)*S+BigInt(b.padEnd(12,'0'));};
const unitsText=n=>String(n/100n)+'.'+String(n%100n).padStart(2,'0');
const CONFIRM_DAY_CONVERSION='\u786e\u8ba4\u65e5\u8f6c\u6362,\u8d4e\u56de\u786e\u8ba4\u4e4b\u540e\u53d1\u8d77\u786e\u8ba4\u91d1\u989d\u7684\u7533\u8d2d\u7684\u8f6c\u6362';
const RULES={
 '023917':{standardSubscriptionRatePpm:10000,source:{url:'https://www.chinaamc.com/upload/resources/file/2025/06/27/'+encodeURIComponent('023917_\u534e\u590f\u56fd\u8bc1\u81ea\u7531\u73b0\u91d1\u6d41\u4ea4\u6613\u578b\u5f00\u653e\u5f0f\u6307\u6570\u8bc1\u5238\u6295\u8d44\u57fa\u91d1\u53d1\u8d77\u5f0f\u8054\u63a5\u57fa\u91d1\u62db\u52df\u8bf4\u660e\u4e66\u66f4\u65b0\uff082025\u5e746\u670830\u65e5\u516c\u544a\uff09.pdf'),sha256:'6dd20e6b1e32a66485743026e6fcde38c435475a3a1c5a40dfe4afbe75c0274d',pages:[58,60]}},
 '002910':{standardSubscriptionRatePpm:15000,source:{url:'https://cdn.efunds.com.cn/owch/data/bulletin/20240731/'+encodeURIComponent('\u6613\u65b9\u8fbe\u4f9b\u7ed9\u6539\u9769\u7075\u6d3b\u914d\u7f6e\u6df7\u5408\u578b\u8bc1\u5238\u6295\u8d44\u57fa\u91d1\u66f4\u65b0\u7684\u62db\u52df\u8bf4\u660e\u4e66.pdf'),sha256:'3eda33e05275006aef764ef634756272537055a7fca249145484d1c946b68b2b',pages:[28,30,32]}}
};
const nextQuote=(series,date,count)=>series.quotes.filter(q=>q.date>date)[count-1];
function validateConversionTargetEstimatePolicy(policy,source){
 if(policy===null)return null;
 const bad=()=>{throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_FUND_CONVERSION_ESTIMATE_POLICY_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_FUND_CONVERSION_ESTIMATE_POLICY_INVALID'});};
 if(!policy||typeof policy!=='object'||Array.isArray(policy)||Object.keys(policy).length!==4||Object.keys(policy).some(k=>!['schema','disabled','orderId','sourceFingerprint'].includes(k))||policy.schema!=='fund-conversion-target-estimate-policy-v1'||policy.disabled!==true||typeof policy.orderId!=='string'||!/^\d{12,80}$/.test(policy.orderId)||typeof policy.sourceFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(policy.sourceFingerprint)||source?.provider!=='alipay'||source.status!=='completed'||source.currency!=='CNY'||source.investmentTrade?.tradeType!=='conversion'||source.investmentTrade.orderId!==policy.orderId||source.recordFingerprint!==policy.sourceFingerprint)bad();
 return policy;
}
function conversionTargetEstimateOverride(c,source,annotations=[]){
 let latest=null;for(const a of annotations)if(a.observationId===c.id&&(!latest||BigInt(a.revision)>BigInt(latest.revision)))latest=a;
 if(!latest||latest.reset===true||latest.patch?.conversionTargetEstimate==null)return null;
 try{validateConversionTargetEstimatePolicy(latest.patch.conversionTargetEstimate,source);if(c.orderId!==latest.patch.conversionTargetEstimate.orderId)throw Error('ORDER_MISMATCH');return{reason:'conversion_target_estimate_disabled',observationId:c.id,orderId:c.orderId,annotationId:latest.id};}
 catch{return{reason:'conversion_target_estimate_override_invalid',observationId:c.id,orderId:c.orderId,annotationId:latest.id};}
}
// These are reversible valuation estimates, never replacement confirmations.
// A nearby actual buy proves its own discounted rate; reusing that discount
// for a conversion remains an exposed assumption, including coupon absence.
function inferConfirmedDayTargetSubscription(c,{sourceRecord,sourceSeries,targetSeries,purchaseMatches=[],purchaseSources=[]}={}){
 try{
  const rule=RULES[c.targetFundCode],trade=sourceRecord?.investmentTrade;
  if(!rule||c.status!=='products_matched'||c.confirmedInUnits!=null||sourceRecord?.provider!=='alipay'||sourceRecord.status!=='completed'||sourceRecord.currency!=='CNY'||sourceRecord.id!==c.id||sourceRecord.occurredAt!==c.appliedAt||trade?.tradeType!=='conversion'||trade.sourceTradeType!==CONFIRM_DAY_CONVERSION||trade.orderId!==c.orderId||trade.appliedAmountMinor!==c.amountMinor||trade.appliedUnits!==c.appliedUnits||sourceRecord.amountMinor!==c.amountMinor||trade.confirmedAt!==c.confirmedAt||trade.confirmedUnits!==null||trade.feeMinor!=='0'||sourceSeries?.fundCode!=='024239'||sourceSeries.currency!=='CNY'||targetSeries?.fundCode!==c.targetFundCode||targetSeries.currency!=='CNY'||sourceSeries.coverageComplete!==true||targetSeries.coverageComplete!==true)return null;
  const appliedDate=c.appliedAt.slice(0,10),confirmedDate=c.confirmedAt.slice(0,10);
  if(appliedDate<'2026-05-29'||confirmedDate>'2026-10-29'||!/^\d+$/.test(c.amountMinor)||BigInt(c.amountMinor)<=0n||BigInt(c.amountMinor)>=100000000n)return null;
  const redemption=inferConversionRedemption(c,sourceSeries);if(!redemption)return null;
  const sourceConfirmed=nextQuote(sourceSeries,redemption.date,2),targetNav=sourceConfirmed&&targetSeries.quotes.find(q=>q.date===sourceConfirmed.date),targetConfirmed=targetNav&&nextQuote(targetSeries,targetNav.date,1);
  if(!targetNav||!targetConfirmed||targetConfirmed.date!==confirmedDate||targetNav.date>targetSeries.periodEnd||redemption.date<targetSeries.periodStart||!targetSeries.quotes.some(q=>q.date===redemption.date))return null;
  const byId=new Map(purchaseSources.map(o=>[o.id,o])),proofs=[];
  for(const match of purchaseMatches){
   const source=byId.get(match.observationId),buy=source?.investmentTrade;
   if(match.status!=='matched'||source?.provider!=='alipay'||source.status!=='completed'||source.financialAccountId!==sourceRecord.financialAccountId||buy?.tradeType!=='buy'||buy.fundCode!==c.targetFundCode||buy.confirmedUnits!==match.units||buy.feeMinor!==match.feeMinor||buy.confirmedAmountMinor!==match.grossMinor||buy.appliedAmountMinor!==match.grossMinor||source.date>appliedDate||Date.parse(appliedDate)-Date.parse(source.date)>31*86400000)continue;
   const gross=BigInt(match.grossMinor),net=BigInt(match.netMinor),fee=BigInt(match.feeMinor),confirmation=nextQuote(targetSeries,match.navDate,1);
   if(gross<=0n||gross>=100000000n||net<=0n||fee<=0n||gross-net!==fee||confirmation?.date!==buy.confirmedAt.slice(0,10))continue;
   const ppm=round(fee*1000000n,net);
   if(ppm<=0n||ppm>BigInt(rule.standardSubscriptionRatePpm)||round(gross*1000000n,1000000n+ppm)!==net)continue;
   if((ppm>1n&&round(gross*1000000n,999999n+ppm)===net)||(ppm<BigInt(rule.standardSubscriptionRatePpm)&&round(gross*1000000n,1000001n+ppm)===net))continue;
   proofs.push({observationId:source.id,orderId:buy.orderId,date:source.date,grossMinor:String(gross),netMinor:String(net),feeMinor:String(fee),ratePpm:String(ppm),recordFingerprint:source.recordFingerprint||null});
  }
  if(!proofs.length||new Set(proofs.map(p=>p.ratePpm)).size!==1)return null;
  const rate=BigInt(proofs[0].ratePpm),gross=BigInt(c.amountMinor),net=round(gross*1000000n,1000000n+rate),fee=gross-net,units=round(net*S,decimal(targetNav.unitNav));
  if(units<=0n)return null;
  return{observationId:c.id,orderId:c.orderId,fundCode:c.targetFundCode,sourceFundCode:c.sourceFundCode,cashAvailableDate:redemption.date,sourceConfirmationDate:sourceConfirmed.date,navDate:targetNav.date,confirmedDate,unitNav:targetNav.unitNav,units:unitsText(units),grossMinor:String(gross),netMinor:String(net),feeMinor:String(fee),ratePpm:String(rate),method:'confirm_day_conversion_official_calendar_and_observed_discount',confidence:'inferred',unitsInferred:true,targetSubscriptionFeeKnown:false,requiresVerification:true,sourceRedemption:redemption,targetRule:rule.source,feeEvidence:proofs,assumptions:['normal_source_T_plus_2_and_target_T_plus_1_registration','same_sales_channel_discount_as_nearby_confirmed_buy','no_unreported_subscription_coupon'],sourceObservationIds:[...new Set([...c.evidenceObservationIds,...proofs.map(p=>p.observationId)])],reversible:true,actualConfirmationSupersedesInference:true,noAdditionalBankOrWalletPosting:true};
 }catch{return null;}
}
module.exports={inferConfirmedDayTargetSubscription,validateConversionTargetEstimatePolicy,conversionTargetEstimateOverride};
