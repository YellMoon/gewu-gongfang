'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const {withWalletIntermediaryPostings}=require('./walletIntermediaryPostings');
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd/,'');
const feeTitle=/^\u6536\u8d39\u4fe1\u7528\u5361\u652f\u4ed8\u670d\u52a1\u8d39\[(\d{8})[A-Z0-9]+\]$/;

// The buyer's fee is distinct from a shop's merchant acquiring fee. Only the
// original three-row cash sequence can establish its extra card-funded cost.
function planNativeBuyerCreditFees(ledger,transactions){
 const originals=ledger.observations||[];
 if(!originals.some(o=>o.balanceEvidence&&feeTitle.test(o.description||'')))return [];
 const am=new Map((ledger.accounts||[]).map(a=>[a.id,a])),byId=new Map(originals.map(o=>[o.id,o])),latest=new Map(),ties=new Set();
 for(const o of originals){const k=identity(o),p=latest.get(k),v=o.sourceVersionOrdinal||0;if(!p||v>(p.sourceVersionOrdinal||0)){latest.set(k,o);ties.delete(k);}else if(v===(p.sourceVersionOrdinal||0)&&o.id!==p.id)ties.add(k);}
 const rows=[...latest.values()],edited=new Set((ledger.annotations||[]).map(a=>byId.get(a.observationId)).filter(Boolean).map(identity)),proofs=validatedWalletProofs(rows,am),sequences=new Map(),roots=new Map(),claimed=new Set(),orders=new Map();
 for(const p of proofs)sequences.set(JSON.stringify([p.observation.financialAccountId,p.observation.importId,p.observation.balanceEvidence.sequence]),p);
 for(const t of transactions){for(const id of t.observationIds||[])roots.set(id,t);for(const p of t.cashPostingEvidence||[])claimed.add(p.proofObservationId);for(const p of t.walletIntermediaryPostings||[])for(const id of p.proofObservationIds||[])claimed.add(id);for(const events of Object.values(t.balanceEffectEvents||{}))for(const e of events)if(e.observationId)claimed.add(e.observationId);}
 for(const o of rows)if(o.provider==='alipay'&&!o.balanceEvidence){const k=JSON.stringify([o.financialAccountId,o.sourceTransactionId]);if(!orders.has(k))orders.set(k,[]);orders.get(k).push(o);}
 const proposals=[];
 for(const fee of proofs){
  const f=fee.observation,title=f.description.match(feeTitle),wallet=am.get(f.financialAccountId),feeAmount=-fee.outgoing;
  if(!title||title[1]!==f.date.replace(/-/g,'')||fee.incoming!==0n||feeAmount<=0n||fee.bank!=='\u652f\u4ed8\u5b9d'||wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.sourceProduct)continue;
  const previous=n=>sequences.get(JSON.stringify([f.financialAccountId,f.importId,f.balanceEvidence.sequence-n])),payment=previous(1),charge=previous(2);if(!payment||!charge)continue;
  const paid=payment.observation,credit=charge.observation,amount=-payment.outgoing,candidates=orders.get(JSON.stringify([wallet.id,paid.relatedReference]))||[];if(candidates.length!==1)continue;
  const source=candidates[0],root=roots.get(source.id),card=am.get(root?.automaticFunding?.financialAccountId),gap=Date.parse(f.occurredAt)-Date.parse(credit.occurredAt),delay=Date.parse(paid.occurredAt)-Date.parse(source.occurredAt),raw=source.rawFields||{};
  if(payment.incoming!==0n||amount<=0n||feeAmount>amount||payment.bank!=='\u652f\u4ed8\u5b9d'||paid.description!=='\u5728\u7ebf\u652f\u4ed8'||charge.incoming!==amount+feeAmount||charge.outgoing!==0n||credit.description!=='\u5145\u503c'||card?.status!=='active'||card.type!=='credit_card'||card.currency!=='CNY'||!/^\d{4}$/.test(card.maskedIdentifier||'')||norm(charge.bank)!==norm(card.provider)||source.currency!=='CNY'||source.status!=='completed'||source.direction!=='debit'||source.amountMinor!==String(amount)||source.date!==f.date||credit.date!==f.date||paid.date!==f.date||gap<0||gap>2000||delay<0||delay>60000)continue;
  if(!root||root.kind!=='expense'||root.status!=='completed'||root.observationIds?.length!==1||root.sources?.length!==1||root.sources[0].id!==source.id||BigInt(root.consumptionMinor)!==amount||BigInt(root.incomeMinor)!==0n||root.incomeExpenseAllocations!=null||!['owner_historical_card_binding','native_bank_funded_order'].includes(root.automaticFunding.method)||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==paid.relatedReference||!/^\d{14,40}$/.test(paid.relatedReference)||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||raw['\u6536/\u652f']!=='\u652f\u51fa'||raw['\u5546\u54c1\u8bf4\u660e']!==source.description)continue;
  if(BigInt(root.balanceEffects[card.id]||0)!==-amount||Object.entries(root.balanceEffects).some(([id,n])=>id!==card.id&&BigInt(n)!==0n)||Object.values(root.cashEffects).some(n=>BigInt(n)!==0n))continue;
  const members=[source,credit,paid,f],keys=new Set(members.map(identity));if(members.some(o=>ties.has(identity(o))||edited.has(identity(o)))||[credit,paid,f].some(o=>roots.has(o.id)||claimed.has(o.id)))continue;
  if((ledger.links||[]).some(l=>(l.status!=='deleted'||['duplicate','transfer'].includes(l.type))&&(l.observationIds||[]).map(id=>byId.get(id)).filter(Boolean).some(o=>keys.has(identity(o)))))continue;
  const nearby=proofs.filter(p=>p.observation.financialAccountId===wallet.id&&p.observation.importId===f.importId&&p.incoming>0n&&p.bank.endsWith('\u94f6\u884c')&&Date.parse(paid.occurredAt)-Date.parse(p.observation.occurredAt)>=0&&Date.parse(paid.occurredAt)-Date.parse(p.observation.occurredAt)<=2000);if(nearby.length!==1)continue;
  if(rows.some(o=>!o.balanceEvidence&&(o.statementFlow||o.bankStatement)&&o.financialAccountId===card.id&&o.status==='completed'&&o.direction==='debit'&&[String(amount),String(amount+feeAmount),String(feeAmount)].includes(o.amountMinor)&&Math.abs(Date.parse(o.date)-Date.parse(source.date))<=86400000))continue;
  proposals.push({source,root,card,fee,charge,payment,amount,feeAmount,members});
 }
 const uses=new Map();for(const p of proposals)for(const o of p.members)uses.set(identity(o),(uses.get(identity(o))||0)+1);
 return proposals.filter(p=>p.members.every(o=>uses.get(identity(o))===1));
}

