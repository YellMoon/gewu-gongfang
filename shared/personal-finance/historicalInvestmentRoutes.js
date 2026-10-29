'use strict';
const {inferAccountRelations}=require('./accountProducts');
function refreshHistoricalInvestmentRoute(record,accounts){
 const guohua=record.provider==='alipay'&&require('./guohuaInvestment').isGuohuaInvestmentPurchase(record);
 const digitalTransfer=record.provider==='alipay'&&['transfer','expense'].includes(record.kind)&&record.direction==='debit'&&record.description==='\u6570\u5b57\u4eba\u6c11\u5e01\u8f6c\u8d26';
 const historicalNamedProduct=record.provider==='alipay'&&(record.kind==='transfer'&&/^定期理财(?:赎回)?-(?:建信养老飞月宝|国寿超月宝)$/.test(record.description||'')||record.kind==='debt_payment'&&/^1688增值服务-诚e赊还款-\d{4}年\d{1,2}月账单$/.test(record.description||''));
 if(!guohua&&!digitalTransfer&&!historicalNamedProduct&&(record.provider!=='alipay'||record.kind!=='transfer'||!/^\u5b58\u91d1\u5b9d-(?:\u4e70\u5165|\u5356\u51fa|\u8f6c\u5165|\u8d4e\u56de)|^\u8682\u8681\u8d22\u5bcc-.+-(?:\u4e70\u5165|\u5356\u51fa\u81f3)|^\u6570\u5b57\u4eba\u6c11\u5e01-\u8f6c[\u5165\u51fa]$/.test(record.description||'')))return record;
 const relations=inferAccountRelations(record,'alipay').map(r=>{const matches=accounts.filter(a=>a.status==='active'&&a.currency===record.currency&&a.sourceProduct===r.product);return {...r,...(matches.length===1?{financialAccountId:matches[0].id}:{})};});
 return {...record,...(guohua?{kind:'transfer'}:{}),accountRelations:relations,automaticClassification:{method:'explicit_historical_investment_route',confidence:'explicit_platform_purpose',evidenceObservationIds:[record.id]}};
}
module.exports={refreshHistoricalInvestmentRoute};
