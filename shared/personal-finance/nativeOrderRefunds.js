'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const refKey=(account,ref)=>JSON.stringify([account,ref]);
const bankName=value=>String(value||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd/,'');
const isAfterSalesRefund=o=>/^\u8f6c\u8d26\u552e\u540e\u7ef4\u6743\[T\d{1,4}P\d{6,}\]$/.test(o.description||'');
const isRefund=o=>isAfterSalesRefund(o)||/^(?:\u9000\u6b3e-\S|\u4ea4\u6613\u9000\u6b3e(?:ERP\u4f1a\u5458\u63d0\u73b0--\d+KdxPj)?$)/.test(o.description||'');
const ALIPAY='\u652f\u4ed8\u5b9d',BALANCE='\u4f59\u989d',RETURN='\u5145\u503c\u9000\u56de';
const provisionalExpense=(o,a)=>!o?.balanceEvidence&&!a.reset&&a.patch?.kind==='expense'&&a.patch.category==='\u6682\u6309\u4e2a\u4eba\u652f\u51fa\uff08\u7528\u6237\u6388\u6743\u3001\u53ef\u4fee\u6539\uff09'&&Object.keys(a.patch).every(k=>['kind','category'].includes(k));

// Immutable balance observations supply cash only after validation of the
// complete native sequence and an exact reference to a completed expense.
function planNativeOrderRefunds(ledger,transactions){
 const originals=ledger.observations||[];
 if(!originals.some(o=>o.balanceEvidence?.schema==='alipay-balance-proof-v1'&&isRefund(o)))return [];
 const accounts=new Map(ledger.accounts.map(a=>[a.id,a])),latest=new Map(),byId=new Map(originals.map(o=>[o.id,o])),ties=new Set();
 for(const o of originals){const k=identity(o),prior=latest.get(k),version=o.sourceVersionOrdinal||0;if(!prior||version>(prior.sourceVersionOrdinal||0)){latest.set(k,o);ties.delete(k);}else if(version===(prior.sourceVersionOrdinal||0)&&o.id!==prior.id)ties.add(k);}
 const rows=[...latest.values()],restoredPurposes=require('./legacyAlipayPurchases').restoredLegacyPurchasePurposes(rows,ledger.annotations||[]),blocked=new Set((ledger.annotations||[]).filter(a=>!provisionalExpense(byId.get(a.observationId),a)&&!restoredPurposes.has(a.observationId)).map(a=>byId.get(a.observationId)).filter(Boolean).map(identity));
 for(const k of ties)blocked.add(k);
 for(const l of ledger.links||[]){const deleted=l.status==='deleted'||l.deletedAt||l.deleted===true;if(!deleted&&['distinct','group_distinct'].includes(l.type)||deleted&&['duplicate','transfer'].includes(l.type))for(const id of l.observationIds||[]){const o=byId.get(id);if(o)blocked.add(identity(o));}}
 const roots=new Map(),claimed=new Set(),orders=new Map();
 for(const t of transactions){
  for(const id of t.observationIds||[])roots.set(id,t);
  for(const p of t.cashPostingEvidence||[])claimed.add(p.proofObservationId);
  for(const p of t.walletIntermediaryPostings||[])for(const id of p.proofObservationIds||[])claimed.add(id);
  for(const events of Object.values(t.balanceEffectEvents||{}))for(const e of events)if(e.observationId)claimed.add(e.observationId);
 }
 for(const o of rows)if(o.provider==='alipay'&&!o.balanceEvidence&&o.sourceTransactionId){const k=refKey(o.financialAccountId,o.sourceTransactionId);if(!orders.has(k))orders.set(k,[]);orders.get(k).push(o);}
 const proofs=validatedWalletProofs(rows,accounts),nativeByImport=new Map(),cashSignatures=new Map(),refunds=new Map();
 const signature=p=>JSON.stringify([p.observation.financialAccountId,p.observation.relatedReference,p.observation.occurredAt,p.observation.description,String(p.delta)]);
 for(const p of proofs){const o=p.observation,k=refKey(o.financialAccountId,o.importId);if(!nativeByImport.has(k))nativeByImport.set(k,new Map());nativeByImport.get(k).set(o.balanceEvidence.sequence,p);const sig=signature(p);cashSignatures.set(sig,(cashSignatures.get(sig)||0)+1);}
 const unused=p=>!claimed.has(p.observation.id)&&!blocked.has(identity(p.observation))&&cashSignatures.get(signature(p))===1;
 for(const p of proofs){
  const o=p.observation;if(p.incoming<=0n||p.outgoing!==0n||p.bank!==ALIPAY||!isRefund(o)||!/^\d{14,40}$/.test(o.relatedReference))continue;
  const k=refKey(o.financialAccountId,o.relatedReference);if(!refunds.has(k))refunds.set(k,[]);refunds.get(k).push(p);
 }
 const plans=[];
 for(const [k,credits]of refunds){
  const candidates=orders.get(k)||[];if(candidates.length!==1)continue;
  const order=candidates[0],root=roots.get(order.id),amount=credits.reduce((n,p)=>n+p.incoming,0n);
  if(credits.some(p=>isAfterSalesRefund(p.observation)&&p.observation.description.slice(p.observation.description.indexOf('[')+1,-1)!==order.relatedReference))continue;
  if(!root||root.kind!=='expense'||root.status!=='completed'||order.status!=='completed'||root.currency!=='CNY'||root.currency!==order.currency||root.reportingAccountIds?.length!==1||BigInt(root.consumptionMinor)!==BigInt(order.amountMinor)||amount>BigInt(order.amountMinor)||blocked.has(identity(order))||credits.some(p=>!unused(p)||Date.parse(p.observation.occurredAt)<Date.parse(order.occurredAt)))continue;
  // Count all rivals before exclusions: owner edits cannot manufacture absence.
  if(rows.some(o=>!o.balanceEvidence&&o.id!==order.id&&o.provider==='alipay'&&o.financialAccountId===order.financialAccountId&&(o.relatedReference===order.sourceTransactionId||o.sourceTransactionId===order.sourceTransactionId)&&(['refund','income'].includes(o.kind)||o.direction==='credit'&&BigInt(o.amountMinor)>0n))||transactions.some(t=>t.kind==='refund'&&t.relatedReference===order.sourceTransactionId))continue;
  const linked=require('./nativeLinkedBankReturns').findReferenceLinkedBankReturns({order,root,credits,proofs,rows,accounts,blocked,identity,unused}),returns=[...linked.returns];let unsafe=false;
  for(const credit of linked.fundingEstablished?[]:credits){
   const c=credit.observation,next=nativeByImport.get(refKey(c.financialAccountId,c.importId))?.get(c.balanceEvidence.sequence+1);
   if(next?.observation.description!==RETURN)continue;
   const n=next.observation,delay=Date.parse(n.occurredAt)-Date.parse(c.occurredAt),payerIds=Object.entries(root.balanceEffects||{}).filter(([id,delta])=>BigInt(delta)===-BigInt(order.amountMinor)&&accounts.get(id)?.type==='credit_card').map(([id])=>id),payer=accounts.get(payerIds[0]);
   // The masked return reference differs from the order. Adjacency, amount,
   // bank and purchase-date prefix support an inference, not bank verification.
   if(!unused(next)||payerIds.length!==1||next.outgoing!==-credit.incoming||next.incoming!==0n||!payer||payer.status!=='active'||payer.currency!=='CNY'||!/^\d{4}$/.test(payer.maskedIdentifier||'')||bankName(next.bank)!==bankName(payer.provider)||delay<0||delay>2*86400000||!/^\d{8}\d+\*+\d+$/.test(n.relatedReference)||!n.relatedReference.startsWith(order.date.replace(/-/g,''))){unsafe=true;break;}
   const sameAmount=proofs.filter(p=>p.observation.financialAccountId===c.financialAccountId&&p.incoming===credit.incoming&&p.outgoing===0n&&p.bank===ALIPAY&&isRefund(p.observation)&&Date.parse(p.observation.occurredAt)<=Date.parse(n.occurredAt)&&Date.parse(n.occurredAt)-Date.parse(p.observation.occurredAt)<=2*86400000);
   if(sameAmount.length!==1){unsafe=true;break;}
   const bankCredits=rows.filter(o=>!o.balanceEvidence&&o.financialAccountId===payer.id&&o.status==='completed'&&o.currency==='CNY'&&o.direction==='credit'&&o.amountMinor===String(credit.incoming)&&Math.abs(Date.parse(o.date)-Date.parse(n.date))<=7*86400000);
   if(bankCredits.length||transactions.some(t=>t.kind==='refund'&&t.relatedReference===order.sourceTransactionId)){unsafe=true;break;}
   returns.push({proof:next,credit,payer,delay});
  }
  if(unsafe)continue;
  if(!linked.fundingEstablished&&!returns.length)returns.push(...require('./nativeLinkedBankReturns').findUniqueDatedBankRefundReturn({order,root,credits,proofs,rows,accounts,unused}));
  for(const credit of credits){const p=credit.observation,evidence={schema:'native-order-refund-v1',role:'wallet_refund',method:'exact_original_order_cash_refund',confidence:'explicit_original_cash_posting',originalOrderObservationId:order.id,originalOrderTransactionId:root.id,originalOrderReference:order.sourceTransactionId,originalReportingAccountId:root.reportingAccountIds[0],originalSourceAmountMinor:p.amountMinor,refundAmountMinor:String(credit.incoming),groupRefundAmountMinor:String(amount),originalPurchaseAmountMinor:order.amountMinor,evidenceObservationIds:[order.id,p.id],reversible:true};plans.push({proof:p,source:{...p,balanceEvidence:undefined,balanceMinor:null,amountMinor:String(credit.incoming),kind:'refund',direction:'credit',paymentChannel:BALANCE,paymentAccountHint:'',category:root.category,counterparty:order.counterparty,nativeOrderRefund:evidence},evidence});}
  for(const {proof:next,credit,payer,delay,linkedReferenceEvidence}of returns){const p=next.observation,evidence={schema:'native-order-refund-v1',role:'bank_return',method:linkedReferenceEvidence?'reference_linked_original_refund_bank_return':'adjacent_original_refund_bank_return',confidence:'inferred_original_payer',originalOrderObservationId:order.id,originalOrderTransactionId:root.id,originalOrderReference:order.sourceTransactionId,refundProofObservationId:credit.observation.id,originalSourceAmountMinor:p.amountMinor,returnAmountMinor:String(-next.outgoing),financialAccountId:payer.id,statementBank:next.bank,cardTailPrinted:false,bankPostingDateVerified:false,returnReferenceMatchedToOrder:false,returnDelaySeconds:delay/1000,evidenceObservationIds:[order.id,credit.observation.id,p.id],...(linkedReferenceEvidence||{}),reversible:true};plans.push({proof:p,source:{...p,balanceEvidence:undefined,balanceMinor:null,amountMinor:String(-next.outgoing),kind:'debt_payment',direction:'debit',paymentChannel:BALANCE,paymentAccountHint:'',counterparty:payer.provider,category:'\u9000\u6b3e\u9000\u56de\u539f\u4ed8\u6b3e\u5361',nativeOrderRefund:evidence,automaticRepaymentTarget:{financialAccountId:payer.id,method:'native_refund_bank_return',confidence:'inferred',payerStatus:'explicit_wallet_cash'}},evidence});}
 }
 return plans;
}

