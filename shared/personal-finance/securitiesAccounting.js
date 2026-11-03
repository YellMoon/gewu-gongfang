'use strict';
function separateSecuritiesAccounting(transactions){
 for(const t of transactions){
  const sources=(t.sources||[]).filter(s=>s.brokerage&&s.status==='completed');
  if(!sources.length||t.securitiesAccounting)continue;
  t.securitiesAccounting={schema:'securities-accounting-v1',financialAccountIds:[...new Set(sources.map(s=>s.financialAccountId))],incomeMinor:t.incomeMinor,expenseMinor:t.consumptionMinor,netRealizedMinor:t.incomeMinor-t.consumptionMinor,includesUnrealizedGains:false};
  t.incomeMinor=t.consumptionMinor=t.selectedIncomeMinor=t.selectedConsumptionMinor=0n;
  if(t.incomeExpenseAllocations)for(const value of Object.values(t.incomeExpenseAllocations)){value.incomeMinor=0n;value.consumptionMinor=0n;}
 }
}
function securitiesPeriodSummary(transactions,selected,{startDate,endDate}={}){
 const results=new Map();
 for(const t of transactions){if(!t.securitiesAccounting||startDate&&t.date<startDate||endDate&&t.date>endDate)continue;const accounting=t.securitiesAccounting;
  const ids=accounting.financialAccountIds.filter(id=>selected.has(id));if(ids.length!==1)continue;
  const id=ids[0],value=results.get(id)||{financialAccountId:id,currency:t.currency,incomeMinor:0n,expenseMinor:0n,netRealizedMinor:0n,depositMinor:0n,withdrawalMinor:0n};
  for(const key of ['incomeMinor','expenseMinor','netRealizedMinor'])value[key]+=BigInt(accounting[key]);
  const sources=new Map();for(const s of t.sources||[]){if(s.financialAccountId!==id||!s.brokerage||s.status!=='completed')continue;const key=s.sourceIdentity||s.id,prior=sources.get(key);if(!prior||(s.sourceVersionOrdinal||0)>(prior.sourceVersionOrdinal||0))sources.set(key,s);}
  for(const s of sources.values()){if(s.brokerage.activity==='deposit')value.depositMinor+=BigInt(s.brokerage.cashDeltaMinor);if(s.brokerage.activity==='withdrawal')value.withdrawalMinor-=BigInt(s.brokerage.cashDeltaMinor);}
  results.set(id,value);
 }
 return [...results.values()];
}
module.exports={separateSecuritiesAccounting,securitiesPeriodSummary};
