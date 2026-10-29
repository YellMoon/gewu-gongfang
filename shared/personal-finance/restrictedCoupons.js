'use strict';
const PREFIX='\u975e\u73b0\u91d1\u6d88\u8d39\u7ea2\u5305\uff08\u7528\u6237\u786e\u8ba4\uff09\uff1a';
function isRestrictedCouponAnnotation(a){return !a?.reset&&typeof a?.patch?.category==='string'&&a.patch.category.startsWith(PREFIX);}
function sourceIsCouponCandidate(s){
 const r=s?.rawFields||{},amount=r['\u91d1\u989d'];
 return s?.provider==='alipay'&&s.currency==='CNY'&&s.status==='completed'&&s.kind==='transfer'&&s.direction==='neutral'&&!s.paymentChannel&&!s.paymentAccountHint&&!s.accountRelations?.length&&!s.investmentTrade&&!s.loanProof&&!s.bankStatement&&!s.statementFlow&&!s.balanceEvidence&&!s.brokerage&&/^\d+$/.test(s.amountMinor)&&BigInt(s.amountMinor)>0n&&r['\u6536/\u652f']==='\u4e0d\u8ba1\u6536\u652f'&&r['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&r['\u4ea4\u6613\u5206\u7c7b']==='\u8f6c\u8d26\u7ea2\u5305'&&r['\u5546\u54c1\u8bf4\u660e']===s.description&&r['\u4ea4\u6613\u5bf9\u65b9']===s.counterparty&&r['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===''&&r['\u4ea4\u6613\u8ba2\u5355\u53f7']===s.sourceTransactionId&&/^2088\d{12}_\d{6,32}$/.test(s.sourceTransactionId)&&typeof amount==='string'&&/^\d+\.\d{2}$/.test(amount)&&BigInt(amount.replace('.',''))===BigInt(s.amountMinor);
}
function ownerConfirmedRestrictedCoupon(source,annotation,accounts){
 const p=annotation?.patch,a=accounts.find(a=>a.id===source?.financialAccountId);
 if(!isRestrictedCouponAnnotation(annotation)||p.kind!=='transfer'||Object.keys(p).some(k=>!['kind','category'].includes(k))||!p.category.slice(PREFIX.length).trim()||!sourceIsCouponCandidate(source)||a?.type!=='wallet'||a.provider!=='alipay'||a.status!=='active'||a.currency!==source.currency)return null;
 return {...source,...p,restrictedCoupon:{schema:'owner-confirmed-restricted-coupon-v1',sourceObservationId:source.id,annotationId:annotation.id||null,faceValueMinor:source.amountMinor,restriction:p.category.slice(PREFIX.length),cashRedeemable:false,portfolioValueRecognized:false,validityOrUseKnown:false},automaticClassification:{method:'owner_confirmed_non_cash_restricted_coupon',confidence:'owner_confirmed',evidenceObservationIds:[source.id],annotationId:annotation.id||null,cashMovementRequired:false}};
}
function isConfirmedRestrictedCoupon(record){const c=record.restrictedCoupon;return c?.schema==='owner-confirmed-restricted-coupon-v1'&&c.sourceObservationId===record.id&&c.faceValueMinor===record.amountMinor&&c.cashRedeemable===false&&c.portfolioValueRecognized===false&&record.automaticClassification?.method==='owner_confirmed_non_cash_restricted_coupon'&&record.category===PREFIX+c.restriction&&sourceIsCouponCandidate(record);}
module.exports={PREFIX,isRestrictedCouponAnnotation,ownerConfirmedRestrictedCoupon,isConfirmedRestrictedCoupon};
