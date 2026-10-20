'use strict';

// Match a closed batch without claiming an individual bank-to-order identity.
// The ledger keeps each bank movement and each platform order independently.
function findReconciliationGroups(observations,accounts,{rootOf,fundingAccount,bankPaymentProvider,annotatedIds=new Set(),links=[]}){
 const roots=new Map(),accountMap=new Map(accounts.map(a=>[a.id,a])),buckets=new Map(),uncertainBankKeys=new Set();
 for(const o of observations){const id=rootOf(o.id);if(!roots.has(id))roots.set(id,[]);roots.get(id).push(o);}
 const annotatedRoots=new Set([...annotatedIds].map(rootOf));
 for(const [id,sources] of roots){
  const completed=sources.filter(o=>o.status==='completed'),platform=completed.filter(o=>['alipay','wechat'].includes(o.provider)),bank=completed.filter(o=>o.bankStatement||o.statementFlow);
  if(Boolean(platform.length)===Boolean(bank.length))continue;
  const side=platform.length?'platform':'bank',rows=platform.length?platform:bank;
  const o=[...rows].sort((a,b)=>(b.sourceVersionOrdinal||0)-(a.sourceVersionOrdinal||0))[0];
  const fund=side==='platform'?fundingAccount(o,accounts):accountMap.get(o.financialAccountId),channel=side==='platform'?o.provider:bankPaymentProvider(o);
  if(!fund)continue;
  if(side==='bank'&&!['alipay','wechat'].includes(channel))uncertainBankKeys.add(JSON.stringify([fund.id,o.date,o.amountMinor,o.currency,o.direction]));
  if(!['alipay','wechat'].includes(channel))continue;
  const key=JSON.stringify([fund.id,o.date,o.amountMinor,o.currency,o.direction,channel]);
  if(!buckets.has(key))buckets.set(key,{platform:[],bank:[]});buckets.get(key)[side].push({id,o,sources});
 }
 const active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|')));
 const veto=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|')));
 const result=[];
 for(const [key,b] of buckets){
  const count=b.platform.length,all=[...b.platform,...b.bank],ids=new Set(all.map(x=>x.id));
  const kind=b.platform[0]?.o.kind,direction=b.platform[0]?.o.direction,eligible=kind==='expense'&&direction==='debit'||kind==='refund'&&direction==='credit';
  const bankRoots=new Set(b.bank.map(x=>x.id));
  if(!eligible||uncertainBankKeys.has(JSON.stringify(JSON.parse(key).slice(0,5)))||count<2||count>32||count!==b.bank.length||all.some(x=>annotatedRoots.has(x.id)||x.sources.some(o=>o.status!=='completed'||o.kind!==kind&&!(bankRoots.has(x.id)&&o.statementFlow&&o.kind==='unknown')||o.direction!==direction||o.amountMinor!==x.o.amountMinor||o.date!==x.o.date||o.currency!==x.o.currency)))continue;
  const actualTradeDate=o=>o.rawFields?.dateBasis==='transaction_date'&&o.rawFields?.tradeDate===o.date||o.statementFlow?.schema==='mybank-current-v1'&&String(o.rawFields?.['\u4ea4\u6613\u65f6\u95f4']||'').replace(/\s/g,'')===o.date+o.occurredAt.slice(11,19);
  if(all.reduce((n,x)=>n+x.sources.length,0)>128||b.platform.some(x=>x.sources.some(o=>o.accountRelations?.length||o.provider!==x.o.provider||fundingAccount(o,accounts)?.id!==fundingAccount(x.o,accounts)?.id))||b.bank.some(x=>x.sources.some(o=>o.financialAccountId!==x.o.financialAccountId||bankPaymentProvider(o)!==bankPaymentProvider(x.o)||!actualTradeDate(o)||o.bankStatement?.nonCash||o.rawFields?.excludedFromBilledTotal)))continue;
  if(veto.some(l=>l.type==='group_distinct'?l.observationIds.some(id=>ids.has(rootOf(id))):l.observationIds.every(id=>ids.has(rootOf(id)))))continue;
  const [financialAccountId,date,amountMinor,currency,,platform]=JSON.parse(key);
  result.push({id:'channel-group:'+key,method:'balanced_channel_group',confidence:'inferred',observationIds:all.flatMap(x=>x.sources.map(o=>o.id)).sort(),platformRootIds:b.platform.map(x=>x.id).sort(),bankRootIds:b.bank.map(x=>x.id).sort(),evidence:{financialAccountId,date,amountMinor,currency,platform,count,totalMinor:(BigInt(amountMinor)*BigInt(count)).toString(),individualIdentity:'undetermined'}});
 }
 return result;
}
module.exports={findReconciliationGroups};
