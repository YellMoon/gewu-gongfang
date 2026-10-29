'use strict';
const {fundingIdentity,sameBankAccount}=require('./assetRegister');
const {actualSecond}=require('./mixedPayments');
const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe|\u5de5\u5546|\u519c\u4e1a)/,'');
function findMissingCardFunding(observations,accounts,{bankPaymentProvider,annotatedIds=new Set(),links=[]}){
 const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),annotatedKeys=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity));
 for(const o of observations){const key=identity(o);if(!latest.has(key)||(o.sourceVersionOrdinal||0)>(latest.get(key).sourceVersionOrdinal||0))latest.set(key,o);}
 const rows=[...latest.values()],accountMap=new Map(accounts.map(a=>[a.id,a])),active=links.filter(l=>l.status!=='deleted'),activeKeys=new Set(active.map(l=>[...l.observationIds].sort().join('|'))),veto=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!activeKeys.has([...l.observationIds].sort().join('|'))),result=new Map();
 const blocked=(p,b)=>veto.some(l=>{const keys=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(identity);return l.type==='group_distinct'?keys.includes(identity(p))||keys.includes(identity(b)):keys.includes(identity(p))&&keys.includes(identity(b));});
 for(const p of rows){
  if(p.provider!=='wechat'||p.status!=='completed'||p.kind!=='transfer'||p.rawFields?.['\u4ea4\u6613\u7c7b\u578b']!=='\u8d2d\u4e70\u7406\u8d22\u901a'||p.paymentAccountHint||annotatedKeys.has(identity(p)))continue;
  const bankName=norm(p.paymentChannel).match(/^(.+\u94f6\u884c)(?:\u50a8\u84c4\u5361|\u501f\u8bb0\u5361)$/)?.[1];if(!bankName)continue;
  const candidates=rows.filter(b=>{const a=accountMap.get(b.financialAccountId);return b.status==='completed'&&b.direction==='debit'&&b.statementFlow&&b.rawFields?.dateBasis==='transaction_date'&&b.date===p.date&&b.amountMinor===p.amountMinor&&b.currency===p.currency&&['expense','transfer','unknown'].includes(b.kind)&&a?.status==='active'&&a.type==='debit_card'&&norm(a.provider)===bankName&&bankPaymentProvider(b)==='wechat'&&!annotatedKeys.has(identity(b))&&!blocked(p,b);});
  const ids=[...new Set(candidates.map(b=>b.financialAccountId))];if(ids.length!==1||candidates.length>32)continue;
  result.set(p.id,{financialAccountId:ids[0],method:'source_statement_card_identity',confidence:'inferred',evidenceObservationIds:candidates.map(b=>b.id)});
 }
 return result;
}
function findProductBankFunding(observations,accounts,{annotatedIds=new Set(),links=[]}={}){
 const latest=new Map(),byId=new Map(observations.map(o=>[o.id,o])),identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const annotated=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity)),rows=[...latest.values()].filter(o=>o.status==='completed'&&!annotated.has(identity(o))),accountMap=new Map(accounts.map(a=>[a.id,a])),proposals=[];
 const active=links.filter(l=>l.status!=='deleted'),activeKeys=new Set(active.map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!activeKeys.has([...l.observationIds].sort().join('|')));
 const blocked=members=>{const keys=new Set(members.map(identity));return vetoes.some(l=>{const other=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(identity);return l.type==='group_distinct'?other.some(k=>keys.has(k)):other.length===l.observationIds.length&&other.every(k=>keys.has(k));});};
 const products=new Map(),bankLegs=new Map(),add=(map,key,o)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(o);};
 for(const o of rows){
  if(o.statementFlow?.schema==='mybank-yulibao-v1'&&o.direction==='credit'&&o.kind==='transfer'&&actualSecond(o))add(products,JSON.stringify([o.financialAccountId,o.date,o.amountMinor,o.currency]),o);
  if(o.statementFlow?.schema==='ccb-debit-v1'&&o.rawFields?.dateBasis==='transaction_date'&&o.direction==='debit'&&['unknown','transfer'].includes(o.kind))add(bankLegs,JSON.stringify([norm(accountMap.get(o.financialAccountId)?.provider),o.date,o.amountMinor,o.currency]),o);
 }
 for(const p of rows){
  if(p.provider!=='alipay'||p.kind!=='transfer'||!actualSecond(p))continue;
  const target=p.accountRelations?.find(r=>r.product==='alipay_yulibao'&&r.role==='target'&&r.activity==='investment_deposit');if(!target)continue;
  const known=fundingIdentity(p.paymentChannel);
  for(const b of products.get(JSON.stringify([target.financialAccountId,p.date,p.amountMinor,p.currency]))||[]){
   const seconds=(Date.parse(b.occurredAt)-Date.parse(p.occurredAt))/1000,institution=norm(b.rawFields?.['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']);
   if(b.statementFlow?.schema!=='mybank-yulibao-v1'||b.financialAccountId!==target.financialAccountId||b.direction!=='credit'||b.kind!=='transfer'||!actualSecond(b)||b.date!==p.date||b.amountMinor!==p.amountMinor||b.currency!==p.currency||!Number.isInteger(seconds)||seconds<0||seconds>30||!institution)continue;
   for(const leg of bankLegs.get(JSON.stringify([institution,b.date,b.amountMinor,b.currency]))||[]){
    const a=accountMap.get(leg.financialAccountId),purpose=[leg.description,leg.counterparty].join(' ');
    if(leg.statementFlow?.schema!=='ccb-debit-v1'||leg.rawFields?.dateBasis!=='transaction_date'||leg.direction!=='debit'||!['unknown','transfer'].includes(leg.kind)||leg.date!==b.date||leg.amountMinor!==b.amountMinor||leg.currency!==b.currency||a?.status!=='active'||a.type!=='debit_card'||norm(a.provider)!==institution||known&&!sameBankAccount(a,known,p.currency)||!/\u7f51\u5546\u94f6\u884c\u6263\u6b3e|\u4f59\u5229\u5b9d\u8f6c\u5165/.test(purpose)||blocked([p,b,leg]))continue;
    proposals.push({p,b,leg,seconds});
   }
  }
 }
 const uses=new Map();for(const m of proposals)for(const o of [m.p,m.b,m.leg])uses.set(identity(o),(uses.get(identity(o))||0)+1);
 return new Map(proposals.filter(m=>[m.p,m.b,m.leg].every(o=>uses.get(identity(o))===1)).map(m=>[m.p.id,{financialAccountId:m.leg.financialAccountId,method:'source_statement_product_funding',confidence:'inferred',evidenceObservationIds:[m.b.id,m.leg.id],secondsAfter:m.seconds}]));
}
function findDirectProductFunding(observations,accounts,{annotatedIds=new Set(),links=[]}={}){
 const legacyQuickPayment=o=>o.description==='(\u6d88\u8d39)\u5feb\u6377\u652f\u4ed8'&&String(o.rawFields?.['\u5907\u6ce8']||'').normalize('NFKC').replace(/\s/g,'')===o.description&&o.rawFields?.['\u4ea4\u6613\u7c7b\u578b']==='\u6b63\u5e38\u8d4e\u56de'&&o.rawFields?.['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']==='\u6d59\u6c5f\u7f51\u5546\u94f6\u884c';
 const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),latest=new Map(),byId=new Map(observations.map(o=>[o.id,o]));
 for(const o of observations){const key=identity(o);if(!latest.has(key)||(o.sourceVersionOrdinal||0)>(latest.get(key).sourceVersionOrdinal||0))latest.set(key,o);}
 const annotated=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity)),rows=[...latest.values()].filter(o=>o.status==='completed'),accountMap=new Map(accounts.map(a=>[a.id,a])),products=new Map(),bankDebits=new Map(),coverage=new Map(),proposals=[];
 const active=links.filter(l=>l.status!=='deleted'),activeKeys=new Set(active.map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!activeKeys.has([...l.observationIds].sort().join('|')));
 const blocked=(p,b)=>vetoes.some(l=>{const keys=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(identity);return l.type==='group_distinct'?keys.includes(identity(p))||keys.includes(identity(b)):keys.includes(identity(p))&&keys.includes(identity(b));});
 for(const o of rows){
  if(o.statementFlow?.schema==='mybank-current-v1'){
   if(!coverage.has(o.financialAccountId))coverage.set(o.financialAccountId,[]);coverage.get(o.financialAccountId).push(o.statementFlow);
   if(o.direction==='debit'){const key=JSON.stringify([o.financialAccountId,o.date,o.amountMinor,o.currency]);if(!bankDebits.has(key))bankDebits.set(key,[]);bankDebits.get(key).push(o);}
  }
  const a=accountMap.get(o.financialAccountId);
  if(o.statementFlow?.schema==='mybank-yulibao-v1'&&a?.status==='active'&&a.sourceProduct==='alipay_yulibao'&&a.currency===o.currency&&o.direction==='debit'&&o.kind==='transfer'&&actualSecond(o)&&!annotated.has(identity(o))&&(/^\(\u6d88\u8d39\)\u5feb\u6377\u652f\u4ed8-\u652f\u4ed8\u5b9d-/.test(o.description)||legacyQuickPayment(o))){
   const key=JSON.stringify([o.date,o.amountMinor,o.currency]);if(!products.has(key))products.set(key,[]);products.get(key).push(o);
  }
 }
 for(const p of rows){
  if(p.provider!=='alipay'||!['expense','debt_payment'].includes(p.kind)||!['debit','neutral'].includes(p.direction)||p.kind==='expense'&&p.direction!=='debit'||p.accountRelations?.length||!actualSecond(p)||annotated.has(identity(p)))continue;
  const nominal=fundingIdentity(p.paymentChannel);if(nominal?.bank!=='\u7f51\u5546\u94f6\u884c'||nominal.type!=='debit_card')continue;
  const bank=accounts.filter(a=>a.status==='active'&&sameBankAccount(a,nominal,p.currency));if(bank.length!==1||!(coverage.get(bank[0].id)||[]).some(s=>s.periodStart<=p.date&&s.periodEnd>=p.date))continue;
  const limit=p.kind==='debt_payment'?30:10,cashCandidates=bankDebits.get(JSON.stringify([bank[0].id,p.date,p.amountMinor,p.currency]))||[];
  if(cashCandidates.some(b=>!actualSecond(b)||Math.abs(Date.parse(b.occurredAt)-Date.parse(p.occurredAt))<=limit*1000))continue;
  for(const b of products.get(JSON.stringify([p.date,p.amountMinor,p.currency]))||[]){const seconds=(Date.parse(b.occurredAt)-Date.parse(p.occurredAt))/1000;if(legacyQuickPayment(b)&&p.kind!=='debt_payment'||!Number.isInteger(seconds)||seconds<0||seconds>limit||blocked(p,b))continue;proposals.push({p,b,seconds,nominalAccountId:bank[0].id});}
 }
 const uses=new Map();for(const m of proposals)for(const o of [m.p,m.b])uses.set(identity(o),(uses.get(identity(o))||0)+1);
 return new Map(proposals.filter(m=>[m.p,m.b].every(o=>uses.get(identity(o))===1)).map(m=>[m.p.id,{financialAccountId:m.b.financialAccountId,method:'source_statement_direct_product',confidence:'inferred',evidenceObservationIds:[m.b.id],secondsAfter:m.seconds,nominalAccountId:m.nominalAccountId}]));
}
module.exports={findMissingCardFunding,findProductBankFunding,findDirectProductFunding};
