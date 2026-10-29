'use strict';
const {latestInvestmentConfirmations}=require('./investmentTrades');
const {buildAssetRegister}=require('./assetRegister');
const {inferConversionRedemption}=require('./fundRedemptionRules');
const {inferConfirmedDayTargetSubscription,conversionTargetEstimateOverride}=require('./fundTargetConversions');
const SCALE=1000000000000n,DECIMAL=/^(0|[1-9]\d{0,14})(\.\d{1,12})?$/;
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const decimal=s=>{if(typeof s!=='string'||!DECIMAL.test(s))throw Error('FUND_DECIMAL_INVALID');const[a,b='']=s.split('.');return BigInt(a)*SCALE+BigInt(b.padEnd(12,'0'));};
const text=n=>{const sign=n<0n?'-':'';if(n<0n)n=-n;return sign+String(n/SCALE)+(n%SCALE?'.'+String(n%SCALE).padStart(12,'0').replace(/0+$/,''):'');};
const rounded=(n,d)=>n<0n?-((-n+d/2n)/d):(n+d/2n)/d;
const value=(units,nav)=>rounded(units*nav*100n,SCALE*SCALE);
const OFFICIAL_HOSTS=new Set(['api.efunds.com.cn','www.efunds.com.cn','www.ctfund.com','www.chinaamc.com','www.jsfund.cn','www.gffunds.com.cn','m.ccbfund.cn']);
function investmentHoldingAccount(observation,accounts){
 const owner=accounts.get(observation.financialAccountId);
 if(owner?.type==='investment')return owner;
 const ids=[...new Set((observation.accountRelations||[]).filter(r=>r.role==='target'&&r.product==='alipay_funds'&&r.activity==='investment_confirmation').map(r=>r.financialAccountId))];
 if(ids.length!==1)return null;const target=accounts.get(ids[0]);return target?.type==='investment'&&target.currency===observation.currency&&target.sourceProduct==='alipay_funds'?target:null;
}
function validateFundNavSeries(s){
 const bad=()=>{throw Error('FUND_NAV_SERIES_INVALID');};
 if(!s||s.schema!=='fund-nav-series-v1'||!/^\d{6}$/.test(s.fundCode)||s.currency!=='CNY'||typeof s.fundName!=='string'||!s.fundName||!date(s.periodStart)||!date(s.periodEnd)||s.periodStart>s.periodEnd||!Array.isArray(s.quotes)||s.quotes.length>10000||!s.quotes.length||!Array.isArray(s.sourceDocuments)||!s.sourceDocuments.length||s.sourceDocuments.length>32||s.coverageComplete!==true)bad();
 for(const d of s.sourceDocuments){let u;try{u=new URL(d.url);}catch{bad();}if(u.protocol!=='https:'||!OFFICIAL_HOSTS.has(u.hostname)||u.username||u.password||u.port||!/^[a-f0-9]{64}$/.test(d.sha256)||typeof d.fetchedAt!=='string'||!Number.isFinite(Date.parse(d.fetchedAt)))bad();}
 let previous=null;for(const q of s.quotes){if(!date(q.date)||q.date<s.periodStart||q.date>s.periodEnd||previous&&previous>=q.date)bad();try{if(decimal(q.unitNav)<=0n||decimal(q.accumulatedNav)<decimal(q.unitNav))bad();}catch{bad();}previous=q.date;}
 return s;
}
function matchPurchaseNav(observation,series){
 const t=observation.investmentTrade;validateFundNavSeries(series);
 if(!t||t.tradeType!=='buy'||t.fundCode!==series.fundCode||observation.currency!==series.currency||!date(observation.date)||observation.date>t.confirmedAt.slice(0,10)||t.confirmedAmountMinor!==t.appliedAmountMinor||!/^[0-9]+\.[0-9]{2}$/.test(t.confirmedUnits))return{status:'unsupported_confirmation',candidates:[]};
 const net=BigInt(t.confirmedAmountMinor)-BigInt(t.feeMinor);if(net<=0n)return{status:'invalid_net_amount',candidates:[]};
 if(series.periodStart>observation.date||series.periodEnd<t.confirmedAt.slice(0,10))return{status:'incomplete_nav_window',candidates:[]};
 const candidates=series.quotes.filter(q=>q.date>=observation.date&&q.date<=t.confirmedAt.slice(0,10)&&rounded(net*SCALE,decimal(q.unitNav))===decimal(t.confirmedUnits)/(SCALE/100n));
 return{status:candidates.length===1?'matched':candidates.length?'ambiguous_nav_date':'nav_units_mismatch',candidates:candidates.map(q=>({date:q.date,unitNav:q.unitNav})),...(candidates.length===1?{navDate:candidates[0].date,unitNav:candidates[0].unitNav,units:t.confirmedUnits,grossMinor:t.confirmedAmountMinor,netMinor:String(net),feeMinor:t.feeMinor,method:'unique_net_amount_confirmed_units_official_nav',observationId:observation.id,orderId:t.orderId,appliedAt:observation.occurredAt,confirmedAt:t.confirmedAt,sourceDocuments:series.sourceDocuments}: {})};
}
// This register values confirmed trade cohorts. It never posts another bank
// debit or treats market movements as cash income. Incomplete conversions or
// distributions stop the affected series instead of fabricating positions.
function buildFundValuations(ledger,{marketData=ledger.investmentMarketData,assetRegister,asOf}={}){
 const groups=new Map(),accounts=new Map((ledger.accounts||[]).map(a=>[a.id,a]));
 for(const o of latestInvestmentConfirmations(ledger.observations||[])){
  const t=o.investmentTrade,a=investmentHoldingAccount(o,accounts),cutoff=a?.investmentIncomePolicy?.dailyAcquisitionsFrom;
  if(t.tradeType!=='buy'||!cutoff||o.date<cutoff)continue;
  const key=JSON.stringify([a.id,t.fundCode,o.currency]);if(!groups.has(key))groups.set(key,{financialAccountId:a.id,sourceFinancialAccountIds:new Set(),fundCode:t.fundCode,fundName:t.fundName,currency:o.currency,buys:[]});groups.get(key).sourceFinancialAccountIds.add(o.financialAccountId);groups.get(key).buys.push(o);
 }
 if(!groups.size)return[];
 const conversions=(assetRegister||buildAssetRegister(ledger)).conversions,seriesByCode=new Map(),invalidCodes=new Set(),sourceAccounts=new Map((ledger.observations||[]).map(o=>[o.id,o.financialAccountId])),sourceRecords=new Map((ledger.observations||[]).map(o=>[o.id,o]));
 for(const s of marketData?.series||[]){try{validateFundNavSeries(s);if(seriesByCode.has(s.fundCode))invalidCodes.add(s.fundCode);else seriesByCode.set(s.fundCode,s);}catch{if(s?.fundCode)invalidCodes.add(s.fundCode);}}
 return [...groups.values()].map(g=>{
  const issues=[],series=seriesByCode.get(g.fundCode),matches=[],redemptions=[],targetSubscriptions=[];
  if(!series||invalidCodes.has(g.fundCode))issues.push({reason:invalidCodes.has(g.fundCode)?'invalid_nav_evidence':'official_nav_unavailable'});
  if(series&&!invalidCodes.has(g.fundCode))for(const o of g.buys){const m=matchPurchaseNav(o,series);matches.push(m);if(m.status!=='matched')issues.push({reason:m.status,observationId:o.id,candidates:m.candidates});}
  const cutoff=asOf?String(asOf).slice(0,10):series?.periodEnd;
  if(asOf&&!date(cutoff))throw Error('FUND_VALUATION_ASOF_INVALID');
  const relatedConversions=conversions.filter(c=>(!cutoff||c.appliedAt.slice(0,10)<=cutoff)&&c.evidenceObservationIds.some(id=>g.sourceFinancialAccountIds.has(sourceAccounts.get(id)))&&(c.sourceFundCode===g.fundCode||c.targetFundCode===g.fundCode));
  let stopAt=null;for(const c of relatedConversions){const redemption=series&&!invalidCodes.has(g.fundCode)&&c.sourceFundCode===g.fundCode?inferConversionRedemption(c,series):null;if(redemption){redemptions.push(redemption);continue;}const override=c.targetFundCode===g.fundCode?conversionTargetEstimateOverride(c,sourceRecords.get(c.id),ledger.annotations||[]):null;const target=!override&&series&&!invalidCodes.has(g.fundCode)&&!invalidCodes.has(c.sourceFundCode)&&c.targetFundCode===g.fundCode?inferConfirmedDayTargetSubscription(c,{sourceRecord:sourceRecords.get(c.id),sourceSeries:seriesByCode.get(c.sourceFundCode),targetSeries:series,purchaseMatches:matches,purchaseSources:g.buys}):null;if(target){targetSubscriptions.push(target);continue;}const sourceRedemption=override&&!invalidCodes.has(c.sourceFundCode)&&seriesByCode.has(c.sourceFundCode)?inferConversionRedemption(c,seriesByCode.get(c.sourceFundCode)):null,d=sourceRedemption?.date||c.appliedAt.slice(0,10);if(!stopAt||d<stopAt)stopAt=d;issues.push(override||{reason:'conversion_nav_units_pending',observationId:c.id,orderId:c.orderId,sourceFundCode:c.sourceFundCode,targetFundCode:c.targetFundCode});}
  const daily=[],matched=matches.filter(m=>m.status==='matched').sort((a,b)=>a.navDate.localeCompare(b.navDate)||a.observationId.localeCompare(b.observationId));
  if(series&&matched.length===g.buys.length&&!invalidCodes.has(g.fundCode)){
   let held=0n,gross=0n,fees=0n,netRedeemed=0n,lastValue=0n,lastDate=null,lastDistribution=null;
   for(const q of series.quotes){
    if(q.date<matched[0].navDate||q.date>cutoff||stopAt&&q.date>=stopAt)continue;
    const distribution=decimal(q.accumulatedNav)-decimal(q.unitNav);
    if(lastDistribution!==null&&lastDistribution!==distribution){issues.push({reason:'fund_distribution_or_split_requires_units',date:q.date});break;}
    lastDistribution=distribution;
    const buys=matched.filter(m=>m.navDate===q.date),sales=redemptions.filter(r=>r.date===q.date),converted=targetSubscriptions.filter(s=>s.navDate===q.date),transferred=targetSubscriptions.filter(s=>s.cashAvailableDate===q.date),pending=targetSubscriptions.filter(s=>s.cashAvailableDate<=q.date&&s.navDate>q.date),activeEstimates=targetSubscriptions.filter(s=>s.cashAvailableDate<=q.date),added=[...buys,...converted].reduce((n,m)=>n+decimal(m.units),0n),removed=sales.reduce((n,m)=>n+decimal(m.units),0n),paid=[...buys,...transferred].reduce((n,m)=>n+BigInt(m.grossMinor),0n),received=sales.reduce((n,m)=>n+BigInt(m.netMinor),0n),fee=[...buys,...converted,...sales].reduce((n,m)=>n+BigInt(m.feeMinor),0n),pendingMinor=pending.reduce((n,m)=>n+BigInt(m.grossMinor),0n);
    if(held+added<removed){issues.push({reason:'conversion_units_exceed_confirmed_holdings',date:q.date});break;}
    held+=added-removed;gross+=paid;fees+=fee;netRedeemed+=received;const balance=value(held,decimal(q.unitNav))+pendingMinor,netGain=balance-lastValue-paid+received;
    daily.push({date:q.date,previousNavDate:lastDate,unitNav:q.unitNav,units:text(held),balanceMinor:String(balance),grossContributionMinor:String(paid),...(sales.length?{netRedemptionMinor:String(received),redemptionInferenceIds:sales.map(m=>m.observationId)}:{}),feeMinor:String(fee),navReturnMinor:String(netGain+fee),netReturnMinor:String(netGain),cumulativeNetReturnMinor:String(balance+netRedeemed-gross),cumulativeFeeMinor:String(fees),sourceObservationIds:[...buys,...sales,...transferred,...converted].map(m=>m.observationId),basis:activeEstimates.length?'published_nav_inferred_conversion_units':'published_nav_confirmed_units',...(activeEstimates.length?{valuationEstimated:true,conversionInferenceIds:activeEstimates.map(m=>m.observationId),pendingConversionCashMinor:String(pendingMinor),requiresVerification:true}:{}),dailyCashIncomePosted:false});lastValue=balance;lastDate=q.date;
    if(held===0n&&!pendingMinor&&!matched.some(m=>m.navDate>q.date)&&!redemptions.some(r=>r.date>q.date)&&!targetSubscriptions.some(r=>r.cashAvailableDate>q.date||r.navDate>q.date))break;
   }
  }
  const last=daily.at(-1),complete=issues.length===0&&Boolean(last);
  return{financialAccountId:g.financialAccountId,fundCode:g.fundCode,fundName:g.fundName,currency:g.currency,scope:targetSubscriptions.length?'inferred_conversion_trade_cohort':'confirmed_trade_cohort',complete,portfolioCoverageConfirmed:false,sourceObservationIds:g.buys.map(o=>o.id),purchaseMatches:matches,...(redemptions.length?{redemptionInferences:redemptions,confidence:'inferred_conversion_redemption'}:{}),...(targetSubscriptions.length?{targetSubscriptionInferences:targetSubscriptions,confidence:'inferred_conversion_target',unitsInferred:true,requiresVerification:true,verificationIssues:targetSubscriptions.map(s=>({reason:'conversion_target_discount_and_registration_estimated',observationId:s.observationId,orderId:s.orderId,assumptions:s.assumptions}))}:{}),sourceDocuments:series?.sourceDocuments||[],daily,latestNavDate:last?.date||null,units:complete?last.units:null,balanceMinor:complete?last.balanceMinor:null,cumulativeNetReturnMinor:complete?last.cumulativeNetReturnMinor:null,issues};
 });
}
module.exports={investmentHoldingAccount,validateFundNavSeries,matchPurchaseNav,buildFundValuations};
