'use strict';
const {actualSecond}=require('./mixedPayments');
const financialPurpose=/\u62bc\u91d1|\u4fdd\u8bc1\u91d1|\u9884\u6388\u6743|\u51bb\u7ed3|\u501f\u6b3e|\u8fd8\u6b3e|\u8d37\u6b3e|\u57fa\u91d1|\u7406\u8d22|\u8bc1\u5238|\u5145\u503c|\u63d0\u73b0|\u8bfe\u7a0b|\u5237\u8bfe/;
// A uniquely referenced successful cash refund proves that its original order
// was paid. Keep the export's final closed status immutable and show the paid
// interpretation separately. Deposits and mixed reward funding need their own
// asset/payment allocation; they cannot become ordinary merchant consumption.
function findRefundProvenClosedHuabeiPurchases(observations,accounts,{annotatedIds=new Set(),links=[]}={}){
 if(!observations.some(o=>o.automaticClassification?.method==='explicit_neutral_wallet_refund_cash'))return new Map();
 const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),latest=new Map(),byId=new Map(observations.map(o=>[o.id,o])),am=new Map(accounts.map(a=>[a.id,a]));
 for(const o of observations)if(!latest.has(key(o))||(o.sourceVersionOrdinal||0)>(latest.get(key(o)).sourceVersionOrdinal||0))latest.set(key(o),o);
 const rows=[...latest.values()],blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(key));
 const active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|')));
 const matchesAmount=o=>typeof o.rawFields?.['\u91d1\u989d']==='string'&&/^\d+\.\d{2}$/.test(o.rawFields['\u91d1\u989d'])&&/^[1-9]\d*$/.test(o.amountMinor)&&BigInt(o.rawFields['\u91d1\u989d'].replace('.',''))===BigInt(o.amountMinor);
 const parents=new Map(),refunds=[];
 for(const o of rows){
  if(o.provider!=='alipay'||o.currency!=='CNY'||am.get(o.financialAccountId)?.provider!=='alipay'||am.get(o.financialAccountId)?.type!=='wallet'||am.get(o.financialAccountId)?.status!=='active'||!actualSecond(o)||!matchesAmount(o))continue;
  if(o.automaticClassification?.method==='explicit_neutral_wallet_refund_cash'&&o.kind==='refund'&&o.direction==='credit'&&o.status==='completed'){refunds.push(o);continue;}
  const raw=o.rawFields||{},relations=o.accountRelations||[],fund=relations.length===1?am.get(relations[0].financialAccountId):null;
  const legacyMerchant=o.kind==='transfer'&&require('./legacyAlipayPurchases').isLegacyAlipayPurchase({...o,status:'completed',rawFields:{...raw,'\u4ea4\u6613\u72b6\u6001':'\u4ea4\u6613\u6210\u529f'}});
  if(o.kind!=='expense'&&!legacyMerchant||o.status!=='failed'||o.direction!=='debit'||o.paymentChannel!=='\u82b1\u5457'||o.paymentAccountHint||o.bankStatement||o.statementFlow||o.investmentTrade||financialPurpose.test(o.description)||relations[0]?.role!=='funding'||relations[0]?.activity!=='credit_charge'||relations[0]?.product!=='alipay_huabei'||fund?.sourceProduct!=='alipay_huabei'||fund.type!=='credit_card'||fund.status!=='active'||fund.currency!==o.currency||!o.sourceTransactionId||!o.relatedReference||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u5173\u95ed'||raw['\u6536/\u652f']!=='\u652f\u51fa'||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==o.sourceTransactionId||raw['\u5546\u5bb6\u8ba2\u5355\u53f7']!==o.relatedReference||raw['\u5546\u54c1\u8bf4\u660e']!==o.description||raw['\u4ea4\u6613\u5bf9\u65b9']!==o.counterparty||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==o.paymentChannel)continue;
  const ref=JSON.stringify([o.financialAccountId,o.sourceTransactionId]);if(!parents.has(ref))parents.set(ref,[]);parents.get(ref).push(o);
 }
 const proposals=[];
 for(const refund of refunds){
  const ref=refund.sourceTransactionId.split('_')[0],possible=(parents.get(JSON.stringify([refund.financialAccountId,ref]))||[]).filter(p=>refund.sourceTransactionId.startsWith(p.sourceTransactionId+'_')&&p.relatedReference===refund.relatedReference&&p.amountMinor===refund.amountMinor&&p.counterparty===refund.counterparty&&refund.description==='\u9000\u6b3e-'+p.description&&Date.parse(refund.occurredAt)>Date.parse(p.occurredAt));
  if(possible.length!==1)continue;const purchase=possible[0];proposals.push({purchase,refund});
 }
 const uses=new Map();for(const p of proposals)for(const o of[p.purchase,p.refund])uses.set(key(o),(uses.get(key(o))||0)+1);
 const out=new Map();for(const {purchase:p,refund:r}of proposals){
  const members=new Set([key(p),key(r)]),veto=vetoes.some(l=>{const ids=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(key);return l.type==='group_distinct'?ids.some(id=>members.has(id)):ids.length===l.observationIds.length&&ids.every(id=>members.has(id));})||links.some(l=>l.status!=='deleted'&&['duplicate','refund'].includes(l.type)&&l.observationIds.some(id=>byId.has(id)&&members.has(key(byId.get(id))))&&(l.type==='duplicate'||!l.observationIds.every(id=>byId.has(id)&&members.has(key(byId.get(id))))));
  if(veto||[p,r].some(o=>blocked.has(key(o))||uses.get(key(o))!==1))continue;
  out.set(p.id,{status:'completed',kind:'expense',automaticClassification:{method:'refund_proven_closed_huabei_purchase',confidence:'inferred_unique_full_original_refund',sourceStatus:p.status,sourceKind:p.kind,sourceRawStatus:p.rawFields['\u4ea4\u6613\u72b6\u6001'],evidenceObservationIds:[p.id,r.id],refundObservationId:r.id,refundCashReceiptMinor:r.amountMinor,financialAccountId:p.accountRelations[0].financialAccountId,reciprocalUnique:true,reversible:true,originalAndRefundRemainSeparate:true}});
 }
 return out;
}
module.exports={findRefundProvenClosedHuabeiPurchases};
