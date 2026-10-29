'use strict';
const invalid=()=>{throw Object.assign(new Error('CREDIT_FINANCING_INVALID'),{code:'CREDIT_FINANCING_INVALID'});};
function validateCreditFinancing(v){
 const keys=['schema','originalPrincipalMinor','termMonths','drawdownObservationIds','receiptObservationIds'];
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k))||v.schema!=='owner-confirmed-credit-financing-v1'||!/^\d{1,20}$/.test(v.originalPrincipalMinor||'')||BigInt(v.originalPrincipalMinor)<=0n||!Number.isInteger(v.termMonths)||v.termMonths<2||v.termMonths>600)invalid();
 for(const key of ['drawdownObservationIds','receiptObservationIds'])if(!Array.isArray(v[key])||!v[key].length||v[key].length>128||new Set(v[key]).size!==v[key].length||v[key].some(id=>typeof id!=='string'||!id||id.length>512))invalid();
 if(v.drawdownObservationIds.some(id=>v.receiptObservationIds.includes(id)))invalid();return v;
}
function buildCreditFinancing(accounts,observations,{annotatedIds=new Set(),links=[]}={}){
 const byId=new Map(observations.map(o=>[o.id,o])),identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),latest=new Map(),result=[];
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const current=[...latest.values()],resolve=id=>{const o=byId.get(id);return o&&latest.get(identity(o));};
 for(const a of accounts.filter(a=>a.creditFinancing)){
  const c=validateCreditFinancing(a.creditFinancing),m={financialAccountId:a.id,originalPrincipalMinor:c.originalPrincipalMinor,termMonths:c.termMonths,status:'evidence_conflict',sourceObservationIds:[],drawdownObservationIds:[],receiptObservationIds:[],balanceEvents:[]};result.push(m);
  if(a.type!=='credit_card'||a.status!=='active'||a.currency!=='CNY')continue;
  const draws=c.drawdownObservationIds.map(resolve),receipts=c.receiptObservationIds.map(resolve);if(draws.some(o=>!o)||receipts.some(o=>!o))continue;
  const all=[...draws,...receipts],keys=new Set(all.map(identity)),sourceIds=new Set(observations.filter(o=>keys.has(identity(o))).map(o=>o.id));m.sourceObservationIds=[...sourceIds];
  if(keys.size!==all.length||[...sourceIds].some(id=>annotatedIds.has(id))||links.some(l=>l.observationIds.some(id=>sourceIds.has(id))&&(l.status!=='deleted'&&['distinct','group_distinct','duplicate'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate')))continue;
  if(draws.some(o=>o.financialAccountId!==a.id||o.status!=='completed'||o.currency!=='CNY'||o.direction!=='debit'||o.kind!=='expense'||!o.bankStatement||o.bankStatement.nonCash||o.rawFields?.excludedFromBilledTotal!==true)||receipts.some(o=>{const bank=accounts.find(b=>b.id===o.financialAccountId);return !bank||bank.status!=='active'||!['bank','savings','debit_card'].includes(bank.type)||o.status!=='completed'||o.currency!=='CNY'||o.direction!=='credit'||!['unknown','loan_drawdown'].includes(o.kind)||!o.statementFlow;}))continue;
  const sum=rs=>rs.reduce((n,o)=>n+BigInt(o.amountMinor),0n),byDate=rs=>{const map=new Map();for(const o of rs)map.set(o.date,(map.get(o.date)||0n)+BigInt(o.amountMinor));return map;},dd=byDate(draws),rd=byDate(receipts);
  if(sum(draws)!==BigInt(c.originalPrincipalMinor)||sum(receipts)!==sum(draws)||dd.size!==rd.size||[...dd].some(([d,n])=>rd.get(d)!==n))continue;
  const first=draws.map(o=>o.date).sort()[0],card=current.filter(o=>o.financialAccountId===a.id&&o.status==='completed'&&!o.balanceEvidence&&o.date>=first),drawKeys=new Set(draws.map(identity));
  // New purchases, refunds, or manual overrides suspend this component estimate.
  if(card.some(o=>!drawKeys.has(identity(o))&&(annotatedIds.has(o.id)||!(o.direction==='debit'&&['interest','fee'].includes(o.kind)||o.direction==='credit'&&o.kind==='debt_payment'||o.direction==='neutral'&&(o.bankStatement?.nonCash||o.amountMinor==='0')))))continue;
  const events=card.filter(o=>drawKeys.has(identity(o))||o.direction!=='neutral').sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id));let principal=0n,cost=0n,paid=0n,charges=0n;
  for(const o of events){const amount=BigInt(o.amountMinor);if(drawKeys.has(identity(o)))principal+=amount;else if(o.direction==='debit'){cost+=amount;charges+=amount;}else{const interestPaid=amount<cost?amount:cost;cost-=interestPaid;principal-=amount-interestPaid;paid+=amount;}if(principal<0n){principal=null;break;}m.balanceEvents.push({date:o.date,occurredAt:o.occurredAt,observationId:o.id,principalMinor:String(principal),accruedCostMinor:String(cost),balanceMinor:String(principal+cost)});}
  if(principal===null){m.balanceEvents=[];continue;}
  Object.assign(m,{status:'reconciled_actual_records',confidence:'owner_confirmed_drawdown_actual_card_records',drawdownObservationIds:draws.map(o=>o.id),receiptObservationIds:receipts.map(o=>o.id),principalMinor:String(principal),accruedCostMinor:String(cost),balanceMinor:String(principal+cost),totalPaidMinor:String(paid),chargedFinancingCostMinor:String(charges),asOf:m.balanceEvents.at(-1)?.date,openingAccountBalanceAssumed:false,futurePaymentsProjected:false});
 }
 const claims=new Map();for(const m of result.filter(m=>m.status==='reconciled_actual_records'))for(const id of m.sourceObservationIds)claims.set(id,(claims.get(id)||0)+1);
 for(const m of result)if(m.sourceObservationIds.some(id=>claims.get(id)>1))Object.assign(m,{status:'evidence_conflict',drawdownObservationIds:[],receiptObservationIds:[],balanceEvents:[]});return result;
}
module.exports={validateCreditFinancing,buildCreditFinancing};
