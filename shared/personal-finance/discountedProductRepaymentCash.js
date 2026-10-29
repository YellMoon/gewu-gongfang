'use strict';
// Alipay's reported cash amount survives even when the credit receipt and the
// benefit amount are unavailable. This plan never fabricates the liability leg.
function discountedProductRepaymentCash(o,accounts){
 const raw=o?.rawFields||{},parts=String(o?.paymentChannel||'').split('&');
 if(o?.provider!=='alipay'||o.status!=='completed'||o.kind!=='debt_payment'||o.direction!=='neutral'||o.currency!=='CNY'||o.description!=='\u4fe1\u7528\u5361\u8fd8\u6b3e'||o.paymentAccountHint||o.accountRelations?.length||o.bankStatement||o.statementFlow||o.investmentTrade||o.automaticFunding||!/^\d+$/.test(o.amountMinor)||BigInt(o.amountMinor)<=0n)return null;
 if(parts.length!==2||parts[0]!=='\u4f59\u989d\u5b9d'||!['\u7ea2\u5305','\u96c6\u5206\u5b9d'].includes(parts[1])||![null,undefined,'0'].includes(o.feeMinor)||o.principalMinor!==null||o.interestMinor!==null)return null;
 const amount=String(raw['\u91d1\u989d']||'').match(/^(\d+)(?:\.(\d{1,2}))?$/),cash=amount?String(BigInt(amount[1])*100n+BigInt((amount[2]||'').padEnd(2,'0'))):null;
 if(cash!==o.amountMinor||raw['\u5546\u54c1\u8bf4\u660e']!==o.description||raw['\u4ea4\u6613\u5bf9\u65b9']!==o.counterparty||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==o.paymentChannel||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==o.sourceTransactionId||!o.sourceTransactionId||raw['\u4ea4\u6613\u72b6\u6001']!=='\u8fd8\u6b3e\u6210\u529f'||raw['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||raw['\u4ea4\u6613\u65f6\u95f4']!==o.occurredAt?.slice(0,19).replace('T',' ')||o.occurredAt?.slice(0,10)!==o.date||!o.occurredAt?.endsWith('+08:00'))return null;
 const wallet=accounts.find(a=>a.id===o.financialAccountId),payers=accounts.filter(a=>a.status==='active'&&a.provider==='alipay'&&a.sourceProduct==='alipay_yuebao'&&a.type==='investment'&&a.currency===o.currency);
 if(wallet?.provider!=='alipay'||wallet.type!=='wallet'||wallet.status!=='active'||wallet.currency!==o.currency||payers.length!==1)return null;
 return {method:'native_discounted_product_repayment_cash',confidence:'explicit_platform_reported_cash',financialAccountId:payers[0].id,sourceObservationId:o.id,sourceTransactionId:o.sourceTransactionId,date:o.date,occurredAt:o.occurredAt,cashPaidMinor:cash,amountBasis:'original_alipay_reported_cash_amount',benefitKind:parts[1],nonCashBenefitMinor:null,cardReceivedMinor:null,receivingLiabilityLeg:'not_inferred',incomeMinor:'0'};
}
// This is an owner-confirmed derived liability leg, never a synthetic bank
// observation. An available bank receipt must be reconciled independently.
function ownerConfirmedRepaymentReceipt(cash,o,accounts,observations,links=[]){
 const payer=accounts.find(a=>a.id===cash.financialAccountId),policy=payer?.creditRepaymentBenefits;
 if(!policy)return null;
 require('./productRepaymentBenefits').validateCreditRepaymentBenefits(policy);
 const rules=policy.rules.filter(r=>r.sourceTransactionId===o.sourceTransactionId&&r.cashPaidMinor===cash.cashPaidMinor&&r.receiptBasis==='owner_confirmed_order_detail');
 if(rules.length!==1)return null;
 const r=rules[0],target=accounts.find(a=>a.id===r.receivingAccountId),kind=o.paymentChannel.endsWith('&\u96c6\u5206\u5b9d')?'jifenbao':'welfare_or_coupon';
 if(r.benefitKind!==kind||!require('./productRepaymentBenefits').benefitAccountValid(payer,target)||target.provider!==o.counterparty||!/^\d{4}$/.test(target.maskedIdentifier||''))return null;
 const identity=s=>JSON.stringify([s.financialAccountId,s.provider,s.sourceIdentity||s.id]),latest=new Map();
 for(const s of observations){const k=identity(s);if(!latest.has(k)||(s.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,s);}
 const rows=[...latest.values()],same=rows.filter(s=>s.provider===o.provider&&s.financialAccountId===o.financialAccountId&&s.sourceTransactionId===o.sourceTransactionId);
 if(same.length!==1||same[0].id!==o.id)return null;
 const dates=[o.date,new Date(Date.parse(o.date+'T00:00:00Z')+86400000).toISOString().slice(0,10)];
 if(rows.some(s=>s.financialAccountId===target.id&&s.status==='completed'&&s.direction==='credit'&&s.currency===o.currency&&dates.includes(s.date)&&s.amountMinor===r.cardReceivedMinor&&(s.bankStatement||s.statementFlow)))return null;
 const byId=new Map(observations.map(s=>[s.id,s])),key=identity(o);
 if(links.some(l=>((l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type))||(l.status==='deleted'&&l.type==='duplicate'))&&l.observationIds.some(id=>byId.has(id)&&identity(byId.get(id))===key)))return null;
 return{receivingAccountId:target.id,cardReceivedMinor:r.cardReceivedMinor,nonCashBenefitMinor:String(BigInt(r.cardReceivedMinor)-BigInt(r.cashPaidMinor)),incomeMinor:String(BigInt(r.cardReceivedMinor)-BigInt(r.cashPaidMinor)),receiptBasis:r.receiptBasis,confirmedAt:r.confirmedAt,receivingLiabilityLeg:'owner_confirmed_derived',cardReceiptDateBasis:'platform_repayment_date_actual_bank_posting_date_unknown',incomeBasis:'non_cash_credit_repayment_benefit'};
}
module.exports={discountedProductRepaymentCash,ownerConfirmedRepaymentReceipt};
