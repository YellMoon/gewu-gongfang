'use strict';
const { actualSecond }=require('./mixedPayments');

// Four original legs establish a refunded purchase despite its final closed
// status. Preserve the actual bank credit date and the failed order status.
function findDelayedClosedOrderRefunds(observations,accounts,{rootOf,fundingAccount,bankMerchant,annotatedIds=new Set(),links=[]}){
 const byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),roots=new Map();
 for(const o of observations){const k=JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const rows=[...latest.values()];for(const o of rows){const r=rootOf(o.id);if(!roots.has(r))roots.set(r,[]);roots.get(r).push(o);}
 const annotated=new Set([...annotatedIds].filter(id=>byId.has(id)).map(rootOf));
 const norm=v=>String(v||'').normalize('NFKC').replace(/[\s\p{P}]/gu,'');
 const actualBank=o=>o.status==='completed'&&o.provider==='bocom'&&o.bankStatement?.schema==='bank-credit-v1'&&!o.bankStatement.nonCash
  &&o.rawFields?.dateBasis==='transaction_date'&&o.rawFields?.tradeDate===o.date&&!o.rawFields?.excludedFromBilledTotal;
 const platformOnly=o=>(roots.get(rootOf(o.id))||[]).every(s=>s.provider==='alipay');
 const bankOnly=o=>(roots.get(rootOf(o.id))||[]).every(s=>s.bankStatement);
 const active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|')));
 const vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|')));
 const proposals=[];
 for(const refund of rows){
  const card=fundingAccount(refund,accounts);
  if(refund.provider!=='alipay'||refund.kind!=='refund'||refund.status!=='completed'||!['credit','neutral'].includes(refund.direction)
    ||!actualSecond(refund)||!platformOnly(refund)||refund.accountRelations?.length||!refund.relatedReference||!refund.sourceTransactionId
    ||card?.type!=='credit_card'||card.status!=='active'||BigInt(refund.amountMinor)<=0n)continue;
  const purchases=rows.filter(p=>p.provider==='alipay'&&p.status==='failed'&&p.kind==='expense'&&p.direction==='debit'
    &&p.rawFields?.['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u5173\u95ed'&&p.rawFields?.['\u6536/\u652f']==='\u652f\u51fa'
    &&actualSecond(p)&&platformOnly(p)&&!p.accountRelations?.length&&p.sourceTransactionId&&refund.sourceTransactionId.startsWith(p.sourceTransactionId+'_')
    &&p.relatedReference===refund.relatedReference&&p.amountMinor===refund.amountMinor&&p.currency===refund.currency&&p.date===refund.date
    &&Date.parse(p.occurredAt)<=Date.parse(refund.occurredAt)&&fundingAccount(p,accounts)?.id===card.id
    &&norm(p.counterparty).length>=4&&norm(p.counterparty)===norm(refund.counterparty));
  if(purchases.length!==1)continue;const purchase=purchases[0];
  const debits=rows.filter(o=>actualBank(o)&&bankOnly(o)&&o.financialAccountId===card.id&&o.date===purchase.date
    &&o.amountMinor===refund.amountMinor&&o.currency===refund.currency&&o.kind==='expense'&&o.direction==='debit'
    &&o.rawFields.statementCredit===false&&o.rawFields.statementAmountMinor===o.amountMinor&&bankMerchant(o)===norm(purchase.counterparty));
  if(new Set(debits.map(o=>rootOf(o.id))).size!==1)continue;const debit=debits[0];
  const next=new Date(Date.parse(refund.date)+86400000).toISOString().slice(0,10);
  const credits=rows.filter(o=>actualBank(o)&&bankOnly(o)&&o.financialAccountId===card.id&&o.date===next
    &&o.amountMinor===refund.amountMinor&&o.currency===refund.currency&&o.kind==='refund'&&o.direction==='credit'
    &&o.description==='\u6d88\u8d39\u9000\u8d27'&&o.counterparty===o.description&&o.rawFields.statementCredit===true&&o.rawFields.statementAmountMinor==='-'+o.amountMinor);
  if(new Set(credits.map(o=>rootOf(o.id))).size!==1)continue;const credit=credits[0],members=[purchase,refund,debit,credit],memberRoots=new Set(members.map(o=>rootOf(o.id)));
  if(memberRoots.size!==4||members.some(o=>annotated.has(rootOf(o.id))))continue;
  // Competing credits or refund/repayment orders prevent reciprocal uniqueness.
  const competing=rows.some(o=>!memberRoots.has(rootOf(o.id))&&o.status==='completed'&&o.currency===refund.currency&&o.amountMinor===refund.amountMinor
    &&o.date>=refund.date&&o.date<=next&&(o.bankStatement&&o.financialAccountId===card.id&&o.direction==='credit'
      ||['alipay','wechat','jd'].includes(o.provider)&&(['refund','income'].includes(o.kind)&&fundingAccount(o,accounts)?.id===card.id
        ||o.kind==='debt_payment'&&norm(o.counterparty).replace(/\u4fe1\u7528\u5361\u8fd8\u6b3e$/,'')===norm(card.provider))));
  if(competing||vetoes.some(l=>l.type==='group_distinct'?l.observationIds.some(id=>byId.has(id)&&memberRoots.has(rootOf(id)))
    :l.observationIds.every(id=>byId.has(id)&&memberRoots.has(rootOf(id)))))continue;
  proposals.push({refund,credit,members,evidence:{financialAccountId:card.id,amountMinor:refund.amountMinor,currency:refund.currency,
    originalPurchaseObservationId:purchase.id,bankPurchaseObservationId:debit.id,refundOrderReference:refund.sourceTransactionId,
    platformRefundDate:refund.date,bankCreditDate:credit.date,dateBasis:'both_original_transaction_dates',reciprocalUnique:true,closedStatusPreserved:true}});
 }
 const uses=new Map();for(const p of proposals)for(const o of[p.refund,p.credit])uses.set(rootOf(o.id),(uses.get(rootOf(o.id))||0)+1);
 return proposals.filter(p=>[p.refund,p.credit].every(o=>uses.get(rootOf(o.id))===1));
}
module.exports={findDelayedClosedOrderRefunds};
