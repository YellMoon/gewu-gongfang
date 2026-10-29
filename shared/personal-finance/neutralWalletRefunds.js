'use strict';
const {actualSecond}=require('./mixedPayments');
// The export's non-income/expense label describes economic purpose. A successful
// refund explicitly paid into the account balance is still a cash credit.
function refreshNeutralWalletRefund(record,accounts){
 const a=accounts.find(a=>a.id===record.financialAccountId),raw=record.rawFields||{};
 if(record.provider!=='alipay'||record.kind!=='refund'||record.direction!=='neutral'||record.status!=='completed'||record.currency!=='CNY'||a?.provider!=='alipay'||a.type!=='wallet'||a.status!=='active'||a.currency!==record.currency||record.paymentAccountHint||record.accountRelations?.length||record.statementFlow||record.bankStatement||record.investmentTrade||!actualSecond(record)||!['\u4f59\u989d','\u652f\u4ed8\u5b9d\u4f59\u989d','\u8d26\u6237\u4f59\u989d'].includes(record.paymentChannel)||!/^\u9000\u6b3e-/.test(record.description)||!record.sourceTransactionId)return record;
 const amount=raw['\u91d1\u989d'];
 if(typeof amount!=='string'||!/^\d+\.\d{2}$/.test(amount)||!/^[1-9]\d*$/.test(record.amountMinor)||BigInt(amount.replace('.',''))!==BigInt(record.amountMinor)||raw['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||raw['\u4ea4\u6613\u72b6\u6001']!=='\u9000\u6b3e\u6210\u529f'||raw['\u5546\u54c1\u8bf4\u660e']!==record.description||raw['\u4ea4\u6613\u5bf9\u65b9']!==record.counterparty||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==record.paymentChannel||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==record.sourceTransactionId||raw['\u5546\u5bb6\u8ba2\u5355\u53f7']!==record.relatedReference)return record;
 return {...record,direction:'credit',automaticClassification:{method:'explicit_neutral_wallet_refund_cash',confidence:'explicit_original_refund_success_and_balance_channel',sourceDirection:'neutral',sourceIncomeExpenseLabel:raw['\u6536/\u652f'],cashReceiptMinor:record.amountMinor,financialAccountId:a.id,evidenceObservationIds:[record.id],sourceStatusPreserved:true}};
}
function findNeutralWalletRefundCash(observations,accounts){
 if(!observations.some(o=>o.provider==='alipay'&&o.kind==='refund'&&o.direction==='neutral'&&o.status==='completed'))return new Map();
 const latest=new Map(),key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
 for(const o of observations)if(!latest.has(key(o))||(o.sourceVersionOrdinal||0)>(latest.get(key(o)).sourceVersionOrdinal||0))latest.set(key(o),o);
 const out=new Map();for(const original of latest.values()){
  const refreshed=refreshNeutralWalletRefund(original,accounts);
  if(refreshed!==original)out.set(original.id,{direction:refreshed.direction,automaticClassification:refreshed.automaticClassification});
 }
 return out;
}
module.exports={refreshNeutralWalletRefund,findNeutralWalletRefundCash};
