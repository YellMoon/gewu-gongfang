'use strict';
const {fundingIdentity}=require('./assetRegister');
function findCommercePaymentTraces(observations,{annotatedIds=new Set(),annotations=new Map(),links=[],accounts=[],rootOf}={}){
 const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),annotated=new Set();
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);if(annotatedIds.has(o.id))annotated.add(k);}
 const active=links.filter(l=>l.status!=='deleted'),activePairs=new Set(active.map(l=>[...l.observationIds].sort().join('|'))),veto=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!activePairs.has([...l.observationIds].sort().join('|'))),blocked=(a,b)=>veto.some(l=>{const ids=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(identity);return l.type==='group_distinct'?ids.includes(identity(a))||ids.includes(identity(b)):ids.includes(identity(a))&&ids.includes(identity(b));});
 const rows=[...latest.values()].filter(o=>o.status==='completed'&&o.kind==='expense'&&o.direction==='debit'),buckets=new Map(),key=o=>JSON.stringify([o.date,o.currency,o.amountMinor]),candidates=[];
 for(const w of rows)if(w.provider==='wechat'&&!annotated.has(identity(w))&&/^\u4eac\u4e1c(?:\u5546\u57ce\u5e73\u53f0\u5546\u6237)?$/.test(w.counterparty)){const k=key(w);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(w);}
 for(const p of rows){if(p.provider!=='jd'||!/^\u5fae\u4fe1\u652f\u4ed8(?:\u4fe1\u7528\u5361)?$/.test(p.paymentChannel)||annotated.has(identity(p)))continue;
  const order=String(p.rawFields?.['\u4ea4\u6613\u8ba2\u5355\u53f7']||'').trim();if(!/^\d{8,40}$/.test(order))continue;
  for(const w of buckets.get(key(p))||[]){
   if(blocked(p,w)||p.paymentChannel.endsWith('\u4fe1\u7528\u5361')&&fundingIdentity(w.paymentChannel)?.type!=='credit_card')continue;
   const seconds=Math.abs(Date.parse(p.occurredAt)-Date.parse(w.occurredAt))/1000,full=w.description.match(/\u8ba2\u5355(?:\u7f16\u53f7)?(\d{8,40})(?!\d)/)?.[1],tail=w.description.match(/(?:\u8ba2\u5355(?:\u7f16\u53f7)?|\u4eac\u4e1c-)\*{4}(\d{4})(?!\d)/)?.[1];
   const exact=full===order&&seconds<=60,masked=tail&&order.endsWith(tail)&&seconds===0;
   if(exact||masked)candidates.push({commerce:p,payment:w,method:'commerce_payment_trace',confidence:'inferred',evidence:{channel:'wechat',orderMatch:exact?'full_order_number':'masked_order_tail_and_exact_second',secondsApart:seconds,date:p.date,amountMinor:p.amountMinor,currency:p.currency,reciprocalUnique:true}});
  }
 }
 for(const p of rows){
  if(p.provider!=='jd'||p.paymentChannel!=='\u5fae\u4fe1\u652f\u4ed8\u4fe1\u7528\u5361'||p.accountRelations?.length||p.paymentAccountHint||annotated.has(identity(p))||String(p.rawFields?.['\u4ea4\u6613\u65f6\u95f4']||'').replace(/\s/g,'')!==p.date+p.occurredAt.slice(11,19)||!/^\d{8,40}$/.test(String(p.rawFields?.['\u4ea4\u6613\u8ba2\u5355\u53f7']||'').trim()))continue;
  if(rows.some(o=>o.id!==p.id&&['jd','wechat','alipay'].includes(o.provider)&&key(o)===key(p)))continue;
  for(const b of rows){
   const raw=b.rawFields||{},text=String(b.description||'').normalize('NFKC').replace(/\s/g,'');
   if(!b.bankStatement||b.bankStatement.nonCash||raw.dateBasis!=='transaction_date'||raw.tradeDate!==b.date||raw.statementCredit!==false||key(b)!==key(p)||b.counterparty!==b.description||text!=='\u6d88\u8d39\u8d22\u4ed8\u901a(\u94f6\u8054\u4e91\u95ea\u4ed8)\u4eac\u4e1c\u5546\u57ce\u5e73\u53f0\u5546\u6237'||annotated.has(identity(b))||blocked(p,b))continue;
   const minute=raw.sourceTradeDateTime;if(typeof minute==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(minute)){const start=Date.parse(minute.replace(' ','T')+':00+08:00'),at=Date.parse(p.occurredAt);if(at<start||at>=start+60000)continue;}
   candidates.push({commerce:p,payment:b,method:'commerce_named_bank_payment_trace',confidence:'inferred',evidence:{channel:'wechat_credit_card',merchantBasis:'explicit_jd_bank_merchant_and_channel',date:p.date,amountMinor:p.amountMinor,currency:p.currency,bankCardTail:raw.cardTail,reciprocalUnique:true}});
  }
 }
 candidates.push(...require('./commerceNetPayments').findCommerceNetPayments(rows,accounts,{identity,annotated,blocked,rootOf,allRows:[...latest.values()]}));
 candidates.push(...require('./commercePaymentBenefits').findCommercePaymentBenefits(observations,accounts,{annotations,links,rootOf}));
 const commerceUses=new Map(),paymentUses=new Map();for(const m of candidates){commerceUses.set(identity(m.commerce),(commerceUses.get(identity(m.commerce))||0)+1);paymentUses.set(identity(m.payment),(paymentUses.get(identity(m.payment))||0)+1);}
 return candidates.filter(m=>commerceUses.get(identity(m.commerce))===1&&paymentUses.get(identity(m.payment))===1);
}
module.exports={findCommercePaymentTraces};
