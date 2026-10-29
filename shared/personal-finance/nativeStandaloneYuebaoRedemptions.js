'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const TITLE='\u7406\u8d22\u8d4e\u56de\u8d44\u91d1\u8f6c\u5165\u652f\u4ed8\u5b9d\u8d26\u6237\u4f59\u989d\u5b9d\u8f6c\u51fa';
function planNativeStandaloneYuebaoRedemptions(ledger,transactions){
 const accounts=new Map((ledger.accounts||[]).map(a=>[a.id,a])),funds=[...accounts.values()].filter(a=>a.status==='active'&&a.type==='investment'&&a.provider==='alipay'&&a.sourceProduct==='alipay_yuebao'&&a.currency==='CNY');
 if(funds.length!==1)return[];const fund=funds[0],latest=new Map();
 for(const o of ledger.observations||[]){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const rows=[...latest.values()],byId=new Map((ledger.observations||[]).map(o=>[o.id,o])),claimed=new Set(),blocked=new Set();
 for(const a of ledger.annotations||[])if(byId.has(a.observationId))blocked.add(identity(byId.get(a.observationId)));
 for(const l of ledger.links||[])for(const id of l.observationIds||[])if(byId.has(id))blocked.add(identity(byId.get(id)));
 for(const t of transactions){for(const id of t.observationIds||[])claimed.add(id);for(const p of t.cashPostingEvidence||[])claimed.add(p.proofObservationId);for(const p of t.walletIntermediaryPostings||[])for(const id of p.proofObservationIds||[])claimed.add(id);for(const events of Object.values(t.balanceEffectEvents||{}))for(const e of events)if(e.observationId)claimed.add(e.observationId);}
 const proofs=validatedWalletProofs(rows,accounts),signatures=new Map(),signature=p=>JSON.stringify([p.observation.financialAccountId,p.observation.relatedReference,p.observation.occurredAt,String(p.incoming)]);
 for(const p of proofs){const k=signature(p);signatures.set(k,(signatures.get(k)||0)+1);}
 const plans=[];
 for(const p of proofs){
  const o=p.observation,wallet=accounts.get(o.financialAccountId);
  if(o.description!==TITLE||p.bank!=='\u5929\u5f18\u57fa\u91d1'||p.incoming<=0n||p.outgoing!==0n||wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.sourceProduct||wallet.currency!==fund.currency||!/^\d{20,40}(?:\*{3}\d{2,4})?$/.test(o.relatedReference)||!o.relatedReference.startsWith(o.date.replace(/-/g,''))||claimed.has(o.id)||blocked.has(identity(o))||signatures.get(signature(p))!==1)continue;
  // A printed product cash receipt is its own transfer. An existing same-value
  // fund withdrawal is a veto even if its original booking date was different;
  // an arbitrary date window cannot prove that a second fund debit is missing.
  if(transactions.some(t=>BigInt(t.balanceEffects?.[fund.id]||0n)===-p.incoming||t.balanceEffectEvents?.[fund.id]?.some(e=>BigInt(e.deltaMinor)===-p.incoming)))continue;
  const reference=new RegExp('^'+o.relatedReference.replace(/\*+/g,'.*')+'$');
  if(rows.some(s=>!s.balanceEvidence&&s.provider==='alipay'&&s.financialAccountId===wallet.id&&[s.sourceTransactionId,s.relatedReference].some(ref=>typeof ref==='string'&&reference.test(ref))))continue;
  plans.push({proof:o,wallet,fund,amountMinor:String(p.incoming),evidence:{schema:'native-standalone-yuebao-redemption-v1',method:'explicit_original_yuebao_wallet_redemption',confidence:'explicit_original_product_and_wallet_cash',walletAccountId:wallet.id,fundAccountId:fund.id,amountMinor:String(p.incoming),occurredAt:o.occurredAt,nativeReference:o.relatedReference,nativeReferenceMasked:o.relatedReference.includes('*'),evidenceObservationIds:[o.id],sourceOrderMatched:false,noBankRecipientInferred:true,noExpenseOrIncome:true,reversible:true}});
 }
 return plans;
}
function appendNativeStandaloneYuebaoRedemptions(ledger,transactions,selected,buildRawTransactions){
 const plans=planNativeStandaloneYuebaoRedemptions(ledger,transactions);if(!plans.length)return;
 const ids=new Set(plans.flatMap(p=>[p.wallet.id,p.fund.id])),accounts=ledger.accounts.filter(a=>ids.has(a.id)).map(a=>Object.fromEntries(['id','label','provider','type','status','currency','sourceProduct'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]])));
 const observations=plans.map(p=>({...p.proof,balanceEvidence:undefined,balanceMinor:null,amountMinor:p.amountMinor,kind:'transfer',direction:'credit',paymentChannel:'\u8d26\u6237\u4f59\u989d',accountRelations:[{product:'alipay_yuebao',financialAccountId:p.fund.id,role:'target',activity:'investment_withdrawal'}]})),added=buildRawTransactions({accounts,observations,annotations:[],links:[],imports:[],balanceSnapshots:[]},{accountIds:[...selected]}),byId=new Map(plans.map(p=>[p.proof.id,p]));
 if(added.length!==plans.length)throw new Error('NATIVE_YUEBAO_REDEMPTION_UNEXPECTED_MERGE');
 for(const t of added){const p=byId.get(t.id),amount=p&&BigInt(p.amountMinor);if(!p||t.observationIds.length!==1||t.incomeMinor!==0n||t.consumptionMinor!==0n||t.balanceEffects[p.wallet.id]!==amount||t.balanceEffects[p.fund.id]!==-amount||t.cashEffects[p.wallet.id]!==amount||t.cashEffects[p.fund.id]!==-amount)throw new Error('NATIVE_YUEBAO_REDEMPTION_CASH_MISMATCH');t.sources=[p.proof];t.nativeStandaloneYuebaoRedemption=p.evidence;t.cashPostingEvidence=[{method:p.evidence.method,sourceObservationId:p.proof.id,proofObservationId:p.proof.id,financialAccountId:p.wallet.id,deltaMinor:p.amountMinor,occurredAt:p.proof.occurredAt,date:p.proof.date,confidence:p.evidence.confidence,reversible:true}];transactions.push(t);}
}
module.exports={planNativeStandaloneYuebaoRedemptions,appendNativeStandaloneYuebaoRedemptions};
