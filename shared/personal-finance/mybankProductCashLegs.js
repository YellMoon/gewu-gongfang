'use strict';
const {fundingIdentity,sameBankAccount}=require('./assetRegister');
const {actualSecond}=require('./mixedPayments');
function findMybankProductCashLegs(observations,accounts,{annotatedIds=new Set(),links=[]}={}){
 const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),accountMap=new Map(accounts.map(a=>[a.id,a]));
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const annotated=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity)),rows=[...latest.values()].filter(o=>o.status==='completed'),active=links.filter(l=>l.status!=='deleted'),activePairs=new Set(active.map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!activePairs.has([...l.observationIds].sort().join('|'))),banks=new Map(),proposals=[];
 const blocked=(p,b)=>vetoes.some(l=>{const keys=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(identity);return l.type==='group_distinct'?keys.includes(identity(p))||keys.includes(identity(b)):keys.includes(identity(p))&&keys.includes(identity(b));});
 for(const b of rows){const a=accountMap.get(b.financialAccountId);if(b.statementFlow?.schema!=='mybank-current-v1'||a?.status!=='active'||a.provider!=='\u7f51\u5546\u94f6\u884c'||a.type!=='debit_card'||!actualSecond(b)||annotated.has(identity(b)))continue;const key=JSON.stringify([b.date,b.amountMinor,b.currency,b.direction]);if(!banks.has(key))banks.set(key,[]);banks.get(key).push(b);}
 for(const p of rows){
  if(p.provider==='alipay'&&p.kind==='transfer'&&p.direction==='credit'&&p.description==='\u4f59\u5229\u5b9d\u8f6c\u51fa\u5230\u652f\u4ed8\u5b9d-\u57fa\u91d1\u8d4e\u56de'&&p.rawFields?.['\u5546\u54c1\u8bf4\u660e']===p.description&&p.rawFields?.['\u6536/\u652f']==='\u6536\u5165'&&p.paymentChannel===''&&!p.paymentAccountHint&&p.accountRelations?.length===1&&actualSecond(p)&&!annotated.has(identity(p))){
   const target=p.accountRelations[0],wallet=accountMap.get(p.financialAccountId),product=accountMap.get(target.financialAccountId);if(target.product!=='alipay_yulibao'||target.role!=='target'||target.activity!=='investment_withdrawal'||wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.currency!==p.currency||product?.status!=='active'||product.sourceProduct!==target.product||product.currency!==p.currency)continue;
   for(const b of rows){if(b.financialAccountId!==product.id||b.statementFlow?.schema!=='mybank-yulibao-v1'||b.direction!=='debit'||b.kind!=='transfer'||b.date!==p.date||b.amountMinor!==p.amountMinor||b.currency!==p.currency||b.occurredAt!==p.occurredAt||!actualSecond(b)||annotated.has(identity(b))||b.description!=='(\u5176\u5b83)\u57fa\u91d1\u8d4e\u56de'||b.rawFields?.['\u5907\u6ce8']!==b.description||b.rawFields?.['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']!=='\u652f\u4ed8\u5b9d'||!/^[^\s@]{1,128}@[^\s@]+\.[A-Za-z]{2,}$/.test(b.rawFields?.['\u5bf9\u65b9\u8d26\u53f7']||'')||blocked(p,b))continue;proposals.push({p,b,seconds:0,financialAccountId:wallet.id,destinationBasis:'explicit_alipay_redemption_and_payee_email'});}
   continue;
  }
  if(p.provider!=='alipay'||p.kind!=='transfer'||p.direction!=='neutral'||!actualSecond(p)||annotated.has(identity(p)))continue;
  const target=p.accountRelations?.find(r=>r.product==='alipay_yulibao'&&r.role==='target'&&['investment_deposit','investment_withdrawal'].includes(r.activity)),a=accountMap.get(target?.financialAccountId);if(!target||a?.status!=='active'||a.sourceProduct!==target.product||a.currency!==p.currency||p.accountRelations.some(r=>r.role==='funding'))continue;
  const card=fundingIdentity(p.paymentChannel);if(p.paymentChannel&&(!card||card.bank!=='\u7f51\u5546\u94f6\u884c'||p.paymentChannel.includes('&'))||p.paymentAccountHint&&!card)continue;
  const deposit=target.activity==='investment_deposit',direction=deposit?'debit':'credit';
  for(const b of banks.get(JSON.stringify([p.date,p.amountMinor,p.currency,direction]))||[]){
   const seconds=(Date.parse(b.occurredAt)-Date.parse(p.occurredAt))/1000,bank=accountMap.get(b.financialAccountId),purpose=String(b.description||'');
   if(!Number.isInteger(seconds)||seconds<0||seconds>5||card&&!sameBankAccount(bank,card,p.currency)||blocked(p,b))continue;
   const operation=deposit?/^(?:\u8f6c\u5165-\u4f59\u5229\u5b9d|\u4f59\u5229\u5b9d\u8f6c\u5165|\u57fa\u91d1\u7533\u8d2d)$/:/^(?:\u8f6c\u51fa-\u4f59\u5229\u5b9d|\u57fa\u91d1\u8d4e\u56de)$/;
   if(!operation.test(purpose)||!(/\u5229\u5b9d\u4ee3\u9500/.test(b.counterparty)||deposit&&/\u8d22\u5b50\u4ee3\u9500\u7533\u8d2d\u5e94\u4ed8-/.test(b.counterparty)))continue;
   proposals.push({p,b,seconds});
  }
 }
 const uses=new Map();for(const m of proposals)for(const o of [m.p,m.b])uses.set(identity(o),(uses.get(identity(o))||0)+1);
 return new Map(proposals.filter(m=>[m.p,m.b].every(o=>uses.get(identity(o))===1)).map(({p,b,seconds,financialAccountId,destinationBasis})=>[p.id,{financialAccountId:financialAccountId||b.financialAccountId,method:'source_statement_mybank_product_cash_leg',confidence:'inferred',evidenceObservationIds:[b.id],secondsAfter:seconds,reciprocalUnique:true,...(destinationBasis?{destinationBasis}:{})}]));
}
module.exports={findMybankProductCashLegs};
