'use strict';
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const money=v=>{const m=String(v??'').replace(/,/g,'').match(/^(-?)(\d+)\.(\d{2})$/);return m?BigInt(m[2])*100n+BigInt(m[3]):null;};
const oneSecond=(source,proof)=>[0,1000].includes(Date.parse(proof.occurredAt)-Date.parse(source.occurredAt));
const bankName=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe|\u5de5\u5546|\u519c\u4e1a|\u6c11\u751f)/,'');
const bankWithdrawalLabel=o=>/^\u63d0\u73b0(?:[\u4e00-\u9fff]{2,4}(?:\u652f\u4ed8\u5b9d\u8f6c\u8d26)?)?$/.test(o.description||'')&&bankName(o.rawFields?.['\u8d44\u91d1\u6e20\u9053']).endsWith('\u94f6\u884c');
function bankWithdrawalSource(source,proof,native,maxSeconds){
 const raw=source.rawFields||{},seconds=(Date.parse(proof.occurredAt)-Date.parse(source.occurredAt))/1000;
 return native.bankWithdrawal&&source.kind==='transfer'&&['neutral','debit'].includes(source.direction)&&/^\d{8,32}$/.test(native.reference)&&/^\u63d0\u73b0-(?:\u666e\u901a|\u5feb\u901f)\u63d0\u73b0$/.test(source.description||'')&&raw['\u5546\u54c1\u8bf4\u660e']===source.description&&raw['\u4ea4\u6613\u5bf9\u65b9']===source.counterparty&&raw['\u6536/\u652f']==='\u4e0d\u8ba1\u6536\u652f'&&raw['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===(source.paymentChannel||'')&&['','\u4f59\u989d','\u8d26\u6237\u4f59\u989d','\u652f\u4ed8\u5b9d\u4f59\u989d'].includes(source.paymentChannel||'')&&!source.paymentAccountHint&&!source.accountRelations?.length&&!source.investmentTrade&&!source.loanProof&&bankName(source.counterparty)===bankName(native.bank)&&require('./mixedPayments').actualSecond(source)&&Number.isInteger(seconds)&&seconds>=0&&seconds<=maxSeconds;
}
function nativeBankWithdrawal(source,proof,native){return !native.ownerNamedOnly&&source.sourceTransactionId===native.reference&&bankWithdrawalSource(source,proof,native,14*86400);}
function ownerBoundBankWithdrawal(source,proof,native,ownerBoundIds,actual){
 if(!ownerBoundIds.has(source.id)||source.sourceTransactionId===native.reference||!bankWithdrawalSource(source,proof,native,86400))return false;
 // Count originals before filtering owner edits. Binding one known card must
 // not make another competing withdrawal disappear.
 return actual.filter(o=>o.financialAccountId===source.financialAccountId&&o.currency===source.currency&&o.amountMinor===source.amountMinor&&bankWithdrawalSource(o,proof,native,86400)).length===1;
}
function purposeOnlyCashTimingAnnotationIds(observations,annotations,accounts=[]){
 if(!annotations.length)return new Set();
 const byId=new Map(observations.map(o=>[o.id,o])),groups=new Map();
 for(const a of annotations){const o=byId.get(a.observationId);if(!o)continue;const key=identity(o);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(a);}
 const timingOnly=a=>{
  const source=byId.get(a.observationId),neutral=require('./legacyMerchantReceipts').neutralMerchantOrder(source);
  if(a.reset||!a.patch||Object.keys(a.patch).length===0)return neutral;
  if(Object.keys(a.patch).every(k=>['kind','category'].includes(k)))return !a.patch.kind||['income','expense','fee','interest','refund','transfer'].includes(a.patch.kind);
  // An owner-classified merchant collection adds a noncash payable, not a new
  // wallet source. Preserve that original credit's exact cash reference only
  // after validating both the merchant receipt and complete settlement edit.
  if(Object.keys(a.patch).some(k=>!['kind','category','settlementAccountId'].includes(k))||a.patch.kind!=='transfer')return false;
  // Assigning a noncash counterparty balance does not change the original
  // credit/debit cash. Keep its independently proven amount and posting time.
  const typedCash=source?.status==='completed'&&['credit','debit'].includes(source.direction);
  try{return (neutral||typedCash||require('./legacyMerchantReceipts').unclassifiedMerchantCredit(source,source,accounts))&&(a.patch.settlementAccountId===null||Boolean(require('./counterpartySettlements').annotatedSettlementAccount(neutral?{...source,direction:'credit'}:source,a,accounts)));}catch{return false;}
 };
 const allowed=new Set([...groups].filter(([,rows])=>rows.every(timingOnly)).map(([key])=>key));
 return new Set(observations.filter(o=>allowed.has(identity(o))).map(o=>o.id));
}
function nativeMixedRefund(source,proof,native,actual,continuousProofIds){
 const raw=source.rawFields||{};
 if(native.delta<=0n||native.delta!==BigInt(source.amountMinor)||!continuousProofIds.has(proof.id)||proof.description!=='\u8f6c\u8d26\u82b1\u5457\u9000\u6b3e'||source.kind!=='refund'||source.direction!=='neutral'||source.paymentChannel!=='\u4f59\u989d&\u7ea2\u5305'||source.paymentAccountHint||source.accountRelations?.length||source.investmentTrade||source.loanProof||source.bankStatement||source.statementFlow||source.date!==proof.date||!oneSecond(source,proof)||!require('./mixedPayments').actualSecond(source)||!/^\u9000\u6b3e-/.test(source.description)||raw['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||raw['\u4ea4\u6613\u72b6\u6001']!=='\u9000\u6b3e\u6210\u529f'||raw['\u5546\u54c1\u8bf4\u660e']!==source.description||raw['\u4ea4\u6613\u5bf9\u65b9']!==source.counterparty||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==source.paymentChannel||!source.relatedReference||raw['\u5546\u5bb6\u8ba2\u5355\u53f7']!==source.relatedReference)return false;
 // Count every completed same-wallet refund before considering edits or links.
 // An owner decision on a rival must never manufacture uniqueness.
 return actual.filter(o=>o.kind==='refund'&&o.financialAccountId===source.financialAccountId&&o.currency===source.currency&&o.amountMinor===source.amountMinor&&o.date===source.date&&oneSecond(o,proof)).length===1;
}
function nativeCompensation(source,proof,native,actual){
 if(native.delta<=0n||source.kind!=='refund'||source.direction!=='neutral'||source.paymentChannel!=='\u8d26\u6237\u4f59\u989d'||source.rawFields?.['\u4ea4\u6613\u72b6\u6001']!=='\u8d54\u4ed8\u6210\u529f'||!source.description.startsWith('\u8d54\u4ed8-')||!/^C-capital-general-C-/.test(source.relatedReference||'')||source.sourceTransactionId!==native.reference+'*'+source.relatedReference||!oneSecond(source,proof))return false;
 return actual.filter(p=>p.financialAccountId===source.financialAccountId&&p.currency===source.currency&&p.kind==='expense'&&p.direction==='debit'&&p.sourceTransactionId===native.reference&&p.counterparty===source.counterparty&&p.relatedReference&&proof.description==='\u8f6c\u8d26/\u552e\u540e\u652f\u4ed8-'+native.reference+'-'+p.relatedReference).length===1;
}
function nativeServiceFee(source,proof,native){
 const tail=String(source.description||'').match(/^\u5206\u8d26-\u57fa\u7840\u8f6f\u4ef6\u670d\u52a1\u8d39\(\*{4}(\d{4})\)\u6263\u6b3e$/),order=String(proof.description||'').match(/^\u8f6c\u8d26\/\u57fa\u7840\u8f6f\u4ef6\u670d\u52a1\u8d39\((\d{8,32})\)\u6263\u6b3e$/);
 return native.delta<0n&&source.kind==='fee'&&source.direction==='debit'&&source.counterparty==='\u676d\u5dde\u95f2\u9c7c\u4fe1\u606f\u6280\u672f\u6709\u9650\u516c\u53f8'&&['','\u8d26\u6237\u4f59\u989d'].includes(source.paymentChannel)&&!source.paymentAccountHint&&!source.accountRelations?.length&&source.rawFields?.['\u5546\u54c1\u8bf4\u660e']===source.description&&source.rawFields?.['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&source.rawFields?.['\u6536/\u652f']==='\u652f\u51fa'&&tail&&order&&order[1].endsWith(tail[1])&&Math.abs(Date.parse(proof.occurredAt)-Date.parse(source.occurredAt))<=1000;
}
function nativeSponsoredPayerPayment(source,proof,native){
 const raw=source.rawFields||{},delay=Date.parse(proof.occurredAt)-Date.parse(source.occurredAt);
 return native.delta<0n&&source.kind==='transfer'&&source.direction==='debit'&&source.description==='\u4ee3\u4ed8'&&/^\d{16,32}$/.test(source.sourceTransactionId||'')&&/^P\d{16,32}$/.test(source.relatedReference||'')&&source.relatedReference==='P'+native.reference&&source.sourceTransactionId!==native.reference&&/^\u8f6c\u8d26\u4ee3\u4ed8\u8f6c\u8d26,\u4ee3\u4ed8\u4eba:/.test(proof.description||'')&&['','\u4f59\u989d','\u8d26\u6237\u4f59\u989d','\u652f\u4ed8\u5b9d\u4f59\u989d'].includes(source.paymentChannel)&&!source.paymentAccountHint&&!source.accountRelations?.length&&!source.investmentTrade&&!source.loanProof&&raw['\u6536/\u652f']==='\u652f\u51fa'&&raw['\u4ea4\u6613\u72b6\u6001']==='\u4ee3\u4ed8\u6210\u529f'&&raw['\u5546\u54c1\u8bf4\u660e']===source.description&&raw['\u4ea4\u6613\u5bf9\u65b9']===source.counterparty&&raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===source.paymentChannel&&raw['\u5546\u5bb6\u8ba2\u5355\u53f7']===source.relatedReference&&raw['\u4ea4\u6613\u65f6\u95f4']===source.date+' '+source.occurredAt.slice(11,19)&&Number.isFinite(delay)&&delay>=0&&delay<=86400000;
}
function nativeProof(o,accounts){
 const e=o.balanceEvidence,r=o.rawFields||{},a=accounts.get(o.financialAccountId),bankWithdrawal=bankWithdrawalLabel(o);
 if(o.provider!=='alipay'||o.status!=='completed'||o.currency!=='CNY'||o.direction!=='neutral'||o.amountMinor!=='0'||e?.schema!=='alipay-balance-proof-v1'||a?.status!=='active'||a.type!=='wallet'||a.provider!=='alipay'||a.currency!==o.currency||o.balanceMinor==null||r['\u65f6\u95f4']!==o.date+o.occurredAt.slice(11,19)||r['\u540d\u79f0\u5907\u6ce8']!==o.description||r['\u6d41\u6c34\u53f7']!==o.relatedReference||!o.relatedReference||r['\u8d44\u91d1\u6e20\u9053']!=='\u652f\u4ed8\u5b9d'&&!bankWithdrawal||money(r['\u8d26\u6237\u4f59\u989d'])!==BigInt(o.balanceMinor))return null;
 if(!/^\d+$/.test(e.incomeMinor)||!/^\d+$/.test(e.expenseMinor))return null;
 const incoming=BigInt(e.incomeMinor),outgoing=BigInt(e.expenseMinor);if((incoming>0n)===(outgoing>0n))return null;
 const other=money(r[incoming>0n?'\u652f\u51fa':'\u6536\u5165']);if(other!==null&&other!==0n||incoming>0n&&String(r['\u6536\u5165']||'').trim().startsWith('-')||e.balanceKind&&e.balanceKind!=='total')return null;
 const actual=money(r[incoming>0n?'\u6536\u5165':'\u652f\u51fa']);if(actual!==(incoming||outgoing))return null;
 if(bankWithdrawal&&incoming!==0n)return null;
 return{delta:incoming-outgoing,reference:o.relatedReference,...(bankWithdrawal?{bankWithdrawal:true,bank:r['\u8d44\u91d1\u6e20\u9053'],ownerNamedOnly:!/^\u63d0\u73b0(?:[\u4e00-\u9fff]{2,4})?$/.test(o.description||'')}: {})};
}
function findBalanceProofCashPostings(observations,accounts,{annotatedIds=new Set(),cashTimingAnnotatedIds=new Set(),links=[]}={}){
 if(!observations.some(o=>o.balanceEvidence?.schema==='alipay-balance-proof-v1'))return new Map();
 const am=new Map(accounts.map(a=>[a.id,a])),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map();
 for(const o of observations){const key=identity(o);if(!latest.has(key)||(o.sourceVersionOrdinal||0)>(latest.get(key).sourceVersionOrdinal||0))latest.set(key,o);}
 const rows=[...latest.values()],blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity)),active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|'))),proposals=[];
 const merchantProofIds=rows.some(o=>o.balanceEvidence?.schema==='alipay-balance-proof-v1'&&bankWithdrawalLabel(o)||!o.balanceEvidence&&o.provider==='alipay'&&o.kind==='transfer'&&(o.direction==='neutral'&&/^T\d{1,4}P\d{6,}$/.test(o.relatedReference||'')||o.direction==='debit'&&o.description==='\u4ee3\u4ed8'&&/^P\d{16,32}$/.test(o.relatedReference||'')))?new Set(require('./walletStatementTopUps').validatedWalletProofs(rows,am).map(p=>p.observation.id)):new Set();
 const nativeMerchant=p=>merchantProofIds.has(p.proof.id)&&require('./legacyMerchantReceipts').nativeUnclassifiedMerchantReceipt(p.source,p.proof);
 const timingOnly=new Set([...cashTimingAnnotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity));
 const actual=rows.filter(o=>!o.balanceEvidence&&o.provider==='alipay'&&o.status==='completed'&&o.currency==='CNY'&&money(o.rawFields?.['\u91d1\u989d'])===BigInt(o.amountMinor)&&o.rawFields?.['\u4ea4\u6613\u8ba2\u5355\u53f7']===o.sourceTransactionId);
 const mixedRefundProofIds=actual.some(o=>o.kind==='refund'&&o.direction==='neutral'&&o.paymentChannel==='\u4f59\u989d&\u7ea2\u5305')?new Set(require('./walletStatementTopUps').validatedWalletProofs(rows,am).map(p=>p.observation.id)):new Set();
 const ownerDestinations=require('./walletWithdrawalDestinations').resolveWithdrawalDestinations(rows,accounts,{annotatedIds}),ownerBoundIds=new Set(rows.filter(o=>ownerDestinations.has(o.id)&&am.get(o.financialAccountId)?.walletWithdrawalDestinations?.rules.some(r=>r.sourceTransactionIds?.includes(o.sourceTransactionId)&&r.financialAccountId===ownerDestinations.get(o.id).financialAccountId)).map(o=>o.id));
 const amountKey=(account,currency,amount)=>JSON.stringify([account,currency,String(amount)]),actualByAmount=new Map();
 for(const o of actual){const k=amountKey(o.financialAccountId,o.currency,BigInt(o.amountMinor));if(!actualByAmount.has(k))actualByAmount.set(k,[]);actualByAmount.get(k).push(o);}
 for(const proof of rows){const native=nativeProof(proof,am);if(!native||native.bankWithdrawal&&!merchantProofIds.has(proof.id))continue;
  const bucket=actualByAmount.get(amountKey(proof.financialAccountId,proof.currency,native.delta<0n?-native.delta:native.delta))||[];
  const sponsored=o=>merchantProofIds.has(proof.id)&&nativeSponsoredPayerPayment(o,proof,native);
  const candidates=bucket.filter(o=>native.bankWithdrawal?(nativeBankWithdrawal(o,proof,native)||ownerBoundBankWithdrawal(o,proof,native,ownerBoundIds,actual)):o.sourceTransactionId===native.reference&&(o.direction==='neutral'||o.direction==='debit'&&native.delta<0n||o.direction==='credit'&&native.delta>0n)||sponsored(o)||nativeMixedRefund(o,proof,native,actual,mixedRefundProofIds)||nativeCompensation(o,proof,native,actual)||nativeServiceFee(o,proof,native)||native.delta>0n&&o.kind==='income'&&o.direction==='neutral'&&!o.paymentChannel&&!o.paymentAccountHint&&[0,1000].includes(Date.parse(proof.occurredAt)-Date.parse(o.occurredAt))&&proof.description==='\u8f6c\u8d26'&&(/^(?:\u8d26\u6237\u7ed3\u606f-\d{4}\.\d{2}\.\d{2}|\u4f59\u989d\u5347\u7ea7\u670d\u52a1\u7ed3\u606f|\u4f59\u989d\u5347\u7ea7\u670d\u52a1\u6536\u76ca\u53d1\u653e)$/.test(o.description))&&o.counterparty==='\u6d59\u6c5f\u7f51\u5546\u94f6\u884c\u80a1\u4efd\u6709\u9650\u516c\u53f8'&&o.rawFields?.['\u5546\u5bb6\u8ba2\u5355\u53f7']===o.relatedReference&&o.relatedReference.endsWith('INTEREST'));
  if(candidates.length!==1)continue;const source=candidates[0],keys=new Set([identity(source),identity(proof)]);proposals.push({source,proof,deltaMinor:String(native.delta),method:native.bankWithdrawal?(nativeBankWithdrawal(source,proof,native)?'native_bank_withdrawal_wallet_cash_posting':'owner_bound_native_bank_withdrawal_wallet_cash_timing'):source.sourceTransactionId===native.reference?'native_order_wallet_cash_posting':sponsored(source)?'native_sponsored_payer_wallet_cash_posting':nativeMixedRefund(source,proof,native,actual,mixedRefundProofIds)?'native_mixed_refund_wallet_receipt':nativeCompensation(source,proof,native,actual)?'native_compensation_wallet_receipt':nativeServiceFee(source,proof,native)?'native_service_fee_wallet_posting':'native_interest_wallet_receipt',blocked:blocked.has(identity(proof))||blocked.has(identity(source))&&!((source.sourceTransactionId===native.reference||sponsored(source))&&timingOnly.has(identity(source)))||vetoes.some(l=>l.observationIds.map(id=>byId.get(id)).filter(Boolean).some(o=>keys.has(identity(o))))});
 }
 // Count all rivals before considering annotations, so an edited original
 // cannot make another source appear uniquely supported by the same cash row.
 const uses=new Map();for(const p of proposals)for(const o of[p.source,p.proof])uses.set(identity(o),(uses.get(identity(o))||0)+1);
 return new Map(proposals.filter(p=>!p.blocked&&[p.source,p.proof].every(o=>uses.get(identity(o))===1)).map(p=>[p.source.id,{method:p.method,sourceObservationId:p.source.id,proofObservationId:p.proof.id,financialAccountId:p.proof.financialAccountId,deltaMinor:p.deltaMinor,sourceOccurredAt:p.source.occurredAt,occurredAt:p.proof.occurredAt,date:p.proof.date,confidence:'explicit_original_cash_posting',...(p.method==='native_mixed_refund_wallet_receipt'?{associationConfidence:'inferred_reciprocal_unique_refund_and_wallet_credit_within_one_second',orderReferencePrintedOnCashProof:false,receivingAccountProvenByNativeBalance:true,noCreditOrLoanPostingInferred:true}:{}),...(p.method==='owner_bound_native_bank_withdrawal_wallet_cash_timing'?{associationConfidence:'inferred_unique_bank_withdrawal_with_owner_order_bound_destination',orderReferencePrintedOnCashProof:false,bankNetAndFeeNotInferred:true,ownerConfirmedDestinationRequired:true}:{}),ownerPurposePreserved:timingOnly.has(identity(p.source)),preservesUnclassifiedMerchantPurpose:nativeMerchant(p),allowsNeutralReceipt:nativeMerchant(p)||!timingOnly.has(identity(p.source))&&p.source.direction==='neutral'&&['income','interest','refund'].includes(p.source.kind)&&BigInt(p.deltaMinor)>0n}]));
}
function merchantCashPlanCompatible(sources,p,cashEffects,balanceEffects){
 if(!p.preservesUnclassifiedMerchantPurpose)return true;
 const s=sources[0],a=s?.automaticClassification;
 if(sources.length!==1||s.id!==p.sourceObservationId||s.kind!=='transfer'||s.automaticFunding||s.withdrawalDestination||s.automaticRepaymentTarget)return false;
 const settlement=s.direction==='credit'&&a?.method==='owner_confirmed_counterparty_settlement'&&a.cashReceiptProofObservationId===p.proofObservationId&&a.sourceDirection==='neutral'&&s.settlementAccountId===a.financialAccountId&&a.financialAccountId!==p.financialAccountId;
 if(!settlement&&(s.direction!=='neutral'||s.settlementAccountId))return false;
 if([...cashEffects].some(([id,value])=>id!==p.financialAccountId&&BigInt(value)!==0n))return false;
 if([...balanceEffects].some(([id,value])=>id!==p.financialAccountId&&BigInt(value)!==0n&&!(settlement&&id===a.financialAccountId&&BigInt(value)===-BigInt(p.deltaMinor))))return false;
 return !settlement||BigInt(balanceEffects.get(a.financialAccountId)||0n)===-BigInt(p.deltaMinor);
}
function planBalanceProofCashPostings(sources,matches,cashEffects,balanceEffects){
 const grouped=new Map();for(const source of sources){const p=matches.get(source.id);if(p){if(!grouped.has(p.financialAccountId))grouped.set(p.financialAccountId,[]);grouped.get(p.financialAccountId).push(p);}}
 const result=[];for(const [accountId,plans]of grouped){if(plans.length!==1)continue;const p=plans[0];if(p.partialMerchantSettlement){if(require('./partialMerchantCash').partialMerchantPlanCompatible(sources,p,cashEffects,balanceEffects))result.push(p);continue;}if(!merchantCashPlanCompatible(sources,p,cashEffects,balanceEffects))continue;const cash=BigInt(cashEffects.get(accountId)||0n),balance=BigInt(balanceEffects.get(accountId)||0n),delta=BigInt(p.deltaMinor);if(cash!==balance||cash!==delta&&!(cash===0n&&p.allowsNeutralReceipt))continue;result.push(p);}return result;
}
function cashPostingTiming(timing,plans){
 if(!plans.length)return timing;
 return{...timing,cashPostingEvidence:plans,cashEffectEvents:{...timing.cashEffectEvents,...Object.fromEntries(plans.map(p=>[p.financialAccountId,[{date:p.date,deltaMinor:p.deltaMinor}]]))},balanceEffectEvents:{...timing.balanceEffectEvents,...Object.fromEntries(plans.map(p=>[p.financialAccountId,[{occurredAt:p.occurredAt,deltaMinor:p.deltaMinor,observationId:p.proofObservationId}]]))}};
}

// Changing the expense bearer to a counterparty settlement does not erase a
// separately proven wallet debit. An adjacent sponsor credit is a different
// funding path and must be resolved before this direct-wallet branch applies.
function findNativeSettlementWalletFunding(observations,accounts,cashPostings,annotations){
 const am=new Map(accounts.map(a=>[a.id,a])),proofs=require('./walletStatementTopUps').validatedWalletProofs(observations,am),proofById=new Map(proofs.map(p=>[p.observation.id,p])),out=new Map();
 for(const source of observations){const annotation=annotations.get(source.id);let settlement;try{settlement=require('./counterpartySettlements').annotatedSettlementAccount(source,annotation,accounts);}catch{continue;}if(!settlement||source.provider!=='alipay'||source.direction!=='debit'||source.paymentChannel||source.paymentAccountHint||source.accountRelations?.length||source.investmentTrade||source.loanProof)continue;
  const plan=cashPostings.get(source.id),proof=proofById.get(plan?.proofObservationId),p=proof?.observation,owner=am.get(source.financialAccountId),amount=BigInt(source.amountMinor);if(!plan||plan.method!=='native_order_wallet_cash_posting'||plan.sourceObservationId!==source.id||plan.financialAccountId!==source.financialAccountId||plan.deltaMinor!==String(-amount)||owner?.status!=='active'||owner.type!=='wallet'||owner.provider!=='alipay'||owner.sourceProduct||!p||p.relatedReference!==source.sourceTransactionId||p.date!==source.date||proof.incoming!==0n||proof.outgoing!==-amount||proof.bank!=='\u652f\u4ed8\u5b9d')continue;
  const sponsors=proofs.filter(c=>{const o=c.observation,gap=Date.parse(p.occurredAt)-Date.parse(o.occurredAt);return o.financialAccountId===source.financialAccountId&&o.importId===p.importId&&c.incoming>0n&&gap>=0&&gap<=2000;});if(sponsors.length)continue;
  out.set(source.id,{method:'native_original_wallet_debit_with_owner_settlement',proofObservationId:p.id,settlementAccountId:settlement.id,amountMinor:source.amountMinor,actualCashPurposeIndependentOfBearer:true,reversible:true});
 }return out;
}

module.exports={findNativeSettlementWalletFunding,findBalanceProofCashPostings,planBalanceProofCashPostings,cashPostingTiming,purposeOnlyCashTimingAnnotationIds,nativeSponsoredPayerPayment};
