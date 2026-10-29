'use strict';
// A manual duplicate link identifies one already-posted original. It supplies
// identity only; it cannot introduce a bank movement or certify captured time.
function findOwnerNativeCashEvidence(records,accounts,transactions,{annotations=[],links=[],bankLeg}={}){
 const nativeIds=new Set(records.map(r=>r.id||r.bankNetwork.recordId)),am=new Map(accounts.map(a=>[a.id,a])),latestAnnotations=new Map(),bySource=new Map();
 for(const a of annotations){const old=latestAnnotations.get(a.observationId);if(!old||BigInt(a.revision)>BigInt(old.revision))latestAnnotations.set(a.observationId,a);}
 for(const t of transactions)for(const s of t.sources||[]){if(!bySource.has(s.id))bySource.set(s.id,[]);bySource.get(s.id).push({t,s});}
 const active=l=>l.status!=='deleted'&&!l.deletedAt&&l.deleted!==true,out=[];
 for(const r of records){
  const id=r.id||r.bankNetwork.recordId,e=r.bankNetwork,a=am.get(r.financialAccountId),ann=latestAnnotations.get(id);
  if(r.status!=='completed'||e.nativeStatus==='frozen'||!['debit','credit'].includes(r.direction)||ann&&!ann.reset||!a||!['active','archived'].includes(a.status)||!['debit_card','credit_card'].includes(a.type)||a.provider!==e.bank||a.maskedIdentifier!==e.cardTail||a.currency!==r.currency)continue;
  const involving=links.filter(l=>(l.observationIds||[]).includes(id)&&active(l));if(involving.length!==1)continue;
  const link=involving[0];if(link.type!=='duplicate'||link.source!=='manual'||typeof link.id!=='string'||!link.id||typeof link.note!=='string'||!link.note.trim()||typeof link.createdAt!=='string'||!Number.isFinite(Date.parse(link.createdAt))||link.observationIds.length!==2||new Set(link.observationIds).size!==2)continue;
  const other=link.observationIds.find(x=>x!==id);if(nativeIds.has(other))continue;
  const candidates=bySource.get(other)||[];if(candidates.length!==1)continue;const {t,s}=candidates[0];
  if(t.status!=='completed'||t.kind==='unknown'||t.currency!==r.currency||!bankLeg?.(r,s,a.id)||String(t.balanceEffects[a.id]||0)!==String(BigInt(r.amountMinor)*(r.direction==='credit'?1n:-1n)))continue;
  if(links.some(l=>active(l)&&['distinct','group_distinct'].includes(l.type)&&(l.observationIds||[]).includes(other)))continue;
  const sameIdentity=t.sources.filter(p=>p.financialAccountId===s.financialAccountId&&p.provider===s.provider&&(p.sourceIdentity||p.id)===(s.sourceIdentity||s.id)),newest=Math.max(...sameIdentity.map(p=>p.sourceVersionOrdinal||0));if(sameIdentity.some(p=>(p.sourceVersionOrdinal||0)===newest&&(p.id!==s.id||p.status!=='completed')))continue;
  out.push({method:'owner_confirmed_native_existing_cash_evidence',confidence:'owner_confirmed',captureRecordIds:[e.recordId],networkObservationIds:[id],transactionIds:[t.id],existingObservationIds:[...t.observationIds],financialAccountId:a.id,date:r.date,deltaMinor:String(BigInt(r.amountMinor)*(r.direction==='credit'?1n:-1n)),currency:r.currency,networkCount:1,existingEconomicEventCount:1,individualIdentity:'owner_selected_original',dateBasis:[e.dateBasis],timeUsedForMatching:false,reversible:true,noNewCash:true,noNewIncomeOrConsumption:true,preservesOwnerClassification:true,ownerSelectionEvidence:{schema:'owner-native-original-cash-selection-v1',linkId:link.id,nativeObservationId:id,bankObservationId:s.id,ownerNote:link.note,confirmedAt:link.createdAt,selectionBasis:'owner_explicit_original_transaction_identity',nativeDisplayedTimeAccuracyClaimed:false,originalBankDatesAndTimesPreserved:true,noGeneralUnequalSubsetMatchInferred:true}});
 }
 const uses=new Map();for(const m of out)for(const id of m.transactionIds)uses.set(JSON.stringify([m.financialAccountId,id]),(uses.get(JSON.stringify([m.financialAccountId,id]))||0)+1);
 return out.filter(m=>m.transactionIds.every(id=>uses.get(JSON.stringify([m.financialAccountId,id]))===1));
}
module.exports={findOwnerNativeCashEvidence};
