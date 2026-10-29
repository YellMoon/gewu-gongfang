'use strict';
// UTF-8 recognize only the original named investment purchase, not an insurer
// name, arbitrary insurance expense, estimated cash value or inferred redemption.
const GUOHUA_PRODUCT='alipay_guohua_no1_enhanced';
function isGuohuaInvestmentPurchase(r){
 const raw=r?.rawFields||{},text=String(r?.description||'').normalize('NFKC').replace(/\s/g,''),m=String(raw['\u91d1\u989d']??'').match(/^(\d+)\.(\d{2})$/);
 return !!r&&r.currency==='CNY'&&r.status==='completed'&&['transfer','expense'].includes(r.kind)&&r.direction==='debit'&&[null,undefined,'0'].includes(r.feeMinor)
  &&/^(?:\u3010\d{1,2}\u6708\u7406\u8d22\u7279\u522b\u7248\u3011)?\u56fd\u534e1\u53f7\u589e\u5f3a\u7248\u56fd\u534e\u4eba\u5bff\u7406\u8d22\u6295\u8d44\u8ba1\u5212$/.test(text)
  &&r.counterparty==='\u56fd\u534e\u4eba\u5bff\u5b98\u65b9\u65d7\u8230\u5e97'&&raw['\u5546\u54c1\u8bf4\u660e']===r.description&&raw['\u4ea4\u6613\u5bf9\u65b9']===r.counterparty
  &&raw['\u4ea4\u6613\u8ba2\u5355\u53f7']===r.sourceTransactionId&&/^\d{12,40}$/.test(r.sourceTransactionId||'')&&typeof r.occurredAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+]08:00$/.test(r.occurredAt)&&r.date===r.occurredAt.slice(0,10)&&raw['\u4ea4\u6613\u65f6\u95f4']===r.occurredAt.slice(0,19).replace('T',' ')
  &&raw['\u6536/\u652f']==='\u652f\u51fa'&&raw['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===r.paymentChannel&&!!m&&/^\d+$/.test(r.amountMinor||'')&&BigInt(r.amountMinor)>0n&&BigInt(m[1])*100n+BigInt(m[2])===BigInt(r.amountMinor);
}
module.exports={GUOHUA_PRODUCT,isGuohuaInvestmentPurchase};
