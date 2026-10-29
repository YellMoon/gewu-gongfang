'use strict';
const invalid=()=>{throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_RECALLED_PRODUCT_FUNDING_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_RECALLED_PRODUCT_FUNDING_INVALID'});};
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const text=(s,max=512)=>typeof s==='string'&&s.length>0&&s.length<=max&&s.trim()===s;
const buyUsageValid=r=>r.usage===undefined&&r.supportingImportIds===undefined||r.usage==='investment_reward'&&r.supportingImportIds===undefined||r.usage==='investment_buy'&&Array.isArray(r.supportingImportIds)&&r.supportingImportIds.length>0&&r.supportingImportIds.length<=4&&new Set(r.supportingImportIds).size===r.supportingImportIds.length&&r.supportingImportIds.every(id=>text(id,128));
const rewardInferenceValid=r=>r.confidence==='owner_authorized_inference'&&r.usage==='investment_reward'&&r.ownerRecollection===undefined&&text(r.ownerDecision,500)&&r.inferredRewardOriginal&&typeof r.inferredRewardOriginal==='object'&&!Array.isArray(r.inferredRewardOriginal)&&Object.keys(r.inferredRewardOriginal).length===2&&r.inferredRewardOriginal.counterparty==='\u56fd\u6cf0\u57fa\u91d1\u7ba1\u7406\u6709\u9650\u516c\u53f8'&&r.inferredRewardOriginal.paymentChannel==='\u7ea2\u5305';
const decisionValid=r=>r.confidence==='owner_recalled'&&text(r.ownerRecollection,500)&&r.ownerDecision===undefined&&r.inferredRewardOriginal===undefined||rewardInferenceValid(r);
function validateRecalledProductFunding(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['schema','rules'].includes(k))||value.schema!=='recalled-product-funding-v1'||!Array.isArray(value.rules)||!value.rules.length||value.rules.length>64)invalid();
 const used=new Set();for(const r of value.rules){if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['sourceTransactionId','sourceDate','sourceAmountMinor','financialAccountId','sourceProduct','confidence','recordedAt','ownerRecollection','ownerDecision','inferredRewardOriginal','usage','supportingImportIds'].includes(k))||!text(r.sourceTransactionId)||used.has(r.sourceTransactionId)||!date(r.sourceDate)||typeof r.sourceAmountMinor!=='string'||!/^[1-9]\d{0,19}$/.test(r.sourceAmountMinor)||!text(r.financialAccountId)||r.sourceProduct!=='alipay_yuebao'||!decisionValid(r)||!text(r.recordedAt,64)||!/^\d{4}-\d{2}-\d{2}T/.test(r.recordedAt)||Number.isNaN(Date.parse(r.recordedAt))||!buyUsageValid(r))invalid();used.add(r.sourceTransactionId);}return value;
}
function recalledProductFundingValid(source,target,rule){return source?.status==='active'&&source.type==='wallet'&&source.provider==='alipay'&&!source.sourceProduct&&source.currency==='CNY'&&target?.status==='active'&&target.type==='investment'&&target.provider==='alipay'&&target.sourceProduct===rule.sourceProduct&&target.id===rule.financialAccountId&&target.id!==source.id&&target.currency===source.currency;}
function findRecalledProductFunding(observations,accounts,{annotatedIds=new Set(),links=[],balanceEvidenceObservations=[],balanceEvidenceImports=[]}={}){
 if(!accounts.some(account=>account.recalledProductFunding))return new Map();
 const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),byId=new Map(observations.map(o=>[o.id,o])),am=new Map(accounts.map(a=>[a.id,a])),latest=new Map(),blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(key));
 for(const o of observations){const k=key(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|'))),rows=[...latest.values()],out=new Map();let walletProofs,independentMybankBridges;
 for(const source of accounts){if(!source.recalledProductFunding)continue;const config=validateRecalledProductFunding(source.recalledProductFunding),rules=new Map(config.rules.map(rule=>[rule.sourceTransactionId,rule]));
  for(const o of rows){
   const rule=rules.get(o.sourceTransactionId),target=am.get(rule?.financialAccountId),raw=o.rawFields||{};
   if(!rule||rule.sourceDate!==o.date||rule.sourceAmountMinor!==o.amountMinor||o.financialAccountId!==source.id||o.provider!=='alipay'||o.status!=='completed'||o.direction!=='neutral'||o.paymentChannel||o.paymentAccountHint||o.automaticFunding||o.automaticClassification&&!(rule.usage==='investment_buy'&&o.automaticClassification.method==='explicit_historical_investment_route')||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==''||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==o.sourceTransactionId||raw['\u5546\u54c1\u8bf4\u660e']!==o.description||blocked.has(key(o)))continue;
   if(!recalledProductFundingValid(source,target,rule)||accounts.filter(a=>a.status==='active'&&a.sourceProduct===rule.sourceProduct&&a.currency===o.currency).length!==1)continue;
   let supportingOriginalImportIds;
   if(rule.usage==='investment_buy'){
    const relations=o.accountRelations||[],product=relations.length===1?am.get(relations[0].financialAccountId):null;
    if(o.kind!=='transfer'||!/^\u8682\u8681\u8d22\u5bcc-.+-\u4e70\u5165$/.test(o.description)||raw['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||relations[0]?.role!=='target'||relations[0]?.activity!=='investment_deposit'||relations[0]?.product!=='alipay_funds'||product?.type!=='investment'||product.status!=='active'||product.sourceProduct!=='alipay_funds'||product.currency!==o.currency||!require('./mixedPayments').actualSecond(o))continue;
    if(walletProofs===undefined)walletProofs=require('./walletStatementTopUps').validatedWalletProofs(balanceEvidenceObservations,am);
    const supports=rule.supportingImportIds.map(id=>{
     const imports=balanceEvidenceImports.filter(item=>item.id===id);if(imports.length!==1)return null;const item=imports[0],proofs=walletProofs.filter(p=>p.observation.importId===id&&p.observation.financialAccountId===source.id);
     if(item.financialAccountId!==source.id||!/^[a-f0-9]{64}$/.test(item.fileHash||'')||item.sourceEvidence?.periodStart>o.date||item.sourceEvidence?.periodEnd<o.date||!item.sourceEvidence?.periodStart||!item.sourceEvidence?.periodEnd||item.recordCount!==proofs.length||item.observationIds?.length!==proofs.length||proofs.some(p=>!item.observationIds.includes(p.observation.id)))return null;
     return id;
    });
    if(supports.some(id=>!id)||walletProofs.some(p=>p.observation.financialAccountId===source.id&&p.observation.currency===o.currency&&p.observation.relatedReference===o.sourceTransactionId&&(p.incoming!==0n||p.outgoing!==0n)))continue;
    supportingOriginalImportIds=supports;
   }else if(o.kind!=='debt_payment'||o.description!=='\u4fe1\u7528\u5361\u8fd8\u6b3e'||!String(o.counterparty||'').endsWith('\u94f6\u884c')||o.accountRelations?.length||raw['\u4ea4\u6613\u72b6\u6001']!=='\u8fd8\u6b3e\u6210\u529f')continue;
   if(vetoes.some(l=>l.observationIds.map(id=>byId.get(id)).filter(Boolean).some(p=>key(p)===key(o))))continue;
   // A later actual cash record outranks recollection. An absent cash row is
   // supporting evidence only; owner authorization remains the funding basis.
   const bankCandidates=rows.filter(b=>b.id!==o.id&&b.status==='completed'&&b.currency===o.currency&&b.amountMinor===o.amountMinor&&b.direction==='debit'&&(b.bankStatement||b.statementFlow)&&!b.bankStatement?.nonCash&&Math.abs(Date.parse(b.date)-Date.parse(o.date))<=86400000),excludedUnrelatedBankEvidence=[];
   if(bankCandidates.length){
    if(rule.usage!=='investment_buy')continue;
    if(independentMybankBridges===undefined)independentMybankBridges=require('./reconciliationGroups').findMybankWalletProductBridgeGroups(rows,accounts,{rootOf:id=>id,annotatedIds,links}).filter(g=>{
     const members=new Set(g.observationIds.map(id=>key(byId.get(id))));return g.evidence.platformEffectBasis==='wallet_to_yuebao'&&g.observationIds.every(id=>!blocked.has(key(byId.get(id))))&&!links.some(l=>l.observationIds.some(id=>byId.has(id)&&members.has(key(byId.get(id)))));
    });
    for(const b of bankCandidates){const groups=independentMybankBridges.filter(g=>g.bankRootIds.includes(b.id)&&g.evidence.walletAccountId===source.id&&g.evidence.productAccountId===target.id&&g.evidence.date===o.date&&g.platformRootIds.length===1&&g.platformRootIds[0]!==o.id&&Math.abs(Date.parse(byId.get(g.platformRootIds[0]).occurredAt)-Date.parse(o.occurredAt))>30000);if(groups.length!==1)continue;const g=groups[0];excludedUnrelatedBankEvidence.push({method:'separate_original_wallet_to_yuebao_bank_transit',bankObservationId:b.id,otherSourceObservationId:g.platformRootIds[0],reconciliationGroupId:g.id,evidenceObservationIds:g.observationIds,originalBankCashLegsPreserved:true,bankNetMinor:g.evidence.bankNetMinor,productAccountId:g.evidence.productAccountId,confidence:'original_distinct_transit_not_fund_payment'});}
    if(excludedUnrelatedBankEvidence.length!==bankCandidates.length)continue;
   }
   out.set(o.id,{financialAccountId:target.id,method:'owner_recalled_product_funding',confidence:'owner_recalled',sourceProduct:rule.sourceProduct,sourceTransactionId:o.sourceTransactionId,evidenceObservationIds:[o.id],policyRecordedAt:rule.recordedAt,ownerRecollection:rule.ownerRecollection,statementPayerVerified:false,reversible:true,...(supportingOriginalImportIds?{usage:rule.usage,supportingOriginalImportIds,walletStatementPayerExcluded:true,fundingBasis:'owner_authorized_inference_not_an_actual_product_debit'}:{}),...(excludedUnrelatedBankEvidence.length?{excludedUnrelatedBankEvidence}:{})});
  }
 }
 return new Map([...out,...require('./recalledProductRewards').findRecalledProductRewards(observations,accounts,{annotatedIds,links,balanceEvidenceObservations})]);
}
module.exports={validateRecalledProductFunding,recalledProductFundingValid,findRecalledProductFunding};
