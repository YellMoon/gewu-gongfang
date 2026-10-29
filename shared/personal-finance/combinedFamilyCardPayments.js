'use strict';
const {actualSecond}=require('./mixedPayments');
function findCombinedFamilyCardPayments(observations,accounts,{rootOf=id=>id,fundingAccount,bankPaymentProvider,annotatedIds=new Set(),links=[]}={}){
 const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity));
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const rows=[...latest.values()],roots=new Map(),buckets=new Map();for(const o of rows){const k=rootOf(o.id);if(!roots.has(k))roots.set(k,[]);roots.get(k).push(o);}
 const active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|')));
 for(const p of rows){const f=fundingAccount(p,accounts),raw=p.rawFields||{};
  if(p.provider!=='alipay'||p.status!=='completed'||p.kind!=='expense'||p.direction!=='debit'||p.accountRelations?.length||p.description!=='\u4eb2\u60c5\u5361'||!p.counterparty||!actualSecond(p)||raw['\u4ea4\u6613\u65f6\u95f4']!==p.date+' '+p.occurredAt.slice(11,19)||raw['\u5546\u54c1\u8bf4\u660e']!==p.description||raw['\u6536/\u652f']!=='\u652f\u51fa'||raw['\u4ea4\u6613\u5206\u7c7b']!=='\u4eb2\u53cb\u4ee3\u4ed8'||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==p.sourceTransactionId||!/^\d{20,40}$/.test(p.sourceTransactionId||'')||!/^\d{20,40}$/.test(raw['\u5546\u5bb6\u8ba2\u5355\u53f7']||'')||/[&+]/.test(p.paymentChannel)||f?.status!=='active'||f.type!=='credit_card'||f.currency!==p.currency||blocked.has(identity(p))||roots.get(rootOf(p.id)).length!==1||BigInt(p.amountMinor)<=0n)continue;
  const key=JSON.stringify([p.financialAccountId,f.id,p.date,p.occurredAt,p.currency,p.counterparty]);if(!buckets.has(key))buckets.set(key,{fund:f,platform:[]});buckets.get(key).platform.push(p);
 }
 const proposals=[];
 for(const {fund,platform}of buckets.values()){
  if(platform.length<2||platform.length>8)continue;const p=platform[0],ids=platform.map(p=>BigInt(p.sourceTransactionId)).sort((a,b)=>a<b?-1:a>b?1:0);if(ids.some((id,i)=>i&&id!==ids[i-1]+1n))continue;
  const total=platform.reduce((n,p)=>n+BigInt(p.amountMinor),0n),banks=rows.filter(b=>b.status==='completed'&&b.financialAccountId===fund.id&&b.date===p.date&&b.currency===p.currency&&b.direction==='debit'&&BigInt(b.amountMinor)===total&&b.bankStatement);
  if(banks.length!==1)continue;const bank=banks[0],raw=bank.rawFields||{};if(bank.kind!=='expense'||bank.provider!=='ccb'||bank.bankStatement?.schema!=='bank-credit-v1'||bank.bankStatement.nonCash||raw.dateBasis!=='transaction_date'||raw.tradeDate!==bank.date||raw.statementCredit!==false||raw.statementAmountMinor!==bank.amountMinor||raw.cardTail!==fund.maskedIdentifier||bankPaymentProvider(bank)!=='alipay'||blocked.has(identity(bank))||roots.get(rootOf(bank.id)).length!==1)continue;
  const members=[...platform,bank],keys=new Set(members.map(identity));if(vetoes.some(l=>l.observationIds.map(id=>byId.get(id)).filter(Boolean).some(o=>keys.has(identity(o)))))continue;
  if(rows.some(o=>o.provider==='alipay'&&!keys.has(identity(o))&&o.status==='completed'&&o.date===p.date&&o.currency===p.currency&&o.direction==='debit'&&BigInt(o.amountMinor)===total&&fundingAccount(o,accounts)?.id===fund.id))continue;
  proposals.push({id:'combined_family_'+bank.id,method:'combined_family_card_payment_group',confidence:'inferred',observationIds:members.map(o=>o.id),platformRootIds:platform.map(o=>rootOf(o.id)),bankRootIds:[rootOf(bank.id)],evidence:{financialAccountId:fund.id,date:p.date,currency:p.currency,platform:'alipay',count:platform.length,platformCount:platform.length,bankCount:1,totalMinor:String(total),individualIdentity:'same_second_adjacent_family_orders_one_actual_card_debit',statisticsAuthority:'individual_platform_orders',sameOriginalPaymentSecond:p.occurredAt,adjacentOriginalOrderIds:true,reciprocalUnique:true}});
 }
 const uses=new Map();for(const p of proposals)for(const id of p.observationIds)uses.set(rootOf(id),(uses.get(rootOf(id))||0)+1);return proposals.filter(p=>p.observationIds.every(id=>uses.get(rootOf(id))===1));
}
module.exports={findCombinedFamilyCardPayments};
