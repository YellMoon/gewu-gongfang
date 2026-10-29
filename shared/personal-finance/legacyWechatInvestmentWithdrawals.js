'use strict';

// The old "change investment" entry was a Licaitong entry, not a payment
// from a customer. This exact native receipt names both the redemption and
// its destination. It does not identify a fund, confirmed units or profit.
function nativeLegacyWechatWithdrawal(record){
 const raw=record.rawFields,amount=String(raw?.['\u91d1\u989d(\u5143)']??'');
 const namedReceipt=record.counterparty==='\u96f6\u94b1\u7406\u8d22\u5feb\u901f\u53d6\u51fa'||/^\u7406\u8d22\u901aT\+0\u63d0\u73b0\[1306760801\]\[\d{6}\]\[\*{4}\d{4}\]$/.test(record.counterparty||'')&&String(record.sourceTransactionId||'').startsWith('1306760801');
 if(record.provider!=='wechat'||record.currency!=='CNY'||record.direction!=='credit'||record.status!=='completed'
  ||!['income','transfer'].includes(record.kind)||!namedReceipt||record.description!=='/'||record.paymentChannel!=='/'||record.paymentAccountHint
  ||record.accountRelations?.some(r=>r.product!=='wechat_licaitong'||r.activity!=='investment_withdrawal'||r.role!=='target')||(record.accountRelations?.length||0)>1||record.investmentTrade||record.brokerage||record.automaticFunding||record.automaticWalletReceipt
  ||raw?.['\u6536/\u652f']!=='\u6536\u5165'||raw['\u4ea4\u6613\u7c7b\u578b']!=='\u5546\u6237\u6d88\u8d39'||raw['\u5f53\u524d\u72b6\u6001']!=='\u5df2\u5b58\u5165\u96f6\u94b1'
  ||raw['\u4ea4\u6613\u5bf9\u65b9']!==record.counterparty||raw['\u5546\u54c1']!==record.description||raw['\u652f\u4ed8\u65b9\u5f0f']!==record.paymentChannel
  ||raw['\u4ea4\u6613\u5355\u53f7']!==record.sourceTransactionId||raw['\u4ea4\u6613\u65f6\u95f4']!==record.occurredAt?.slice(0,19).replace('T',' ')||record.date!==record.occurredAt?.slice(0,10)
  ||!/^\d{20,40}$/.test(record.sourceTransactionId||'')||!/^\d+(?:\.\d{1,2})?$/.test(amount))return false;
 const [whole,fraction='']=amount.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))===BigInt(record.amountMinor)&&BigInt(record.amountMinor)>0n;
}
function refreshLegacyWechatWithdrawal(record,accounts){
 if(!nativeLegacyWechatWithdrawal(record))return record;
 const wallet=accounts.find(a=>a.id===record.financialAccountId&&a.provider==='wechat'&&a.type==='wallet'&&a.currency===record.currency&&a.status==='active');if(!wallet)return record;
 const products=accounts.filter(a=>a.status==='active'&&a.sourceProduct==='wechat_licaitong'&&a.provider==='wechat'&&a.type==='investment'&&a.currency===record.currency);
 if(record.accountRelations?.[0]?.financialAccountId&&(products.length!==1||products[0].id!==record.accountRelations[0].financialAccountId))return record;
 return {...record,kind:'transfer',category:record.counterparty==='\u96f6\u94b1\u7406\u8d22\u5feb\u901f\u53d6\u51fa'?'\u7406\u8d22\u8d4e\u56de\uff08\u65e7\u7248\u96f6\u94b1\u7406\u8d22\uff09':'\u7406\u8d22\u8d4e\u56de\uff08\u65e7\u7248\u7406\u8d22\u901a\uff09',accountRelations:[{product:'wechat_licaitong',activity:'investment_withdrawal',role:'target',...(products.length===1?{financialAccountId:products[0].id}:{})}],automaticClassification:{method:'explicit_legacy_wechat_investment_withdrawal',confidence:'native_redemption_and_wallet_receipt',evidenceObservationIds:[record.id]},automaticWalletReceipt:{method:'native_legacy_investment_wallet_receipt',financialAccountId:wallet.id,evidenceObservationIds:[record.id]}};
}
module.exports={nativeLegacyWechatWithdrawal,refreshLegacyWechatWithdrawal};
