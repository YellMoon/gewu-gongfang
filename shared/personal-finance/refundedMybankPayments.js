'use strict';
const {actualSecond}=require('./mixedPayments');

// Infer the purpose of an otherwise unknown debit only from the bank's own
// explicit full refund. These are two real cash events, never duplicates.
function refundedMybankPayments(observations,accounts,{annotatedIds=new Set(),links=[]}={}){
 const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),am=new Map(accounts.map(a=>[a.id,a]));
 for(const o of observations){const key=identity(o);if(!latest.has(key)||(o.sourceVersionOrdinal||0)>(latest.get(key).sourceVersionOrdinal||0))latest.set(key,o);}
 const blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity)),rows=[...latest.values()],linked=new Set(links.filter(l=>l.status!=='deleted'||l.type==='duplicate').flatMap(l=>l.observationIds).map(id=>byId.get(id)).filter(Boolean).map(identity));
 const amountMatches=(raw,amount,credit)=>{const m=String(raw??'').match(credit?/^\+(\d+)(?:\.(\d{1,2}))?$/:/^-(\d+)(?:\.(\d{1,2}))?$/);return Boolean(m)&&BigInt(m[1])*100n+BigInt((m[2]||'').padEnd(2,'0'))===BigInt(amount);};
 const financial=/\u94f6\u884c|\u4f59\u989d\u5b9d|\u4f59\u5229\u5b9d|\u96f6\u94b1\u901a|\u7406\u8d22|\u57fa\u91d1|\u8bc1\u5238|\u501f\u5457|\u82b1\u5457|\u4fe1\u7528|\u8d37\u6b3e|\u8fd8\u6b3e|\u91d1\u6761|\u767d\u6761|\u4fdd\u9669|\u62bc\u91d1|\u4fdd\u8bc1\u91d1|\u9884\u6388\u6743/;
 const native=o=>{const a=am.get(o.financialAccountId),raw=o.rawFields;return o.provider==='mybank'&&o.status==='completed'&&o.currency==='CNY'&&o.statementFlow?.schema==='mybank-current-v1'&&a?.provider==='\u7f51\u5546\u94f6\u884c'&&a.type==='debit_card'&&a.status==='active'&&a.currency===o.currency&&actualSecond(o)&&BigInt(o.amountMinor)>0n&&raw?.['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']==='\u652f\u4ed8\u5b9d'&&raw['\u5bf9\u65b9\u6237\u540d']===o.counterparty&&o.counterparty&&o.counterparty!=='/'&&!financial.test(o.counterparty)&&/^\*{4,}\d{4}$/.test(raw['\u5bf9\u65b9\u8d26\u53f7']||'')&&raw['\u4ea4\u6613\u540d\u79f0']===o.description&&o.sourceTransactionId&&raw['\u4ea4\u6613\u6d41\u6c34\u53f7']===o.sourceTransactionId;};
 const allDebits=rows.filter(o=>native(o)&&o.direction==='debit'&&o.description==='\u5feb\u6377\u652f\u4ed8-\u652f\u4ed8\u5b9d-'+o.counterparty&&o.statementFlow.incomeMinor==='0'&&o.statementFlow.expenseMinor===o.amountMinor&&amountMatches(o.rawFields['\u4ea4\u6613\u91d1\u989d'],o.amountMinor,false));
 const allRefunds=rows.filter(o=>native(o)&&o.direction==='credit'&&o.description==='\u5feb\u6377\u652f\u4ed8\u9000\u6b3e-\u652f\u4ed8\u5b9d-'+o.counterparty&&o.statementFlow.incomeMinor===o.amountMinor&&o.statementFlow.expenseMinor==='0'&&amountMatches(o.rawFields['\u4ea4\u6613\u91d1\u989d'],o.amountMinor,true));
 const eligible=o=>!o.accountRelations?.length&&!o.automaticFunding&&!blocked.has(identity(o))&&!linked.has(identity(o)),debits=allDebits.filter(o=>eligible(o)&&o.kind==='unknown'&&!o.automaticClassification),refunds=allRefunds.filter(o=>eligible(o)&&o.kind==='refund');
 const proposals=[];
 for(const p of debits)for(const r of refunds){const seconds=(Date.parse(r.occurredAt)-Date.parse(p.occurredAt))/1000;if(p.financialAccountId!==r.financialAccountId||p.date!==r.date||p.amountMinor!==r.amountMinor||p.currency!==r.currency||p.counterparty!==r.counterparty||p.rawFields['\u5bf9\u65b9\u8d26\u53f7']!==r.rawFields['\u5bf9\u65b9\u8d26\u53f7']||!Number.isInteger(seconds)||seconds<=0||seconds>3600)continue;
  const sameCash=o=>o.financialAccountId===p.financialAccountId&&o.date===p.date&&o.amountMinor===p.amountMinor&&o.currency===p.currency&&o.counterparty===p.counterparty&&o.rawFields['\u5bf9\u65b9\u8d26\u53f7']===p.rawFields['\u5bf9\u65b9\u8d26\u53f7'];
  if(allDebits.filter(o=>sameCash(o)&&Date.parse(o.occurredAt)<Date.parse(r.occurredAt)&&Date.parse(o.occurredAt)>=Date.parse(r.occurredAt)-3600000).length!==1||allRefunds.filter(o=>sameCash(o)&&Date.parse(o.occurredAt)>Date.parse(p.occurredAt)&&Date.parse(o.occurredAt)<=Date.parse(p.occurredAt)+3600000).length!==1)continue;
  // An existing platform event may carry a non-consumption purpose. Do not
  // override it through this fallback for missing platform records.
  if(rows.some(o=>o.provider==='alipay'&&o.date===p.date&&o.amountMinor===p.amountMinor&&o.currency===p.currency&&['completed','failed'].includes(o.status)))continue;
  proposals.push({p,r,seconds});
 }
 const uses=new Map();for(const m of proposals)for(const o of[m.p,m.r])uses.set(identity(o),(uses.get(identity(o))||0)+1);
 return new Map(proposals.filter(m=>[m.p,m.r].every(o=>uses.get(identity(o))===1)).map(({p,r,seconds})=>[p.id,{kind:'expense',automaticClassification:{method:'paired_original_payment_refund',confidence:'inferred',evidenceObservationIds:[p.id,r.id],refundSourceTransactionId:r.sourceTransactionId,secondsUntilRefund:seconds,oppositeAccount:p.rawFields['\u5bf9\u65b9\u8d26\u53f7'],reciprocalUnique:true,cashEventsKeptSeparate:true}}]));
}
module.exports={refundedMybankPayments};
