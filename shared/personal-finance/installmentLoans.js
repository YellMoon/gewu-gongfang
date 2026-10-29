'use strict';
const invalid=()=>{throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_INPUT_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_INPUT_INVALID'});};
const amount=v=>typeof v==='string'&&/^[1-9]\d{0,20}$/.test(v),id=v=>typeof v==='string'&&v.length>0&&v.length<=512;
function validateInstallmentLoan(v){
 const keys=['schema','originalPrincipalMinor','termMonths','sourceAccountId','drawdownObservationId','paymentObservationIds','settlementObservationId','settled'];
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k))||v.schema!=='flat-installment-loan-v1'||!amount(v.originalPrincipalMinor)||!Number.isInteger(v.termMonths)||v.termMonths<2||v.termMonths>600||!id(v.sourceAccountId)||!id(v.drawdownObservationId)||!id(v.settlementObservationId)||v.settled!==true||!Array.isArray(v.paymentObservationIds)||v.paymentObservationIds.length<4||v.paymentObservationIds.length>1200||v.paymentObservationIds.some(x=>!id(x))||new Set(v.paymentObservationIds).size!==v.paymentObservationIds.length||!v.paymentObservationIds.includes(v.settlementObservationId)||v.paymentObservationIds.includes(v.drawdownObservationId)||BigInt(v.originalPrincipalMinor)%BigInt(v.termMonths)!==0n)invalid();
 return v;
}
const round=(n,d)=>(n+d/2n)/d;
function buildInstallmentLoans(accounts,observations,{annotatedIds=new Set(),links=[]}={}){
 const byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),result=[];
 for(const o of observations){const k=key(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const resolve=id=>{const original=byId.get(id);return original&&latest.get(key(original));};
 for(const account of accounts.filter(a=>a.type==='loan'&&a.installmentLoan)){
  const c=validateInstallmentLoan(account.installmentLoan),model={financialAccountId:account.id,sourceAccountId:c.sourceAccountId,status:'schedule_conflict',confidence:'inferred_reconciled_schedule',costClassification:'interest_or_financing_fee',originalPrincipalMinor:c.originalPrincipalMinor,termMonths:c.termMonths,periods:[],balanceEvents:[],balanceMinor:null,assumptions:['equal_principal_equal_financing_cost','settlement_cost_prorated_over_current_due_cycle'],userConfirmedFacts:['original_principal','term_months','settled'],sourceObservationIds:[c.drawdownObservationId,...c.paymentObservationIds]};result.push(model);
  const draw=resolve(c.drawdownObservationId),payments=c.paymentObservationIds.map(resolve),settlement=resolve(c.settlementObservationId),ids=new Set(model.sourceObservationIds);
  const sourceKeys=new Set([...ids].map(id=>byId.get(id)).filter(Boolean).map(key));for(const o of observations)if(sourceKeys.has(key(o)))ids.add(o.id);model.sourceObservationIds=[...ids];
  const veto=links.some(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)&&l.observationIds.some(id=>ids.has(id))||l.status==='deleted'&&l.type==='duplicate'&&l.observationIds.some(id=>ids.has(id)));
  if(veto||[...ids].some(id=>annotatedIds.has(id))||!draw||!settlement||payments.some(o=>!o)||new Set(payments.map(key)).size!==payments.length||draw.financialAccountId!==c.sourceAccountId||draw.status!=='completed'||draw.currency!=='CNY'||draw.kind!=='loan_drawdown'||draw.direction!=='credit'||draw.amountMinor!==c.originalPrincipalMinor||draw.statementFlow?.schema!=='psbc-debit-v1'||payments.some(o=>o.financialAccountId!==c.sourceAccountId||o.status!=='completed'||o.currency!=='CNY'||o.direction!=='debit'||o.kind!=='debt_payment'||o.statementFlow?.schema!=='psbc-debit-v1'||o.description!=='\u8d37\u6b3e\u8fd8\u6b3e'||o.date<=draw.date||o.date>settlement.date))continue;
  const regular=payments.filter(o=>o.id!==settlement.id),months=new Map();for(const o of regular){const m=o.date.slice(0,7);if(!months.has(m))months.set(m,[]);months.get(m).push(o);}
  const rows=[...months].sort(([a],[b])=>a.localeCompare(b));if(rows.length<3)continue;
  const principal=BigInt(c.originalPrincipalMinor),monthlyPrincipal=principal/BigInt(c.termMonths),monthIndex=d=>Number(d.slice(0,4))*12+Number(d.slice(5,7)),dueDay=draw.date.slice(8),paymentAmount=rows[0][1].reduce((s,o)=>s+BigInt(o.amountMinor),0n),cost=paymentAmount-monthlyPrincipal;
  if(rows.length<3||rows.length>=c.termMonths||cost<0n||rows.some(([m,rs],i)=>monthIndex(m)!==monthIndex(draw.date)+i+1||rs.some(o=>o.date!==m+'-'+dueDay)||rs.reduce((s,o)=>s+BigInt(o.amountMinor),0n)!==paymentAmount))continue;
  const lastDate=rows.at(-1)[0]+'-'+dueDay,nextDate=new Date(Date.UTC(Number(lastDate.slice(0,4)),Number(lastDate.slice(5,7)),Number(dueDay))).toISOString().slice(0,10),elapsed=BigInt((Date.parse(settlement.date)-Date.parse(lastDate))/86400000),cycle=BigInt((Date.parse(nextDate)-Date.parse(lastDate))/86400000),remaining=principal-BigInt(rows.length)*monthlyPrincipal,closingCost=round(cost*elapsed,cycle);
  if(elapsed<=0n||elapsed>=cycle||remaining+closingCost!==BigInt(settlement.amountMinor))continue;
  const totalPaid=payments.reduce((s,o)=>s+BigInt(o.amountMinor),0n),lifetimeCost=totalPaid-principal;if(lifetimeCost!==BigInt(rows.length)*cost+closingCost)continue;
  let balance=principal;model.balanceEvents.push({date:draw.date,balanceMinor:String(balance)});
  for(const [m,rs]of rows){balance-=monthlyPrincipal;const date=rs[0].date;model.periods.push({month:m,date,amountMinor:String(paymentAmount),principalMinor:String(monthlyPrincipal),financingCostMinor:String(cost),balanceMinor:String(balance),observationIds:rs.map(o=>o.id),confidence:model.confidence});model.balanceEvents.push({date,balanceMinor:String(balance)});}
  model.periods.push({month:settlement.date.slice(0,7),date:settlement.date,amountMinor:settlement.amountMinor,principalMinor:String(remaining),financingCostMinor:String(closingCost),balanceMinor:'0',observationIds:[settlement.id],confidence:model.confidence,settlement:true,elapsedDays:Number(elapsed),cycleDays:Number(cycle)});model.balanceEvents.push({date:settlement.date,balanceMinor:'0'});
  Object.assign(model,{status:'reconciled_settled',asOf:settlement.date,balanceMinor:'0',totalPaidMinor:String(totalPaid),lifetimeFinancingCostMinor:String(lifetimeCost),monthlyPrincipalMinor:String(monthlyPrincipal),monthlyFinancingCostMinor:String(cost),drawdownObservationId:draw.id});
 }
 const claims=new Map();for(const m of result.filter(m=>m.status==='reconciled_settled'))for(const id of m.sourceObservationIds)claims.set(id,(claims.get(id)||0)+1);
 for(const m of result)if(m.sourceObservationIds.some(id=>claims.get(id)>1))Object.assign(m,{status:'schedule_conflict',periods:[],balanceEvents:[],balanceMinor:null});
 return result;
}
module.exports={validateInstallmentLoan,buildInstallmentLoans};
