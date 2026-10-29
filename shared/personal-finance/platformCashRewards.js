'use strict';
const {actualSecond}=require('./mixedPayments');
const norm=v=>String(v||'').normalize('NFKC').trim(),identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const RULES=[
 {description:'\u9489\u9489\u7ea2\u5305\u63d0\u73b0',counterparties:['\u9489\u9489\u7ea2\u5305'],platform:'dingtalk',providers:['dingtalk','dingding']},
 {description:'\u6dd8\u5b9d\u73b0\u91d1\u7ea2\u5305\u63d0\u73b0',counterparties:['','\u6dd8\u5b9d\u73b0\u91d1\u7ea2\u5305'],platform:'taobao',providers:['taobao']},
];
function originalRule(o){
 const r=o.rawFields||{},rule=RULES.find(p=>p.description===o.description&&p.counterparties.includes(norm(o.counterparty)));
 if(!rule||o.provider!=='alipay'||o.currency!=='CNY'||o.status!=='completed'||!['transfer','income'].includes(o.kind)||o.direction!=='credit'||typeof o.amountMinor!=='string'||!/^\d+$/.test(o.amountMinor)||BigInt(o.amountMinor)<=0n||!actualSecond(o)||!['','\u4f59\u989d','\u652f\u4ed8\u5b9d\u4f59\u989d','\u8d26\u6237\u4f59\u989d'].includes(o.paymentChannel)||o.paymentAccountHint||o.accountRelations?.length||o.automaticFunding||o.investmentTrade||o.loanProof||o.brokerage||o.bankStatement||o.balanceEvidence||[o.feeMinor,o.interestMinor,o.principalMinor].some(v=>v!=null&&v!=='0'))return null;
 if(r['\u6536/\u652f']!=='\u6536\u5165'||r['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||r['\u5546\u54c1\u8bf4\u660e']!==o.description||r['\u4ea4\u6613\u5bf9\u65b9']!==o.counterparty||r['\u4ea4\u6613\u5206\u7c7b']!=='\u8f6c\u8d26\u7ea2\u5305'||o.category!==r['\u4ea4\u6613\u5206\u7c7b']||r['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==o.paymentChannel||r['\u4ea4\u6613\u65f6\u95f4']!==o.date+' '+o.occurredAt.slice(11,19)||r['\u4ea4\u6613\u8ba2\u5355\u53f7']!==o.sourceTransactionId||!/^\d{20,32}$/.test(o.sourceTransactionId||'')||!o.sourceTransactionId.startsWith(o.date.replace(/-/g,''))||!/^\d+\.\d{2}$/.test(r['\u91d1\u989d']||'')||BigInt(r['\u91d1\u989d'].replace('.',''))!==BigInt(o.amountMinor))return null;
 return rule;
}
function isPlatformCashReward(record){return Boolean(originalRule(record));}
function refreshPlatformCashReward(record,{accounts=[],excludedCounterparties=new Set(),blockedSourceKeys=new Set()}={}){
 const rule=originalRule(record);if(!rule||blockedSourceKeys.has(identity(record))||record.counterparty&&excludedCounterparties.has(norm(record.counterparty))||record.automaticClassification&&record.automaticClassification.method!=='explicit_platform_cash_reward_receipt')return record;
 const wallet=accounts.find(a=>a.id===record.financialAccountId);if(wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.currency!==record.currency||wallet.sourceProduct)return record;
 // A separately recorded reward wallet could already recognize the award.
 // Its withdrawal must not create another income merely on reaching Alipay.
 if(accounts.some(a=>a.status!=='deleted'&&(rule.providers.includes(a.provider)||a.sourceProduct===rule.platform+'_cash_rewards')))return record;
 return {...record,kind:'income',automaticClassification:{method:'explicit_platform_cash_reward_receipt',confidence:'explicit_original_cash_income',evidenceObservationIds:[record.id],platform:rule.platform,incomeRecognitionBasis:'original_cash_reward_withdrawal_receipt',incomeRecognitionOccurredAt:record.occurredAt,rewardEarnedDateKnown:false,sourceKind:record.kind,reversible:true}};
}
module.exports={isPlatformCashReward,refreshPlatformCashReward};