function appendNativeBuyerCreditFees(ledger,transactions,selected,buildRawTransactions){
 const plans=planNativeBuyerCreditFees(ledger,transactions);if(!plans.length)return;
 for(const p of plans){
  const f=p.fee.observation,walletId=f.financialAccountId,proofIds=[p.charge.observation.id,p.payment.observation.id,f.id],evidence={schema:'native-buyer-credit-fee-v1',method:'exact_native_card_top_up_purchase_and_buyer_fee',amountMinor:String(p.feeAmount),purchaseAmountMinor:String(p.amount),bankChargeMinor:String(p.amount+p.feeAmount),walletAccountId:walletId,payerAccountId:p.card.id,originalOrderObservationId:p.source.id,originalOrderReference:p.source.sourceTransactionId,evidenceObservationIds:[p.source.id,...proofIds],cashFeeConfidence:'explicit_original_fee',bankFundingConfidence:'inferred_unique_native_cash_sequence_and_owner_card_policy',cardTailPrinted:false,cardIdentityConfidence:p.root.automaticFunding.cardIdentityConfidence||p.root.automaticFunding.confidence,reversible:true};
  const derived={...f,financialAccountId:p.card.id,balanceEvidence:undefined,balanceMinor:null,amountMinor:String(p.feeAmount),kind:'fee',direction:'debit',paymentChannel:'',paymentAccountHint:'',category:'\u652f\u4ed8\u624b\u7eed\u8d39',relatedReference:'',nativeBuyerCreditFee:evidence},accounts=[p.card].map(a=>Object.fromEntries(['id','label','type','provider','status','currency','maskedIdentifier'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]))),added=buildRawTransactions({accounts,observations:[derived],imports:[],annotations:[],links:[],balanceSnapshots:[]},{accountIds:[...selected]});
  if(added.length!==1||added[0].id!==f.id||added[0].consumptionMinor!==p.feeAmount||added[0].incomeMinor!==0n||added[0].balanceEffects[p.card.id]!==-p.feeAmount||Object.values(added[0].cashEffects).some(n=>BigInt(n)!==0n))throw new Error('NATIVE_BUYER_CREDIT_FEE_CONFLICT');
  const bridge={financialAccountId:walletId,sourceObservationId:p.source.id,method:'native_wallet_intermediary_postings',path:'card_top_up_purchase_and_buyer_fee',confidence:evidence.bankFundingConfidence,cashEvidenceConfidence:'explicit_original_cash_postings',amountMinor:evidence.bankChargeMinor,netDeltaMinor:'0',proofObservationIds:proofIds,payerAccountId:p.card.id,reversible:true,events:[p.charge,p.payment,p.fee].map(c=>({occurredAt:c.observation.occurredAt,date:c.observation.date,deltaMinor:c.delta,observationId:c.observation.id}))};
  const index=transactions.indexOf(p.root);transactions[index]=withWalletIntermediaryPostings(p.root,[bridge]);transactions[index].nativeBuyerCreditFee=evidence;const fee=added[0];fee.sources=[f];fee.financialAccountIds=[...new Set([...fee.financialAccountIds,walletId])];fee.nativeBuyerCreditFee={...evidence,role:'buyer_fee'};transactions.push(fee);
 }
}
module.exports={planNativeBuyerCreditFees,appendNativeBuyerCreditFees};
