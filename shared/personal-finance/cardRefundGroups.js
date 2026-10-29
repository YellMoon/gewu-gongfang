'use strict';

// A bank may label every incoming card credit as a repayment. A closed batch of
// actual platform refunds supplies its economic purpose, without pairing orders.
function findCardRefundGroups(observations,accounts,{rootOf,fundingAccount,annotatedIds=new Set(),links=[]}){
 const accountMap=new Map(accounts.map(a=>[a.id,a])),roots=new Map(),buckets=new Map(),annotated=new Set([...annotatedIds].map(rootOf));
 for(const o of observations){const id=rootOf(o.id);if(!roots.has(id))roots.set(id,[]);roots.get(id).push(o);}
 const key=(o,id)=>JSON.stringify([id,o.date,o.amountMinor,o.currency]);
 const refund=o=>['wechat','alipay'].includes(o.provider)&&o.status==='completed'&&o.kind==='refund'&&(o.direction==='credit'||o.provider==='alipay'&&o.direction==='neutral')&&!o.accountRelations?.length&&accountMap.get(o.financialAccountId)?.type==='wallet';
 const actualCredit=o=>o.provider==='bocom'&&o.direction==='credit'&&o.bankStatement?.schema==='bank-credit-v1'&&!o.bankStatement.nonCash&&o.counterparty===o.description&&o.rawFields?.statementCredit===true&&o.rawFields?.statementAmountMinor==='-'+o.amountMinor&&o.rawFields?.dateBasis==='transaction_date'&&o.rawFields?.tradeDate===o.date;
 const generic=o=>actualCredit(o)&&o.kind==='debt_payment'&&o.description==='\u4ee3\u53d1\u6b3e\u9879 \u4fe1\u7528\u5361\u8fd8\u6b3e';
 const explicitWechat=o=>actualCredit(o)&&o.kind==='refund'&&o.description==='\u6d88\u8d39\u9000\u8d27 \u8d22\u4ed8\u901a(\u5feb\u6377)';
 for(const[id,sources]of roots){
  if(annotated.has(id)||sources.some(o=>o.status!=='completed'))continue;
  const platform=sources.every(refund),bank=sources.every(o=>o.bankStatement&&o.direction==='credit');if(platform===bank)continue;
  const o=[...sources].sort((a,b)=>(b.sourceVersionOrdinal||0)-(a.sourceVersionOrdinal||0))[0],target=platform?fundingAccount(o,accounts):accountMap.get(o.financialAccountId);
  if(target?.status!=='active'||target.type!=='credit_card'||BigInt(o.amountMinor)<=0n)continue;
  if(sources.some(s=>s.date!==o.date||s.amountMinor!==o.amountMinor||s.currency!==o.currency||platform&&(fundingAccount(s,accounts)?.id!==target.id||s.paymentAccountHint&&s.paymentAccountHint!==target.maskedIdentifier)||bank&&s.financialAccountId!==target.id))continue;
  const k=key(o,target.id);if(!buckets.has(k))buckets.set(k,{platform:[],bank:[]});buckets.get(k)[platform?'platform':'bank'].push({id,o,sources});
 }
 const active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|'))),veto=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|'))),result=[];
 const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/\u4fe1\u7528\u5361\u8fd8\u6b3e$/,'');
 for(const[k,b]of buckets){
  const n=b.platform.length,all=[...b.platform,...b.bank],ids=new Set(all.map(x=>x.id)),[financialAccountId,date,amountMinor,currency]=JSON.parse(k),card=accountMap.get(financialAccountId);
  if(n<2||n>32||b.bank.length!==n||all.reduce((s,x)=>s+x.sources.length,0)>128||new Set(b.platform.map(x=>x.o.provider)).size!==1||new Set(b.platform.map(x=>x.o.financialAccountId)).size!==1||!b.bank.some(x=>generic(x.o))||b.bank.some(x=>x.sources.some(o=>!generic(o)&&!(b.platform[0].o.provider==='wechat'&&explicitWechat(o)))))continue;
  const competitor=observations.some(o=>{if(o.status!=='completed'||o.date!==date||o.amountMinor!==amountMinor||o.currency!==currency||ids.has(rootOf(o.id)))return false;if(o.statementFlow&&o.direction==='debit')return true;if(o.bankStatement&&o.direction==='credit'&&o.financialAccountId===financialAccountId)return true;if(!['alipay','wechat','jd'].includes(o.provider))return false;if(o.kind==='debt_payment'&&['debit','neutral'].includes(o.direction)&&norm(o.counterparty)===norm(card.provider))return true;return ['credit','neutral'].includes(o.direction)&&fundingAccount(o,accounts)?.id===financialAccountId;});
  if(competitor||veto.some(l=>l.type==='group_distinct'?l.observationIds.some(id=>ids.has(rootOf(id))):l.observationIds.every(id=>ids.has(rootOf(id)))))continue;
  result.push({id:'card-refund-group:'+k,method:'balanced_card_refund_group',confidence:'inferred',observationIds:all.flatMap(x=>x.sources.map(o=>o.id)).sort(),platformRootIds:b.platform.map(x=>x.id),bankRootIds:b.bank.map(x=>x.id),evidence:{financialAccountId,date,amountMinor,currency,platform:b.platform[0].o.provider,count:n,totalMinor:String(BigInt(amountMinor)*BigInt(n)),individualIdentity:'undetermined',bankCreditLabel:'repayment',economicPurpose:'actual_platform_refunds'}});
 }
 return result;
}
module.exports={findCardRefundGroups};
