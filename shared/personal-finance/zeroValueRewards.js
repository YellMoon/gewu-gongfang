'use strict';
const {actualSecond}=require('./mixedPayments');
function isZeroValueReward(record){
 const raw=record.rawFields;
 return record.provider==='alipay'&&record.currency==='CNY'&&record.status==='completed'&&record.kind==='transfer'&&record.direction==='neutral'&&record.amountMinor==='0'&&!record.paymentAccountHint&&!record.accountRelations?.length&&!record.investmentTrade&&!record.brokerage
  &&raw&&!Object.hasOwn(raw,'kind')&&record.description==='\u7ea2\u5305\u5956\u52b1\u53d1\u653e'&&raw['\u5546\u54c1\u8bf4\u660e']===record.description&&raw['\u6536/\u652f']==='\u4e0d\u8ba1\u6536\u652f'&&raw['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&/^0(?:\.0{1,2})?$/.test(raw['\u91d1\u989d']||'')
  &&record.paymentChannel==='\u57fa\u91d1\u4efd\u989d\u7ea2\u5305'&&raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===record.paymentChannel&&record.category==='\u6295\u8d44\u7406\u8d22'&&raw['\u4ea4\u6613\u5206\u7c7b']===record.category&&raw['\u4ea4\u6613\u5bf9\u65b9']===record.counterparty&&/\u57fa\u91d1\u7ba1\u7406(?:\u6709\u9650|\u6709\u9650\u8d23\u4efb|\u80a1\u4efd\u6709\u9650)\u516c\u53f8$/.test(record.counterparty||'')
  &&/^\d{24,40}$/.test(record.sourceTransactionId||'')&&record.sourceTransactionId.startsWith(record.date.replace(/-/g,''))&&raw['\u4ea4\u6613\u8ba2\u5355\u53f7']===record.sourceTransactionId&&/^\d{20,40}-121$/.test(record.relatedReference||'')&&raw['\u5546\u5bb6\u8ba2\u5355\u53f7']===record.relatedReference&&actualSecond(record)
  &&!raw['\u5907\u6ce8']&&!['\u4efd\u989d','\u57fa\u91d1\u4efd\u989d','\u786e\u8ba4\u4efd\u989d','\u6570\u91cf','\u5355\u4f4d\u51c0\u503c','\u786e\u8ba4\u91d1\u989d'].some(k=>Object.hasOwn(raw,k));
}
function refreshZeroValueReward(record){
 if(!isZeroValueReward(record)||record.automaticClassification&&record.automaticClassification.method!=='native_zero_value_reward')return record;
 return {...record,automaticClassification:{method:'native_zero_value_reward',confidence:'explicit_original_zero_amount',evidenceObservationIds:[record.id],scope:'zero_amount_source_event',cashMovementRequired:false,fundUnitsInferred:false}};
}
module.exports={isZeroValueReward,refreshZeroValueReward};
