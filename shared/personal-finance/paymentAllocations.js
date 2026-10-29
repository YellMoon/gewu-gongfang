'use strict';
const invalid=()=>{throw Object.assign(new Error('PAYMENT_ALLOCATION_INVALID'),{code:'PAYMENT_ALLOCATION_INVALID'});};
const integer=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v);
function paymentAllocation(source,annotation,accounts,observations,{allowArchived=false}={}){
 const p=annotation.patch?.paymentAllocation;if(!p)return null;
 const effective={...source,...annotation.patch},map=new Map(accounts.map(a=>[a.id,a])),byId=new Map(observations.map(o=>[o.id,o]));
 if(!p||p.schema!=='payment-allocation-v1'||Object.keys(p).some(k=>!['schema','parts','evidence','foldedObservationIds'].includes(k))||effective.status!=='completed'||!['expense','debt_payment'].includes(effective.kind)||effective.direction!=='debit'&&!(effective.kind==='debt_payment'&&effective.direction==='neutral')||!Array.isArray(p.parts)||!p.parts.length||p.parts.length>4||!p.evidence||Object.keys(p.evidence).some(k=>!['documentSha256','page','receiptNumber'].includes(k))||!/^[a-f0-9]{64}$/.test(p.evidence.documentSha256||'')||!Number.isInteger(p.evidence.page)||p.evidence.page<1||p.evidence.page>10000||!/^\d{18,80}$/.test(p.evidence.receiptNumber||'')||effective.accountRelations?.some(r=>r.role==='funding')||effective.investmentTrade||effective.brokerage)invalid();
 if(effective.assetAllocation||effective.settlementAccountId)invalid();
 const ids=new Set(),parts=[];let total=0n;
 for(const part of p.parts){if(!part||typeof part!=='object'||Array.isArray(part))invalid();const a=map.get(part.financialAccountId);if(!a||!['active',...(allowArchived?['archived']:[])].includes(a.status)||a.currency!==source.currency||!['wallet','debit_card','cash','savings','bank'].includes(a.type)||!integer(part.amountMinor)||ids.has(a.id)||Object.keys(part).some(k=>!['financialAccountId','amountMinor','bankObservationId'].includes(k)))invalid();ids.add(a.id);total+=BigInt(part.amountMinor);
  if(a.type!=='wallet'&&a.type!=='cash'){const b=byId.get(part.bankObservationId);if(!b||!b.statementFlow||b.status!=='completed'||b.financialAccountId!==a.id||b.currency!==source.currency||b.direction!=='debit'||b.amountMinor!==part.amountMinor||b.date!==source.date)invalid();}
  else if(part.bankObservationId!==undefined)invalid();parts.push({...part});
 }
 if(total!==BigInt(source.amountMinor))invalid();
 if(effective.kind==='debt_payment'&&[effective.interestMinor,effective.feeMinor].some(v=>v!==null&&v!==undefined&&BigInt(v)!==0n))invalid();
 const folded=p.foldedObservationIds||[];if(!Array.isArray(folded)||folded.length>4||new Set(folded).size!==folded.length)invalid();
 for(const id of folded){const o=byId.get(id);if(!o||o.id===source.id||o.provider!=='alipay'||o.kind!=='transfer'||o.status!=='completed'||o.direction!=='neutral'||o.description!=='\u6570\u5b57\u4eba\u6c11\u5e01-\u8f6c\u5165'||o.date!==source.date||o.currency!==source.currency||!parts.some(part=>part.bankObservationId&&part.amountMinor===o.amountMinor))invalid();}
 return {method:'document_payment_allocation',sourceObservationId:source.id,parts,evidence:{...p.evidence},foldedObservationIds:[...folded],observationIds:[source.id,...parts.map(p=>p.bankObservationId).filter(Boolean),...folded]};
}
function paymentAllocationPlans(annotations,accounts,observations,links=[]){
 const byId=new Map(observations.map(o=>[o.id,o])),active=links.filter(l=>l.status!=='deleted'),pairs=new Set(active.map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!pairs.has([...l.observationIds].sort().join('|'))),plans=[];
 for(const a of annotations.values()){if(a.reset||!a.patch?.paymentAllocation)continue;const source=byId.get(a.observationId);if(!source)invalid();const plan=paymentAllocation(source,a,accounts,observations,{allowArchived:true});if(plan.foldedObservationIds.some(id=>annotations.has(id)&&!annotations.get(id).reset))continue;const members=new Set(plan.observationIds);if(vetoes.some(l=>l.type==='group_distinct'?l.observationIds.some(id=>members.has(id)):l.observationIds.every(id=>members.has(id))))continue;plans.push(plan);}
 const used=new Map();for(const p of plans)for(const id of p.observationIds)used.set(id,(used.get(id)||0)+1);return plans.filter(p=>p.observationIds.every(id=>used.get(id)===1));
}
function paymentAllocationEffects(plan,sources,accounts,source){
 const map=new Map(accounts.map(a=>[a.id,a])),effects=new Map(),flow=new Map(),times=new Map(),set=(id,delta,time,cash)=>{if(effects.has(id))throw Object.assign(new Error('PAYMENT_ALLOCATION_CONFLICT'),{code:'PAYMENT_ALLOCATION_CONFLICT'});effects.set(id,delta);times.set(id,time);if(cash)flow.set(id,delta);};
 for(const s of sources.filter(s=>(s.statementFlow||s.bankStatement)&&s.status==='completed')){const a=map.get(s.financialAccountId),debit=s.direction==='debit';if(!a||s.currency!==source.currency||s.date!==source.date||!debit&&!(a.type==='credit_card'&&s.direction==='credit'&&s.amountMinor===source.amountMinor)||debit&&!plan.parts.some(p=>p.bankObservationId===s.id&&p.financialAccountId===a.id&&p.amountMinor===s.amountMinor))throw Object.assign(new Error('PAYMENT_ALLOCATION_CONFLICT'),{code:'PAYMENT_ALLOCATION_CONFLICT'});set(a.id,BigInt(s.amountMinor)*(debit?-1n:1n),s.occurredAt,!['credit_card','loan'].includes(a.type));}
 for(const p of plan.parts)if(!p.bankObservationId)set(p.financialAccountId,-BigInt(p.amountMinor),source.occurredAt,true);
 return {effects,flow,times};
}
module.exports={paymentAllocation,paymentAllocationPlans,paymentAllocationEffects};
