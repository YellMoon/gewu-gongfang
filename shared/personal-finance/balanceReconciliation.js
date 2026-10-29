'use strict';
const {statementBalances}=require('./balanceEvidence');
const actualSnapshotSources=new Set(['owner_confirmation','user_confirmation','manual']);
const upper=(rows,time)=>{let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].time<=time)lo=mid+1;else hi=mid;}return lo;};
// Only independently observed balances are endpoints. AccountStats and
// reconstructed opening balances must never validate their own calculation.
function reconcileIndependentBalances(ledger,transactions,{accountIds,balanceTimingGroups=[],additionalStatementAnchors=[]}={}){
 const allAccounts=ledger.accounts||[],accounts=allAccounts.filter(a=>!accountIds||accountIds.has(a.id)),am=new Map(allAccounts.map(a=>[a.id,a])),points=new Map(),events=new Map();
 const anchors=[...statementBalances(ledger.observations||[],allAccounts),...additionalStatementAnchors];
 for(const s of ledger.balanceSnapshots||[])if(actualSnapshotSources.has(s.source)&&!s.derived&&!s.inferred&&!s.estimated&&s.balanceMinor!=null&&(!s.balanceKind||s.balanceKind==='total'))anchors.push({...s,time:Date.parse(s.asOf)});
 for(const s of anchors){const a=am.get(s.financialAccountId);if(!a||a.currency!==s.currency||!Number.isFinite(s.time))continue;const sign=['credit_card','loan','payable'].includes(a.type)&&s.balanceConvention!=='signed'?-1n:1n,key=JSON.stringify([a.id,s.time]);if(!points.has(key))points.set(key,[]);points.get(key).push({...s,balanceMinor:String(BigInt(s.balanceMinor)*sign)});}
 for(const e of require('./collectiveWalletWithdrawalTiming').balancePostings(transactions,balanceTimingGroups)){
  const id=e.financialAccountId;if(!am.has(id))continue;if(!events.has(id))events.set(id,[]);
  const time=Date.parse(e.occurredAt);if(Number.isFinite(time))events.get(id).push({time,delta:BigInt(e.deltaMinor),transactionId:e.transactionId,...(e.sourceTransactionIds?{sourceTransactionIds:e.sourceTransactionIds,collectiveTimingGroupId:e.collectiveTimingGroupId}:{})});
 }
 const byAccount=new Map();for(const records of points.values()){const a=records[0];if(!byAccount.has(a.financialAccountId))byAccount.set(a.financialAccountId,[]);const conflict=new Set(records.map(s=>s.balanceMinor)).size>1;byAccount.get(a.financialAccountId).push({time:a.time,asOf:a.asOf,balanceMinor:conflict?null:a.balanceMinor,anchorIds:records.map(s=>s.id),conflict});}
 for(const rows of byAccount.values())rows.sort((a,b)=>a.time-b.time);for(const rows of events.values())rows.sort((a,b)=>a.time-b.time);
 const result=[],dayContext={accounts:allAccounts,anchorsByAccount:byAccount,eventsByAccount:events};
 for(const a of accounts){const anchors=(byAccount.get(a.id)||[]).sort((a,b)=>a.time-b.time),es=(events.get(a.id)||[]).sort((a,b)=>a.time-b.time),prefix=[0n];for(const e of es)prefix.push(prefix.at(-1)+e.delta);const intervals=[];
  for(let i=1;i<anchors.length;i++){const start=anchors[i-1],end=anchors[i];if(start.conflict||end.conflict)continue;const lo=upper(es,start.time),hi=upper(es,end.time),movement=prefix[hi]-prefix[lo],computed=BigInt(start.balanceMinor)+movement,difference=BigInt(end.balanceMinor)-computed;intervals.push({startAsOf:start.asOf,endAsOf:end.asOf,startAnchorIds:start.anchorIds,endAnchorIds:end.anchorIds,startBalanceMinor:start.balanceMinor,observedEndBalanceMinor:end.balanceMinor,ledgerMovementMinor:String(movement),computedEndBalanceMinor:String(computed),differenceMinor:String(difference),balanceEventCount:hi-lo,status:difference===0n?'balanced':'difference',...(difference!==0n?{transactionIds:[...new Set(es.slice(lo,hi).map(e=>e.transactionId))]}:{})});}
  const conflicts=anchors.filter(s=>s.conflict),differences=intervals.filter(i=>i.status==='difference'),dayChecks=require('./observedDayBalances').compareObservedDayBalances(a,anchors,es,dayContext),outsideDays=dayChecks.filter(c=>c.status==='outside_observed_day_range');result.push({financialAccountId:a.id,currency:a.currency,independentAnchorCount:anchors.length-conflicts.length,independentIntervalCount:intervals.length,balancedIntervalCount:intervals.length-differences.length,differenceIntervalCount:differences.length,conflictingAnchorCount:conflicts.length,status:conflicts.length?'conflicting_observed_balances':differences.length||outsideDays.length?'balance_difference':intervals.length?'balanced_observed_intervals':'insufficient_independent_anchors',intervals,conflictingAnchors:conflicts.map(({time,...s})=>s),...(dayChecks.length?{observedDayBalanceChecks:dayChecks,outOfRangeDayBalanceCount:outsideDays.length}:{})});
 }
 return{schema:'independent-balance-reconciliation-v1',method:'observed_start_plus_ledger_movements_equals_observed_end',doesNotVerifyIndividualPurposeOrCompleteness:true,noDerivedOpeningUsedAsIndependentEvidence:true,summary:{accountCount:result.length,checkedAccountCount:result.filter(a=>a.independentIntervalCount).length,independentIntervalCount:result.reduce((n,a)=>n+a.independentIntervalCount,0),balancedIntervalCount:result.reduce((n,a)=>n+a.balancedIntervalCount,0),differenceIntervalCount:result.reduce((n,a)=>n+a.differenceIntervalCount,0),conflictingAnchorCount:result.reduce((n,a)=>n+a.conflictingAnchorCount,0)},accounts:result,...(result.some(a=>a.observedDayBalanceChecks?.length)?{observedDayBalanceSummary:{accountCount:result.filter(a=>a.observedDayBalanceChecks?.length).length,checkCount:result.reduce((n,a)=>n+(a.observedDayBalanceChecks?.length||0),0),outsideRangeCount:result.reduce((n,a)=>n+(a.outOfRangeDayBalanceCount||0),0)}}:{})};
}
// A failed account equation is one account issue, not a reason to accuse every
// transaction in its interval. Keep the discrepancy visible in the review count.
function balanceReviewIssues(report){
 const issues=[];
 for(const account of report.accounts){
  const intervals=account.intervals.filter(i=>i.status==='difference').map(i=>({startAsOf:i.startAsOf,endAsOf:i.endAsOf,differenceMinor:i.differenceMinor,startAnchorIds:i.startAnchorIds,endAnchorIds:i.endAnchorIds}));
  const dayBalances=(account.observedDayBalanceChecks||[]).filter(c=>c.status==='outside_observed_day_range');
  if(intervals.length||dayBalances.length)issues.push({reason:'account_balance_difference',financialAccountId:account.financialAccountId,currency:account.currency,intervalCount:intervals.length,intervals,...(dayBalances.length?{observedDayBalanceMismatchCount:dayBalances.length,dayBalances}:{}),basis:'independent_observed_balances_do_not_match_recorded_movements'});
  if(account.conflictingAnchorCount)issues.push({reason:'account_balance_conflict',financialAccountId:account.financialAccountId,currency:account.currency,conflictingAnchorCount:account.conflictingAnchorCount,anchors:account.conflictingAnchors,basis:'independent_sources_disagree_at_the_same_time'});
 }
 return issues;
}
module.exports={reconcileIndependentBalances,balanceReviewIssues};
