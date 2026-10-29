'use strict';

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=512)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max;
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const invalid=()=>{throw Object.assign(new Error('OWNER_WALLET_EXPENSE_ATTRIBUTION_INVALID'),{code:'OWNER_WALLET_EXPENSE_ATTRIBUTION_INVALID'});};
function validateOwnerWalletExpenseAttributions(value,account){
 if(!object(value)||Object.keys(value).some(k=>!['schema','rules'].includes(k))||value.schema!=='owner-wallet-expense-attributions-v1'||!Array.isArray(value.rules)||!value.rules.length||value.rules.length>1000||account?.type!=='wallet'||account.provider!=='alipay'||account.currency!=='CNY'||account.sourceProduct)invalid();
 const seen=new Set();
 for(const r of value.rules){
  if(!object(r)||Object.keys(r).some(k=>!['sourceObservationId','sourceTransactionId','sourceFingerprint','sourceAmountMinor','sourceDate','confidence','basis','recordedAt','category'].includes(k))||!text(r.sourceObservationId)||!text(r.sourceTransactionId)||!/^[a-f0-9]{64}$/.test(r.sourceFingerprint||'')||!/^[1-9]\d{0,23}$/.test(r.sourceAmountMinor||'')||!/^\d{4}-\d{2}-\d{2}$/.test(r.sourceDate||'')||!Number.isFinite(Date.parse(r.sourceDate))||new Date(r.sourceDate).toISOString().slice(0,10)!==r.sourceDate||r.confidence!=='owner_authorized_provisional'||!text(r.basis)||!text(r.category,160)||typeof r.recordedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(r.recordedAt)||!Number.isFinite(Date.parse(r.recordedAt))||seen.has(r.sourceObservationId))invalid();
  seen.add(r.sourceObservationId);
 }
 return structuredClone(value);
}

