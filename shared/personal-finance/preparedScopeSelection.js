'use strict';

// Only selection fields change here. Economic amounts, evidence, cash and balance
// events are the already completed full-history decisions.
function projectSelectedTransactions(transactions, accounts, selected, effectiveSourceAccounts) {
 const every=accounts.every(a=>selected.has(a.id));
 return transactions.map(t=>{
  const report=(t.reportingAccountIds||[]).some(id=>selected.has(id))||every,allocation=t.incomeExpenseAllocations;
  let selectedIncomeMinor=allocation?Object.entries(allocation).reduce((n,[id,a])=>n+(selected.has(id)?BigInt(a.incomeMinor):0n),0n):report?BigInt(t.incomeMinor):0n;
  let selectedConsumptionMinor=allocation?Object.entries(allocation).reduce((n,[id,a])=>n+(selected.has(id)?BigInt(a.consumptionMinor):0n),0n):report?BigInt(t.consumptionMinor):0n;
  if(t.ownerRefundEstimate?.status==='applied'){
   selectedIncomeMinor=0n;selectedConsumptionMinor=selected.has(t.ownerRefundEstimate.financialAccountId)?BigInt(t.consumptionMinor):0n;
  }
  let selectedObservationIds;
  const merchant=t.merchantSettlementReceivable;
  if(merchant?.role==='claim_created')selectedObservationIds=selected.has(merchant.financialAccountId)?[merchant.collectionObservationId]:[];
  else if(merchant?.role==='claim_settled')selectedObservationIds=[...(selected.has(merchant.financialAccountId)?[merchant.withdrawalObservationId]:[]),...(selected.has(merchant.bankAccountId)?[merchant.bankReceiptObservationId]:[])];
  else if(t.nativeBuyerCreditFee?.role==='buyer_fee')selectedObservationIds=selected.has(t.nativeBuyerCreditFee.payerAccountId)?[t.id]:[];
  else {
   const sources=new Map((t.sources||[]).map(o=>[o.id,o.financialAccountId]));
   // Full-history selection already contains the original append/union order,
   // including duplicate proof IDs where the original rule appended them.
   selectedObservationIds=(t.selectedObservationIds||[]).filter(id=>selected.has(effectiveSourceAccounts.get(id)??sources.get(id))||(id===t.termDepositPosting?.sourceObservationId&&selected.has(t.termDepositPosting.termAccountId)));
  }
  return {...t,selectedIncomeMinor,selectedConsumptionMinor,selectedObservationIds};
 });
}
function clonePreparedValue(value){if(value===null||typeof value!=='object')return value;if(Array.isArray(value))return value.map(clonePreparedValue);const result=Object.create(Object.getPrototypeOf(value));for(const key of Object.keys(value))result[key]=clonePreparedValue(value[key]);return result;}
module.exports={projectSelectedTransactions,clonePreparedValue};
