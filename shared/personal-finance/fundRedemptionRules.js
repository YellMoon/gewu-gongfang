'use strict';
// Official C-class schedule, checked against the 2026-05-29 prospectus,
// physical PDF pages 77-82 and the manager's rate page. These rates alone
// do not prove a holding period or a target fund's subscription fee.
const C_GLOBAL_TECH={fundCode:'024239',shareClass:'C',currency:'CNY',publishedAt:'2026-05-29',verifiedThrough:'2026-10-24',possibleRatePpm:[0,5000,15000],source:{url:'https://www.chinaamc.com/upload/resources/file/2026/05/29/928e507e97ae4998986f27e068688a4f.pdf',sha256:'a18b2938095dd463c20bb58166e14f98a60bcf33acbbb4c81ea922c2566d20a5',pages:[77,78,81,82]}};
const S=1000000000000n,decimal=s=>{if(typeof s!=='string'||!/^(0|[1-9]\d{0,14})(\.\d{1,12})?$/.test(s))throw Error('FUND_CONVERSION_DECIMAL_INVALID');const[a,b='']=s.split('.');return BigInt(a)*S+BigInt(b.padEnd(12,'0'));},round=(n,d)=>(n+d/2n)/d;
function inferConversionRedemption(c,series){
 const rule=C_GLOBAL_TECH;
 if(c.sourceFundCode!==rule.fundCode||series?.fundCode!==rule.fundCode||series.currency!==rule.currency||!c.appliedUnits||!/^\d+\.\d{2}$/.test(c.appliedUnits)||!/^\d+$/.test(c.amountMinor)||BigInt(c.amountMinor)<=0n||!Number.isFinite(Date.parse(c.appliedAt))||!Number.isFinite(Date.parse(c.confirmedAt)))return null;
 const local=new Date(Date.parse(c.appliedAt)+8*3600000).toISOString(),start=local.slice(0,10),end=c.confirmedAt.slice(0,10);
 if(start<rule.publishedAt||end>rule.verifiedThrough||series.periodStart>start||series.periodEnd<end||end<start)return null;
 const matches=[];for(const q of series.quotes){if(q.date<start||q.date>end||q.date===start&&local.slice(11,16)>='15:00')continue;const gross=round(decimal(c.appliedUnits)*decimal(q.unitNav)*100n,S*S);for(const ppm of rule.possibleRatePpm){const fee=round(gross*BigInt(ppm),1000000n);if(gross-fee===BigInt(c.amountMinor))matches.push({date:q.date,unitNav:q.unitNav,grossMinor:String(gross),feeMinor:String(fee),ratePpm:String(ppm)});}}
 if(matches.length!==1)return null;
 return{...matches[0],observationId:c.id,orderId:c.orderId,fundCode:c.sourceFundCode,units:c.appliedUnits,netMinor:c.amountMinor,method:'unique_published_rate_units_cash_nav',confidence:'inferred',holdingPeriodVerified:false,targetSubscriptionFeeKnown:false,sourceRule:rule.source,sourceObservationIds:c.evidenceObservationIds};
}
module.exports={inferConversionRedemption};
