'use strict';
const {isSettlementAccount}=require('./counterpartySettlements');
const minor=v=>{const m=String(v??'').match(/^(\d+)\.(\d{2})$/);return m?BigInt(m[1])*100n+BigInt(m[2]):null;};

// "Transfer/red packet" is an old export category, not proof that a paid
// goods order is the owner's internal transfer. Keep the original money and
// request a purpose classification unless an owner income/settlement decision
// has actually resolved it. No revenue or family receivable is invented here.
function unclassifiedMerchantCredit(source,effective,accounts){
 const r=source.rawFields||{},wallet=accounts.find(a=>a.id===source.financialAccountId);
 if(source.provider!=='alipay'||source.status!=='completed'||source.kind!=='transfer'||source.direction!=='credit'||source.currency!=='CNY'||effective.kind!=='transfer'||effective.status!=='completed'||effective.direction!=='credit'||wallet?.type!=='wallet'||wallet.provider!=='alipay'||wallet.sourceProduct||wallet.status!=='active'||wallet.currency!==source.currency||source.accountRelations?.length||source.investmentTrade||source.loanProof||source.brokerage||r['\u6536/\u652f']!=='\u6536\u5165'||r['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||r['\u4ea4\u6613\u5206\u7c7b']!=='\u8f6c\u8d26\u7ea2\u5305'||r['\u5546\u54c1\u8bf4\u660e']!==source.description||r['\u4ea4\u6613\u8ba2\u5355\u53f7']!==source.sourceTransactionId||r['\u5546\u5bb6\u8ba2\u5355\u53f7']!==source.relatedReference||!/^T\d{1,4}P\d{6,}$/.test(source.relatedReference||'')||minor(r['\u91d1\u989d'])!==BigInt(source.amountMinor)||BigInt(source.amountMinor)<=0n)return false;
 const settlement=accounts.find(a=>a.id===effective.settlementAccountId||a.id===effective.automaticClassification?.financialAccountId);
 return !(isSettlementAccount(settlement)&&effective.automaticClassification?.method==='owner_confirmed_counterparty_settlement');
}
function nativeUnclassifiedMerchantReceipt(source,proof){
 const e=proof.balanceEvidence;
 return neutralMerchantOrder(source)&&nativeMerchantProof(source,proof,e);
}
function nativeMerchantProof(source,proof,e){
 const clean=value=>String(value||'').normalize('NFKC').replace(/\s/g,'');
 const nativeTitle=proof.description==='\u4ea4\u6613\u4ed8\u6b3e'||clean(proof.description)==='\u652f\u4ed8-'+clean(source.description);
 return proof.provider==='alipay'&&proof.financialAccountId===source.financialAccountId&&proof.currency===source.currency&&proof.relatedReference===source.sourceTransactionId&&nativeTitle&&proof.date>=source.date&&proof.rawFields?.['\u8d44\u91d1\u6e20\u9053']==='\u652f\u4ed8\u5b9d'&&e?.schema==='alipay-balance-proof-v1'&&e.incomeMinor===source.amountMinor&&e.expenseMinor==='0';
}
function neutralMerchantOrder(source){
 const r=source.rawFields||{};
 return source.provider==='alipay'&&source.currency==='CNY'&&source.status==='completed'&&source.kind==='transfer'&&source.direction==='neutral'&&!source.paymentChannel&&!source.paymentAccountHint&&!source.accountRelations?.length&&!source.investmentTrade&&!source.loanProof&&!source.brokerage&&BigInt(source.amountMinor)>0n&&r['\u6536/\u652f']==='\u4e0d\u8ba1\u6536\u652f'&&r['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&r['\u5546\u54c1\u8bf4\u660e']===source.description&&r['\u4ea4\u6613\u8ba2\u5355\u53f7']===source.sourceTransactionId&&r['\u5546\u5bb6\u8ba2\u5355\u53f7']===source.relatedReference&&/^T\d{1,4}P\d{6,}$/.test(source.relatedReference||'')&&minor(r['\u91d1\u989d'])===BigInt(source.amountMinor);
}
module.exports={unclassifiedMerchantCredit,nativeUnclassifiedMerchantReceipt,neutralMerchantOrder};
