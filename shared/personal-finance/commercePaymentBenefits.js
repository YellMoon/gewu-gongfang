'use strict';

const invalid=()=>{throw Object.assign(new Error('COMMERCE_PAYMENT_INVALID'),{code:'COMMERCE_PAYMENT_INVALID'});};
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const amountMatches=(raw,value)=>{
 const m=String(raw??'').match(/^(\d+)(?:\.(\d{1,2}))?$/);
 return !!m&&BigInt(m[1])*100n+BigInt((m[2]||'').padEnd(2,'0'))===BigInt(value);
};

// The owner confirms this particular order/payment difference. A small amount
// difference alone never activates this rule or creates a cash benefit wallet.
function commercePaymentBenefit(source,annotation,accounts,observations,{allowArchived=false,links=[]}={}){
 const patch=annotation?.reset?null:annotation?.patch,p=patch?.commercePayment;
 if(p===undefined||p===null)return null;
 if(p.schema==='native-wallet-payment-v1')return {nativeOnly:true,...require('./nativeWalletPaymentCash').nativeWalletPaymentCash(source,annotation,accounts,observations,{allowArchived,links})};
 if(p.schema==='native-credit-payment-v1'){const input=observations.map(o=>o.id===source.id?{...o,...patch}:o),annotations=new Map([[source.id,annotation]]),plan=require('./nativeBankFundedOrders').findNativeBankFundedOrders(input,accounts,{annotations,annotatedIds:new Set([source.id])}).get(source.id);if(!plan?.actualPaidMinor||plan.paymentDifferenceMinor!==p.discountMinor)invalid();return {nativeOnly:true,...plan};}
 const effective={...source,...patch},byId=new Map(observations.map(o=>[o.id,o])),map=new Map(accounts.map(a=>[a.id,a]));
 const active=a=>a&&['active',...(allowArchived?['archived']:[])].includes(a.status)&&a.currency===source.currency;
 if(!p||typeof p!=='object'||Array.isArray(p)||p.schema!=='commerce-payment-v1'||p.basis!=='owner_confirmed_credit_payment_benefit'||Object.keys(p).some(k=>!['schema','bankObservationId','discountMinor','basis'].includes(k))||typeof p.bankObservationId!=='string'||typeof p.discountMinor!=='string'||!/^\d+$/.test(p.discountMinor)||BigInt(p.discountMinor)<=0n)invalid();
 const b=byId.get(p.bankObservationId),card=map.get(b?.financialAccountId),wallet=map.get(source.financialAccountId),raw=source.rawFields||{},br=b?.rawFields||{},bank=b?.bankStatement||{};
 if(source.provider!=='jd'||source.kind!=='expense'||source.direction!=='debit'||source.status!=='completed'||source.currency!=='CNY'||effective.kind!==source.kind||effective.status!==source.status||effective.direction!==source.direction||!active(wallet)||wallet.provider!=='jd'||wallet.type!=='wallet'||source.accountRelations?.length||source.paymentAccountHint||source.investmentTrade||source.brokerage||effective.paymentAllocation||effective.assetAllocation||effective.settlementAccountId)invalid();
 if(!['\u94f6\u8054\u652f\u4ed8','\u4e91\u95ea\u4ed8'].includes(source.paymentChannel)||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==source.paymentChannel||raw['\u4ea4\u6613\u65f6\u95f4']!==source.occurredAt.slice(0,19).replace('T',' ')||raw['\u4ea4\u6613\u8bf4\u660e']!==source.description||raw['\u5546\u6237\u540d\u79f0']!==source.counterparty||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||raw['\u6536/\u652f']!=='\u652f\u51fa'||!/^\d{8,40}$/.test(raw['\u4ea4\u6613\u8ba2\u5355\u53f7']||'')||!amountMatches(raw['\u91d1\u989d'],source.amountMinor))invalid();
 if(!b||b.id===source.id||b.provider!==bank.provider||!active(card)||card.type!=='credit_card'||bank.schema!=='bank-credit-v1'||bank.nonCash!==false||b.kind!=='expense'||b.status!=='completed'||b.direction!=='debit'||b.date!==source.date||b.currency!==source.currency||b.counterparty!==b.description||b.accountRelations?.length||bank.cardTail!==card.maskedIdentifier||br.cardTail!==card.maskedIdentifier||br.dateBasis!=='transaction_date'||br.tradeDate!==b.date||br.statementCredit!==false||br.statementAmountMinor!==b.amountMinor||br.excludedFromBilledTotal||b.bankAccount?.provider!==card.provider||b.bankAccount.type!=='credit_card'||b.bankAccount.maskedIdentifier!==card.maskedIdentifier||b.bankAccount.currency!==card.currency||BigInt(b.amountMinor)<=0n||BigInt(b.amountMinor)+BigInt(p.discountMinor)!==BigInt(source.amountMinor)||[effective,b].some(o=>![undefined,null,'0'].includes(o.feeMinor)))invalid();
 const text=b.description.normalize('NFKC').replace(/\s/g,''),namedJd=/^(?:\(\u6d88\u8d39\))?\u4eac\u4e1c\u5546\u57ce\u5e73\u53f0\u5546\u6237$/.test(text),globalJd=text==='\u7f51\u94f6\u56fd\u9645\u8d2dInternational'&&source.description.startsWith('\u5168\u7403\u8d2d-');
 if(!namedJd&&!globalJd)invalid();
 const minute=br.sourceTradeDateTime;
 if(minute!==undefined){if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(minute)||source.occurredAt.slice(0,16).replace('T',' ')!==minute)invalid();}
 else if(globalJd)invalid();
 return {commerce:source,payment:b,method:'owner_confirmed_commerce_payment_benefit',confidence:'owner_confirmed',evidence:{annotationId:annotation.id,basis:p.basis,date:source.date,currency:source.currency,orderNumber:raw['\u4ea4\u6613\u8ba2\u5355\u53f7'],orderAmountMinor:source.amountMinor,actualPaidMinor:b.amountMinor,paymentDifferenceMinor:p.discountMinor,paymentDifferenceClassification:'credit_payment_discount',bankCardTail:card.maskedIdentifier,bankObservationId:b.id,amountBasis:'actual_credit_statement_payment',merchantBasis:globalJd?'global_order_and_same_native_minute':'explicit_jd_bank_merchant',reversible:true}};
}

