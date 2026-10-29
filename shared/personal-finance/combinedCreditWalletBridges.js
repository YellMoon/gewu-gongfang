'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const {validateHistoricalCardBindings,historicalCardBindingValid}=require('./historicalCardBindings');
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd/,'');
const nonzero=map=>Object.entries(map||{}).filter(([,n])=>BigInt(n)!==0n);

// Both purchases already have their real card-funded economic effects. This
// adds only the exact native wallet transit, once, without creating card debt.
function addCombinedCreditWalletBridges(ledger,transactions,plans){
 const am=new Map((ledger.accounts||[]).map(a=>[a.id,a])),byId=new Map((ledger.observations||[]).map(o=>[o.id,o]));
 if(![...am.values()].some(a=>a.type==='credit_card')||![...byId.values()].some(o=>o.balanceEvidence))return plans;
 const latest=new Map(),ties=new Set(),edited=new Set(),claimed=new Set(),roots=new Map();
 for(const o of byId.values()){
  const k=identity(o),prior=latest.get(k),v=o.sourceVersionOrdinal||0;
  if(!prior||v>(prior.sourceVersionOrdinal||0)){latest.set(k,o);ties.delete(k);}
  else if(v===(prior.sourceVersionOrdinal||0)&&o.id!==prior.id)ties.add(k);
 }
 for(const a of ledger.annotations||[]){const o=byId.get(a.observationId);if(o)edited.add(identity(o));}
 for(const l of ledger.links||[])if(l.status!=='deleted'||['duplicate','transfer'].includes(l.type))for(const id of l.observationIds||[]){const o=byId.get(id);if(o)edited.add(identity(o));}
 for(const t of transactions){
  for(const id of t.observationIds||[]){if(!roots.has(id))roots.set(id,[]);roots.get(id).push(t);claimed.add(id);}
  for(const e of t.cashPostingEvidence||[])claimed.add(e.proofObservationId);
  for(const p of t.walletIntermediaryPostings||[])for(const id of p.proofObservationIds||[])claimed.add(id);
  for(const events of Object.values(t.balanceEffectEvents||{}))for(const e of events)if(e.observationId)claimed.add(e.observationId);
 }
 for(const list of plans.values())for(const p of list)for(const id of p.proofObservationIds||[])claimed.add(id);
 const rows=[...latest.values()],proofs=validatedWalletProofs(rows,am),seq=new Map(),orders=new Map(),refs=new Map(),policies=new Map();
 const refkey=(wallet,ref)=>JSON.stringify([wallet,ref]);
 for(const a of am.values())if(a.historicalCardBindings){try{policies.set(a.id,validateHistoricalCardBindings(a.historicalCardBindings));}catch{}}
 for(const p of proofs){const o=p.observation;seq.set(JSON.stringify([o.financialAccountId,o.importId,o.balanceEvidence.sequence]),p);const k=refkey(o.financialAccountId,o.relatedReference);if(!refs.has(k))refs.set(k,[]);refs.get(k).push(p);}
 for(const o of rows)if(o.provider==='alipay'&&!o.balanceEvidence&&o.sourceTransactionId){const k=refkey(o.financialAccountId,o.sourceTransactionId);if(!orders.has(k))orders.set(k,[]);orders.get(k).push(o);}
 const clean=o=>o&&latest.get(identity(o))?.id===o.id&&!ties.has(identity(o))&&!edited.has(identity(o));
 const free=p=>clean(p?.observation)&&!claimed.has(p.observation.id),proposals=[];
 for(const charge of proofs){
  const credit=charge.observation,wallet=am.get(credit.financialAccountId),n=charge.incoming;
  if(!free(charge)||n<=0n||charge.outgoing!==0n||credit.description!=='\u5145\u503c'||!charge.bank.endsWith('\u94f6\u884c')||wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.sourceProduct||wallet.currency!=='CNY'||!new RegExp('^'+credit.date.replace(/-/g,'')+'\\d+\\*+\\d+$').test(credit.relatedReference))continue;
  const members=[];let total=0n,paidAt=null,originalAt=null,card=null,rule=null,valid=true;
  for(let i=1;i<=32&&total<n;i++){
   const payment=seq.get(JSON.stringify([wallet.id,credit.importId,credit.balanceEvidence.sequence+i])),debit=payment?.observation;
   if(!payment||!free(payment)||payment.incoming!==0n||payment.outgoing>=0n||payment.bank!=='\u652f\u4ed8\u5b9d'||debit.description!=='\u5728\u7ebf\u652f\u4ed8'||debit.date!==credit.date||!/^\d{14,40}$/.test(debit.relatedReference)||paidAt&&paidAt!==debit.occurredAt||refs.get(refkey(wallet.id,debit.relatedReference))?.length!==1){valid=false;break;}
   const gap=Date.parse(debit.occurredAt)-Date.parse(credit.occurredAt),sources=orders.get(refkey(wallet.id,debit.relatedReference))||[];
   if(gap<0||gap>2000||sources.length!==1){valid=false;break;}
   const s=sources[0],matches=roots.get(s.id)||[],t=matches[0],raw=s.rawFields||{},amount=-payment.outgoing;
   const c=am.get(t?.automaticFunding?.financialAccountId),delay=Date.parse(debit.occurredAt)-Date.parse(s.occurredAt);
   if(matches.length!==1||!clean(s)||s.currency!=='CNY'||s.status!=='completed'||s.direction!=='debit'||s.amountMinor!==String(amount)||s.date!==credit.date||s.accountRelations?.length||s.investmentTrade||s.loanProof||[s.feeMinor,s.interestMinor,s.principalMinor].some(v=>v!=null&&v!=='0')||originalAt&&originalAt!==s.occurredAt||delay<0||delay>60000||norm(s.paymentChannel)!==norm(charge.bank)||s.paymentAccountHint||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==debit.relatedReference||raw['\u4ea4\u6613\u65f6\u95f4']!==s.date+' '+s.occurredAt.slice(11,19)||raw['\u6536/\u652f']!=='\u652f\u51fa'||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||raw['\u5546\u54c1\u8bf4\u660e']!==s.description||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==s.paymentChannel||!/^\d+\.\d{2}$/.test(raw['\u91d1\u989d']||'')||BigInt(raw['\u91d1\u989d'].replace('.',''))!==amount){valid=false;break;}
   if(t.kind!=='expense'||t.status!=='completed'||t.currency!=='CNY'||BigInt(t.consumptionMinor)!==amount||BigInt(t.incomeMinor)!==0n||t.incomeExpenseAllocations!=null||t.observationIds?.length!==1||t.sources?.length!==1||t.sources[0].id!==s.id||t.reconciliationGroup||t.appliedAnnotations?.length||t.cashPostingEvidence?.length||t.walletIntermediaryPostings?.length||t.balanceEffectEvents||t.cashEffectEvents||plans.has(t.id)||t.automaticFunding?.method!=='owner_historical_card_binding'||c?.status!=='active'||c.type!=='credit_card'||c.currency!=='CNY'||norm(c.provider)!==norm(charge.bank)||!/^\d{4}$/.test(c.maskedIdentifier||'')||card&&card.id!==c.id||nonzero(t.balanceEffects).length!==1||BigInt(t.balanceEffects[c.id]||0)!==-amount||nonzero(t.cashEffects).length){valid=false;break;}
   const rules=(policies.get(wallet.id)?.rules||[]).filter(r=>r.usage!=='repayment_target'&&norm(r.channel)===norm(charge.bank)&&norm(r.institution)===norm(charge.bank)&&r.financialAccountId===c.id&&r.periodStart<=s.date&&r.periodEnd>=s.date&&(!r.sourceTransactionIds||r.sourceTransactionIds.includes(s.sourceTransactionId))&&historicalCardBindingValid(wallet,c,r));
   if(rules.length!==1||rule&&JSON.stringify(rule)!==JSON.stringify(rules[0])){valid=false;break;}
   card=c;rule=rules[0];paidAt=debit.occurredAt;originalAt=s.occurredAt;total+=amount;members.push({source:s,root:t,payment});
  }
  if(!valid||total!==n||members.length<2||new Set(members.map(m=>m.source.id)).size!==members.length)continue;
  const next=seq.get(JSON.stringify([wallet.id,credit.importId,credit.balanceEvidence.sequence+members.length+1]));
  if(next&&next.observation.occurredAt===paidAt&&next.outgoing<0n)continue;
  const sponsors=proofs.filter(p=>p.observation.financialAccountId===wallet.id&&p.observation.importId===credit.importId&&p.incoming>0n&&p.bank.endsWith('\u94f6\u884c')&&Date.parse(paidAt)-Date.parse(p.observation.occurredAt)>=0&&Date.parse(paidAt)-Date.parse(p.observation.occurredAt)<=2000);
  if(sponsors.length!==1||rows.some(o=>!o.balanceEvidence&&(o.statementFlow||o.bankStatement)&&o.financialAccountId===card.id&&o.status==='completed'&&o.direction==='debit'&&[String(n),...members.map(m=>m.source.amountMinor)].includes(o.amountMinor)&&Math.abs(Date.parse(o.date)-Date.parse(credit.date))<=86400000))continue;
  proposals.push({charge,credit,wallet,card,rule,members,n});
 }
 const uses=new Map();for(const p of proposals)for(const o of [p.credit,...p.members.flatMap(m=>[m.source,m.payment.observation])])uses.set(identity(o),(uses.get(identity(o))||0)+1);
 for(const p of proposals){
  if([p.credit,...p.members.flatMap(m=>[m.source,m.payment.observation])].some(o=>uses.get(identity(o))!==1))continue;
  const cash=[p.charge,...p.members.map(m=>m.payment)],first=p.members[0];
  plans.set(first.root.id,[{financialAccountId:p.wallet.id,sourceObservationId:first.source.id,method:'native_wallet_intermediary_postings',path:'combined_credit_top_up_and_exact_order_payments',confidence:'exact_native_cash_references_and_existing_owner_card_policy',cashEvidenceConfidence:'explicit_original_cash_postings',amountMinor:String(p.n),netDeltaMinor:'0',proofObservationIds:cash.map(q=>q.observation.id),sourceOrderObservationIds:p.members.map(m=>m.source.id),payerAccountId:p.card.id,payerIdentityBasis:'existing_owner_historical_card_binding',cardIdentityConfidence:p.rule.confidence,nativeStatementCardTailPrinted:false,originalConsumptionAndCardDebtPreserved:true,reversible:true,events:cash.map(q=>({occurredAt:q.observation.occurredAt,date:q.observation.date,deltaMinor:q.delta,observationId:q.observation.id}))}]);
 }
 return plans;
}
module.exports={addCombinedCreditWalletBridges};
