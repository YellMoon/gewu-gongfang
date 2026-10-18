'use strict';
const INTEGER=/^(0|[1-9]\d*)$/;
const UNITS=/^(0|[1-9]\d{0,23})(\.\d{1,12})?$/;
const FIELDS=['schema','orderId','fundCode','fundName','combination','tradeType','sourceTradeType','appliedAmountMinor','appliedUnits','confirmedAmountMinor','confirmedUnits','feeMinor','confirmedAt','sourcePages'];
function validateInvestmentTrade(value,record){
 const bad=()=>{throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_INVESTMENT_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_INVESTMENT_INVALID'});};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!FIELDS.includes(k))||FIELDS.some(k=>!Object.hasOwn(value,k))||value.schema!=='ant-fund-confirmation-v1'||!/^\d{12,80}$/.test(value.orderId)||!['buy','conversion'].includes(value.tradeType)||typeof value.sourceTradeType!=='string'||value.sourceTradeType.length>256)bad();
 if(value.fundCode!==null&&!/^\d{6}$/.test(value.fundCode)||value.fundName!==null&&(typeof value.fundName!=='string'||!value.fundName||value.fundName.length>256)||value.combination!==null&&(typeof value.combination!=='string'||value.combination.length>256))bad();
 for(const key of ['appliedAmountMinor','confirmedAmountMinor','feeMinor'])if(value[key]===null?(value.tradeType==='buy'||key!=='confirmedAmountMinor'):typeof value[key]!=='string'||!INTEGER.test(value[key])||value[key].length>20)bad();
 for(const key of ['appliedUnits','confirmedUnits'])if(value[key]===null?(key==='confirmedUnits'&&value.tradeType==='buy'):typeof value[key]!=='string'||!UNITS.test(value[key]))bad();
 if(value.tradeType==='buy'&&(!value.fundCode||!value.fundName)||typeof value.confirmedAt!=='string'||!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.confirmedAt)||Number.isNaN(Date.parse(value.confirmedAt))||!Array.isArray(value.sourcePages)||value.sourcePages.length!==2||value.sourcePages.some(p=>!Number.isInteger(p)||p<1||p>100)||value.sourcePages[0]>value.sourcePages[1])bad();
 if(record&&(record.feeMinor!==value.feeMinor||record.amountMinor!==value.appliedAmountMinor||record.direction!=='neutral'||record.kind!=='transfer'))bad();
 return value;
}
function latestInvestmentConfirmations(sources){
 const orders=new Map();
 for(const source of sources){if(!source.investmentTrade||source.status!=='completed')continue;const key=JSON.stringify([source.provider,source.investmentTrade.schema,source.investmentTrade.orderId]);const previous=orders.get(key);if(!previous||(source.sourceVersionOrdinal||0)>(previous.sourceVersionOrdinal||0))orders.set(key,source);}
 return [...orders.values()];
}
module.exports={validateInvestmentTrade,latestInvestmentConfirmations};
