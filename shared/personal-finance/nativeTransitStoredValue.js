'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const {withWalletIntermediaryPostings}=require('./walletIntermediaryPostings');
const KEY='alipay_hangzhou_transit',LABEL='\u676d\u5dde\u901a\u7535\u5b50\u516c\u4ea4\u5361',PROVIDER='\u676d\u5dde\u5e02\u6c11\u5361',TOPUP=LABEL+'\u5145\u503c';
const minor=v=>/^\d+\.\d{2}$/.test(v||'')?String(BigInt(v.replace('.',''))):null;
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const refKey=(wallet,ref)=>JSON.stringify([wallet,ref]);
function namedTransitTopUp(o){
 const r=o.rawFields||{};
 return o.provider==='alipay'&&o.status==='completed'&&o.kind==='transfer'&&o.direction==='debit'&&o.currency==='CNY'&&o.description===TOPUP&&o.counterparty===PROVIDER&&o.paymentChannel==='\u4f59\u989d\u5b9d'&&!o.paymentAccountHint&&/^\d{14,40}$/.test(o.sourceTransactionId||'')&&/^\d+$/.test(o.relatedReference||'')&&o.amountMinor!=='0'&&minor(r['\u91d1\u989d'])===o.amountMinor&&r['\u4ea4\u6613\u8ba2\u5355\u53f7']===o.sourceTransactionId&&r['\u5546\u5bb6\u8ba2\u5355\u53f7']===o.relatedReference&&r['\u4ea4\u6613\u65f6\u95f4']===o.occurredAt.slice(0,19).replace('T',' ')&&o.occurredAt.startsWith(o.date+'T')&&o.occurredAt.endsWith('+08:00')&&r['\u5546\u54c1\u8bf4\u660e']===TOPUP&&r['\u4ea4\u6613\u5bf9\u65b9']===PROVIDER&&r['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&r['\u6536/\u652f']==='\u652f\u51fa'&&r['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===o.paymentChannel&&r['\u4ea4\u6613\u5206\u7c7b']==='\u4ea4\u901a\u51fa\u884c'&&[o.feeMinor,o.interestMinor].every(v=>v===null||v===undefined||v==='0');
}
function namedTransitAccount(a){return a.provider===PROVIDER&&a.type==='other'&&a.currency==='CNY'&&(a.sourceProduct===KEY||!a.sourceProduct&&a.label===LABEL)&&a.maskedIdentifier==='';}
function transitAccountProposal(observations,accounts){
 if(!observations.some(namedTransitTopUp)||accounts.some(namedTransitAccount))return null;
 return{key:KEY+':CNY',label:LABEL,provider:PROVIDER,type:'other',sourceProduct:KEY,currency:'CNY',maskedIdentifier:'',status:'active',openingBalanceMinor:null,openingDate:null,balanceConvention:'signed'};
}
function planNativeTransitStoredValue(ledger,transactions){
 const originals=ledger.observations||[];if(!originals.some(namedTransitTopUp))return [];
 const am=new Map((ledger.accounts||[]).map(a=>[a.id,a])),byId=new Map(originals.map(o=>[o.id,o])),latest=new Map(),ties=new Set(),blocked=new Set(),roots=new Map(),claims=new Map();
 for(const o of originals){const k=identity(o),p=latest.get(k),v=o.sourceVersionOrdinal||0;if(!p||v>(p.sourceVersionOrdinal||0)){latest.set(k,o);ties.delete(k);}else if(v===(p.sourceVersionOrdinal||0)&&o.id!==p.id)ties.add(k);}
 for(const a of ledger.annotations||[]){const o=byId.get(a.observationId);if(o)blocked.add(identity(o));}
 for(const l of ledger.links||[]){const deleted=l.status==='deleted'||l.deletedAt||l.deleted===true;if(!deleted||['duplicate','transfer'].includes(l.type))for(const id of l.observationIds||[]){const o=byId.get(id);if(o)blocked.add(identity(o));}}
 const claim=(id,root)=>{if(!claims.has(id))claims.set(id,new Set());claims.get(id).add(root);};
 for(const t of transactions){
  for(const id of t.observationIds||[]){roots.set(id,t);claim(id,t.id);}
  for(const p of t.cashPostingEvidence||[])claim(p.proofObservationId,t.id);
  for(const p of t.walletIntermediaryPostings||[])for(const id of p.proofObservationIds||[])claim(id,t.id);
  for(const events of Object.values(t.balanceEffectEvents||{}))for(const e of events)if(e.observationId)claim(e.observationId,t.id);
 }
 const rows=[...latest.values()],proofs=validatedWalletProofs(rows,am),refs=new Map(),sequences=new Map(),orders=new Map(),signatures=new Map();
 const signature=p=>JSON.stringify([p.observation.financialAccountId,p.observation.relatedReference,p.observation.occurredAt,p.observation.description,String(p.delta)]);
 for(const p of proofs){const o=p.observation,k=refKey(o.financialAccountId,o.relatedReference);if(!refs.has(k))refs.set(k,[]);refs.get(k).push(p);sequences.set(JSON.stringify([o.financialAccountId,o.importId,o.balanceEvidence.sequence]),p);const sig=signature(p);signatures.set(sig,(signatures.get(sig)||0)+1);}
 for(const o of rows)if(o.provider==='alipay'&&!o.balanceEvidence&&o.sourceTransactionId){const k=refKey(o.financialAccountId,o.sourceTransactionId);if(!orders.has(k))orders.set(k,[]);orders.get(k).push(o);}
 const usable=(p,t)=>p&&!blocked.has(identity(p.observation))&&!ties.has(identity(p.observation))&&signatures.get(signature(p))===1&&[...(claims.get(p.observation.id)||[])].every(id=>id===t.id);
 const bridgeState=(t,w,ps)=>{
  if(BigInt(t.balanceEffects[w]||0)!==0n||BigInt(t.cashEffects[w]||0)!==0n)return null;
  const events=t.balanceEffectEvents?.[w];
  if(events)return events.length===2&&events.every((e,i)=>e.observationId===ps[i].observation.id&&BigInt(e.deltaMinor)===ps[i].delta&&e.occurredAt===ps[i].observation.occurredAt)?'present':null;
  return t.walletIntermediaryPostings?.some(p=>p.financialAccountId===w)||t.cashEffectEvents?.[w]?null:'missing';
 };
 const plans=[];
 for(const o of rows.filter(namedTransitTopUp)){
  const wallet=am.get(o.financialAccountId),top=roots.get(o.id),candidates=orders.get(refKey(o.financialAccountId,o.sourceTransactionId))||[],r=o.accountRelations?.[0],fund=am.get(r?.financialAccountId);
  if(candidates.length!==1||wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.currency!=='CNY'||wallet.sourceProduct||!top||top.observationIds.length!==1||top.kind!=='transfer'||top.status!=='completed'||BigInt(top.consumptionMinor)!==0n||BigInt(top.incomeMinor)!==0n||top.nativeTransitStoredValue||blocked.has(identity(o))||ties.has(identity(o)))continue;
  if(o.accountRelations?.length!==1||r.product!=='alipay_yuebao'||r.activity!=='funding_outflow'||r.role!=='funding'||fund?.sourceProduct!==r.product||fund.status!=='active'||fund.type!=='investment'||fund.provider!=='alipay'||fund.currency!=='CNY'||top.balanceEffects[fund.id]!==-BigInt(o.amountMinor)&&top.balanceEffects[fund.id]!==String(-BigInt(o.amountMinor))||top.cashEffects[fund.id]!==-BigInt(o.amountMinor)&&top.cashEffects[fund.id]!==String(-BigInt(o.amountMinor))||Object.keys(top.balanceEffects).some(id=>![wallet.id,fund.id].includes(id)))continue;
  const returns=rows.filter(s=>!s.balanceEvidence&&s.provider==='alipay'&&s.financialAccountId===wallet.id&&s.sourceTransactionId?.startsWith(o.sourceTransactionId+'_'));if(returns.length!==1)continue;
  const s=returns[0],raw=s.rawFields||{},ret=roots.get(s.id),rel=s.accountRelations?.[0];
  if(s.kind!=='refund'||s.status!=='completed'||s.direction!=='neutral'||s.currency!=='CNY'||s.description!=='\u9000\u6b3e-'+TOPUP||s.counterparty!==PROVIDER||s.paymentChannel!=='\u4f59\u989d\u5b9d'||s.paymentAccountHint||s.relatedReference!==o.relatedReference||!/^\d+$/.test(s.sourceTransactionId.slice(o.sourceTransactionId.length+1))||BigInt(s.amountMinor)<=0n||BigInt(s.amountMinor)>BigInt(o.amountMinor)||s.date<o.date||!s.occurredAt.startsWith(s.date+'T')||!s.occurredAt.endsWith('+08:00')||s.accountRelations?.length!==1||rel.product!==r.product||rel.activity!=='funding_inflow'||rel.role!=='funding'||rel.financialAccountId!==fund.id||[s.feeMinor,s.interestMinor].some(v=>v!==null&&v!==undefined&&v!=='0')||blocked.has(identity(s))||ties.has(identity(s)))continue;
  if(raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==s.sourceTransactionId||raw['\u5546\u5bb6\u8ba2\u5355\u53f7']!==s.relatedReference||raw['\u4ea4\u6613\u65f6\u95f4']!==s.occurredAt.slice(0,19).replace('T',' ')||raw['\u5546\u54c1\u8bf4\u660e']!==s.description||raw['\u4ea4\u6613\u5bf9\u65b9']!==PROVIDER||raw['\u4ea4\u6613\u72b6\u6001']!=='\u9000\u6b3e\u6210\u529f'||raw['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!=='\u4f59\u989d\u5b9d'||minor(raw['\u91d1\u989d'])!==s.amountMinor||!ret||ret.observationIds.length!==1||ret.kind!=='refund'||ret.status!=='completed'||BigInt(ret.consumptionMinor)!==-BigInt(s.amountMinor)||BigInt(ret.incomeMinor)!==0n||ret.nativeTransitStoredValue||Object.keys(ret.balanceEffects).length!==1||BigInt(ret.balanceEffects[fund.id]||0)!==BigInt(s.amountMinor)||BigInt(ret.cashEffects[fund.id]||0)!==BigInt(s.amountMinor))continue;
  const exact=refs.get(refKey(wallet.id,o.sourceTransactionId))||[],payments=exact.filter(p=>p.outgoing===-BigInt(o.amountMinor)&&p.incoming===0n&&p.bank==='\u652f\u4ed8\u5b9d'&&p.observation.description==='\u5728\u7ebf\u652f\u4ed8'&&p.observation.date===o.date),credits=exact.filter(p=>p.incoming>0n&&p.outgoing===0n&&p.bank==='\u652f\u4ed8\u5b9d'&&p.observation.description==='\u4ea4\u6613\u9000\u6b3e');
  if(payments.length!==1||credits.length!==1||credits[0].incoming!==BigInt(s.amountMinor)||credits[0].observation.date!==s.date)continue;
  const pay=payments[0],credit=credits[0],initial=sequences.get(JSON.stringify([wallet.id,pay.observation.importId,pay.observation.balanceEvidence.sequence-1])),out=sequences.get(JSON.stringify([wallet.id,credit.observation.importId,credit.observation.balanceEvidence.sequence+1]));
  if(!initial||initial.incoming!==BigInt(o.amountMinor)||initial.outgoing!==0n||initial.bank!=='\u652f\u4ed8\u5b9d'||initial.observation.relatedReference!==o.sourceTransactionId||initial.observation.description!=='\u8f6c\u8d26'||initial.observation.date!==o.date||!out||out.outgoing!==-BigInt(s.amountMinor)||out.incoming!==0n||out.bank!=='\u652f\u4ed8\u5b9d'||out.observation.date!==s.date||out.observation.description!=='\u8d2d\u4e70\u7406\u8d22\u4ea7\u54c1\u8f6c\u51fa(\u4f59\u989d\u5b9d\u3001\u6dd8\u5b9d\u57fa\u91d1\u3001\u62db\u8d22\u5b9d\u7b49)\u9000\u6b3e\u8f6c\u5165')continue;
  const delays=[Date.parse(pay.observation.occurredAt)-Date.parse(o.occurredAt),Date.parse(pay.observation.occurredAt)-Date.parse(initial.observation.occurredAt),Date.parse(credit.observation.occurredAt)-Date.parse(s.occurredAt),Date.parse(out.observation.occurredAt)-Date.parse(credit.observation.occurredAt)];
  if(delays.some(v=>!Number.isFinite(v)||v<0||v>60000)||![initial,pay].every(p=>usable(p,top))||![credit,out].every(p=>usable(p,ret)))continue;
  const topBridge=bridgeState(top,wallet.id,[initial,pay]),refundBridge=bridgeState(ret,wallet.id,[credit,out]);if(!topBridge||!refundBridge)continue;
  const targets=(ledger.accounts||[]).filter(namedTransitAccount),target=targets.length===1&&targets[0].status==='active'?targets[0]:null;
  plans.push({source:o,refund:s,top,ret,wallet,fund,target,initial,pay,credit,out,topBridge,refundBridge,accountIssue:targets.length>1?'ambiguous':targets[0]?.status==='archived'?'archived':'missing'});
 }
 const uses=new Map();for(const p of plans)for(const o of[p.source,p.refund,p.initial.observation,p.pay.observation,p.credit.observation,p.out.observation])uses.set(identity(o),(uses.get(identity(o))||0)+1);
 return plans.filter(p=>[p.source,p.refund,p.initial.observation,p.pay.observation,p.credit.observation,p.out.observation].every(o=>uses.get(identity(o))===1));
}
function applyNativeTransitStoredValue(ledger,transactions,selected,issues){
 const plans=planNativeTransitStoredValue(ledger,transactions);
 for(const p of plans){
  const evidence={schema:'native-transit-stored-value-v1',method:'named_transit_topup_and_original_refund_with_explicit_yuebao_cash',originalTopUpObservationId:p.source.id,originalRefundObservationId:p.refund.id,originalTopUpReference:p.source.sourceTransactionId,originalMerchantReference:p.source.relatedReference,walletAccountId:p.wallet.id,fundingAccountId:p.fund.id,storedValueAccountId:p.target?.id||null,assetAccountResolved:Boolean(p.target),topUpMinor:p.source.amountMinor,refundMinor:p.refund.amountMinor,nominalStoredValueAmountBasis:'original_completed_top_up_order_amount',actualPrepaidReceiptVerified:false,currentPrepaidBalanceImplied:false,unexplainedDifferenceNotClassifiedAsConsumption:true,originalRefundConsumptionMinor:String(p.ret.consumptionMinor),refundDestinationBasis:'original_refund_explicit_yuebao_funding_relation',nativeProductOutflowDescriptionAloneNotUsedAsProductIdentity:true,evidenceObservationIds:[p.source.id,p.refund.id,p.initial.observation.id,p.pay.observation.id,p.credit.observation.id,p.out.observation.id],reversible:true};
  const attach=(t,proofs,state,path)=>state==='present'?t:withWalletIntermediaryPostings(t,[{financialAccountId:p.wallet.id,sourceObservationId:t.id,method:'native_wallet_intermediary_postings',confidence:'exact_original_cash_and_explicit_product_route',cashEvidenceConfidence:'explicit_original_cash_postings',path,amountMinor:String(proofs[0].delta),netDeltaMinor:'0',proofObservationIds:proofs.map(q=>q.observation.id),reversible:true,events:proofs.map(q=>({occurredAt:q.observation.occurredAt,date:q.observation.date,deltaMinor:q.delta,observationId:q.observation.id}))}]);
  Object.assign(p.top,attach(p.top,[p.initial,p.pay],p.topBridge,'named_transit_top_up_from_explicit_yuebao'));
  Object.assign(p.ret,attach(p.ret,[p.credit,p.out],p.refundBridge,'named_transit_refund_to_explicit_yuebao'));
  p.ret.kind='transfer';p.ret.category='\u4ea4\u901a\u5361\u9000\u6b3e\uff08\u50a8\u503c\u8d44\u4ea7\u8f6c\u56de\uff09';p.ret.consumptionMinor=0n;p.ret.selectedConsumptionMinor=0n;p.ret.balanceEffectTimes={...p.ret.balanceEffectTimes,[p.fund.id]:p.out.observation.occurredAt};p.ret.nativeTransitStoredValue={...evidence,role:'stored_value_refund'};p.top.nativeTransitStoredValue={...evidence,role:'stored_value_top_up'};
  for(const t of[p.top,p.ret])t.automaticAssociations=[...t.automaticAssociations,{method:evidence.method,confidence:'explicit_original_cash_route_and_nominal_stored_value',observationIds:evidence.evidenceObservationIds,evidence}];
  if(p.target){
   for(const[t,delta,time]of[[p.top,BigInt(p.source.amountMinor),p.pay.observation.occurredAt],[p.ret,-BigInt(p.refund.amountMinor),p.credit.observation.occurredAt]]){t.balanceEffects={...t.balanceEffects,[p.target.id]:delta};t.balanceEffectTimes={...t.balanceEffectTimes,[p.target.id]:time};t.financialAccountIds=[...new Set([...t.financialAccountIds,p.target.id])];}
  }else for(const t of[p.top,p.ret])issues.push({reason:'unresolved_account_movement',observationId:t.id,financialAccountId:p.wallet.id,basis:'named_transit_stored_value_account_'+p.accountIssue,productLabel:LABEL});
 }
}
module.exports={namedTransitTopUp,namedTransitAccount,transitAccountProposal,planNativeTransitStoredValue,applyNativeTransitStoredValue};