function appendNativeOrderRefunds(ledger,transactions,selected,buildRawTransactions){
 const plans=planNativeOrderRefunds(ledger,transactions);if(!plans.length)return;
 const ids=new Set(plans.flatMap(p=>[p.source.financialAccountId,p.evidence.financialAccountId].filter(Boolean))),accounts=ledger.accounts.filter(a=>ids.has(a.id)).map(a=>Object.fromEntries(['id','label','type','provider','status','currency','maskedIdentifier'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]))),derived={accounts,observations:plans.map(p=>p.source),annotations:[],links:[],imports:[],balanceSnapshots:[]},byId=new Map(plans.map(p=>[p.source.id,p]));
 const added=buildRawTransactions(derived,{accountIds:[...selected]});
 if(added.length!==plans.length)throw new Error('NATIVE_REFUND_UNEXPECTED_MERGE');
 for(const t of added){const plan=byId.get(t.observationIds[0]);if(!plan||t.observationIds.length!==1)throw new Error('NATIVE_REFUND_UNEXPECTED_SOURCE');const delta=BigInt(plan.source.amountMinor)*(plan.source.direction==='credit'?1n:-1n);if(t.cashEffects[plan.source.financialAccountId]!==delta)throw new Error('NATIVE_REFUND_CASH_MISMATCH');t.sources=[plan.proof];t.nativeOrderRefund=plan.evidence;t.cashPostingEvidence=[{method:plan.evidence.method,sourceObservationId:plan.source.id,proofObservationId:plan.proof.id,financialAccountId:plan.proof.financialAccountId,deltaMinor:String(delta),occurredAt:plan.proof.occurredAt,date:plan.proof.date,confidence:'explicit_original_cash_posting',reversible:true}];if(plan.evidence.role==='wallet_refund'){const account=plan.evidence.originalReportingAccountId;t.reportingAccountIds=[account];t.financialAccountIds=[...new Set([...t.financialAccountIds,account])];t.incomeExpenseAllocations={[account]:{consumptionMinor:-delta,incomeMinor:0n}};t.selectedConsumptionMinor=selected.has(account)?-delta:0n;}transactions.push(t);}
}
module.exports={planNativeOrderRefunds,appendNativeOrderRefunds};
