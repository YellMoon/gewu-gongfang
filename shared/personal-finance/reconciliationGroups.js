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
  if(uncertainBankKeys.has(JSON.stringify(JSON.parse(key).slice(0,5)))||count<2||count>4||count!==b.bank.length||all.some(x=>annotatedRoots.has(x.id)||x.sources.some(o=>o.status!=='completed'||o.kind!=='expense'||o.direction!=='debit'||o.amountMinor!==x.o.amountMinor||o.date!==x.o.date||o.currency!==x.o.currency)))continue;
  if(all.reduce((n,x)=>n+x.sources.length,0)>128||b.platform.some(x=>x.sources.some(o=>o.accountRelations?.length||o.provider!==x.o.provider||fundingAccount(o,accounts)?.id!==fundingAccount(x.o,accounts)?.id))||b.bank.some(x=>x.sources.some(o=>o.financialAccountId!==x.o.financialAccountId||bankPaymentProvider(o)!==bankPaymentProvider(x.o)||o.rawFields?.dateBasis!=='transaction_date'||o.rawFields?.tradeDate!==o.date||o.bankStatement?.nonCash||o.rawFields?.excludedFromBilledTotal)))continue;
  if(veto.some(l=>l.type==='group_distinct'?l.observationIds.some(id=>ids.has(rootOf(id))):l.observationIds.every(id=>ids.has(rootOf(id)))))continue;
  const [financialAccountId,date,amountMinor,currency,,platform]=JSON.parse(key);
  result.push({id:'channel-group:'+key,method:'balanced_channel_group',confidence:'inferred',observationIds:all.flatMap(x=>x.sources.map(o=>o.id)).sort(),platformRootIds:b.platform.map(x=>x.id).sort(),bankRootIds:b.bank.map(x=>x.id).sort(),evidence:{financialAccountId,date,amountMinor,currency,platform,count,totalMinor:(BigInt(amountMinor)*BigInt(count)).toString(),individualIdentity:'undetermined'}});
 }
 return result;
}
module.exports={findReconciliationGroups};
