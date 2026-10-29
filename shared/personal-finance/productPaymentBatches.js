'use strict';
const {actualSecond}=require('./mixedPayments');
const {fundingIdentity,sameBankAccount}=require('./assetRegister');

// Preserve originals and their own clocks. A clearing pair explains the route,
// but never supplies a second expense or a fabricated individual order match.
function context(observations,accounts,{rootOf,annotatedIds=new Set(),links=[]}) {
  const roots=new Map(),accountMap=new Map(accounts.map(a=>[a.id,a]));
  for(const o of observations){const id=rootOf(o.id);if(!roots.has(id))roots.set(id,[]);roots.get(id).push(o);}
  const annotated=new Set([...annotatedIds].map(rootOf)),rows=[];
  for(const [id,sources] of roots) {
    if(annotated.has(id)||sources.some(o=>o.status!=='completed'))continue;
    const latest=new Map();
    for(const o of sources){const k=JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
    if(latest.size===1)rows.push({id,o:[...latest.values()][0],sources});
  }
  const active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|')));
  const vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|')));
  const blocked=members=>{const ids=new Set(members.map(x=>x.id));return vetoes.some(l=>l.type==='group_distinct'?l.observationIds.some(id=>ids.has(rootOf(id))):l.observationIds.every(id=>ids.has(rootOf(id))));};
  const nominal=o=>{
    const parts=String(o.paymentChannel||'').split('&');
    if(parts.length>2||parts.length===2&&parts[1]!=='\u4f59\u989d')return null;
    const identity=fundingIdentity(parts[0]);
    if(identity?.bank!=='\u7f51\u5546\u94f6\u884c'||identity.type!=='debit_card')return null;
    const matches=accounts.filter(a=>a.status==='active'&&a.type==='debit_card'&&sameBankAccount(a,identity,o.currency));
    return matches.length===1?{bank:matches[0],wallet:parts.length===2}:null;
  };
  const available=new Set(rows.map(x=>x.id));
  const banks=rows.filter(x=>x.o.statementFlow?.schema==='mybank-current-v1'&&actualSecond(x.o)&&accountMap.get(x.o.financialAccountId)?.status==='active');
  const products=rows.filter(x=>x.o.statementFlow?.schema==='mybank-yulibao-v1'&&actualSecond(x.o)&&x.o.kind==='transfer'&&x.o.direction==='debit'&&accountMap.get(x.o.financialAccountId)?.status==='active'&&accountMap.get(x.o.financialAccountId)?.currency===x.o.currency&&accountMap.get(x.o.financialAccountId)?.sourceProduct==='alipay_yulibao'&&x.o.rawFields?.['\u4ea4\u6613\u7c7b\u578b']==='\u6b63\u5e38\u8d4e\u56de'&&x.o.rawFields?.['\u5907\u6ce8']===x.o.description&&/^\(\u6d88\u8d39\)\u5feb\u6377\u652f\u4ed8-\u652f\u4ed8\u5b9d-/.test(x.o.description));
  function clearing(product,bank) {
    const p=product.o,raw=p.rawFields||{};
    if(observations.some(o=>!available.has(rootOf(o.id))&&o.financialAccountId===bank.id&&o.occurredAt===p.occurredAt&&o.currency===p.currency&&o.statementFlow?.schema==='mybank-current-v1'))return null;
    if(raw['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']!=='\u6d59\u6c5f\u7f51\u5546\u94f6\u884c'||!/^\*{4,}\d{4}$/.test(raw['\u5bf9\u65b9\u8d26\u53f7']||'')||raw['\u5bf9\u65b9\u8d26\u53f7'].slice(-4)!==bank.maskedIdentifier)return null;
    const near=banks.filter(x=>x.o.financialAccountId===bank.id&&x.o.date===p.date&&x.o.currency===p.currency&&x.o.occurredAt===p.occurredAt&&x.o.amountMinor===p.amountMinor);
    const credits=near.filter(x=>x.o.direction==='credit'&&['unknown','transfer'].includes(x.o.kind)&&['\u8f6c\u51fa-\u4f59\u5229\u5b9d','\u5176\u5b83\u4ea4\u6613'].includes(x.o.description)&&/^\*\u5229\u5b9d\u4ee3\u9500(?:\u8d4e\u56de\u5e94\u6536|\u5f85\u6e05\u7b97)-/.test(x.o.counterparty)&&x.o.rawFields?.['\u5bf9\u65b9\u6237\u540d']===x.o.counterparty);
    const debits=near.filter(x=>x.o.direction==='debit'&&['unknown','transfer'].includes(x.o.kind)&&['\u5feb\u6377\u652f\u4ed8','\u5176\u5b83\u4ea4\u6613'].includes(x.o.description)&&x.o.rawFields?.['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']==='\u652f\u4ed8\u5b9d');
    return credits.length===1&&debits.length===1?{credit:credits[0],debit:debits[0]}:null;
  }
  return {rows,banks,products,accountMap,nominal,clearing,blocked,rootOf,available};
}
function unique(proposals) {
  const uses=new Map();for(const p of proposals)for(const x of p.members)uses.set(x.id,(uses.get(x.id)||0)+1);
  return proposals.filter(p=>new Set(p.members.map(x=>x.id)).size===p.members.length&&p.members.every(x=>uses.get(x.id)===1));
}
function findProductCreditRepayments(observations,accounts,options) {
  const c=context(observations,accounts,options),proposals=[];
  for(const platform of c.rows) {
    const p=platform.o,n=c.nominal(p),relation=p.accountRelations?.length===1?p.accountRelations[0]:null,target=c.accountMap.get(relation?.financialAccountId),wallet=c.accountMap.get(p.financialAccountId);
    if(!n||p.provider!=='alipay'||p.kind!=='debt_payment'||p.direction!=='neutral'||!actualSecond(p)||p.rawFields?.['\u4ea4\u6613\u72b6\u6001']!=='\u8fd8\u6b3e\u6210\u529f'||!/^\u81ea\u52a8\u8fd8\u6b3e-\u82b1\u5457(?:\|\u4fe1\u7528\u8d2d)?\d{4}\u5e74\d{2}\u6708\u8d26\u5355$/.test(p.description)||relation?.product!=='alipay_huabei'||relation.role!=='target'||relation.activity!=='repayment'||target?.status!=='active'||target.sourceProduct!==relation.product||target.type!=='credit_card'||target.currency!==p.currency||wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.currency!==p.currency||[p.interestMinor,p.feeMinor].some(v=>v!=null&&v!=='0'))continue;
    if(!p.description.endsWith(p.date.slice(0,4)+'\u5e74'+p.date.slice(5,7)+'\u6708\u8d26\u5355')||p.paymentAccountHint&&p.paymentAccountHint!==n.bank.maskedIdentifier)continue;
    for(const product of c.products) {
      const b=product.o,seconds=(Date.parse(b.occurredAt)-Date.parse(p.occurredAt))/1000;
      // The automatic debit runs first; the platform records its success one
      // second later. This bound applies only to this named monthly repayment.
      if(b.date!==p.date||b.currency!==p.currency||seconds!==-1||b.description!=='(\u6d88\u8d39)\u5feb\u6377\u652f\u4ed8-\u652f\u4ed8\u5b9d-*\u6b3e')continue;
      const pair=c.clearing(product,n.bank);if(!pair)continue;
      const direct=c.banks.filter(x=>x.id!==pair.debit.id&&x.o.financialAccountId===n.bank.id&&x.o.date===p.date&&x.o.currency===p.currency&&x.o.occurredAt===b.occurredAt&&x.o.direction==='debit'&&['unknown','transfer'].includes(x.o.kind)&&x.o.description==='\u5feb\u6377\u652f\u4ed8-\u652f\u4ed8\u5b9d-*\u6b3e'&&x.o.rawFields?.['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']==='\u652f\u4ed8\u5b9d');
      if(direct.length>1)continue;
      const paid=BigInt(b.amountMinor)+direct.reduce((s,x)=>s+BigInt(x.o.amountMinor),0n),remaining=BigInt(p.amountMinor)-paid;
      if(n.wallet?remaining<=0n:remaining!==0n)continue;
      if(observations.some(o=>c.rootOf(o.id)!==platform.id&&o.provider==='alipay'&&o.status==='completed'&&o.currency===p.currency&&Math.abs(Date.parse(o.occurredAt)-Date.parse(p.occurredAt))<=2000&&c.nominal(o)?.bank.id===n.bank.id))continue;
      const members=[platform,product,pair.credit,pair.debit,...direct];if(c.blocked(members))continue;
      proposals.push({members,platform:p,product:b,bank:n.bank,bankDebits:[pair.debit.o,...direct.map(x=>x.o)],clearingCredit:pair.credit.o,targetAccountId:target.id,walletAccountId:n.wallet?wallet.id:null,walletAmountMinor:String(remaining),allocation:[{financialAccountId:b.financialAccountId,amountMinor:b.amountMinor},...direct.map(x=>({financialAccountId:n.bank.id,amountMinor:x.o.amountMinor})),...(n.wallet?[{financialAccountId:wallet.id,amountMinor:String(remaining)}]:[])],method:'product_funded_monthly_credit_repayment'});
    }
  }
  return unique(proposals).map(p=>({...p,members:p.members.flatMap(x=>x.sources)}));
}
function findFamilyProductPaymentGroups(observations,accounts,options) {
  const c=context(observations,accounts,options),buckets=new Map(),proposals=[];
  for(const x of c.rows) {
    const p=x.o,n=c.nominal(p);
    if(!n||n.wallet||p.provider!=='alipay'||p.kind!=='expense'||p.direction!=='debit'||!actualSecond(p)||p.accountRelations?.length||p.description!=='\u4eb2\u60c5\u5361'||p.rawFields?.['\u5546\u54c1\u8bf4\u660e']!==p.description||p.rawFields?.['\u4ea4\u6613\u5206\u7c7b']!=='\u4eb2\u53cb\u4ee3\u4ed8'||p.rawFields?.['\u6536/\u652f']!=='\u652f\u51fa'||BigInt(p.amountMinor)<=0n)continue;
    const k=JSON.stringify([n.bank.id,p.financialAccountId,p.date,p.occurredAt,p.currency,p.counterparty]);if(!buckets.has(k))buckets.set(k,{platforms:[],bank:n.bank});buckets.get(k).platforms.push(x);
  }
  for(const {platforms,bank} of buckets.values()) {
    if(platforms.length<2||platforms.length>32)continue;
    const p=platforms[0].o,total=platforms.reduce((sum,x)=>sum+BigInt(x.o.amountMinor),0n),own=new Set(platforms.map(x=>x.id));
    for(const product of c.products) {
      const b=product.o,seconds=(Date.parse(b.occurredAt)-Date.parse(p.occurredAt))/1000;
      if(b.date!==p.date||b.currency!==p.currency||BigInt(b.amountMinor)!==total||!Number.isInteger(seconds)||seconds<0||seconds>5||!/^\(\u6d88\u8d39\)\u5feb\u6377\u652f\u4ed8-\u652f\u4ed8\u5b9d-[*\u4e00-\u9fff]+\u516c\u53f8$/.test(b.description))continue;
      if(observations.some(o=>!own.has(c.rootOf(o.id))&&o.provider==='alipay'&&o.status==='completed'&&o.currency===p.currency&&Math.abs(Date.parse(o.occurredAt)-Date.parse(p.occurredAt))<=5000&&c.nominal(o)?.bank.id===bank.id))continue;
      const pair=c.clearing(product,bank);if(!pair)continue;
      const members=[...platforms,product,pair.credit,pair.debit];if(c.blocked(members))continue;
      proposals.push({members,platforms,product,pair,bank,total:String(total),seconds});
    }
  }
  return unique(proposals).map(p=>({id:'family-product-batch:'+p.product.id,method:'family_product_payment_group',confidence:'inferred',observationIds:p.members.flatMap(x=>x.sources.map(o=>o.id)).sort(),platformRootIds:p.platforms.map(x=>x.id),bankRootIds:[p.product.id,p.pair.credit.id,p.pair.debit.id],evidence:{financialAccountId:p.bank.id,productAccountId:p.product.o.financialAccountId,date:p.product.o.date,currency:p.product.o.currency,count:p.platforms.length,bankCount:3,totalMinor:p.total,individualIdentity:'undetermined',secondsAfter:p.seconds,actualBankNetMinor:'0',originalBankCashLegsPreserved:true,statisticsAuthority:'individual_platform_orders'}}));
}
function findProductWalletTopUps(observations,accounts,options) {
  const c=context(observations,accounts,options),proposals=[];
  const products=c.rows.filter(x=>x.o.statementFlow?.schema==='mybank-yulibao-v1'&&actualSecond(x.o)&&x.o.kind==='transfer'&&x.o.direction==='debit'&&x.o.description==='(\u6d88\u8d39)\u5feb\u6377\u652f\u4ed8'&&x.o.rawFields?.['\u5907\u6ce8']===x.o.description&&x.o.rawFields?.['\u4ea4\u6613\u7c7b\u578b']==='\u6b63\u5e38\u8d4e\u56de'&&x.o.rawFields?.['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']==='\u6d59\u6c5f\u7f51\u5546\u94f6\u884c'&&/^\*{4,}\d{4}$/.test(x.o.rawFields?.['\u5bf9\u65b9\u8d26\u53f7']||'')&&BigInt(x.o.amountMinor)>0n&&c.accountMap.get(x.o.financialAccountId)?.status==='active'&&c.accountMap.get(x.o.financialAccountId)?.currency===x.o.currency&&c.accountMap.get(x.o.financialAccountId)?.sourceProduct==='alipay_yulibao');
  for(const platform of c.rows) {
    const p=platform.o,wallet=c.accountMap.get(p.financialAccountId);
    if(p.provider!=='alipay'||p.kind!=='transfer'||p.direction!=='neutral'||!actualSecond(p)||p.description!=='\u5145\u503c-\u666e\u901a\u5145\u503c'||p.rawFields?.['\u5546\u54c1\u8bf4\u660e']!==p.description||p.rawFields?.['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||!['\u4f59\u989d','\u8d26\u6237\u4f59\u989d'].includes(p.paymentChannel)||p.paymentAccountHint||p.accountRelations?.length||p.automaticFunding||wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.currency!==p.currency||BigInt(p.amountMinor)<=0n)continue;
    for(const product of products) {
      const b=product.o,seconds=(Date.parse(b.occurredAt)-Date.parse(p.occurredAt))/1000;
      if(b.date!==p.date||b.currency!==p.currency||!Number.isInteger(seconds)||seconds<0||seconds>30||BigInt(b.amountMinor)>BigInt(p.amountMinor))continue;
      const banks=accounts.filter(a=>a.status==='active'&&a.provider==='\u7f51\u5546\u94f6\u884c'&&a.type==='debit_card'&&a.currency===p.currency&&a.maskedIdentifier===b.rawFields['\u5bf9\u65b9\u8d26\u53f7'].slice(-4));if(banks.length!==1)continue;const bank=banks[0];
      if(!observations.some(o=>o.status==='completed'&&o.financialAccountId===bank.id&&o.currency===p.currency&&o.statementFlow?.schema==='mybank-current-v1'&&o.statementFlow.periodStart<=p.date&&o.statementFlow.periodEnd>=p.date))continue;
      const rawCash=observations.filter(o=>o.financialAccountId===bank.id&&o.statementFlow?.schema==='mybank-current-v1'&&o.currency===p.currency&&o.occurredAt===b.occurredAt);
      if(rawCash.some(o=>!c.available.has(c.rootOf(o.id))))continue;
      const cash=c.banks.filter(x=>x.o.financialAccountId===bank.id&&x.o.currency===p.currency&&x.o.occurredAt===b.occurredAt),remaining=BigInt(p.amountMinor)-BigInt(b.amountMinor);
      let direct=[];
      if(remaining===0n){if(seconds>12||cash.length)continue;}
      else {
        if(cash.length!==1)continue;const d=cash[0].o;
        if(d.direction!=='debit'||!['unknown','transfer'].includes(d.kind)||d.description!=='\u5feb\u6377\u652f\u4ed8'||d.rawFields?.['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']!=='\u652f\u4ed8\u5b9d'||BigInt(d.amountMinor)!==remaining)continue;
        direct=cash;
      }
      if(observations.some(o=>c.rootOf(o.id)!==platform.id&&o.status==='completed'&&o.provider==='alipay'&&o.kind!=='transfer'&&o.currency===p.currency&&[p.amountMinor,b.amountMinor].includes(o.amountMinor)&&actualSecond(o)&&Date.parse(b.occurredAt)>=Date.parse(o.occurredAt)&&Date.parse(b.occurredAt)-Date.parse(o.occurredAt)<=30000&&c.nominal(o)?.bank.id===bank.id))continue;
      const members=[platform,product,...direct];if(c.blocked(members))continue;
      proposals.push({members,platform:p,product:b,bank,bankDebits:direct.map(x=>x.o),walletAccountId:wallet.id,walletCreditMinor:p.amountMinor,allocation:[{financialAccountId:b.financialAccountId,amountMinor:b.amountMinor},...direct.map(x=>({financialAccountId:bank.id,amountMinor:x.o.amountMinor}))],method:'product_funded_wallet_top_up',secondsAfter:seconds});
    }
  }
  return unique(proposals).map(p=>({...p,members:p.members.flatMap(x=>x.sources)}));
}
module.exports={findProductCreditRepayments,findFamilyProductPaymentGroups,findProductWalletTopUps};
