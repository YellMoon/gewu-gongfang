'use strict';

// Buying a telecom service is consumption even when its title says "top up".
// The financial-wallet recharge rules must still handle actual cash transfers.
function isLegacyTelecomServiceFormat(description){const text=String(description||'').normalize('NFKC');return text==='\u56fa\u8bdd/\u5bbd\u5e26'||/^\u624b\u673a\u5145\u503c-\u5145\u503c\d+\.\d{2}\u5143-1[3-9]\d{9}$/.test(text);}
function isTelecomServicePurchase(description){
 const text=String(description||'').normalize('NFKC');
 const namedMobileRecharge=/(?:^|\s)1[3-9]\d(?:[- ]?\d{4}){2}(?!\d)/.test(text)&&/(?:\u79fb\u52a8|\u8054\u901a|\u7535\u4fe1)/.test(text)&&/(?:\u5145\u503c|\u5feb\u5145|\u5feb\u51b2|\u79d2\u5145|\u79d2\u51b2)/.test(text)&&/\d+(?:\.\d+)?\s*\u5143/.test(text)&&!/\u94b1\u5305|\u94f6\u884c|\u4f59\u989d|\u91d1\u878d|\u516c\u4ea4|\u4ea4\u901a\u5361/.test(text);
 return (/\u8bdd\u8d39\u5145\u503c|\u624b\u673a\u8bdd\u8d39|\u6d41\u91cf\u5145\u503c|(?:\u79fb\u52a8|\u8054\u901a|\u7535\u4fe1)\s*\d+(?:\.\d+)?\s*\u5143\s*\u5145\u503c/.test(text)||namedMobileRecharge||isLegacyTelecomServiceFormat(text))
  && !/\u9000\u6b3e|\u9000\u8d27|\u8f6c\u8d26|\u8f6c\u5165|\u8f6c\u51fa|\u63d0\u73b0|\u8fd8\u6b3e|\u57fa\u91d1|\u7406\u8d22|\u8d37\u6b3e|\u501f\u6b3e/.test(text);
}
function refreshTelecomServicePurchase(record){
 const raw=record.rawFields;
 if(record.provider!=='alipay'||record.status!=='completed'||record.direction!=='debit'||record.kind!=='transfer'||record.currency!=='CNY'||BigInt(record.amountMinor)<=0n
  ||!raw||Object.hasOwn(raw,'kind')||raw['\u6536/\u652f']!=='\u652f\u51fa'||raw['\u5546\u54c1\u8bf4\u660e']!==record.description||!(raw['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'||raw['\u4ea4\u6613\u72b6\u6001']==='\u5145\u503c\u6210\u529f'&&isLegacyTelecomServiceFormat(record.description)&&record.description.startsWith('\u624b\u673a\u5145\u503c-'))||!isTelecomServicePurchase(record.description))return record;
 return {...record,kind:'expense',automaticClassification:{method:'explicit_telecom_service_purchase',confidence:'explicit_original_purchase_direction_and_description',evidenceObservationIds:[record.id]}};
}
function findNativeTelecomWalletFunding(observations,accounts,cashPostings){
 if(!cashPostings.size||!observations.some(o=>o.provider==='alipay'&&isLegacyTelecomServiceFormat(o.description)&&!o.paymentChannel))return new Map();
 const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),latest=new Map(),am=new Map(accounts.map(a=>[a.id,a]));for(const o of observations)if(!latest.has(key(o))||(o.sourceVersionOrdinal||0)>(latest.get(key(o)).sourceVersionOrdinal||0))latest.set(key(o),o);
 const rows=[...latest.values()],proofs=require('./walletStatementTopUps').validatedWalletProofs(rows,am),byId=new Map(proofs.map(p=>[p.observation.id,p])),sequences=new Map(),result=new Map();
 for(const p of proofs){const o=p.observation,k=JSON.stringify([o.financialAccountId,o.importId,o.balanceEvidence.sequence]);if(!sequences.has(k))sequences.set(k,[]);sequences.get(k).push(p);}
 for(const s of rows){
  const a=am.get(s.financialAccountId),plan=cashPostings.get(s.id),p=byId.get(plan?.proofObservationId),o=p?.observation;
  if(s.provider!=='alipay'||!['transfer','expense'].includes(s.kind)||!isLegacyTelecomServiceFormat(s.description)||s.paymentChannel||s.paymentAccountHint||s.accountRelations?.length||s.investmentTrade||s.loanProof||a?.status!=='active'||a.type!=='wallet'||a.provider!=='alipay'||a.sourceProduct||a.currency!==s.currency||refreshTelecomServicePurchase({...s,kind:'transfer',automaticClassification:undefined}).kind!=='expense'||!require('./mixedPayments').actualSecond(s)||plan?.method!=='native_order_wallet_cash_posting'||plan.sourceObservationId!==s.id||plan.financialAccountId!==s.financialAccountId||plan.deltaMinor!==String(-BigInt(s.amountMinor))||!o||p.bank!=='\u652f\u4ed8\u5b9d'||p.incoming!==0n||p.outgoing!==-BigInt(s.amountMinor)||o.relatedReference!==s.sourceTransactionId||!/^\u652f\u4ed8-\u751f\u6d3b\u670d\u52a1\d+$/.test(o.description)||o.date!==s.date)continue;
  const delay=Date.parse(o.occurredAt)-Date.parse(s.occurredAt),previous=sequences.get(JSON.stringify([s.financialAccountId,o.importId,o.balanceEvidence.sequence-1]))||[];if(delay<0||delay>86400000||previous.length!==1)continue;
  const prior=previous[0],gap=Date.parse(o.occurredAt)-Date.parse(prior.observation.occurredAt);if(gap<0||prior.incoming>0n&&gap<=2000)continue;
  result.set(s.id,{financialAccountId:s.financialAccountId,method:'native_telecom_wallet_debit',confidence:'explicit_original_wallet_cash',sourceObservationId:s.id,proofObservationId:o.id,previousCashObservationId:prior.observation.id,occurredAt:o.occurredAt,amountMinor:s.amountMinor,originalBlankPaymentChannelPreserved:true,noAdjacentSponsorBankOrProductCredit:true});
 }
 return result;
}
function addUnallocatedNativeBankServiceCash(transactions,observations,accounts,cashPostings,plans,{unallocatedSourceIds=new Set(),annotations=[],links=[]}={}){
 if(!unallocatedSourceIds.size)return plans;
 const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),latest=new Map(),am=new Map(accounts.map(a=>[a.id,a]));for(const o of observations)if(!latest.has(key(o))||(o.sourceVersionOrdinal||0)>(latest.get(key(o)).sourceVersionOrdinal||0))latest.set(key(o),o);
 const rows=[...latest.values()],proofs=require('./walletStatementTopUps').validatedWalletProofs(rows,am),byId=new Map(observations.map(o=>[o.id,o])),proofById=new Map(proofs.map(p=>[p.observation.id,p])),occupied=new Set(),edited=new Set(annotations.map(a=>byId.get(a.observationId)).filter(Boolean).map(key)),proposals=[];
 for(const list of plans.values())for(const plan of list)for(const id of plan.proofObservationIds||[])if(byId.has(id))occupied.add(key(byId.get(id)));
 for(const t of transactions){
  if(t.kind!=='expense'||t.status!=='completed'||t.sources.length!==1||t.reportingAccountIds.length||Object.values(t.balanceEffects).some(v=>BigInt(v)!==0n)||Object.values(t.cashEffects).some(v=>BigInt(v)!==0n))continue;
  const s=t.sources[0],cash=cashPostings.get(s.id),negative=proofById.get(cash?.proofObservationId),debit=negative?.observation,amount=BigInt(s.amountMinor);
  if(!unallocatedSourceIds.has(s.id)||!isLegacyTelecomServiceFormat(s.description)||refreshTelecomServicePurchase({...s,kind:'transfer',automaticClassification:undefined}).kind!=='expense'||!require('./mixedPayments').actualSecond(s)||s.paymentChannel||s.paymentAccountHint||s.accountRelations?.length||cash?.method!=='native_order_wallet_cash_posting'||cash.sourceObservationId!==s.id||cash.financialAccountId!==s.financialAccountId||cash.deltaMinor!==String(-amount)||!debit||negative.bank!=='\u652f\u4ed8\u5b9d'||negative.incoming!==0n||negative.outgoing!==-amount||debit.relatedReference!==s.sourceTransactionId||debit.date!==s.date||!/^\u652f\u4ed8-\u751f\u6d3b\u670d\u52a1\d+$/.test(debit.description))continue;
  const delay=Date.parse(debit.occurredAt)-Date.parse(s.occurredAt),previous=proofs.filter(p=>p.observation.financialAccountId===s.financialAccountId&&p.observation.importId===debit.importId&&p.observation.balanceEvidence.sequence===debit.balanceEvidence.sequence-1);if(delay<0||delay>86400000||previous.length!==1)continue;
  const positive=previous[0],credit=positive.observation,gap=Date.parse(debit.occurredAt)-Date.parse(credit.occurredAt);
  if(positive.incoming!==amount||positive.outgoing!==0n||!positive.bank.endsWith('\u94f6\u884c')||!['\u5145\u503c','\u5145\u503c\u4ea4\u6613\u6210\u529f'].includes(credit.description)||credit.date!==s.date||gap<0||gap>2000||[credit,debit].some(o=>occupied.has(key(o))||edited.has(key(o))))continue;
  const rivals=proofs.filter(p=>{const o=p.observation,delta=Date.parse(debit.occurredAt)-Date.parse(o.occurredAt);return o.financialAccountId===s.financialAccountId&&o.importId===debit.importId&&p.incoming>0n&&p.bank.endsWith('\u94f6\u884c')&&['\u5145\u503c','\u5145\u503c\u4ea4\u6613\u6210\u529f'].includes(o.description)&&delta>=0&&delta<=2000;});if(rivals.length!==1)continue;
  const members=new Set([s,credit,debit].map(key)),cashKeys=new Set([credit,debit].map(key)),blocked=links.some(l=>{const ids=(l.observationIds||[]).map(id=>byId.get(id)).filter(Boolean).map(key);return l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)&&ids.some(id=>members.has(id))||l.type==='duplicate'&&ids.some(id=>cashKeys.has(id))&&(l.status==='deleted'||ids.length!==(l.observationIds||[]).length||ids.some(id=>!members.has(id)));});
  proposals.push({t,s,credit,debit,amount,bank:positive.bank,blocked,members:[s,credit,debit]});
 }
 const uses=new Map();for(const p of proposals)for(const o of p.members)uses.set(key(o),(uses.get(key(o))||0)+1);
 for(const p of proposals){if(p.blocked||p.members.some(o=>uses.get(key(o))!==1))continue;
  const plan={financialAccountId:p.s.financialAccountId,sourceObservationId:p.s.id,method:'native_wallet_intermediary_postings',path:'unallocated_bank_top_up_and_service_payment',confidence:'explicit_native_cash_with_bank_card_identity_unknown',cashEvidenceConfidence:'explicit_original_cash_postings',amountMinor:String(p.amount),netDeltaMinor:'0',proofObservationIds:[p.credit.id,p.debit.id],payerAccountId:null,nativeBankName:p.bank,nativeStatementCardTailPrinted:false,economicPayerStillUnallocated:true,expenseStillRequiresReview:true,noBankAccountCreated:true,noBankOrDebtPostingInferred:true,reversible:true,events:[{occurredAt:p.credit.occurredAt,date:p.credit.date,deltaMinor:p.amount,observationId:p.credit.id},{occurredAt:p.debit.occurredAt,date:p.debit.date,deltaMinor:-p.amount,observationId:p.debit.id}]};
  plans.set(p.t.id,[...(plans.get(p.t.id)||[]),plan]);
 }
 return plans;
}
module.exports={isTelecomServicePurchase,isLegacyTelecomServiceFormat,refreshTelecomServicePurchase,findNativeTelecomWalletFunding,addUnallocatedNativeBankServiceCash};
