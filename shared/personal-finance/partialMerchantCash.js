'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const {unclassifiedMerchantCredit}=require('./legacyMerchantReceipts');
const {annotatedSettlementAccount,isSettlementAccount}=require('./counterpartySettlements');
const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
function findPartialMerchantCash(ledger,annotations){
 if(![...annotations.values()].some(a=>!a.reset&&a.patch?.settlementAccountId))return new Map();
 const latest=new Map(),ties=new Set();for(const o of ledger.observations||[]){const k=key(o),old=latest.get(k),v=o.sourceVersionOrdinal||0;if(!old||v>(old.sourceVersionOrdinal||0)){latest.set(k,o);ties.delete(k);}else if(v===(old.sourceVersionOrdinal||0)&&old.id!==o.id)ties.add(k);}
 const rows=[...latest.values()],accounts=ledger.accounts||[],am=new Map(accounts.map(a=>[a.id,a])),validated=new Map(validatedWalletProofs(rows,am).map(p=>[p.observation.id,p])),out=new Map();
 const byRef=new Map(),orders=new Map();for(const o of rows){const k=JSON.stringify([o.financialAccountId,o.balanceEvidence?o.relatedReference:o.sourceTransactionId]);const map=o.balanceEvidence?byRef:orders;if(!map.has(k))map.set(k,[]);map.get(k).push(o);}
 for(const source of rows){
  const a=annotations.get(source.id),patch=a?.reset?null:a?.patch;
  if(!patch||patch.kind!=='transfer'||typeof patch.settlementAccountId!=='string'||Object.keys(patch).some(k=>!['kind','category','settlementAccountId'].includes(k))||source.balanceEvidence||ties.has(key(source))||!unclassifiedMerchantCredit(source,source,accounts)||source.paymentChannel||source.paymentAccountHint||source.rawFields?.['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==''||source.rawFields?.['\u4ea4\u6613\u65f6\u95f4']!==source.date+' '+source.occurredAt.slice(11,19))continue;
  let target;try{target=annotatedSettlementAccount({...source,...patch},a,accounts);}catch{continue;}if(!isSettlementAccount(target))continue;
  const k=JSON.stringify([source.financialAccountId,source.sourceTransactionId]),peers=orders.get(k)||[],natives=byRef.get(k)||[];
  // A second original, even one edited or otherwise unusable, prevents a
  // partial capture from appearing to prove a complete one-to-one receipt.
  if(peers.length!==1||natives.length!==1)continue;const proof=natives[0],cash=validated.get(proof.id),delay=Date.parse(proof.occurredAt)-Date.parse(source.occurredAt);
  if(!cash||ties.has(key(proof))||annotations.has(proof.id)||cash.bank!=='\u652f\u4ed8\u5b9d'||cash.incoming<=0n||cash.outgoing!==0n||cash.incoming>=BigInt(source.amountMinor)||proof.description!=='\u4ea4\u6613\u4ed8\u6b3e'||proof.currency!==source.currency||!Number.isFinite(delay)||delay<0||delay>31*86400000)continue;
  const ids=new Set([source.id,proof.id]);if((ledger.links||[]).some(l=>(l.observationIds||[]).some(id=>ids.has(id))&&(l.status!=='deleted'&&!l.deletedAt&&l.deleted!==true||['duplicate','transfer'].includes(l.type))))continue;
  const delta=String(cash.incoming),partialMerchantSettlement={schema:'partial-merchant-settlement-cash-v1',originalGrossMinor:source.amountMinor,confirmedCashMinor:delta,unexplainedDifferenceMinor:String(BigInt(source.amountMinor)-cash.incoming),settlementAccountId:target.id,ownerAnnotationId:a.id,unconfirmedDifferenceIsNotAnAsset:true,differenceTreatment:'not_assumed_refund_or_receivable'};
  out.set(source.id,{method:'native_partial_merchant_settlement_cash_posting',sourceObservationId:source.id,proofObservationId:proof.id,financialAccountId:source.financialAccountId,deltaMinor:delta,sourceOccurredAt:source.occurredAt,occurredAt:proof.occurredAt,date:proof.date,confidence:'explicit_original_cash_and_owner_confirmed_payable',ownerPurposePreserved:true,partialMerchantSettlement,reversible:true});
 }
 return out;
}
function partialMerchantPlanCompatible(sources,p,cashEffects,balanceEffects){
 const e=p.partialMerchantSettlement,s=sources[0],a=s?.automaticClassification;
 if(p.method!=='native_partial_merchant_settlement_cash_posting'||e?.schema!=='partial-merchant-settlement-cash-v1'||sources.length!==1||s.id!==p.sourceObservationId||s.financialAccountId!==p.financialAccountId||s.amountMinor!==e.originalGrossMinor||s.kind!=='transfer'||s.direction!=='credit'||a?.method!=='owner_confirmed_counterparty_settlement'||a.financialAccountId!==e.settlementAccountId||s.automaticFunding||s.withdrawalDestination||s.automaticRepaymentTarget||s.settlementAccountId!==e.settlementAccountId||BigInt(p.deltaMinor)<=0n||BigInt(p.deltaMinor)>=BigInt(s.amountMinor)||e.confirmedCashMinor!==p.deltaMinor||e.unconfirmedDifferenceIsNotAnAsset!==true)return false;
 const expected=new Map([[p.financialAccountId,BigInt(s.amountMinor)],[e.settlementAccountId,-BigInt(s.amountMinor)]]);return cashEffects.size===1&&cashEffects.get(p.financialAccountId)===BigInt(s.amountMinor)&&balanceEffects.size===2&&[...balanceEffects].every(([id,n])=>expected.get(id)===n);
}
module.exports={findPartialMerchantCash,partialMerchantPlanCompatible};