// This assigns an expense report account. It never creates or changes cash.
function applyOwnerWalletExpenseAttributions(ledger,transactions,selected,issues){
 const configured=(ledger.accounts||[]).filter(a=>a.ownerWalletExpenseAttributions);
 if(!configured.length)return [];
 const originals=ledger.observations||[],byId=new Map(originals.map(o=>[o.id,o])),latest=new Map(),ties=new Set(),models=[];
 for(const s of originals){const k=identity(s),old=latest.get(k);if(!old||(s.sourceVersionOrdinal||0)>(old.sourceVersionOrdinal||0)){latest.set(k,s);ties.delete(k);}else if((s.sourceVersionOrdinal||0)===(old.sourceVersionOrdinal||0)&&s.id!==old.id)ties.add(k);}
 const edits=new Map();for(const a of ledger.annotations||[]){const old=edits.get(a.observationId);if(!old||BigInt(a.revision)>BigInt(old.revision))edits.set(a.observationId,a);}
 const proofs=require('./walletStatementTopUps').validatedWalletProofs(originals,new Map((ledger.accounts||[]).map(a=>[a.id,a]))),proofById=new Map(proofs.map(p=>[p.observation.id,p]));
 for(const account of configured){
  const policy=validateOwnerWalletExpenseAttributions(account.ownerWalletExpenseAttributions,account);
  if(account.status!=='active')continue;
  for(const rule of policy.rules){
   const source=byId.get(rule.sourceObservationId),roots=transactions.filter(t=>t.observationIds.includes(rule.sourceObservationId));
   const model={schema:'owner-wallet-expense-attribution-v1',sourceObservationId:rule.sourceObservationId,financialAccountId:account.id,confidence:rule.confidence,basis:rule.basis,recordedAt:rule.recordedAt,actualUpstreamBankCardKnown:false,noCashOrBalanceChange:true,reversible:true,actualSourcePrecedence:true};
   const blocked=reason=>models.push({...model,status:'not_applied',reason});
   if(!source||source.financialAccountId!==account.id||source.provider!=='alipay'||source.currency!=='CNY'||source.date!==rule.sourceDate||source.amountMinor!==rule.sourceAmountMinor||source.sourceTransactionId!==rule.sourceTransactionId||source.recordFingerprint!==rule.sourceFingerprint||latest.get(identity(source))?.id!==source.id||ties.has(identity(source))||roots.length!==1){blocked('source_changed_or_not_unique');continue;}
   const raw=source.rawFields||{},edit=edits.get(source.id),t=roots[0];
   if(raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||!/^\d+\.\d{2}$/.test(raw['\u91d1\u989d']||'')||BigInt(raw['\u91d1\u989d'].replace('.',''))!==BigInt(source.amountMinor)||raw['\u4ea4\u6613\u5bf9\u65b9']!==source.counterparty){blocked('native_source_amount_status_or_counterparty_changed');continue;}
   if(source.status!=='completed'||source.direction!=='debit'||source.paymentChannel||source.paymentAccountHint||source.accountRelations?.length||source.bankStatement||source.statementFlow||source.investmentTrade||source.brokerage||source.loanProof||source.balanceEvidence||edit&&!edit.reset||!require('./telecomTopups').isLegacyTelecomServiceFormat(source.description)||raw['\u6536/\u652f']!=='\u652f\u51fa'||raw['\u5546\u54c1\u8bf4\u660e']!==source.description||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==source.sourceTransactionId||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==''||raw['\u4ea4\u6613\u65f6\u95f4']!==source.occurredAt?.slice(0,19).replace('T',' ')){blocked('not_an_unallocated_original_telecom_payment');continue;}
   const activeLinks=(ledger.links||[]).filter(l=>l.status!=='deleted'&&!l.deletedAt&&l.deleted!==true);
   if(activeLinks.some(l=>l.observationIds?.includes(source.id))||t.kind!=='expense'||t.status!=='completed'||BigInt(t.consumptionMinor)!==BigInt(source.amountMinor)||BigInt(t.incomeMinor)!==0n||t.reportingAccountIds.length||t.sources.some(s=>s.statementFlow||s.bankStatement)||Object.values(t.balanceEffects||{}).some(n=>BigInt(n)!==0n)||Object.values(t.cashEffects||{}).some(n=>BigInt(n)!==0n)){blocked('actual_payer_or_other_owner_decision_takes_precedence');continue;}
   const plans=(t.walletIntermediaryPostings||[]).filter(p=>p.sourceObservationId===source.id&&p.financialAccountId===account.id&&p.path==='unallocated_bank_top_up_and_service_payment'&&p.cashEvidenceConfidence==='explicit_original_cash_postings'&&p.amountMinor===source.amountMinor&&p.netDeltaMinor==='0'&&p.proofObservationIds?.length===2&&p.events?.length===2);
   if(plans.length!==1){blocked('original_zero_net_wallet_bridge_required');continue;}
   const plan=plans[0],[creditId,debitId]=plan.proofObservationIds,credit=proofById.get(creditId),debit=proofById.get(debitId),n=BigInt(source.amountMinor);
   if(!credit||!debit||credit.observation.financialAccountId!==account.id||debit.observation.financialAccountId!==account.id||credit.observation.importId!==debit.observation.importId||debit.observation.balanceEvidence.sequence!==credit.observation.balanceEvidence.sequence+1||credit.incoming!==n||credit.outgoing!==0n||debit.incoming!==0n||debit.outgoing!==-n||debit.balance!==credit.balance-n||debit.observation.relatedReference!==source.sourceTransactionId||debit.bank!=='\u652f\u4ed8\u5b9d'||plan.events.some((e,i)=>e.observationId!==[creditId,debitId][i]||String(e.deltaMinor)!==String(i?-n:n))||activeLinks.some(l=>l.observationIds?.some(id=>[creditId,debitId].includes(id)))||[creditId,debitId].some(id=>edits.get(id)&&!edits.get(id).reset)){blocked('native_cash_evidence_changed_or_conflicting');continue;}
   t.category=rule.category;
   t.reportingAccountIds=[account.id];
   t.incomeExpenseAllocations={[account.id]:{consumptionMinor:n,incomeMinor:0n}};
   t.selectedConsumptionMinor=selected.has(account.id)?n:0n;
   t.selectedIncomeMinor=0n;t.pendingConsumptionMinor=0n;t.pendingIncomeMinor=0n;
   t.ownerWalletExpenseAttribution={...model,status:'applied',proofObservationIds:[creditId,debitId],upstreamBankLabel:credit.bank,upstreamBankFundingStillUnidentified:true,reportingOnly:true};
   t.walletIntermediaryPostings=t.walletIntermediaryPostings.map(p=>p===plan?{...p,economicPayerStillUnallocated:false,expenseStillRequiresReview:false,tentativeReportingAccountId:account.id,expensePayerBasis:rule.confidence,upstreamBankFundingStillUnidentified:true}:p);
   for(let i=issues.length-1;i>=0;i--){const issue=issues[i];if(issue.observationId===source.id&&(issue.reason==='unallocated_income_expense'||issue.reason==='unresolved_funding_account'&&issue.basis==='original_paid_merchant_order_payer_not_exported'))issues.splice(i,1);}
   models.push(t.ownerWalletExpenseAttribution);
  }
 }
 return models;
}
module.exports={validateOwnerWalletExpenseAttributions,applyOwnerWalletExpenseAttributions};
