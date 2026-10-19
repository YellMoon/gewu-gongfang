'use strict';
// Balance proofs are observations, not another cash transaction.
// A proof may report available money rather than the account's total asset value.
function balanceAccountId(record,accounts){
 const product=record.balanceEvidence?.product;
 if(!product)return record.financialAccountId;
 const explicit=record.accountRelations?.find(r=>r.product===product)?.financialAccountId;
 if(explicit&&accounts.some(a=>a.id===explicit&&a.sourceProduct===product&&a.currency===record.currency))return explicit;
 const matches=accounts.filter(a=>a.sourceProduct===product&&a.currency===record.currency);
 return matches.length===1?matches[0].id:null;
}
function statementBalances(records,accounts,{includeAvailable=false}={}){
 const latest=new Map();
 for(const o of records){
  if(o.status!=='completed'||o.balanceMinor==null||['available','estimated','distributor_total','billed_debt'].includes(o.balanceEvidence?.balanceKind||o.statementFlow?.balanceKind)&&!includeAvailable)continue;
  const key=JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
  if(!latest.has(key)||(o.sourceVersionOrdinal||0)>(latest.get(key).sourceVersionOrdinal||0))latest.set(key,o);
 }
 // At one timestamp, only the final row within a validated proof is its closing balance.
 // Across independent files, keep conflicting assertions for the caller to flag.
 const rows=new Map();
 for(const o of latest.values()){
  const target=balanceAccountId(o,accounts);if(!target)continue;
  const key=JSON.stringify([target,o.occurredAt,(o.balanceEvidence||o.statementFlow)&&o.importId||o.id]);
  if(!rows.has(key)||(o.balanceEvidence?.sequence||o.statementFlow?.sequence||0)>(rows.get(key).balanceEvidence?.sequence||rows.get(key).statementFlow?.sequence||0))rows.set(key,o);
 }
 return [...rows.values()].map(o=>({id:o.id,financialAccountId:balanceAccountId(o,accounts),currency:o.currency,asOf:o.occurredAt,balanceMinor:o.balanceMinor,balanceConvention:o.balanceConvention,source:'statement_observation',sourceObservationId:o.id,balanceKind:o.balanceEvidence?.balanceKind||o.statementFlow?.balanceKind||'total',time:Date.parse(o.occurredAt)}));
}
module.exports={balanceAccountId,statementBalances};