function findCommercePaymentBenefits(observations,accounts,{annotations=new Map(),links=[],rootOf}={}){
 const latest=new Map(),byId=new Map(observations.map(o=>[o.id,o]));
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const activePairs=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!activePairs.has([...l.observationIds].sort().join('|'))),plans=[];
 for(const ann of annotations.values()){
  if(ann.reset||!ann.patch?.commercePayment)continue;
  const source=byId.get(ann.observationId);if(!source)invalid();if(['native-credit-payment-v1','native-wallet-payment-v1'].includes(ann.patch.commercePayment.schema))continue;
  const plan=commercePaymentBenefit(source,ann,accounts,observations,{allowArchived:true}),members=[source,plan.payment],keys=new Set(members.map(identity));
  if(members.some(o=>latest.get(identity(o)).id!==o.id)||[...annotations].some(([id,a])=>!a.reset&&byId.has(id)&&keys.has(identity(byId.get(id)))&&id!==source.id))continue;
  if(vetoes.some(l=>{const ks=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(identity);return l.type==='group_distinct'?ks.some(k=>keys.has(k)):ks.every(k=>keys.has(k));}))continue;
  if(rootOf&&observations.some(o=>members.some(m=>rootOf(o.id)===rootOf(m.id))&&!keys.has(identity(o))))continue;
  plans.push(plan);
 }
 const uses=new Map();for(const p of plans)for(const o of [p.commerce,p.payment])uses.set(identity(o),(uses.get(identity(o))||0)+1);
 return plans.filter(p=>[p.commerce,p.payment].every(o=>uses.get(identity(o))===1));
}
module.exports={commercePaymentBenefit,findCommercePaymentBenefits};
