'use strict';
const PRODUCT='cn_medical_personal_account',integer=v=>typeof v==='string'&&/^(?:0|[1-9]\d*)$/.test(v);
const invalid=()=>{throw Object.assign(new Error('MEDICAL_SETTLEMENT_INVALID'),{code:'MEDICAL_SETTLEMENT_INVALID'});};
function confirmedMedicalSettlement(source,annotation,accounts,{links=[]}={}){
 const patch=annotation?.reset?null:annotation?.patch,p=patch?.medicalSettlement;if(p==null)return null;
 if(typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['schema','personalAccountId','personalPaidMinor','pooledPaidMinor','sourceTransactionId','sourceFingerprint','sourceAmountMinor','basis','confirmedAt'].includes(k))||p.schema!=='medical-settlement-v1'||p.basis!=='owner_confirmed_medical_account_breakdown'||patch.kind!=='expense'||Object.keys(patch).some(k=>!['kind','category','medicalSettlement'].includes(k))||!integer(p.personalPaidMinor)||!integer(p.pooledPaidMinor)||typeof p.confirmedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(p.confirmedAt)||!Number.isFinite(Date.parse(p.confirmedAt)))invalid();
 const payer=accounts.find(a=>a.id===source.financialAccountId),target=accounts.find(a=>a.id===p.personalAccountId);
 if(!require('./legacyNativePurchases').isOriginalNonSelfPayMedicalPayment(source)||payer?.status!=='active'||payer.type!=='wallet'||payer.provider!=='alipay'||payer.currency!=='CNY'||payer.sourceProduct||p.sourceTransactionId!==source.sourceTransactionId||p.sourceAmountMinor!==source.amountMinor||!/^[a-f0-9]{64}$/.test(p.sourceFingerprint||'')||p.sourceFingerprint!==source.recordFingerprint||BigInt(p.personalPaidMinor)+BigInt(p.pooledPaidMinor)!==BigInt(source.amountMinor))invalid();
 if(BigInt(p.personalPaidMinor)>0n||p.personalAccountId!==undefined){if(!target||target.id===payer.id||target.status!=='active'||target.type!=='wallet'||target.provider!=='medical_insurance'||target.sourceProduct!==PRODUCT||target.currency!=='CNY')invalid();}
 if(links.some(l=>(l.observationIds||[]).includes(source.id)&&(l.status!=='deleted'||['duplicate','transfer','group_duplicate'].includes(l.type))))invalid();
 const trace={schema:p.schema,method:'owner_confirmed_medical_settlement',confidence:'owner_confirmed',sourceObservationId:source.id,sourceTransactionId:source.sourceTransactionId,sourceFingerprint:source.recordFingerprint,originalSettlementAmountMinor:source.amountMinor,personalAccountId:BigInt(p.personalPaidMinor)>0n?target.id:null,personalPaidMinor:p.personalPaidMinor,pooledPaidMinor:p.pooledPaidMinor,basis:p.basis,confirmedAt:p.confirmedAt,reversible:true,medicalAccountBalanceKnown:false};
 const paid=BigInt(p.personalPaidMinor)>0n;
 return {...source,...patch,amountMinor:p.personalPaidMinor,accountRelations:paid?[{product:PRODUCT,role:'funding',activity:'funding_outflow',financialAccountId:target.id}]:[],automaticClassification:{method:'owner_confirmed_medical_settlement',confidence:'owner_confirmed',evidenceObservationIds:[source.id]},...(paid?{automaticFunding:{method:'owner_confirmed_medical_settlement',confidence:'owner_confirmed',financialAccountId:target.id,amountMinor:p.personalPaidMinor,originalSettlementAmountMinor:source.amountMinor,pooledPaidMinor:p.pooledPaidMinor,evidenceObservationIds:[source.id],reversible:true}}:{}),medicalSettlementEvidence:trace};
}
function medicalSettlementFunding(observations,accounts,annotations,links=[]){
 const out=new Map();for(const o of observations){const a=annotations.get(o.id);if(a?.reset||!a?.patch?.medicalSettlement)continue;try{const effective=confirmedMedicalSettlement(o,a,accounts,{links});if(effective?.automaticFunding)out.set(o.id,effective.automaticFunding);}catch{/* Invalid or stale confirmations never become account evidence. */}}
 return out;
}
module.exports={confirmedMedicalSettlement,medicalSettlementFunding};
