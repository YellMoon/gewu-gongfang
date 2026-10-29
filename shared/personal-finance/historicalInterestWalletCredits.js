'use strict';
const {actualSecond}=require('./mixedPayments');
const {findBalanceProofCashPostings}=require('./balanceCashPostings');
const issuer='\u6d59\u6c5f\u7f51\u5546\u94f6\u884c\u80a1\u4efd\u6709\u9650\u516c\u53f8';
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
function originalInterest(o){
 const r=o.rawFields||{},day=o.date?.replace(/-/g,''),title='\u8d26\u6237\u7ed3\u606f-'+o.date?.replace(/-/g,'.');
 if(o.provider!=='alipay'||o.currency!=='CNY'||o.status!=='completed'||o.kind!=='income'||o.direction!=='neutral'||o.description!==title||o.counterparty!==issuer||o.paymentChannel||o.paymentAccountHint||o.accountRelations?.length||o.investmentTrade||o.brokerage||o.bankStatement||o.statementFlow||o.balanceEvidence||o.automaticFunding||!actualSecond(o)||!/^\d+$/.test(o.amountMinor||'')||BigInt(o.amountMinor)<=0n||[o.principalMinor,o.interestMinor,o.feeMinor].some(x=>x!=null&&x!=='0'))return false;
 if(!['03-21','06-21','09-21','12-21'].includes(o.date.slice(5))||!new RegExp('^'+day+'1025530100312500\\d+$').test(o.sourceTransactionId||'')||!new RegExp('^'+day+'\\d+INTEREST$').test(o.relatedReference||''))return false;
 return r['\u6536/\u652f']==='\u4e0d\u8ba1\u6536\u652f'&&r['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&r['\u4ea4\u6613\u65f6\u95f4']===o.date+' '+o.occurredAt.slice(11,19)&&r['\u5546\u54c1\u8bf4\u660e']===title&&r['\u4ea4\u6613\u5bf9\u65b9']===issuer&&r['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===''&&r['\u4ea4\u6613\u8ba2\u5355\u53f7']===o.sourceTransactionId&&r['\u5546\u5bb6\u8ba2\u5355\u53f7']===o.relatedReference&&/^\d+\.\d{2}$/.test(r['\u91d1\u989d']||'')&&BigInt(r['\u91d1\u989d'].replace('.',''))===BigInt(o.amountMinor);
}
// A bank issuer does not identify the owner's separate bank deposit account.
// Infer only a missing historical receiving leg of an already recognized
// interest event, supported by this wallet's later actual cash statements.
function applyHistoricalInterestWalletCredits(ledger,transactions,validatedPostings){
 const originals=ledger.observations||[];if(!originals.some(originalInterest))return;
 const byId=new Map(originals.map(o=>[o.id,o])),accounts=new Map(ledger.accounts.map(a=>[a.id,a])),latest=new Map(),ties=new Set(),annotationByKey=new Map(),blocked=new Set();
 for(const o of originals){const k=identity(o),old=latest.get(k);if(!old||(o.sourceVersionOrdinal||0)>(old.sourceVersionOrdinal||0)){latest.set(k,o);ties.delete(k);}else if((o.sourceVersionOrdinal||0)===(old.sourceVersionOrdinal||0)&&old.id!==o.id)ties.add(k);}
 for(const a of ledger.annotations||[]){const o=byId.get(a.observationId);if(!o)continue;const k=identity(o),old=annotationByKey.get(k);if(!old||BigInt(a.revision||0)>BigInt(old.revision||0))annotationByKey.set(k,a);}
 for(const[k,a]of annotationByKey)if(Object.keys(a.patch||{}).length)blocked.add(k);
 for(const link of ledger.links||[])if(link.status!=='deleted'||['duplicate','transfer'].includes(link.type))for(const id of link.observationIds||[]){const o=byId.get(id);if(o)blocked.add(identity(o));}
 const clean=o=>o&&latest.get(identity(o))?.id===o.id&&!ties.has(identity(o))&&!blocked.has(identity(o)),rows=[...latest.values()],postings=validatedPostings||findBalanceProofCashPostings(rows,ledger.accounts,{annotatedIds:new Set((ledger.annotations||[]).map(a=>a.observationId)),links:ledger.links||[]}),witnesses=[];
 for(const t of transactions){
  const s=t.observationIds?.length===1&&byId.get(t.observationIds[0]);if(!s||!clean(s)||!originalInterest(s)||t.cashPostingEvidence?.length!==1)continue;
  const e=t.cashPostingEvidence[0],plan=postings.get(s.id),o=byId.get(plan?.proofObservationId),delta=Date.parse(o?.occurredAt)-Date.parse(s.occurredAt);
  if(e.method!=='native_interest_wallet_receipt'||e.sourceObservationId!==s.id||e.financialAccountId!==s.financialAccountId||e.deltaMinor!==s.amountMinor||!plan||plan.method!==e.method||plan.proofObservationId!==e.proofObservationId||plan.financialAccountId!==s.financialAccountId||plan.deltaMinor!==s.amountMinor||!clean(o)||o.financialAccountId!==s.financialAccountId||o.rawFields?.['\u8d44\u91d1\u6e20\u9053']!=='\u652f\u4ed8\u5b9d'||o.description!=='\u8f6c\u8d26'||![0,1000].includes(delta)||BigInt(t.balanceEffects?.[s.financialAccountId]||0)!==BigInt(s.amountMinor))continue;
  witnesses.push({source:s,proof:o});
 }
 for(const t of transactions){
  const s=t.observationIds?.length===1&&byId.get(t.observationIds[0]);if(!s||!clean(s)||!originalInterest(s))continue;const wallet=accounts.get(s.financialAccountId),n=BigInt(s.amountMinor);
  if(wallet?.type!=='wallet'||wallet.provider!=='alipay'||wallet.status!=='active'||wallet.currency!=='CNY'||wallet.sourceProduct||t.sources?.length!==1||t.sources[0].id!==s.id||t.kind!=='income'||t.status!=='completed'||BigInt(t.incomeMinor||0)!==n||BigInt(t.consumptionMinor||0)!==0n||t.cashPostingEvidence?.length||t.balanceEffectEvents||t.cashEffectEvents||t.walletIntermediaryPostings?.length||t.historicalInterestWalletCredit||[t.balanceEffects,t.cashEffects].some(e=>Object.values(e||{}).some(v=>BigInt(v)!==0n)))continue;
  const family=witnesses.filter(w=>w.source.financialAccountId===wallet.id&&w.source.date>s.date),dates=new Set(family.map(w=>w.source.date));if(dates.size<2||new Set(family.map(w=>w.proof.id)).size!==family.length)continue;
  // A newly supplied statement takes precedence, even if it contradicts the
  // earlier inference or has not yet matched this particular source row.
  if(rows.some(o=>o.balanceEvidence&&o.financialAccountId===wallet.id&&o.date===s.date))continue;
  if(rows.some(o=>o.provider==='mybank'&&o.status==='completed'&&o.kind==='income'&&o.amountMinor===s.amountMinor&&o.currency===s.currency&&/\u7ed3\u606f|\u5229\u606f/.test(o.description)&&Math.abs(Date.parse(o.date)-Date.parse(s.date))<=86400000))continue;
  t.balanceEffects={...t.balanceEffects,[wallet.id]:n};t.cashEffects={...t.cashEffects,[wallet.id]:n};t.balanceEffectTimes={...t.balanceEffectTimes,[wallet.id]:s.occurredAt};t.balanceEffectEvents={[wallet.id]:[{date:s.date,occurredAt:s.occurredAt,deltaMinor:n,observationId:s.id}]};t.cashEffectEvents={[wallet.id]:[{date:s.date,deltaMinor:n}]};
  t.historicalInterestWalletCredit={schema:'historical-interest-wallet-credit-v1',method:'same_wallet_later_native_interest_business_family',confidence:'inferred_receiving_account',walletAccountId:wallet.id,sourceObservationId:s.id,originalAmountMinor:s.amountMinor,sourceOccurredAt:s.occurredAt,historicalCashProofAbsent:true,cashDateBasis:'original_interest_event_date',corroboratingReceipts:family.map(w=>({interestObservationId:w.source.id,cashProofObservationId:w.proof.id,date:w.source.date,amountMinor:w.source.amountMinor})),differentTransactionsNotDuplicateMatches:true,originalIssuerNotUsedAsOwnerBankAccount:true,incomeAlreadyRecognized:true,noAdditionalIncomeRecognized:true,bankAndInvestmentBalancesUnchanged:true,reversible:true,undoAnnotation:{observationId:s.id,patch:{kind:'income',direction:'neutral'}}};
 }
}
module.exports={applyHistoricalInterestWalletCredits};
