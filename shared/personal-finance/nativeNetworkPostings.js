'use strict';
const day=iso=>{const t=Date.parse(iso);return Number.isFinite(t)?new Date(t+8*3600000).toISOString().slice(0,10):null;};
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const normalized=value=>String(value||'').normalize('NFKC').replace(/\s/g,'');
function literalMerchantService(record){
 const title=normalized(record.description.split('_')[0]);
 if(/\u8f68\u9053\u4ea4\u901a|\u516c\u5171\u4ea4\u901a|\u4e2d\u56fd\u94c1\u8def\u7f51\u7edc\u6709\u9650\u516c\u53f8|\u987a\u98ce\u8f66\u6253\u8f66/.test(title))return '\u4ea4\u901a\u51fa\u884c\uff08\u539f\u59cb\u5546\u6237\u540d\u79f0\u63a8\u7b97\u3001\u53ef\u4fee\u6539\uff09';
 if(/\u9910\u5385|\u9910\u996e|\u5c0f\u5403|\u725b\u8089\u6c64|\u7c73\u7c89|\u51c9\u76ae|\u70eb\u635e|\u5b85\u6025\u9001/.test(title))return '\u9910\u996e\uff08\u539f\u59cb\u5546\u6237\u540d\u79f0\u63a8\u7b97\u3001\u53ef\u4fee\u6539\uff09';
 return require('./nativeRetailMerchantServices').namedRetailMerchantService(record)?.suggestedCategory||null;
}
function distinctNativePeerGroup(peers){
 if(peers.length<2)return null;const first=peers[0];
 if(peers.some(r=>r.direction!=='debit'||r.bankNetwork.nativeStatus!=='settled'||r.bankNetwork.dateBasis!=='visible_date_label'||r.currency!==first.currency||r.description!==first.description||r.bankNetwork.sourceSha256!==first.bankNetwork.sourceSha256))return null;
 const texts=peers.map(r=>JSON.stringify(r.rawFields.nativeRowText));if(new Set(texts).size!==peers.length||new Set(peers.map(r=>r.bankNetwork.displayedTime)).size!==peers.length)return null;
 return {schema:'native-distinct-printed-rows-v1',observationIds:peers.map(r=>r.id),sourceDocumentSha256:first.bankNetwork.sourceSha256,distinctPrintedRowCount:peers.length,identityBasis:'different_immutable_original_list_row_text',timeUsedForMatching:false,bankTransactionIdsClaimed:false};
}
function intakeBaseline(ledger,importId){
 const imports=new Map((ledger.imports||[]).map(i=>[i.id,i])),intake=imports.get(importId),at=Date.parse(intake?.createdAt);
 if(intake?.provider!=='unionpay'||!Number.isFinite(at))return null;
 const dates=[];
 for(const o of ledger.observations||[]){
  if(o.bankNetwork)continue;const source=imports.get(o.importId),created=Date.parse(source?.createdAt||o.createdAt);
  if(Number.isFinite(created)&&created>at)continue;
  for(const d of [o.date,day(o.occurredAt),o.bankStatement?.postedDate])if(date(d))dates.push(d);
 }
 for(const s of ledger.balanceSnapshots||[]){const created=Date.parse(s.createdAt);if(Number.isFinite(created)&&created>at)continue;const d=day(s.asOf);if(date(d))dates.push(d);}
 return dates.length?{schema:'native-network-intake-baseline-v1',intakeImportId:importId,intakeCreatedAt:intake.createdAt,knownSourceDateThrough:dates.sort().at(-1),basis:'sources_and_balance_anchors_acquired_by_native_import_time'}:null;
}
function ownerMixedBankTransfer(record,annotation,link,ledger,baseView){
 const repayment=require('./nativeOwnerBankRepayment').ownerNativeBankRepayment(record,annotation,link,ledger,baseView);if(repayment)return repayment;
 const named=require('./nativeNamedBankTransfers').nativeNamedBankTransfer(record,annotation,link,ledger,baseView);if(named)return named;
 if(annotation?.reset||annotation?.patch?.kind!=='transfer'||record.direction!=='debit'||record.bankAccount?.type!=='debit_card'||link.type!=='transfer'||link.status==='deleted'||link.deletedAt||link.deleted===true||link.observationIds?.length!==2)return null;
 const active=(ledger.links||[]).filter(l=>(l.observationIds||[]).includes(record.id)&&l.status!=='deleted'&&!l.deletedAt&&l.deleted!==true);if(active.length!==1)return null;
 const otherId=link.observationIds.find(id=>id!==record.id),source=ledger.observations.find(o=>o.id===otherId);if(!source||source.bankNetwork||source.provider!=='huaxia'||source.statementFlow?.schema!=='huaxia-debit-v1'||source.status!=='completed'||source.direction!=='credit'||source.currency!==record.currency||source.date!==record.date||source.amountMinor!==record.amountMinor||source.financialAccountId===record.financialAccountId)return null;
 const sender=ledger.accounts.find(a=>a.id===record.financialAccountId),receiver=ledger.accounts.find(a=>a.id===source.financialAccountId);if(sender?.type!=='debit_card'||receiver?.type!=='debit_card'||sender.currency!==record.currency||receiver.currency!==record.currency||source.statementFlow.incomeMinor!==record.amountMinor||source.statementFlow.expenseMinor!=='0')return null;
 const raw=source.rawFields||{},number=String(raw['\u5bf9\u65b9\u5361/\u8d26\u53f7']||''),institution=normalized(raw['\u5bf9\u65b9\u5f00\u6237\u884c']);
 const same=name=>require('./statementAccounts').statementCounterAccount({...source,rawFields:{...raw,'\u5bf9\u65b9\u5f00\u6237\u884c':name}},[sender,receiver])?.id===sender.id;
 const printedInstitution=same(institution)?institution:institution.endsWith('\u80a1\u4efd\u6709\u9650\u516c')&&same(institution+'\u53f8')?institution+'\u53f8':null;
 if(!/^(?:\*+|\d+)?\d{4}$/.test(number)||number.slice(-4)!==record.bankNetwork.cardTail||sender.maskedIdentifier!==record.bankNetwork.cardTail||!printedInstitution||raw['\u8bb0\u8d26\u65e5\u671f']!==record.date)return null;
 const roots=baseView.transactions.filter(t=>t.observationIds.includes(source.id));if(roots.length!==1||roots[0].kind!=='transfer'||roots[0].status!=='completed'||Object.keys(roots[0].balanceEffects).length!==1||roots[0].balanceEffects[receiver.id]!==record.amountMinor)return null;
 return {method:'owner_confirmed_native_debit_and_original_bank_receipt',linkId:link.id,nativeObservationId:record.id,bankObservationId:source.id,payerAccountId:sender.id,receivingAccountId:receiver.id,date:record.date,amountMinor:record.amountMinor,printedCounterInstitution:raw['\u5bf9\u65b9\u5f00\u6237\u884c'],comparedInstitution:printedInstitution,printedPayerCardTail:record.bankNetwork.cardTail,actualSourcesOnBothSides:true,noDerivedCounterpartCash:true,timeUsedForMatching:false,reversible:true};
}
function findNativeNetworkPostings(ledger,baseView,plan){
 const records=(ledger.observations||[]).filter(o=>o.bankNetwork),byId=new Map(records.map(o=>[o.id,o])),tx=new Map(baseView.transactions.map(t=>[t.id,t])),held=new Map(plan.held.map(h=>[h.observationId,h])),baselines=new Map(),signed=r=>BigInt(r.amountMinor)*(r.direction==='credit'?1n:-1n),key=(id,delta)=>JSON.stringify([id,String(delta)]),sourceDays=new Map(),counts=new Map();
 const distinctLinks=(ledger.links||[]).filter(l=>l.type==='distinct'&&l.status!=='deleted'&&!l.deletedAt&&l.deleted!==true),distinctNativeIds=new Set(distinctLinks.flatMap(l=>l.observationIds||[]).filter(id=>byId.has(id))),amountEvidence=new Map();
 const deltasByDay=new Map();
 const add=(id,delta,d,observationIds=[])=>{if(!date(d)||!delta)return;const k=key(id,delta);if(!sourceDays.has(k))sourceDays.set(k,new Set());sourceDays.get(k).add(d);const dk=JSON.stringify([id,d]);if(!deltasByDay.has(dk))deltasByDay.set(dk,new Set());deltasByDay.get(dk).add(String(delta));if(distinctNativeIds.size){const ek=JSON.stringify([id,String(delta),d]);if(!amountEvidence.has(ek))amountEvidence.set(ek,new Set());for(const sourceId of observationIds)amountEvidence.get(ek).add(sourceId);}};
 const {fundingIdentity,sameBankAccount}=require('./assetRegister'),merchantDays=new Map(),addMerchant=(id,s,transactionId)=>{const k=JSON.stringify([id,s.currency]);if(!merchantDays.has(k))merchantDays.set(k,[]);merchantDays.get(k).push({date:s.date,names:[s.description,s.counterparty].map(normalized),sourceId:s.id,transactionId});};
 for(const t of baseView.transactions){
  for(const [id,value]of Object.entries(t.balanceEffects)){const delta=BigInt(value);for(const d of [t.date,day(t.balanceEffectTimes?.[id]||t.occurredAt)])add(id,delta,d,t.observationIds);for(const e of t.balanceEffectEvents?.[id]||[])add(id,BigInt(e.deltaMinor),e.date||day(e.occurredAt),t.observationIds);}
  // A source suppressed by an existing owner/overlap decision still competes.
  for(const s of t.sources)if(!s.bankNetwork&&s.status==='completed'){
   const ids=new Set([s.financialAccountId]),funding=fundingIdentity(s.paymentChannel);
   if(funding)for(const a of ledger.accounts||[])if(sameBankAccount(a,funding,s.currency))ids.add(a.id);
   for(const relation of s.accountRelations||[])if(relation.financialAccountId)ids.add(relation.financialAccountId);
   for(const id of ids){addMerchant(id,s,t.id);for(const sign of s.direction==='credit'?[1n]:s.direction==='debit'?[-1n]:[-1n,1n])for(const d of [s.date,day(s.occurredAt),s.bankStatement?.postedDate])add(id,BigInt(s.amountMinor)*sign,d,[s.id]);}
  }
 }
 for(const r of records)if(r.status==='completed'){const k=JSON.stringify([r.financialAccountId,r.date,r.direction,r.amountMinor]);if(!counts.has(k))counts.set(k,[]);counts.get(k).push(r);}
 const historical=[],conflictingPurposes=new Set();
 for(const m of plan.matches)for(const id of m.networkObservationIds){
  const source=byId.get(id);if(source?.direction!=='debit')continue;
  if(m.transactionIds.every(id=>tx.get(id)?.kind==='expense')){
   // A bounded name completion or competitor exclusion can supplement an
   // existing expense. Do not propagate that inference into another posting.
   if(!m.merchantNameEvidence?.length&&!m.excludedCandidateEvidence?.length)historical.push({source,match:m});
  }else conflictingPurposes.add(JSON.stringify([source.financialAccountId,source.currency,normalized(source.description)]));
 }
 const latestAnnotations=new Map();for(const a of ledger.annotations||[]){const old=latestAnnotations.get(a.observationId);if(!old||BigInt(a.revision)>BigInt(old.revision))latestAnnotations.set(a.observationId,a);}
 const out=[];
 for(const r of records){
  const reason=held.get(r.id)?.reason,annotation=latestAnnotations.get(r.id),involved=(ledger.links||[]).filter(l=>(l.observationIds||[]).includes(r.id));
  if(!['no_exact_existing_cash_movement','existing_owner_decision_or_link'].includes(reason)||r.status!=='completed'||!['credit','debit'].includes(r.direction))continue;
  if(annotation&&!annotation.reset&&Object.keys(annotation.patch||{}).some(k=>!['category','kind','settlementAccountId'].includes(k)))continue;
  const mixedTransferEvidence=involved.map(l=>ownerMixedBankTransfer(r,annotation,l,ledger,baseView)).find(Boolean);
  if(involved.some(l=>!['distinct','group_distinct'].includes(l.type)&&!((l.status==='deleted'||l.deletedAt||l.deleted===true)&&['duplicate','transfer'].includes(l.type))&&!(l.type==='transfer'&&(l.observationIds||[]).every(id=>byId.has(id)))&&mixedTransferEvidence?.linkId!==l.id))continue;
  if(!baselines.has(r.importId))baselines.set(r.importId,intakeBaseline(ledger,r.importId));const baseline=baselines.get(r.importId);
  if(!baseline)continue;const historicalGap=r.date<=baseline.knownSourceDateThrough;
  const peers=counts.get(JSON.stringify([r.financialAccountId,r.date,r.direction,r.amountMinor])),distinctRows=peers.length>1?distinctNativePeerGroup(peers):null;if(peers.length>1&&!distinctRows)continue;
  const days=sourceDays.get(key(r.financialAccountId,signed(r)))||[];
  const excludedSameAmountEvidence=[],nearDays=[...days].filter(d=>Math.abs(Date.parse(d)-Date.parse(r.date))<=86400000);
  if(nearDays.some(d=>{const ids=[...(amountEvidence.get(JSON.stringify([r.financialAccountId,String(signed(r)),d]))||[])];if(!distinctNativeIds.has(r.id)||annotation?.confidence!=='owner_confirmed'||annotation.patch?.kind!=='expense'||!ids.length||ids.some(id=>!distinctLinks.some(l=>l.observationIds?.includes(r.id)&&l.observationIds.includes(id))))return true;excludedSameAmountEvidence.push({date:d,observationIds:ids});return false;}))continue;
  if(r.kind==='refund'&&baseView.transactions.some(t=>t.sources.some(s=>s.financialAccountId===r.financialAccountId&&s.bankStatement&&s.status==='completed'&&s.direction==='credit'&&s.amountMinor===r.amountMinor&&date(s.bankStatement.postedDate)&&Math.abs(Date.parse(s.bankStatement.postedDate)-Date.parse(r.date))<=31*86400000&&[s.description,s.counterparty].some(v=>normalized(v).includes(normalized(r.description.split('_')[0]))))))continue;
  // A gross platform amount can differ from the actual card charge. An old
  // original naming this merchant/card nearby must be reconciled first, even
  // when it currently has no posted financial effect or a different amount.
  let occupiedNearbyMerchantEvidence=[];
  if(historicalGap){const title=normalized(r.description.split('_')[0]),near=(merchantDays.get(JSON.stringify([r.financialAccountId,r.currency]))||[]).filter(s=>Math.abs(Date.parse(s.date)-Date.parse(r.date))<=86400000&&s.names.some(n=>n&&n.includes(title)));occupiedNearbyMerchantEvidence=near.map(s=>require('./nativeOccupiedMerchantCash').occupiedMerchantCash(r,s,byId,tx,plan.matches));if(occupiedNearbyMerchantEvidence.some(p=>!p))continue;}
  const proxy=Date.parse(r.occurredAt),account=baseView.balanceReconciliation.accounts.find(a=>a.financialAccountId===r.financialAccountId);
  if(account?.intervals.some(i=>i.status==='balanced'&&(historicalGap?Date.parse(i.startAsOf)<=proxy&&Date.parse(r.date+'T00:00:00+08:00')<=Date.parse(i.endAsOf):Date.parse(i.startAsOf)<proxy&&proxy<=Date.parse(i.endAsOf))))continue;
  const ownerKind=annotation&&!annotation.reset&&annotation.patch?.kind;
  if(ownerKind&&(!['expense','debt_payment','refund','transfer','fee','interest','income','loan_drawdown','unknown'].includes(ownerKind)||['expense','fee','interest'].includes(ownerKind)&&r.direction!=='debit'||['refund','income','loan_drawdown'].includes(ownerKind)&&r.direction!=='credit'))continue;
  const provisionalOwnerPurpose=!!ownerKind&&annotation.confidence==='owner_authorized_provisional';
  // Permission to use a coarse income/expense label is not confirmation of
  // the underlying purpose. In particular, a credit-card receipt is not
  // ordinary income merely because its original direction is credit.
  if(provisionalOwnerPurpose&&(annotation.reversible!==true||annotation.basis!=='direct_owner_authorized_ordinary_income_expense_for_unknown_purpose'||!['expense','income'].includes(ownerKind)||ownerKind==='income'&&(ledger.accounts||[]).find(a=>a.id===r.financialAccountId)?.type!=='debit_card'))continue;
  let kind=ownerKind||r.kind,basis=mixedTransferEvidence?.purposeBasis||(provisionalOwnerPurpose?'owner_authorized_provisional_native_purpose_with_original_account_movement':ownerKind?'owner_confirmed_native_purpose_with_original_account_movement':'explicit_completed_native_network_purpose'),proofIds=[],suggestedCategory=null;
  if(kind==='unknown'&&!ownerKind&&r.direction==='debit'){
   const title=normalized(r.description.split('_')[0]);
   if(/\u94f6\u884c|\u57fa\u91d1|\u8bc1\u5238|\u7406\u8d22|\u8d37\u6b3e|\u501f\u6b3e|\u8fd8\u6b3e|\u8f6c\u8d26|\u8d22\u4ed8\u901a|\u652f\u4ed8\u5b9d|\u7f51\u8054|\u94f6\u8054|\u5b58\u6b3e|\u63d0\u73b0|\u5145\u503c|\u82b1\u5457|\u767d\u6761|\u6295\u8d44|\u4f59\u989d\u5b9d|\u4f59\u5229\u5b9d|\u62bc\u91d1|\u4fdd\u8bc1\u91d1/.test(title))continue;
   if(conflictingPurposes.has(JSON.stringify([r.financialAccountId,r.currency,normalized(r.description)])))continue;
   const h=historical.filter(h=>h.source.financialAccountId===r.financialAccountId&&h.source.currency===r.currency&&(historicalGap||h.source.date<r.date&&h.source.amountMinor===r.amountMinor)&&normalized(h.source.description)===normalized(r.description)).sort((a,b)=>Math.abs(Date.parse(a.source.date)-Date.parse(r.date))-Math.abs(Date.parse(b.source.date)-Date.parse(r.date)))[0];
   if(h){kind='expense';basis=historicalGap?'completed_historical_native_debit_and_verified_same_card_merchant_purpose':'completed_native_debit_and_verified_prior_same_card_merchant_and_amount';proofIds=[h.source.id,...h.match.existingObservationIds];}
   else{
    suggestedCategory=literalMerchantService(r);if(!suggestedCategory)continue;
    // A close original card amount could be a coupon/fee split rather than a
    // missing charge. Keep that case for reconciliation before posting again.
    const near=[-1,0,1].flatMap(offset=>[...(deltasByDay.get(JSON.stringify([r.financialAccountId,new Date(Date.parse(r.date)+offset*86400000).toISOString().slice(0,10)]))||[])]).some(v=>{const d=BigInt(v),difference=d-signed(r);return (d>0n)===(signed(r)>0n)&&(difference<0n?-difference:difference)<=100n;});if(near)continue;
    kind='expense';basis='completed_native_debit_with_literal_nonfinancial_merchant_service';
   }
  }
  if(!ownerKind&&!['expense','debt_payment','refund'].includes(kind))continue;
  out.push({schema:'native-network-posting-v1',sourceObservationId:r.id,sourceDocumentSha256:r.bankNetwork.sourceSha256,financialAccountId:r.financialAccountId,date:r.date,occurredAt:r.occurredAt,amountMinor:r.amountMinor,signedAmountMinor:String(signed(r)),currency:r.currency,kind,basis,confidence:mixedTransferEvidence?.confidence||(provisionalOwnerPurpose?'owner_authorized_provisional':ownerKind?'owner_confirmed_native_purpose':kind===r.kind?'explicit_native_list_purpose':suggestedCategory?'inferred_literal_merchant_service':'inferred_historical_merchant_purpose'),historicalEvidenceObservationIds:proofIds,baseline,dateBasis:'native_visible_day_proxy_not_bank_posting_date',sourceScope:'channel_only',bankPostingDatePrinted:false,timeAccuracyVerified:false,counterpartAssociationInferred:false,reversible:true,...(provisionalOwnerPurpose?{ownerProvisionalPurpose:{annotationId:annotation.id,actualPurposeUnconfirmed:true,ordinaryIncomeExpenseOnly:true}}:{}),...(suggestedCategory?{suggestedCategory}:{}),...(distinctRows?{distinctNativeRows:distinctRows}:{}),...(mixedTransferEvidence?{mixedTransferEvidence}:{}),...(historicalGap?{historicalGap:{schema:'native-network-historical-gap-v1',noSameAmountOriginalWithinOneDay:excludedSameAmountEvidence.length===0,noUnexcludedSameAmountOriginalWithinOneDay:true,noNearbyOriginalNamingMerchant:true,noBalancedIndependentIntervalOnVisibleDay:true,purposeInferred:provisionalOwnerPurpose||!ownerKind&&kind!==r.kind,completeBankHistoryClaimed:false}}:{})});
  if(excludedSameAmountEvidence.length)out.at(-1).ownerDistinctCashEvidence={method:'owner_confirmed_distinct_actual_expense',excludedSameAmountEvidence,noGeneralDateOrAmountToleranceAdded:true,reversible:true};
  if(occupiedNearbyMerchantEvidence.length)out.at(-1).occupiedNearbyMerchantEvidence=occupiedNearbyMerchantEvidence;
  if(suggestedCategory){const named=require('./nativeRetailMerchantServices').namedRetailMerchantService(r);if(named){out.at(-1).merchantPurposeInference=named;out.at(-1).basis='completed_native_debit_with_provisional_named_merchant_business';out.at(-1).confidence='inferred_named_merchant_business';}}
 }
 return out;
}
function materializeNativeNetworkPosting(record,proof){
 const {bankNetwork,bankAccount,...economic}=record;
 return {...economic,kind:proof.kind,...(!economic.category&&proof.suggestedCategory?{category:proof.suggestedCategory}:{}),nativeNetworkPosting:proof,automaticClassification:{method:'verified_new_native_network_posting',confidence:proof.confidence,evidenceObservationIds:[record.id,...proof.historicalEvidenceObservationIds]}};
}
function findNativeRepaymentPostingPairs(records,postings,accounts,links=[],economicTransactions=[]){
 links=links.filter(l=>!(['distinct','group_distinct'].includes(l.type)&&(l.status==='deleted'||l.deletedAt||l.deleted===true)));
 const byId=new Map(records.map(r=>[r.id,r])),accountMap=new Map(accounts.map(a=>[a.id,a])),buckets=new Map(),out=[];
 for(const p of postings){const r=byId.get(p.sourceObservationId),a=accountMap.get(p.financialAccountId);if(p.kind!=='debt_payment'||r.kind!=='debt_payment'||r.bankNetwork.nativeStatus!=='settled')continue;const k=JSON.stringify([p.date,p.currency,p.amountMinor]);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push({p,r,a});}
 for(const rows of buckets.values()){
  const payers=rows.filter(x=>x.r.direction==='debit'&&x.a?.type==='debit_card'),receivers=rows.filter(x=>x.r.direction==='credit'&&x.a?.type==='credit_card');
  if(payers.length!==1||receivers.length!==1||rows.length!==2)continue;const payer=payers[0],receiver=receivers[0],ids=[payer.r.id,receiver.r.id];
  // Count all source repayment rows, including rows that already have existing
  // evidence or were declined for another reason; a partial capture stays an
  // inference and never becomes a claim of complete banking coverage.
  const peers=records.filter(r=>r.status==='completed'&&r.bankNetwork.nativeStatus!=='refund'&&(r.kind==='debt_payment'||r.kind==='unknown'&&/^(?:\u94f6\u8054\u8f6c\u8d26\(\u4e91\u95ea\u4ed8\)|\u652f\u4ed8\u5b9d.*\u6709\u9650\u516c\u53f8|\u8d22\u4ed8\u901a\u652f\u4ed8\u79d1\u6280\u6709\u9650\u516c\u53f8)$/.test(normalized(r.description)))&&r.date===payer.p.date&&r.currency===payer.p.currency&&r.amountMinor===payer.p.amountMinor);
  if(peers.length!==2||links.some(l=>(l.observationIds||[]).some(id=>ids.includes(id))))continue;
  const otherEconomicCounterpart=economicTransactions.some(t=>t.status==='completed'&&t.currency===payer.p.currency&&t.kind==='debt_payment'&&Object.entries(t.balanceEffects).some(([id,value])=>{
   const a=accountMap.get(id),delta=BigInt(value);if(!a||delta===0n||String(delta<0n?-delta:delta)!==payer.p.amountMinor)return false;
   const otherReceiver=a.type==='credit_card'&&delta>0n&&id!==receiver.a.id,otherPayer=['debit_card','wallet','bank','savings','cash','investment'].includes(a.type)&&delta<0n&&id!==payer.a.id;
   if(!otherReceiver&&!otherPayer)return false;return [t.date,day(t.balanceEffectTimes?.[id]||t.occurredAt)].includes(payer.p.date);
  }));
  if(otherEconomicCounterpart)continue;
  out.push({method:'inferred_native_credit_repayment_pair',confidence:'inferred',observationIds:ids,evidence:{payerAccountId:payer.a.id,receivingCreditAccountId:receiver.a.id,date:payer.p.date,currency:payer.p.currency,amountMinor:payer.p.amountMinor,matchingBasis:'unique_completed_native_repayment_outflow_and_credit_inflow_in_current_source_set',sourceScope:'channel_only',completeBankCoverageClaimed:false,counterpartAccountPrinted:false,timeUsedForMatching:false,reversible:true}});
 }
 return out;
}
module.exports={intakeBaseline,findNativeNetworkPostings,materializeNativeNetworkPosting,findNativeRepaymentPostingPairs};
