'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const packet='\u53d1\u4e2a\u4eba\u7ea2\u5305\u2014\u73b0\u91d1',funded='\u7406\u8d22\u8d4e\u56de\u8d44\u91d1\u8f6c\u5165\u652f\u4ed8\u5b9d\u8d26\u6237\u4f59\u989d\u5b9d\u652f\u4ed8';

// Personal packet exports and wallet cash can use different business IDs.
// Preserve both IDs and infer only a reciprocal unique, near-time funded pair.
function addNativePersonalPacketBridges(ledger,transactions,plans){
 const byId=new Map((ledger.observations||[]).map(o=>[o.id,o]));if(![...byId.values()].some(o=>o.description===packet))return plans;
 const am=new Map(ledger.accounts.map(a=>[a.id,a])),latest=new Map(),ties=new Set(),edited=new Set(),claimed=new Set();
 for(const o of byId.values()){const k=key(o),old=latest.get(k);if(!old||(o.sourceVersionOrdinal||0)>(old.sourceVersionOrdinal||0)){latest.set(k,o);ties.delete(k);}else if((o.sourceVersionOrdinal||0)===(old.sourceVersionOrdinal||0)&&old.id!==o.id)ties.add(k);}
 for(const a of ledger.annotations||[]){const o=byId.get(a.observationId);if(o)edited.add(key(o));}
 for(const l of ledger.links||[])if(l.status!=='deleted'||['duplicate','transfer'].includes(l.type))for(const id of l.observationIds||[]){const o=byId.get(id);if(o)edited.add(key(o));}
 for(const list of plans.values())for(const p of list)for(const id of p.proofObservationIds||[])claimed.add(id);
 for(const t of transactions){for(const id of t.observationIds||[])claimed.add(id);for(const e of t.cashPostingEvidence||[])claimed.add(e.proofObservationId);for(const es of Object.values(t.balanceEffectEvents||{}))for(const e of es)if(e.observationId)claimed.add(e.observationId);}
 const rows=[...latest.values()],proofs=validatedWalletProofs(rows,am),seq=new Map();for(const p of proofs){const o=p.observation;seq.set(JSON.stringify([o.financialAccountId,o.importId,o.balanceEvidence.sequence]),p);}
 const sources=rows.filter(o=>o.provider==='alipay'&&!o.balanceEvidence&&o.status==='completed'&&o.description===packet&&o.paymentChannel==='\u4f59\u989d\u5b9d'&&o.direction==='debit'),proposals=[];
 const clean=o=>o&&latest.get(key(o))?.id===o.id&&!ties.has(key(o))&&!edited.has(key(o));
 for(const s of sources){
  const roots=transactions.filter(t=>t.observationIds?.includes(s.id));if(roots.length!==1)continue;const t=roots[0],wallet=am.get(s.financialAccountId),relation=s.accountRelations?.[0],fund=am.get(relation?.financialAccountId),r=s.rawFields||{},n=BigInt(s.amountMinor);
  if(!clean(s)||plans.has(t.id)||n<=0n||wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.sourceProduct||wallet.currency!=='CNY'||s.currency!=='CNY'||s.kind!=='transfer'||s.accountRelations?.length!==1||relation.product!=='alipay_yuebao'||relation.activity!=='funding_outflow'||relation.role!=='funding'||fund?.status!=='active'||fund.type!=='investment'||fund.sourceProduct!=='alipay_yuebao'||fund.provider!=='alipay'||fund.currency!=='CNY'||t.status!=='completed'||!['expense','transfer'].includes(t.kind)||t.observationIds?.length!==1||t.sources?.length!==1||t.sources[0].id!==s.id||t.appliedAnnotations?.length||t.reconciliationGroup||t.incomeExpenseAllocations!=null||t.cashPostingEvidence?.length||t.walletIntermediaryPostings?.length||t.balanceEffectEvents||t.cashEffectEvents||BigInt(t.incomeMinor||0)!==0n||BigInt(t.consumptionMinor||0)!==(t.kind==='expense'?n:0n)||BigInt(t.balanceEffects[fund.id]||0)!==-n||BigInt(t.cashEffects[fund.id]||0)!==-n||[t.balanceEffects,t.cashEffects].some(m=>Object.entries(m).some(([id,v])=>id!==fund.id&&BigInt(v)!==0n)))continue;
  if(!/^\d{14,40}$/.test(s.sourceTransactionId)||r['\u4ea4\u6613\u65f6\u95f4']!==s.date+' '+s.occurredAt.slice(11,19)||r['\u4ea4\u6613\u8ba2\u5355\u53f7']!==s.sourceTransactionId||r['\u5546\u54c1\u8bf4\u660e']!==s.description||r['\u6536/\u652f']!=='\u652f\u51fa'||r['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||r['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!=='\u4f59\u989d\u5b9d'||r['\u91d1\u989d']!==(n/100n)+'.'+String(n%100n).padStart(2,'0')||[s.feeMinor,s.interestMinor,s.principalMinor].some(v=>v!=null&&v!=='0'))continue;
  if(sources.filter(o=>o.financialAccountId===wallet.id&&o.date===s.date&&o.amountMinor===s.amountMinor).length!==1)continue;
  const matches=proofs.filter(p=>p.observation.financialAccountId===wallet.id&&p.observation.date===s.date&&p.observation.description==='\u53d1\u7ea2\u5305'&&p.bank==='\u652f\u4ed8\u5b9d'&&p.incoming===0n&&p.outgoing===-n);if(matches.length!==1)continue;
  const negative=matches[0],debit=negative.observation,positive=seq.get(JSON.stringify([wallet.id,debit.importId,debit.balanceEvidence.sequence-1])),credit=positive?.observation,delay=Date.parse(debit.occurredAt)-Date.parse(s.occurredAt),gap=Date.parse(debit.occurredAt)-Date.parse(credit?.occurredAt);
  if(!positive||!clean(credit)||!clean(debit)||claimed.has(credit.id)||claimed.has(debit.id)||credit.date!==s.date||positive.incoming!==n||positive.outgoing!==0n||positive.bank!=='\u5929\u5f18\u57fa\u91d1'||credit.description!==funded||gap<0||gap>2000||delay<0||delay>60000||!/^\d{14,40}$/.test(debit.relatedReference)||debit.relatedReference===s.sourceTransactionId||!new RegExp('^'+s.date.replace(/-/g,'')+'0002510525\\d+\\*{3}\\d+$').test(credit.relatedReference))continue;
  if(rows.some(o=>o.provider==='alipay'&&!o.balanceEvidence&&o.financialAccountId===wallet.id&&[o.sourceTransactionId,o.relatedReference].includes(debit.relatedReference)))continue;
  proposals.push({s,t,wallet,fund,n,positive,negative,credit,debit,delay});
 }
 const uses=new Map();for(const p of proposals)for(const o of[p.s,p.credit,p.debit])uses.set(key(o),(uses.get(key(o))||0)+1);
 for(const p of proposals){if([p.s,p.credit,p.debit].some(o=>uses.get(key(o))!==1))continue;
  const evidence={matchingBasis:'reciprocal_unique_same_day_amount_product_and_personal_packet_type',confidence:'owner_authorized_inferred',reciprocalUnique:true,sourceOrderReference:p.s.sourceTransactionId,nativeDebitOrderReference:p.debit.relatedReference,sourceOrderReferenceMatched:false,sourceFundingProduct:'alipay_yuebao',fundingAccountId:p.fund.id,sourceEconomicPurposePreserved:true,noNewFundOrBankCash:true,orderToRedemptionDelaySeconds:p.delay/1000};
  plans.set(p.t.id,[{financialAccountId:p.wallet.id,sourceObservationId:p.s.id,method:'native_wallet_intermediary_postings',path:'funded_personal_packet_via_wallet',confidence:'inferred_unique_personal_packet_and_adjacent_explicit_yuebao_cash',cashEvidenceConfidence:'explicit_original_cash_postings',amountMinor:String(p.n),netDeltaMinor:'0',proofObservationIds:[p.credit.id,p.debit.id],personalPacketMatchEvidence:evidence,reversible:true,events:[p.positive,p.negative].map(q=>({occurredAt:q.observation.occurredAt,date:q.observation.date,deltaMinor:q.delta,observationId:q.observation.id}))}]);
 }
 return plans;
}
module.exports={addNativePersonalPacketBridges};
