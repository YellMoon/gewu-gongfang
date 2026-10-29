'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const {validateHistoricalCardBindings,historicalCardBindingValid}=require('./historicalCardBindings');
const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe|\u5de5\u5546|\u519c\u4e1a|\u6c11\u751f)/,'');
const minor=v=>/^\d+\.\d{2}$/.test(v||'')?String(BigInt(v.replace('.',''))):null;
const payment=p=>p.bank==='\u652f\u4ed8\u5b9d'&&p.incoming===0n&&p.outgoing<0n&&/^\d{14,40}$/.test(p.observation.relatedReference)&&(p.observation.description==='\u5728\u7ebf\u652f\u4ed8'||p.observation.description.startsWith('\u652f\u4ed8-'));
const refund=p=>p.bank==='\u652f\u4ed8\u5b9d'&&p.incoming>0n&&p.outgoing===0n&&/^(?:\u9000\u6b3e-.+|\u4ea4\u6613\u9000\u6b3e(?:[A-Za-z][A-Za-z0-9_-]*)?)$/.test(p.observation.description);
function planNativeCombinedOrderCash(ledger,transactions){
 const originals=ledger.observations||[];if(!originals.some(o=>!o.balanceEvidence&&o.provider==='alipay'&&o.status==='failed'&&o.rawFields?.['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u5173\u95ed'))return [];
 const am=new Map((ledger.accounts||[]).map(a=>[a.id,a])),latest=new Map(),byId=new Map(originals.map(o=>[o.id,o])),ties=new Set(),blocked=new Set(),roots=new Map(),claimed=new Set(),policies=new Map();
 for(const o of originals){const k=key(o),old=latest.get(k),v=o.sourceVersionOrdinal||0;if(!old||v>(old.sourceVersionOrdinal||0)){latest.set(k,o);ties.delete(k);}else if(v===(old.sourceVersionOrdinal||0)&&o.id!==old.id)ties.add(k);}
 for(const a of ledger.annotations||[]){const o=byId.get(a.observationId);if(o)blocked.add(key(o));}
 for(const l of ledger.links||[]){const deleted=l.status==='deleted'||l.deletedAt||l.deleted===true;if(!deleted||['duplicate','transfer'].includes(l.type))for(const id of l.observationIds||[]){const o=byId.get(id);if(o)blocked.add(key(o));}}
 for(const a of am.values())if(a.historicalCardBindings){try{policies.set(a.id,validateHistoricalCardBindings(a.historicalCardBindings));}catch{/* No inference from invalid identity rules. */}}
 for(const t of transactions){
  for(const id of t.observationIds||[])roots.set(id,t);
  for(const p of t.cashPostingEvidence||[])claimed.add(p.proofObservationId);
  for(const p of t.walletIntermediaryPostings||[])for(const id of p.proofObservationIds||[])claimed.add(id);
  for(const events of Object.values(t.balanceEffectEvents||{}))for(const e of events)if(e.observationId)claimed.add(e.observationId);
 }
 const rows=[...latest.values()],proofs=validatedWalletProofs(rows,am),refKey=(id,ref)=>JSON.stringify([id,ref]),orders=new Map(),refs=new Map(),sequences=new Map(),signatures=new Map(),bankCash=new Set();
 const signature=p=>JSON.stringify([p.observation.financialAccountId,p.observation.relatedReference,p.observation.occurredAt,p.observation.description,String(p.delta)]);
 for(const p of proofs){const o=p.observation,k=refKey(o.financialAccountId,o.relatedReference);if(!refs.has(k))refs.set(k,[]);refs.get(k).push(p);sequences.set(JSON.stringify([o.financialAccountId,o.importId,o.balanceEvidence.sequence]),p);const sig=signature(p);signatures.set(sig,(signatures.get(sig)||0)+1);}
 for(const o of rows){
  if(o.provider==='alipay'&&!o.balanceEvidence&&o.sourceTransactionId){const k=refKey(o.financialAccountId,o.sourceTransactionId);if(!orders.has(k))orders.set(k,[]);orders.get(k).push(o);}
  if(!o.balanceEvidence&&(o.statementFlow||o.bankStatement)&&['debit','credit'].includes(o.direction)&&['credit_card','debit_card','bank','savings'].includes(am.get(o.financialAccountId)?.type)&&!o.bankStatement?.nonCash)bankCash.add(JSON.stringify([o.financialAccountId,o.date,o.amountMinor]));
 }
 const unused=p=>!roots.has(p.observation.id)&&!claimed.has(p.observation.id)&&!blocked.has(key(p.observation))&&!ties.has(key(p.observation))&&signatures.get(signature(p))===1,proposals=[];
 for(const charge of proofs){
  const c=charge.observation,wallet=am.get(c.financialAccountId);if(charge.incoming<=0n||charge.outgoing!==0n||c.description!=='\u5145\u503c'||wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.sourceProduct||wallet.currency!=='CNY'||!unused(charge)||!/^\d{8}\d+\*+\d+$/.test(c.relatedReference)||!c.relatedReference.startsWith(c.date.replace(/-/g,'')))continue;
  const payments=[];let sum=0n,next,valid=true;
  for(let i=1;i<=32;i++){
   next=sequences.get(JSON.stringify([c.financialAccountId,c.importId,c.balanceEvidence.sequence+i]));
   if(!next||!payment(next)||!unused(next)||next.observation.date!==c.date||payments.length&&next.observation.occurredAt!==payments[0].observation.occurredAt){valid=false;break;}
   const delay=Date.parse(next.observation.occurredAt)-Date.parse(c.occurredAt);if(delay<0||delay>60000){valid=false;break;}
   payments.push(next);sum-=next.outgoing;if(sum>=charge.incoming)break;
  }
  if(!valid||payments.length<2||sum!==charge.incoming)continue;
  const after=sequences.get(JSON.stringify([c.financialAccountId,c.importId,c.balanceEvidence.sequence+payments.length+1]));
  if(after&&payment(after)&&after.observation.occurredAt===payments[0].observation.occurredAt)continue;
  const members=[],refunds=[];let closedTotal=0n;
  for(const p of payments){
   const candidates=orders.get(refKey(c.financialAccountId,p.observation.relatedReference))||[];if(candidates.length!==1){valid=false;break;}
   const o=candidates[0],raw=o.rawFields||{},root=roots.get(o.id),delay=Date.parse(p.observation.occurredAt)-Date.parse(o.occurredAt);
   if(o.currency!=='CNY'||o.direction!=='debit'||o.date!==c.date||o.date!==o.occurredAt.slice(0,10)||!o.occurredAt.endsWith('+08:00')||o.amountMinor!==String(-p.outgoing)||o.paymentAccountHint||o.accountRelations?.length||o.investmentTrade||o.loanProof||blocked.has(key(o))||ties.has(key(o))||!root||root.observationIds.length!==1||root.observationIds[0]!==o.id||root.currency!=='CNY'||delay<0||delay>60000||Object.keys(root.cashEffects).length||root.walletIntermediaryPostings?.length||root.balanceEffectEvents||root.cashPostingEvidence?.length||[o.feeMinor,o.interestMinor].some(v=>v!==null&&v!==undefined&&v!=='0')){valid=false;break;}
   if(norm(o.paymentChannel)!==charge.bank||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==o.sourceTransactionId||raw['\u4ea4\u6613\u65f6\u95f4']!==o.occurredAt.slice(0,19).replace('T',' ')||raw['\u5546\u54c1\u8bf4\u660e']!==o.description||raw['\u6536/\u652f']!=='\u652f\u51fa'||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==o.paymentChannel||minor(raw['\u91d1\u989d'])!==o.amountMinor){valid=false;break;}
   const all=refs.get(refKey(c.financialAccountId,o.sourceTransactionId))||[];
   const legacyPaid=o.kind==='transfer'&&root.automaticClassification?.method==='explicit_legacy_alipay_paid_order'&&require('./legacyAlipayPurchases').isLegacyAlipayPurchase(o);
   if(o.status==='completed'&&(o.kind==='expense'||legacyPaid)&&raw['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'){
    if(all.length!==1||all[0]!==p||root.kind!=='expense'||root.status!=='completed'||BigInt(root.consumptionMinor)!==BigInt(o.amountMinor)||BigInt(root.incomeMinor)!==0n||root.reportingAccountIds.length!==1||root.automaticFunding?.method!=='owner_historical_card_binding'){valid=false;break;}
   }else if(o.status==='failed'&&o.kind==='transfer'&&raw['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u5173\u95ed'){
    const credits=all.filter(refund);if(!credits.length||all.length!==credits.length+1||!all.includes(p)||credits.reduce((n,q)=>n+q.incoming,0n)!==BigInt(o.amountMinor)||credits.some(q=>!unused(q)||Date.parse(q.observation.occurredAt)<Date.parse(p.observation.occurredAt)||Date.parse(q.observation.occurredAt)-Date.parse(p.observation.occurredAt)>2*86400000)||root.status!=='failed'||BigInt(root.consumptionMinor)!==0n||BigInt(root.incomeMinor)!==0n||Object.keys(root.balanceEffects).length){valid=false;break;}
    closedTotal+=BigInt(o.amountMinor);refunds.push(...credits);
   }else{valid=false;break;}
   members.push({source:o,root,proof:p});
  }
  if(!valid||closedTotal<=0n||closedTotal>=charge.incoming)continue;
  const matchingRules=(policies.get(wallet.id)?.rules||[]).filter(rule=>rule.usage!=='repayment_target'&&rule.type==='credit_card'&&norm(rule.channel)===charge.bank&&norm(rule.institution)===charge.bank&&members.every(m=>rule.periodStart<=m.source.date&&rule.periodEnd>=m.source.date&&(!rule.sourceTransactionIds||rule.sourceTransactionIds.includes(m.source.sourceTransactionId)))&&historicalCardBindingValid(wallet,am.get(rule.financialAccountId),rule));
  if(matchingRules.length!==1)continue;const rule=matchingRules[0],card=am.get(rule.financialAccountId);
  if(!/^\d{4}$/.test(card.maskedIdentifier||'')||members.some(m=>m.source.status==='completed'&&(m.root.automaticFunding.financialAccountId!==card.id||m.root.reportingAccountIds[0]!==card.id||Object.keys(m.root.balanceEffects).length!==1||BigInt(m.root.balanceEffects[card.id]||0)!==-BigInt(m.source.amountMinor))))continue;
  const chargeRows=refs.get(refKey(c.financialAccountId,c.relatedReference))||[],returns=chargeRows.filter(q=>q.incoming===0n&&q.outgoing===-closedTotal&&q.bank===charge.bank&&q.observation.description==='\u5145\u503c\u9000\u56de');if(chargeRows.length!==2||returns.length!==1||!unused(returns[0]))continue;
  const returned=returns[0],ret=returned.observation,lastRefund=Math.max(...refunds.map(q=>Date.parse(q.observation.occurredAt))),delay=Date.parse(ret.occurredAt)-lastRefund;if(delay<0||delay>2*86400000)continue;
  const amounts=new Set([String(charge.incoming),String(closedTotal),...members.map(m=>m.source.amountMinor)]),dates=new Set();for(const date of[c.date,ret.date])for(let offset=-7;offset<=7;offset++)dates.add(new Date(Date.parse(date)+offset*86400000).toISOString().slice(0,10));
  if([...dates].some(date=>[...amounts].some(amount=>bankCash.has(JSON.stringify([card.id,date,amount])))))continue;
  proposals.push({charge,members,refunds,returned,closedTotal,card,rule});
 }
 const uses=new Map();for(const p of proposals)for(const o of[p.charge.observation,...p.members.flatMap(m=>[m.source,m.proof.observation]),...p.refunds.map(q=>q.observation),p.returned.observation])uses.set(key(o),(uses.get(key(o))||0)+1);
 return proposals.filter(p=>[p.charge.observation,...p.members.flatMap(m=>[m.source,m.proof.observation]),...p.refunds.map(q=>q.observation),p.returned.observation].every(o=>uses.get(key(o))===1));
}
function appendNativeCombinedOrderCash(ledger,transactions,selected,buildRawTransactions){
 const plans=planNativeCombinedOrderCash(ledger,transactions);if(!plans.length)return;
 const derived=[],byId=new Map(),accountIds=new Set(),evidences=new Map();
 for(const p of plans){
  const wallet=p.charge.observation.financialAccountId,allProofs=[p.charge,...p.members.map(m=>m.proof),...p.refunds,p.returned],e={schema:'native-combined-order-cash-v1',method:'exact_shared_bank_topup_order_payment_and_closed_refund_batch',sharedTopUpObservationId:p.charge.observation.id,sharedTopUpMinor:String(p.charge.incoming),sharedOriginalBankReference:p.charge.observation.relatedReference,completedOrderAmountMinor:String(p.charge.incoming-p.closedTotal),closedOrderAmountMinor:String(p.closedTotal),walletAccountId:wallet,bankAccountId:p.card.id,statementBank:p.rule.institution,bankIdentityConfidence:p.rule.confidence,identityPolicyConfirmedAt:p.rule.confirmedAt,identityPolicyPeriodStart:p.rule.periodStart,identityPolicyPeriodEnd:p.rule.periodEnd,bankCardTailPrinted:false,bankPostingDatesVerified:false,referenceVisibility:'masked',fullUnmaskedFundingReferenceVerified:false,parts:p.members.map(m=>({sourceObservationId:m.source.id,sourceTransactionId:m.source.sourceTransactionId,amountMinor:m.source.amountMinor,status:m.source.status,paymentProofObservationId:m.proof.observation.id})),evidenceObservationIds:[...p.members.map(m=>m.source.id),...allProofs.map(q=>q.observation.id)],noNewConsumptionOrIncome:true,reversible:true};evidences.set(p,e);accountIds.add(wallet);accountIds.add(p.card.id);
  const postings=[{proof:p.charge,role:'shared_bank_top_up'},...p.members.filter(m=>m.source.status==='failed').map(m=>({proof:m.proof,role:'closed_order_payment'})),...p.refunds.map(proof=>({proof,role:'closed_order_refund'})),{proof:p.returned,role:'bank_return'}];
  for(const q of postings){const s=q.proof.observation;byId.set(s.id,{...q,plan:p,evidence:{...e,role:q.role}});derived.push({...s,balanceEvidence:undefined,balanceMinor:null,amountMinor:String(q.proof.delta<0n?-q.proof.delta:q.proof.delta),direction:q.proof.delta>0n?'credit':'debit',kind:'transfer',paymentChannel:'\u4f59\u989d',paymentAccountHint:'',category:'\u5408\u5e76\u4ed8\u6b3e\u4e0e\u5173\u95ed\u8ba2\u5355\u8d44\u91d1\u5f80\u6765',relatedReference:''});}
 }
 const accounts=ledger.accounts.filter(a=>accountIds.has(a.id)).map(a=>Object.fromEntries(['id','label','type','provider','status','currency','maskedIdentifier'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]))),added=buildRawTransactions({accounts,observations:derived,annotations:[],links:[],imports:[],balanceSnapshots:[]},{accountIds:[...selected]});
 if(added.length!==derived.length)throw new Error('NATIVE_COMBINED_CASH_UNEXPECTED_MERGE');
 for(const t of added){const q=byId.get(t.id),wallet=q?.plan.charge.observation.financialAccountId;if(!q||t.observationIds.length!==1||t.consumptionMinor!==0n||t.incomeMinor!==0n||t.balanceEffects[wallet]!==q.proof.delta||t.cashEffects[wallet]!==q.proof.delta)throw new Error('NATIVE_COMBINED_CASH_MISMATCH');}
 const trace=(proof,e)=>({method:e.method,proofObservationId:proof.observation.id,financialAccountId:e.walletAccountId,deltaMinor:String(proof.delta),occurredAt:proof.observation.occurredAt,date:proof.observation.date,confidence:'explicit_original_cash_posting',reversible:true});
 for(const p of plans)for(const m of p.members.filter(m=>m.source.status==='completed')){
  const t=m.root,wallet=p.charge.observation.financialAccountId,card=p.card.id,e={...evidences.get(p),role:'completed_order_payment',bankBalancePostedOnceAtSharedTopUp:true,originalDirectBankBalanceEffectMinor:String(t.balanceEffects[card]),originalDirectBankEffectTime:t.balanceEffectTimes[card]};
  t.balanceEffects={...t.balanceEffects};delete t.balanceEffects[card];t.balanceEffects[wallet]=m.proof.delta;t.balanceEffectTimes={...t.balanceEffectTimes};delete t.balanceEffectTimes[card];t.balanceEffectTimes[wallet]=m.proof.observation.occurredAt;t.cashEffects={...t.cashEffects,[wallet]:m.proof.delta};t.financialAccountIds=[...new Set([...t.financialAccountIds,wallet,card])];t.sources=[...t.sources,m.proof.observation];t.observationIds=[...t.observationIds,m.proof.observation.id];if(selected.has(wallet))t.selectedObservationIds=[...t.selectedObservationIds,m.proof.observation.id];t.nativeCombinedOrderCash=e;t.cashPostingEvidence=[trace(m.proof,e)];t.automaticAssociations=[...t.automaticAssociations,{method:e.method,confidence:'inferred_owner_historical_card_and_exact_native_batch',observationIds:e.evidenceObservationIds,evidence:e}];
 }
 for(const t of added){const q=byId.get(t.id),e=q.evidence;if(['shared_bank_top_up','bank_return'].includes(q.role)){t.balanceEffects[q.plan.card.id]=-q.proof.delta;t.balanceEffectTimes[q.plan.card.id]=q.proof.observation.occurredAt;t.financialAccountIds=[...new Set([...t.financialAccountIds,q.plan.card.id])];}t.sources=[q.proof.observation];t.nativeCombinedOrderCash=e;t.cashPostingEvidence=[trace(q.proof,e)];transactions.push(t);}
}
module.exports={planNativeCombinedOrderCash,appendNativeCombinedOrderCash};
