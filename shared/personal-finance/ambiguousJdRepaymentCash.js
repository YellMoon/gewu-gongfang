'use strict';
// Resolve only the cash payer. The export's combined white/gold label is not
// evidence of which debt was repaid, its principal, or its financing cost.
function findAmbiguousJdRepaymentCash(observations,accounts,{rootOf=id=>id,fundingAccount,annotatedIds=new Set(),links=[]}={}){
 const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),latest=new Map(),byId=new Map(observations.map(o=>[o.id,o])),blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(key));
 for(const o of observations){const k=key(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const rows=[...latest.values()],roots=new Map();for(const o of rows){const id=rootOf(o.id);if(!roots.has(id))roots.set(id,[]);roots.get(id).push(o);}
 const active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|'))),out=[];
 for(const p of rows){
  const raw=p.rawFields||{},f=fundingAccount(p,accounts),proof=p.automaticFunding;
  if(p.provider!=='jd'||p.status!=='completed'||p.kind!=='debt_payment'||p.direction!=='neutral'||p.description!=='\u4eac\u4e1c\u767d\u6761/\u91d1\u6761-\u8fd8\u6b3e'||raw.creditProductAmbiguous!==true||raw['\u4ea4\u6613\u8bf4\u660e']!==p.description||raw['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==p.paymentChannel||p.accountRelations?.length||p.automaticRepaymentTarget||blocked.has(key(p))||roots.get(rootOf(p.id)).length!==1||BigInt(p.amountMinor)<=0n||proof?.method!=='owner_historical_card_binding'||proof.confidence!=='owner_confirmed'||f?.status!=='active'||f.type!=='debit_card'||f.currency!==p.currency||f.provider!=='\u676d\u5dde\u94f6\u884c'||proof.institution!==f.provider||proof.maskedIdentifier!==f.maskedIdentifier||p.paymentChannel!==f.provider)continue;
  const possible=rows.filter(b=>b.financialAccountId===f.id&&b.status==='completed'&&b.currency===p.currency&&b.date===p.date&&b.amountMinor===p.amountMinor&&b.direction==='debit'&&(b.statementFlow||b.bankStatement));
  if(possible.length!==1)continue;const b=possible[0],r=b.rawFields||{};
  if(b.provider!=='hangzhou'||b.statementFlow?.schema!=='hangzhou-debit-v1'||b.statementFlow.expenseMinor!==b.amountMinor||b.statementFlow.incomeMinor!=='0'||!['unknown','debt_payment'].includes(b.kind)||b.description!=='\u8f6c\u5e10'||b.counterparty!=='\u6216\u5176\u4ed6\u6b3e\u9879-\u8fde\u8fde\u652f\u4ed8'||r.description!==b.description||r.counterparty!==b.counterparty||!/^\*+\d{4}$/.test(r.counterAccount||'')||blocked.has(key(b))||roots.get(rootOf(b.id)).length!==1)continue;
  if(rows.some(o=>key(o)!==key(p)&&['jd','alipay','wechat'].includes(o.provider)&&o.status==='completed'&&o.currency===p.currency&&o.date===p.date&&o.amountMinor===p.amountMinor&&['neutral','debit'].includes(o.direction)&&fundingAccount(o,accounts)?.id===f.id))continue;
  const members=new Set([key(p),key(b)]);if(vetoes.some(l=>l.observationIds.map(id=>byId.get(id)).filter(Boolean).some(o=>members.has(key(o)))))continue;
  out.push({platform:p,bank:b,evidence:{financialAccountId:f.id,maskedIdentifier:f.maskedIdentifier,date:p.date,currency:p.currency,amountMinor:p.amountMinor,cashLegOnly:true,payerIdentityConfidence:'owner_confirmed',debtProductStatus:'white_or_gold_unresolved',principalAndCostSplitKnown:false,reciprocalUnique:true}});
 }
 const uses=new Map();for(const m of out)for(const o of[m.platform,m.bank])uses.set(rootOf(o.id),(uses.get(rootOf(o.id))||0)+1);return out.filter(m=>[m.platform,m.bank].every(o=>uses.get(rootOf(o.id))===1));
}
module.exports={findAmbiguousJdRepaymentCash};
