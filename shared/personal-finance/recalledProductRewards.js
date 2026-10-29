'use strict';
const {actualSecond}=require('./mixedPayments');
// An issuer name alone never selects a product. An exact owner-scoped rule
// allocates the face value only; it never invents confirmed units or cash.
function findRecalledProductRewards(observations,accounts,{annotatedIds=new Set(),links=[],balanceEvidenceObservations=[]}={}){
 if(!accounts.some(a=>a.recalledProductFunding?.rules?.some(r=>r.usage==='investment_reward')))return new Map();
 const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),am=new Map(accounts.map(a=>[a.id,a])),blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(key));
 for(const o of observations)if(!latest.has(key(o))||(o.sourceVersionOrdinal||0)>(latest.get(key(o)).sourceVersionOrdinal||0))latest.set(key(o),o);
 const rows=[...latest.values()],out=new Map();let proofs;
 for(const source of accounts){
  if(!source.recalledProductFunding)continue;
  const config=require('./recalledProductFunding').validateRecalledProductFunding(source.recalledProductFunding);
  for(const rule of config.rules.filter(r=>r.usage==='investment_reward')){
   const matches=rows.filter(o=>o.financialAccountId===source.id&&o.provider==='alipay'&&o.sourceTransactionId===rule.sourceTransactionId);if(matches.length!==1)continue;
   const o=matches[0],r=o.rawFields||{},target=am.get(rule.financialAccountId),inferred=rule.confidence==='owner_authorized_inference',original=inferred?rule.inferredRewardOriginal:{counterparty:'\u5929\u5f18\u57fa\u91d1\u7ba1\u7406\u6709\u9650\u516c\u53f8',paymentChannel:'\u57fa\u91d1\u4efd\u989d\u7ea2\u5305'};
   if(observations.filter(p=>key(p)===key(o)&&(p.sourceVersionOrdinal||0)===(o.sourceVersionOrdinal||0)).length!==1)continue;
   if(!require('./recalledProductFunding').recalledProductFundingValid(source,target,rule)||accounts.filter(a=>a.status==='active'&&a.sourceProduct==='alipay_yuebao'&&a.currency===o.currency).length!==1||o.date!==rule.sourceDate||o.amountMinor!==rule.sourceAmountMinor||o.status!=='completed'||o.currency!=='CNY'||o.kind!=='transfer'||o.direction!=='neutral'||o.description!=='\u7ea2\u5305\u5956\u52b1\u53d1\u653e'||o.counterparty!==original.counterparty||o.paymentChannel!==original.paymentChannel||o.paymentAccountHint||o.accountRelations?.length||o.investmentTrade||o.brokerage||o.bankStatement||o.statementFlow||o.balanceEvidence||o.automaticFunding||o.automaticClassification||!actualSecond(o)||blocked.has(key(o)))continue;
   if(r['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||r['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||r['\u4ea4\u6613\u5bf9\u65b9']!==o.counterparty||r['\u5546\u54c1\u8bf4\u660e']!==o.description||r['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==o.paymentChannel||r['\u4ea4\u6613\u8ba2\u5355\u53f7']!==o.sourceTransactionId||!o.relatedReference||r['\u5546\u5bb6\u8ba2\u5355\u53f7']!==o.relatedReference||typeof r['\u91d1\u989d']!=='string'||!/^\d+\.\d{2}$/.test(r['\u91d1\u989d'])||BigInt(r['\u91d1\u989d'].replace('.',''))!==BigInt(o.amountMinor))continue;
   if(links.some(l=>(l.status!=='deleted'||l.type==='duplicate')&&l.observationIds.some(id=>byId.has(id)&&key(byId.get(id))===key(o))))continue;
   if(proofs===undefined)proofs=require('./walletStatementTopUps').validatedWalletProofs(balanceEvidenceObservations,am);
   const bridge=proofs.filter(p=>p.observation.financialAccountId===source.id&&p.observation.relatedReference===o.sourceTransactionId);
   if(bridge.length&&(bridge.some(p=>Date.parse(p.observation.occurredAt)!==Date.parse(o.occurredAt)||annotatedIds.has(p.observation.id))||bridge.reduce((sum,p)=>sum+p.incoming,0n)!==BigInt(o.amountMinor)||bridge.reduce((sum,p)=>sum+p.outgoing,0n)!==-BigInt(o.amountMinor)))continue;
   out.set(o.id,{financialAccountId:target.id,method:inferred?'owner_authorized_product_reward_inference':'owner_recalled_product_share_reward',confidence:rule.confidence,usage:'investment_reward',accountRole:'receiving',sourceProduct:rule.sourceProduct,sourceTransactionId:o.sourceTransactionId,evidenceObservationIds:[o.id],policyRecordedAt:rule.recordedAt,...(inferred?{ownerDecision:rule.ownerDecision,inferredRewardOriginal:{...rule.inferredRewardOriginal},rewardFormVerified:false,nonCashBasis:'owner_selected_inference'}:{ownerRecollection:rule.ownerRecollection}),statementProductVerified:false,reversible:true,inferredKind:'income',inferredDirection:'credit',sourceKind:o.kind,sourceDirection:o.direction,nonCashProductReward:true,rewardValueMinor:o.amountMinor,confirmedUnitsUnknown:true,incomeBasis:inferred?'owner_authorized_reward_face_value_with_inferred_product':'native_share_reward_face_value_with_owner_inferred_product',...(bridge.length?{walletBridgeObserved:true,walletBridgeProofObservationIds:bridge.map(p=>p.observation.id),walletBridgeNetCashMinor:'0'}:{})});
  }
 }
 return out;
}
module.exports={findRecalledProductRewards};
