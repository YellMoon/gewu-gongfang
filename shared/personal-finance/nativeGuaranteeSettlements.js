'use strict';
const {annotatedSettlementAccount}=require('./counterpartySettlements');
const invalid=()=>Object.assign(new Error('NATIVE_GUARANTEE_SETTLEMENT_INVALID'),{code:'NATIVE_GUARANTEE_SETTLEMENT_INVALID'});
const isNativeGuarantee=o=>o?.provider==='alipay'&&o.balanceEvidence?.schema==='alipay-balance-proof-v1'&&o.description==='\u8f6c\u8d26\u4fdd\u8bc1\u91d1\u8f6c\u79fb';

// The owner supplies the bearer. Money, direction and posting time continue to
// come from the unique native cash proof, rather than the zero-valued proof row.
function validateNativeGuaranteeSettlement(source,annotation,ledger){
 const patch=annotation?.reset?null:annotation?.patch;
 if(!isNativeGuarantee(source)||!patch||patch.kind!=='transfer'||typeof patch.settlementAccountId!=='string'||Object.keys(patch).some(k=>!['kind','category','settlementAccountId'].includes(k)))throw invalid();
 const proofs=require('./nativeUnassignedGuaranteeCash').plan({...ledger,annotations:[]},[]),matches=proofs.filter(p=>p.observation.id===source.id);
 if(matches.length!==1)throw invalid();
 const p=matches[0],derived={...source,...patch,balanceEvidence:undefined,balanceMinor:null,amountMinor:String(-p.outgoing),kind:'transfer',direction:'debit',paymentChannel:'\u4f59\u989d',paymentAccountHint:''};
 let target;try{target=annotatedSettlementAccount(derived,annotation,ledger.accounts||[]);}catch{throw invalid();}
 if(target?.status!=='active')throw invalid();
 return {...derived,nativeGuaranteeSettlement:{schema:'owner-confirmed-native-guarantee-settlement-v1',method:'native_guarantee_cash_and_owner_confirmed_bearer',sourceObservationId:source.id,originalReference:source.relatedReference,walletAccountId:source.financialAccountId,settlementAccountId:target.id,amountMinor:derived.amountMinor,occurredAt:source.occurredAt,date:source.date,ownerAnnotationId:annotation.id||null,personalConsumptionRecognized:false,sourceGuaranteePurposePreserved:true,reversible:true}};
}
function append(ledger,transactions,selected,buildRawTransactions){
 const latest=new Map();for(const a of ledger.annotations||[]){const prior=latest.get(a.observationId);if(!prior||BigInt(a.revision)>BigInt(prior.revision))latest.set(a.observationId,a);}
 const claimed=new Set();for(const t of transactions){for(const id of t.observationIds||[])claimed.add(id);for(const e of t.cashPostingEvidence||[])claimed.add(e.proofObservationId);for(const es of Object.values(t.balanceEffectEvents||{}))for(const e of es)if(e.observationId)claimed.add(e.observationId);for(const p of t.walletIntermediaryPostings||[])for(const id of p.proofObservationIds||[])claimed.add(id);}
 const byId=new Map((ledger.observations||[]).map(o=>[o.id,o])),originals=new Map(),sources=[],annotations=[],accountIds=new Set();
 for(const annotation of latest.values()){
  const source=byId.get(annotation.observationId);
  if(annotation.reset||!isNativeGuarantee(source)||!annotation.patch?.settlementAccountId||claimed.has(source.id))continue;
  const derived=validateNativeGuaranteeSettlement(source,annotation,ledger);
  sources.push(derived);annotations.push(annotation);originals.set(source.id,source);accountIds.add(source.financialAccountId);accountIds.add(annotation.patch.settlementAccountId);
 }
 if(!sources.length)return;
 const fields=['id','label','type','provider','status','currency','counterpartySettlement','balanceConvention'];
 const accounts=ledger.accounts.filter(a=>accountIds.has(a.id)).map(a=>Object.fromEntries(fields.filter(k=>a[k]!==undefined).map(k=>[k,a[k]])));
 const added=buildRawTransactions({accounts,observations:sources,annotations,links:[],imports:[],balanceSnapshots:[]},{accountIds:[...selected]});
 if(added.length!==sources.length)throw invalid();
 for(const t of added){
  const source=originals.get(t.id),e=t.nativeGuaranteeSettlement,amount=BigInt(e?.amountMinor||0);
  if(!source||!e||t.kind!=='transfer'||t.consumptionMinor!==0n||t.incomeMinor!==0n||t.balanceEffects[e.walletAccountId]!==-amount||t.cashEffects[e.walletAccountId]!==-amount||t.balanceEffects[e.settlementAccountId]!==amount||t.cashEffects[e.settlementAccountId])throw invalid();
  t.sources=[source];t.cashPostingEvidence=[{method:e.method,sourceObservationId:source.id,proofObservationId:source.id,financialAccountId:e.walletAccountId,deltaMinor:String(-amount),occurredAt:source.occurredAt,date:source.date,confidence:'original_cash_and_owner_confirmed_bearer',reversible:true}];transactions.push(t);
 }
}
module.exports={isNativeGuarantee,validateNativeGuaranteeSettlement,append};
