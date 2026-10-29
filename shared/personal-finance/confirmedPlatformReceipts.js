'use strict';
const {actualSecond}=require('./mixedPayments');
// A neutral fare withdrawal requires an explicit owner decision: it can also
// refund prepaid fares. Keep the export unchanged and derive the cash receipt.
function confirmedPlatformIncomeReceipt(source,annotation,accounts){
 const p=annotation?.patch,r=source?.rawFields||{},a=accounts.find(a=>a.id===source?.financialAccountId);
 if(!p||p.kind!=='income'||Object.keys(p).some(k=>!['kind','category'].includes(k))||source.provider!=='alipay'||source.status!=='completed'||source.currency!=='CNY'||source.direction!=='neutral'||source.kind!=='transfer'||!/^\d+$/.test(source.amountMinor)||BigInt(source.amountMinor)<=0n||source.description!=='\u54c8\u5570\u8f66\u8d39\u63d0\u73b0'||source.counterparty!=='\u6d59\u6c5f\u7f51\u5546\u94f6\u884c'||source.paymentChannel!=='\u8d26\u6237\u4f59\u989d'||source.paymentAccountHint||source.accountRelations?.length||source.investmentTrade||source.bankStatement||source.statementFlow||a?.provider!=='alipay'||a.type!=='wallet'||a.status!=='active'||a.currency!==source.currency||!actualSecond(source))return null;
 const native=r['\u91d1\u989d'];if(typeof native!=='string'||!/^\d+\.\d{2}$/.test(native)||BigInt(native.replace('.',''))!==BigInt(source.amountMinor)||r['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||r['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||r['\u5546\u54c1\u8bf4\u660e']!==source.description||r['\u4ea4\u6613\u5bf9\u65b9']!==source.counterparty||r['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==source.paymentChannel||!source.sourceTransactionId||r['\u4ea4\u6613\u8ba2\u5355\u53f7']!==source.sourceTransactionId||!source.relatedReference||r['\u5546\u5bb6\u8ba2\u5355\u53f7']!==source.relatedReference)return null;
 return {...source,...p,direction:'credit',automaticClassification:{method:'owner_confirmed_platform_income_receipt',confidence:'owner_confirmed',annotationId:annotation.id,evidenceObservationIds:[source.id],sourceDirection:source.direction,incomeBasis:'earned_fare_withdrawal',cashReceiptMinor:source.amountMinor}};
}
module.exports={confirmedPlatformIncomeReceipt};
