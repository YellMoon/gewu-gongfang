'use strict';
// A bank's exact product name distinguishes this receipt from another fund's
// same-value redemption. Generic fund receipts cannot establish this identity.
function findNamedYuebaoBankReceipts(observations,accounts,{rootOf=id=>id,fundingAccount,annotatedIds=new Set(),links=[]}={}){
 const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity)),am=new Map(accounts.map(a=>[a.id,a]));
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const rows=[...latest.values()],roots=new Map();for(const o of rows){const k=rootOf(o.id);if(!roots.has(k))roots.set(k,[]);roots.get(k).push(o);}
 const active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|')));
 const isWithdrawal=p=>p.provider==='alipay'&&p.status==='completed'&&p.kind==='transfer'&&['neutral','debit'].includes(p.direction)&&p.description==='\u4f59\u989d\u5b9d-\u8f6c\u51fa\u5230\u94f6\u884c\u5361'&&p.rawFields?.['\u5546\u54c1\u8bf4\u660e']===p.description&&p.rawFields?.['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&p.rawFields?.['\u6536/\u652f']==='\u4e0d\u8ba1\u6536\u652f';
 const proposals=[];
 for(const p of rows){
  if(!isWithdrawal(p)||blocked.has(identity(p))||roots.get(rootOf(p.id)).length!==1||BigInt(p.amountMinor)<=0n)continue;
  const fund=fundingAccount(p,accounts),relation=p.accountRelations?.length===1?p.accountRelations[0]:null,product=am.get(relation?.financialAccountId);
  if(fund?.status!=='active'||fund.type!=='debit_card'||fund.currency!==p.currency||fund.provider!=='\u5efa\u8bbe\u94f6\u884c'||!/^\d{4}$/.test(fund.maskedIdentifier||'')||relation?.product!=='alipay_yuebao'||relation.role!=='target'||relation.activity!=='investment_withdrawal'||product?.sourceProduct!=='alipay_yuebao'||product.status!=='active'||product.type!=='investment'||product.currency!==p.currency)continue;
  if(rows.some(o=>identity(o)!==identity(p)&&isWithdrawal(o)&&o.date===p.date&&o.amountMinor===p.amountMinor&&o.currency===p.currency&&(!fundingAccount(o,accounts)||fundingAccount(o,accounts).id===fund.id)))continue;
  const banks=rows.filter(b=>{const raw=b.rawFields||{};return b.provider==='ccb'&&b.status==='completed'&&b.financialAccountId===fund.id&&b.date===p.date&&b.currency===p.currency&&b.amountMinor===p.amountMinor&&b.direction==='credit'&&['transfer','unknown'].includes(b.kind)&&b.statementFlow?.schema==='ccb-debit-v1'&&b.statementFlow.incomeMinor===b.amountMinor&&b.statementFlow.expenseMinor==='0'&&raw.dateBasis==='transaction_date'&&raw['\u4ea4\u6613\u65e5\u671f']===b.date.replace(/-/g,'')&&raw['\u6458\u8981']==='\u94f6\u8054\u5165\u8d26'&&raw['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00']==='\u4f59\u989d\u5b9d\u8f6c\u51fa\u5230\u5361'&&raw['\u5bf9\u65b9\u8d26\u53f7']?.match(/^\*+(\d{4})$/)?.[1]===fund.maskedIdentifier&&raw['\u5bf9\u65b9\u8d26\u53f7\u4e0e\u6237\u540d']===raw['\u5bf9\u65b9\u8d26\u53f7']+'/\u4f59\u989d\u5b9d';});
  if(banks.length!==1)continue;const bank=banks[0],members=[p,bank],keys=new Set(members.map(identity));if(blocked.has(identity(bank))||roots.get(rootOf(bank.id)).length!==1||vetoes.some(l=>l.observationIds.map(id=>byId.get(id)).filter(Boolean).some(o=>keys.has(identity(o)))))continue;
  proposals.push({platform:p,bank,evidence:{product:'alipay_yuebao',productAccountId:product.id,financialAccountId:fund.id,date:p.date,currency:p.currency,amountMinor:p.amountMinor,bankProductNamed:true,bankCardTail:fund.maskedIdentifier,bankDateBasis:'transaction_date',reciprocalUnique:true}});
 }
 const uses=new Map();for(const p of proposals)for(const o of[p.platform,p.bank])uses.set(rootOf(o.id),(uses.get(rootOf(o.id))||0)+1);return proposals.filter(p=>[p.platform,p.bank].every(o=>uses.get(rootOf(o.id))===1));
}
module.exports={findNamedYuebaoBankReceipts};
