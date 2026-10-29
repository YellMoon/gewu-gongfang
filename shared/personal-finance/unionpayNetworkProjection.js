'use strict';
const {planUnionpayNetworkEvidence}=require('./unionpayNetworkReconciliation');
const {buildReviewSummary}=require('./reviewSummary');
const within=(date,o)=>(!o.startDate||date>=o.startDate)&&(!o.endDate||date<=o.endDate);
const fail=()=>{throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_NETWORK_ACCOUNT_MISMATCH'),{code:'CLOUD_PERSONAL_FINANCE_NETWORK_ACCOUNT_MISMATCH'});};
function buildNetworkFinanceView(ledger,options,buildFinanceView){
 const records=ledger.observations.filter(o=>o.bankNetwork),economic=ledger.observations.filter(o=>!o.bankNetwork),economicIds=new Set(economic.map(o=>o.id)),accountMap=new Map((ledger.accounts||[]).map(a=>[a.id,a]));
 for(const record of records){
  require('./ledger').validateRecord(record);const a=accountMap.get(record.financialAccountId),e=record.bankNetwork;
  if(record.provider!=='unionpay'||!a||!['active','archived'].includes(a.status)||!['debit_card','credit_card'].includes(a.type)||a.currency!=='CNY'||a.provider!==e.bank||a.maskedIdentifier!==e.cardTail||!record.bankAccount||record.bankAccount.type!==a.type)fail();
 }
 const baseLedger={...ledger,observations:economic,annotations:(ledger.annotations||[]).filter(a=>economicIds.has(a.observationId)),links:(ledger.links||[]).filter(l=>(l.observationIds||[]).every(id=>economicIds.has(id)))};
 // Association decisions use the complete history and must not change when the
 // user changes account/date filters. Existing financial calculations run once
 // for an unfiltered view and are never replayed from supplemental network rows.
 const initialFull=buildFinanceView(baseLedger,{}),initialPlan=planUnionpayNetworkEvidence({records,accounts:ledger.accounts||[],transactions:initialFull.transactions,annotations:ledger.annotations,links:ledger.links});
 const postingRuntime=require('./nativeNetworkPostings'),postings=postingRuntime.findNativeNetworkPostings(ledger,initialFull,initialPlan),postedIds=new Set(postings.map(p=>p.sourceObservationId)),postingMap=new Map(postings.map(p=>[p.sourceObservationId,p])),pairs=postingRuntime.findNativeRepaymentPostingPairs(records,postings,ledger.accounts||[],ledger.links||[],initialFull.transactions),participatingIds=new Set([...economicIds,...postedIds]);
 const financialLedger=postings.length?{...baseLedger,observations:[...economic,...records.filter(r=>postedIds.has(r.id)).map(r=>postingRuntime.materializeNativeNetworkPosting(r,postingMap.get(r.id)))],annotations:(ledger.annotations||[]).filter(a=>participatingIds.has(a.observationId)),links:[...(ledger.links||[]).filter(l=>(l.observationIds||[]).every(id=>participatingIds.has(id))),...pairs.map((p,i)=>({id:'native_repayment_projection_'+i,type:'transfer',observationIds:p.observationIds}))]}:baseLedger;
 const full=postings.length?buildFinanceView(financialLedger,{}):initialFull,view=Object.keys(options).length?buildFinanceView(financialLedger,options):full;
 const plan=planUnionpayNetworkEvidence({records:records.filter(r=>!postedIds.has(r.id)),accounts:ledger.accounts||[],transactions:full.transactions,annotations:ledger.annotations,links:ledger.links});
 if(postings.length){plan.summary.sourceRows=records.length;plan.summary.postedRows=postings.length;plan.postings=postings;plan.postingAssociations=pairs;}
 if(plan.identities.length)fail();
 const sourceById=new Map(records.map(r=>[r.id,r])),transactions=view.transactions.map(t=>({...t,observationIds:[...t.observationIds],sources:[...t.sources],automaticAssociations:[...t.automaticAssociations],selectedObservationIds:[...t.selectedObservationIds]})),byId=new Map(transactions.map(t=>[t.id,t]));
 const selected=new Set(options.accountIds||(ledger.accounts||[]).map(a=>a.id));
 for(const t of transactions){
  const proofs=t.observationIds.filter(id=>postedIds.has(id)).map(id=>postingMap.get(id));if(!proofs.length)continue;
  t.sources=t.sources.map(s=>sourceById.get(s.id)||s);t.networkEvidenceStatus='posted_native_account_movement';t.nativeNetworkPostingProofs=proofs;
  t.automaticAssociations.push(...pairs.filter(p=>p.observationIds.some(id=>t.observationIds.includes(id))));
 }
 for(const match of plan.matches){
  const evidence={...match,sourceScope:'channel_only',postingDatesPreserved:true},association={method:match.method,confidence:match.confidence,observationIds:[...match.existingObservationIds,...match.networkObservationIds],evidence};
  for(const id of match.transactionIds){
   const t=byId.get(id);if(!t)continue;t.automaticAssociations.push(association);
   if(['reciprocal_unique','owner_selected_original'].includes(match.individualIdentity))for(const id of match.networkObservationIds){const s=sourceById.get(id);if(!s)throw new Error('Missing network source');t.observationIds.push(id);t.sources.push(s);if(selected.has(s.financialAccountId))t.selectedObservationIds.push(id);}
  }
 }
 const issues=[...view.unresolvedAssociations];
 // Correcting a native receipt's purpose cannot erase its actual card leg or
 // turn an unidentified internal-transfer counterpart into a completed match.
 const hasActualMixedBankPeer=(t,p)=>{
  const e=p.mixedTransferEvidence;if(!e||t.balanceEffects[e.payerAccountId]!==String(-BigInt(e.amountMinor)))return false;
  const link=(ledger.links||[]).find(l=>l.id===e.linkId&&l.type==='transfer'&&l.status!=='deleted'&&!l.deletedAt&&l.deleted!==true&&l.observationIds?.length===2&&l.observationIds.includes(e.nativeObservationId)&&l.observationIds.includes(e.bankObservationId));if(!link)return false;
  // Ordinary transfers retain one statement row per side. Check the full
  // financial view so selecting only one account does not revoke its pairing.
  const peers=full.transactions.filter(x=>x.observationIds.includes(e.bankObservationId)&&x.status==='completed'&&x.kind==='transfer'&&x.currency===t.currency&&x.balanceEffects[e.receivingAccountId]===e.amountMinor);
  return peers.length===1;
 };
 for(const t of transactions)if(t.nativeNetworkPostingProofs?.some(p=>p.kind==='transfer')&&Object.values(t.balanceEffects).filter(v=>BigInt(v)!==0n).length<2&&!t.nativeNetworkPostingProofs.some(p=>p.kind==='transfer'&&hasActualMixedBankPeer(t,p)))issues.push({reason:'unresolved_account_movement',observationId:t.nativeNetworkPostingProofs.find(p=>p.kind==='transfer').sourceObservationId,basis:'native_owner_transfer_requires_counter_account'});
 const heldById=new Map(plan.held.map(h=>[h.observationId,h])),nonCashIds=new Set(plan.nonCash.map(h=>h.observationId));
 for(const source of records){
  const held=heldById.get(source.id),noncash=nonCashIds.has(source.id);if(!held&&!noncash)continue;
  if(!selected.has(source.financialAccountId)||!within(source.date,options))continue;
  // Unmatched channel evidence is visible as unresolved intake, not a second
  // expenditure. Its actual source amount, sign and status remain unchanged.
  const t={...source,id:source.id,networkEvidenceStatus:noncash?'noncash_authorization':'held_for_reconciliation',networkEvidence:held||{reason:'native_frozen_authorization'},observationIds:[source.id],sources:[source],financialAccountIds:[source.financialAccountId],reportingAccountIds:[],selectedObservationIds:[source.id],automaticAssociations:[],appliedAnnotations:(ledger.annotations||[]).filter(a=>a.observationId===source.id),investmentConfirmations:[],incomeExpenseAllocations:null,coveredEffects:[],statisticsExclusions:[],pendingConsumptionMinor:'0',pendingIncomeMinor:'0',consumptionMinor:'0',incomeMinor:'0',selectedConsumptionMinor:'0',selectedIncomeMinor:'0',balanceEffects:{},balanceEffectTimes:{},cashEffects:{},relatedTransactionId:null,reconciliationGroup:null,repaymentType:null,mortgageSplit:null};
  transactions.push(t);
  if(held)issues.push({reason:'unknown_kind',observationId:source.id,basis:'network_evidence_requires_reconciliation_before_financial_posting',nativeCaptureRecordId:source.bankNetwork.recordId,networkReason:held.reason,candidateTransactionIds:held.candidateTransactionIds});
 }
 transactions.sort((a,b)=>b.date.localeCompare(a.date)||b.occurredAt.localeCompare(a.occurredAt)||a.id.localeCompare(b.id));
 return {...view,transactions,unresolvedAssociations:issues,review:buildReviewSummary(issues,transactions,ledger.accounts||[]),networkEvidence:{...plan,scope:'channel_only',cashPostingPolicy:postings.length?'new_verified_account_movements_posted_with_originals_preserved;remaining_unmatched_rows_are_visible_intake':'matched_rows_are_supplemental_evidence_unmatched_rows_remain_visible_intake',financialPostingApplied:postings.length>0,sourceRowsRemainImmutable:true,allIndependentPostingDatesPreserved:true},reconciliationGroups:[...view.reconciliationGroups,...plan.matches.filter(m=>m.individualIdentity==='undetermined_within_group')]};
}
function prepareNetworkFinanceView(ledger,prepareCore){
 const records=ledger.observations.filter(o=>o.bankNetwork),economic=ledger.observations.filter(o=>!o.bankNetwork),economicIds=new Set(economic.map(o=>o.id)),accountMap=new Map((ledger.accounts||[]).map(a=>[a.id,a]));
 for(const record of records){
  require('./ledger').validateRecord(record);const a=accountMap.get(record.financialAccountId),e=record.bankNetwork;
  if(record.provider!=='unionpay'||!a||!['active','archived'].includes(a.status)||!['debit_card','credit_card'].includes(a.type)||a.currency!=='CNY'||a.provider!==e.bank||a.maskedIdentifier!==e.cardTail||!record.bankAccount||record.bankAccount.type!==a.type)fail();
 }
 const baseLedger={...ledger,observations:economic,annotations:(ledger.annotations||[]).filter(a=>economicIds.has(a.observationId)),links:(ledger.links||[]).filter(l=>(l.observationIds||[]).every(id=>economicIds.has(id)))};
 // Association decisions use the complete history and must not change when the
 // user changes account/date filters. Existing financial calculations run once
 // for an unfiltered view and are never replayed from supplemental network rows.
 let initialCore=prepareCore(baseLedger),initialFull=initialCore({}),initialPlan=planUnionpayNetworkEvidence({records,accounts:ledger.accounts||[],transactions:initialFull.transactions,annotations:ledger.annotations,links:ledger.links});
 const postingRuntime=require('./nativeNetworkPostings'),postings=postingRuntime.findNativeNetworkPostings(ledger,initialFull,initialPlan),postedIds=new Set(postings.map(p=>p.sourceObservationId)),postingMap=new Map(postings.map(p=>[p.sourceObservationId,p])),pairs=postingRuntime.findNativeRepaymentPostingPairs(records,postings,ledger.accounts||[],ledger.links||[],initialFull.transactions),participatingIds=new Set([...economicIds,...postedIds]);
 const financialLedger=postings.length?{...baseLedger,observations:[...economic,...records.filter(r=>postedIds.has(r.id)).map(r=>postingRuntime.materializeNativeNetworkPosting(r,postingMap.get(r.id)))],annotations:(ledger.annotations||[]).filter(a=>participatingIds.has(a.observationId)),links:[...(ledger.links||[]).filter(l=>(l.observationIds||[]).every(id=>participatingIds.has(id))),...pairs.map((p,i)=>({id:'native_repayment_projection_'+i,type:'transfer',observationIds:p.observationIds}))]}:baseLedger;
 // Release the first reconciliation graph before preparing posted movements.
 // Keeping both graphs and their serialized originals doubles peak memory.
 if(postings.length){initialCore=null;initialFull=null;initialPlan=null;}
 const projectCore=postings.length?prepareCore(financialLedger):initialCore;
 let full=postings.length?projectCore({}):initialFull;
 const savedPlan=planUnionpayNetworkEvidence({records:records.filter(r=>!postedIds.has(r.id)),accounts:ledger.accounts||[],transactions:full.transactions,annotations:ledger.annotations,links:ledger.links});
 if(postings.length){savedPlan.summary.sourceRows=records.length;savedPlan.summary.postedRows=postings.length;savedPlan.postings=postings;savedPlan.postingAssociations=pairs;}
 if(savedPlan.identities.length)fail();
 // Future scopes need only these immutable peer facts from the global view.
 const mixedBankPeers=full.transactions.filter(x=>x.status==='completed'&&x.kind==='transfer').map(({observationIds,currency,balanceEffects})=>({observationIds,currency,balanceEffects}));
 full=null;initialCore=null;initialFull=null;initialPlan=null;
 return function projectNetwork(options={}){
 const view=projectCore(options),plan=require('./preparedScopeSelection').clonePreparedValue(savedPlan);
 const sourceById=new Map(records.map(r=>[r.id,r])),transactions=view.transactions.map(t=>({...t,observationIds:[...t.observationIds],sources:[...t.sources],automaticAssociations:[...t.automaticAssociations],selectedObservationIds:[...t.selectedObservationIds]})),byId=new Map(transactions.map(t=>[t.id,t]));
 const selected=new Set(options.accountIds||(ledger.accounts||[]).map(a=>a.id));
 for(const t of transactions){
  const proofs=t.observationIds.filter(id=>postedIds.has(id)).map(id=>postingMap.get(id));if(!proofs.length)continue;
  t.sources=t.sources.map(s=>sourceById.get(s.id)||s);t.networkEvidenceStatus='posted_native_account_movement';t.nativeNetworkPostingProofs=proofs;
  t.automaticAssociations.push(...pairs.filter(p=>p.observationIds.some(id=>t.observationIds.includes(id))));
 }
 for(const match of plan.matches){
  const evidence={...match,sourceScope:'channel_only',postingDatesPreserved:true},association={method:match.method,confidence:match.confidence,observationIds:[...match.existingObservationIds,...match.networkObservationIds],evidence};
  for(const id of match.transactionIds){
   const t=byId.get(id);if(!t)continue;t.automaticAssociations.push(association);
   if(['reciprocal_unique','owner_selected_original'].includes(match.individualIdentity))for(const id of match.networkObservationIds){const s=sourceById.get(id);if(!s)throw new Error('Missing network source');t.observationIds.push(id);t.sources.push(s);if(selected.has(s.financialAccountId))t.selectedObservationIds.push(id);}
  }
 }
 const issues=[...view.unresolvedAssociations];
 // Correcting a native receipt's purpose cannot erase its actual card leg or
 // turn an unidentified internal-transfer counterpart into a completed match.
 const hasActualMixedBankPeer=(t,p)=>{
  const e=p.mixedTransferEvidence;if(!e||t.balanceEffects[e.payerAccountId]!==String(-BigInt(e.amountMinor)))return false;
  const link=(ledger.links||[]).find(l=>l.id===e.linkId&&l.type==='transfer'&&l.status!=='deleted'&&!l.deletedAt&&l.deleted!==true&&l.observationIds?.length===2&&l.observationIds.includes(e.nativeObservationId)&&l.observationIds.includes(e.bankObservationId));if(!link)return false;
  // Ordinary transfers retain one statement row per side. Check the full
  // financial view so selecting only one account does not revoke its pairing.
  const peers=mixedBankPeers.filter(x=>x.observationIds.includes(e.bankObservationId)&&x.currency===t.currency&&x.balanceEffects[e.receivingAccountId]===e.amountMinor);
  return peers.length===1;
 };
 for(const t of transactions)if(t.nativeNetworkPostingProofs?.some(p=>p.kind==='transfer')&&Object.values(t.balanceEffects).filter(v=>BigInt(v)!==0n).length<2&&!t.nativeNetworkPostingProofs.some(p=>p.kind==='transfer'&&hasActualMixedBankPeer(t,p)))issues.push({reason:'unresolved_account_movement',observationId:t.nativeNetworkPostingProofs.find(p=>p.kind==='transfer').sourceObservationId,basis:'native_owner_transfer_requires_counter_account'});
 const heldById=new Map(plan.held.map(h=>[h.observationId,h])),nonCashIds=new Set(plan.nonCash.map(h=>h.observationId));
 for(const source of records){
  const held=heldById.get(source.id),noncash=nonCashIds.has(source.id);if(!held&&!noncash)continue;
  if(!selected.has(source.financialAccountId)||!within(source.date,options))continue;
  // Unmatched channel evidence is visible as unresolved intake, not a second
  // expenditure. Its actual source amount, sign and status remain unchanged.
  const t={...source,id:source.id,networkEvidenceStatus:noncash?'noncash_authorization':'held_for_reconciliation',networkEvidence:held||{reason:'native_frozen_authorization'},observationIds:[source.id],sources:[source],financialAccountIds:[source.financialAccountId],reportingAccountIds:[],selectedObservationIds:[source.id],automaticAssociations:[],appliedAnnotations:(ledger.annotations||[]).filter(a=>a.observationId===source.id),investmentConfirmations:[],incomeExpenseAllocations:null,coveredEffects:[],statisticsExclusions:[],pendingConsumptionMinor:'0',pendingIncomeMinor:'0',consumptionMinor:'0',incomeMinor:'0',selectedConsumptionMinor:'0',selectedIncomeMinor:'0',balanceEffects:{},balanceEffectTimes:{},cashEffects:{},relatedTransactionId:null,reconciliationGroup:null,repaymentType:null,mortgageSplit:null};
  transactions.push(t);
  if(held)issues.push({reason:'unknown_kind',observationId:source.id,basis:'network_evidence_requires_reconciliation_before_financial_posting',nativeCaptureRecordId:source.bankNetwork.recordId,networkReason:held.reason,candidateTransactionIds:held.candidateTransactionIds});
 }
 transactions.sort((a,b)=>b.date.localeCompare(a.date)||b.occurredAt.localeCompare(a.occurredAt)||a.id.localeCompare(b.id));
 return {...view,transactions,unresolvedAssociations:issues,review:buildReviewSummary(issues,transactions,ledger.accounts||[]),networkEvidence:{...plan,scope:'channel_only',cashPostingPolicy:postings.length?'new_verified_account_movements_posted_with_originals_preserved;remaining_unmatched_rows_are_visible_intake':'matched_rows_are_supplemental_evidence_unmatched_rows_remain_visible_intake',financialPostingApplied:postings.length>0,sourceRowsRemainImmutable:true,allIndependentPostingDatesPreserved:true},reconciliationGroups:[...view.reconciliationGroups,...plan.matches.filter(m=>m.individualIdentity==='undetermined_within_group')]};
 };
}
module.exports={buildNetworkFinanceView,prepareNetworkFinanceView};
