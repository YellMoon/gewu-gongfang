'use strict';
const fail=()=>{throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_TERM_DEPOSIT_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_TERM_DEPOSIT_INVALID'});};
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const text=v=>typeof v==='string'&&v.length>0&&v.length<=512&&v===v.trim();
const positive=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v);
function validateTermDeposit(p){
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['schema','bankAccountId','bankCardTail','ownerName','knownFrom','confirmedAt','movements','closedAt','rolloverCycle'].includes(k))||p.schema!=='bank-term-deposit-v1'||!text(p.bankAccountId)||!/^\d{4}$/.test(p.bankCardTail)||!text(p.ownerName)||!date(p.knownFrom)||typeof p.confirmedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(p.confirmedAt)||!Number.isFinite(Date.parse(p.confirmedAt))||!Array.isArray(p.movements)||!p.movements.length||p.movements.length>500)fail();
 const seen=new Set();for(const m of p.movements){if(!m||Object.keys(m).some(k=>!['transactionId','date','direction','amountMinor'].includes(k))||!text(m.transactionId)||seen.has(m.transactionId)||!date(m.date)||m.date<p.knownFrom||!['credit','debit'].includes(m.direction)||!positive(m.amountMinor))fail();seen.add(m.transactionId);}
 if(p.closedAt!==undefined&&(!date(p.closedAt)||p.closedAt<p.knownFrom||p.movements.some(m=>m.date>p.closedAt)))fail();
 if(p.rolloverCycle!==undefined){const c=p.rolloverCycle;if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['firstReinvestmentTransactionId','finalWithdrawalTransactionId','recognition'].includes(k))||!seen.has(c.firstReinvestmentTransactionId)||!seen.has(c.finalWithdrawalTransactionId)||c.recognition!=='final_liquidation'||!p.closedAt)fail();const first=p.movements.find(m=>m.transactionId===c.firstReinvestmentTransactionId),last=p.movements.find(m=>m.transactionId===c.finalWithdrawalTransactionId);if(first.direction!=='debit'||last.direction!=='credit'||first.date>=last.date||last.date!==p.closedAt)fail();}
 return p;
}
function termDepositBindingValid(a,b){return a?.type==='savings'&&a.currency==='CNY'&&!a.sourceProduct&&a.maskedIdentifier===''&&b?.id===a.termDeposit?.bankAccountId&&b.type==='debit_card'&&b.currency===a.currency&&b.provider===a.provider&&b.maskedIdentifier===a.termDeposit.bankCardTail&&b.id!==a.id;}
function buildTermDepositPlans(ledger,transactions,owners){
 if(!(ledger.accounts||[]).some(a=>a.termDeposit))return{plans:[],models:[],issues:[]};
 const accounts=ledger.accounts||[],am=new Map(accounts.map(a=>[a.id,a])),originals=ledger.observations||[],latest=new Map(),annotations=new Map(),txBySource=new Map(),claims=new Map(),plans=[],models=[],issues=[];
 for(const o of originals){const k=JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 for(const a of ledger.annotations||[])if(!annotations.has(a.observationId)||BigInt(a.revision)>BigInt(annotations.get(a.observationId).revision))annotations.set(a.observationId,a);
 for(const t of transactions)for(const id of t.observationIds){if(!txBySource.has(id))txBySource.set(id,[]);txBySource.get(id).push(t);}
 for(const a of accounts)if(a.termDeposit){validateTermDeposit(a.termDeposit);for(const m of a.termDeposit.movements){const k=JSON.stringify([a.termDeposit.bankAccountId,m.transactionId]);if(!claims.has(k))claims.set(k,new Set());claims.get(k).add(a.id);}}
 for(const a of accounts.filter(a=>a.termDeposit)){
  const p=a.termDeposit,bank=am.get(p.bankAccountId),selected=[],problem=reason=>issues.push({reason:'term_deposit_evidence_unresolved',financialAccountId:a.id,basis:reason});
  if(!termDepositBindingValid(a,bank)){problem('linked_bank_identity_invalid');continue;}
  let invalid=false;
  for(const m of p.movements){
   const candidates=[...latest.values()].filter(o=>o.financialAccountId===bank.id&&o.sourceTransactionId===m.transactionId);if(candidates.length!==1||claims.get(JSON.stringify([bank.id,m.transactionId])).size!==1){invalid=true;break;}
   const o=candidates[0],r=o.rawFields||{},f=o.statementFlow,ann=annotations.get(o.id),t=(txBySource.get(o.id)||[]),summary=o.direction==='credit'?'\u8f6c\u8d26\u5b58\u5165':'\u8f6c\u8d26\u652f\u53d6',delta=BigInt(m.amountMinor)*(m.direction==='credit'?1n:-1n);
   if(o.provider!=='ccb'||o.status!=='completed'||o.currency!=='CNY'||o.date!==m.date||o.direction!==m.direction||o.amountMinor!==m.amountMinor||f?.schema!=='ccb-debit-v1'||f.incomeMinor!==(m.direction==='credit'?m.amountMinor:'0')||f.expenseMinor!==(m.direction==='debit'?m.amountMinor:'0')||r.dateBasis!=='transaction_date'||r['\u4ea4\u6613\u65e5\u671f']!==m.date.replace(/-/g,'')||r['\u6458\u8981']!==summary||r['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00']!=='\u5efa\u884c\u6d59\u6c5f\u5206\u884c\u5e10\u52a1\u4e2d'||o.description!==summary+' \u5efa\u884c\u6d59\u6c5f\u5206\u884c\u5e10\u52a1\u4e2d'||r['\u5bf9\u65b9\u8d26\u53f7']!=='****'+p.bankCardTail||o.counterparty!==p.ownerName||owners.get(o.id)!==p.ownerName||ann?.reset||require('./statementAccounts').annotatedCounterAccount(o,ann,accounts)?.id!==a.id||t.length!==1||t[0].kind!=='transfer'||BigInt(t[0].cashEffects[bank.id]||0)!==delta||BigInt(t[0].balanceEffects[bank.id]||0)!==delta||Object.entries(t[0].cashEffects).some(([id,v])=>id!==bank.id&&BigInt(v)!==0n)){invalid=true;break;}
   selected.push({source:o,transaction:t[0],bankDelta:delta,gain:0n});
  }
  if(invalid||new Set(selected.map(x=>x.transaction.id)).size!==p.movements.length){problem('original_cash_owner_or_reversible_annotation_incomplete');continue;}
  selected.sort((x,y)=>x.source.date.localeCompare(y.source.date)||x.source.statementFlow.sequence-y.source.statementFlow.sequence);
  let knownGain=null,firstKnownBasis=null;
  if(p.rolloverCycle){
   const start=selected.findIndex(x=>x.source.sourceTransactionId===p.rolloverCycle.firstReinvestmentTransactionId),end=selected.findIndex(x=>x.source.sourceTransactionId===p.rolloverCycle.finalWithdrawalTransactionId),period=selected.slice(start,end+1);let basis=0n,total=0n,valid=start>=0&&end>start;
   const inPeriod=[...latest.values()].filter(o=>o.financialAccountId===bank.id&&o.provider==='ccb'&&o.date>=period[0]?.source.date&&o.date<=period.at(-1)?.source.date&&o.counterparty===p.ownerName&&o.rawFields?.['\u5bf9\u65b9\u8d26\u53f7']==='****'+p.bankCardTail&&/^\u8f6c\u8d26(?:\u5b58\u5165|\u652f\u53d6) \u5efa\u884c\u6d59\u6c5f\u5206\u884c\u5e10\u52a1\u4e2d$/.test(o.description));
   if(inPeriod.some(o=>!selected.some(x=>x.source.id===o.id)))valid=false;
   for(const x of period){if(x.source.statementFlow.periodStart>period[0].source.date||x.source.statementFlow.periodEnd<=period.at(-1).source.date)valid=false;const amount=BigInt(x.source.amountMinor);if(x.bankDelta<0n){if(basis!==0n)valid=false;basis=amount;if(firstKnownBasis===null)firstKnownBasis=amount;}else{if(basis===0n||amount<basis)valid=false;x.gain=amount-basis;total+=x.gain;basis=0n;}}
   if(!valid||basis!==0n){problem('known_rollover_cycle_not_complete');continue;}knownGain=total;
  }
  const model={financialAccountId:a.id,bankAccountId:bank.id,status:'source_backed_owner_recalled_term_cash',confidence:'owner_recalled_with_original_same_card_cash',knownFrom:p.knownFrom,closedAt:p.closedAt||null,initialPrincipalBeforeFirstObservedRedemptionKnown:false,knownReinvestmentBasisMinor:firstKnownBasis===null?null:String(firstKnownBasis),recognizedHistoricalGainMinor:knownGain===null?null:String(knownGain),recognition:knownGain===null?'not_inferred_without_known_closed_cycle':'final_liquidation_known_reinvestment_cycle_only',dailyAccrualKnown:false,observationIds:selected.map(x=>x.source.id),reversible:true};models.push(model);
  for(const x of selected)plans.push({...x,account:a,model,recognizedIncome:p.rolloverCycle&&x.source.sourceTransactionId===p.rolloverCycle.finalWithdrawalTransactionId?knownGain:0n});
 }
 return{plans,models,issues};
}
function applyTermDepositPlans(transactions,result,selected){
 if(!result.plans.length)return;
 const byId=new Map(result.plans.map(p=>[p.transaction.id,p]));
 for(let i=0;i<transactions.length;i++){const t=transactions[i],p=byId.get(t.id);if(!p)continue;const id=p.account.id,delta=-p.bankDelta+p.gain,when=t.balanceEffectTimes[p.model.bankAccountId]||p.source.occurredAt;
  if(Object.hasOwn(t.balanceEffects,id)||Object.hasOwn(t.cashEffects,id))throw new Error('TERM_DEPOSIT_COUNTERPART_ALREADY_POSTED');
  const income=BigInt(t.incomeMinor)+p.recognizedIncome,allocation=p.recognizedIncome?{[id]:{incomeMinor:p.recognizedIncome,consumptionMinor:0n}}:t.incomeExpenseAllocations;
  transactions[i]={...t,balanceEffects:{...t.balanceEffects,[id]:delta},cashEffects:{...t.cashEffects,[id]:delta},balanceEffectTimes:{...t.balanceEffectTimes,[id]:when},financialAccountIds:[...new Set([...t.financialAccountIds,id])],reportingAccountIds:[...new Set([...t.reportingAccountIds,id])],selectedObservationIds:selected.has(id)?[...new Set([...t.selectedObservationIds,p.source.id])]:t.selectedObservationIds,incomeMinor:income,selectedIncomeMinor:p.recognizedIncome?(selected.has(id)?p.recognizedIncome:0n):t.selectedIncomeMinor,incomeExpenseAllocations:allocation,termDepositPosting:{schema:'bank-term-deposit-posting-v1',termAccountId:id,bankAccountId:p.model.bankAccountId,sourceObservationId:p.source.id,bankCashMinor:String(p.bankDelta),termCashMinor:String(delta),capitalizedKnownGainMinor:String(p.gain),recognizedIncomeMinor:String(p.recognizedIncome),incomeRecognition:p.model.recognition,initialPrincipalBeforeFirstObservedRedemptionKnown:false,dateBasis:'original_statement_day_proxy',actualTimeKnown:false,originalBankCashPreserved:true,reversible:true}};
 }
}
module.exports={validateTermDeposit,termDepositBindingValid,buildTermDepositPlans,applyTermDepositPlans};
