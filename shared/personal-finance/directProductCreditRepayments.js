'use strict';
const {statementCounterAccount}=require('./statementAccounts');
const {findStatementRepayments}=require('./statementTransfers');
// Require two independent originals. Remitter clearing numbers never become
// owned bank-account identities; no synthetic cash or liability leg is added.
function findDirectProductCreditRepayments(observations,accounts,{rootOf=id=>id,annotatedIds=new Set(),links=[],statementOwners=new Map()}={}){
 const am=new Map(accounts.map(a=>[a.id,a])),identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity));
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const rows=[...latest.values()].filter(o=>o.status==='completed'),members=new Map();for(const o of rows){const r=rootOf(o.id);if(!members.has(r))members.set(r,[]);members.get(r).push(o);}
 const active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|'))),proposals=[];
 const veto=(d,c)=>{const ids=new Set([identity(d),identity(c)]);return vetoes.some(l=>{const keys=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(identity);return l.type==='group_distinct'?keys.some(k=>ids.has(k)):keys.length===l.observationIds.length&&keys.every(k=>ids.has(k));});};
 for(const d of rows){
  const a=am.get(d.financialAccountId),raw=d.rawFields||{},target=statementCounterAccount(d,accounts),institution=String(raw['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']||''),bank=v=>String(v||'').replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe\u94f6\u884c$|\u5de5\u5546\u94f6\u884c$|\u519c\u4e1a\u94f6\u884c$)/,''),repaymentLabel=d.description?.split('\u4fe1\u7528\u5361\u8fd8\u6b3e-');
  if(d.provider!=='mybank'||d.statementFlow?.schema!=='mybank-yulibao-v1'||a?.status!=='active'||a.sourceProduct!=='alipay_yulibao'||a.currency!==d.currency||d.direction!=='debit'||d.kind!=='transfer'||d.accountRelations?.length||blocked.has(identity(d))||members.get(rootOf(d.id)).length!==1||target?.status!=='active'||target.type!=='credit_card'||target.currency!==d.currency||BigInt(d.amountMinor)<=0n)continue;
  const originalNamedIssuer=repaymentLabel?.length===2&&(bank(repaymentLabel[1])===bank(target.provider)||repaymentLabel[1]==='\u4e2d\u56fd\u5efa\u8bbe'&&institution==='\u4e2d\u56fd\u5efa\u8bbe\u94f6\u884c'&&bank(target.provider)==='\u5efa\u8bbe\u94f6\u884c');
  if(d.statementFlow.incomeMinor!=='0'||d.statementFlow.expenseMinor!==d.amountMinor||raw['\u4ea4\u6613\u7c7b\u578b']!=='\u6b63\u5e38\u8d4e\u56de'||raw['\u5907\u6ce8']!==d.description||!originalNamedIssuer||bank(institution)!==bank(target.provider)||!/^\*{4,}\d{4}$/.test(raw['\u5bf9\u65b9\u8d26\u53f7']||'')||raw['\u5bf9\u65b9\u8d26\u53f7'].slice(-4)!==target.maskedIdentifier||raw['\u4ea4\u6613\u65f6\u95f4']!==d.date+d.occurredAt.slice(11,19)||!d.occurredAt.endsWith('+08:00'))continue;
  const signed=String(raw['\u4ea4\u6613\u91d1\u989d']||'').match(/^-(\d+)\.(\d{2})$/);if(!signed||BigInt(signed[1])*100n+BigInt(signed[2])!==BigInt(d.amountMinor))continue;
  const credits=rows.filter(c=>[0,86400000].includes(Date.parse(c.date)-Date.parse(d.date))&&c.currency===d.currency&&c.amountMinor===d.amountMinor&&c.financialAccountId===target.id&&c.kind==='debt_payment'&&c.direction==='credit'&&(c.bankStatement?.schema==='bank-credit-v1'||c.provider==='spdb'&&c.bankStatement?.schema==='bank-credit-detail-v1')&&!c.bankStatement.nonCash&&c.bankStatement.provider===c.provider&&c.bankStatement.cardTail===target.maskedIdentifier&&c.rawFields?.statementCredit===true&&c.rawFields?.statementAmountMinor==='-'+c.amountMinor&&c.rawFields?.tradeDate===c.date&&c.rawFields?.dateBasis==='transaction_date');
  if(credits.length!==1)continue;const c=credits[0];if(blocked.has(identity(c))||members.get(rootOf(c.id)).length!==1||rootOf(c.id)===rootOf(d.id)||veto(d,c))continue;
  const competitors=rows.filter(o=>{if(o.id===d.id||o.direction!=='debit'||o.date!==d.date||o.currency!==d.currency||o.amountMinor!==d.amountMinor||!['unknown','transfer','debt_payment'].includes(o.kind)||!(o.statementFlow||o.bankStatement))return false;const other=statementCounterAccount(o,accounts);return !other||other.id===target.id;});
  let independentOtherPairs=[];
  if(competitors.length){
   if(competitors.some(o=>statementCounterAccount(o,accounts)?.id===target.id||blocked.has(identity(o))||members.get(rootOf(o.id)).length!==1))continue;
   independentOtherPairs=findStatementRepayments(rows.filter(o=>o.id!==d.id&&o.id!==c.id),accounts,{rootOf,annotatedIds,links,statementOwners,isBlocked:(a,b)=>veto(byId.get(a),byId.get(b))}).filter(m=>m.credit.date===d.date&&m.credit.amountMinor===d.amountMinor&&m.credit.currency===d.currency&&am.get(m.credit.financialAccountId)?.provider===target.provider&&!blocked.has(identity(m.credit))&&members.get(rootOf(m.credit.id)).length===1);
   if(competitors.some(o=>!independentOtherPairs.some(m=>m.debit.id===o.id)))continue;
  }
  proposals.push({debit:d,credit:c,target,method:'original_product_credit_repayment',independentOtherPairs});
 }
 const uses=new Map();for(const p of proposals)for(const o of[p.debit,p.credit])uses.set(identity(o),(uses.get(identity(o))||0)+1);return proposals.filter(p=>[p.debit,p.credit].every(o=>uses.get(identity(o))===1));
}
module.exports={findDirectProductCreditRepayments};
