'use strict';
const bankName=value=>String(value||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd/,'');
const maskedReference=value=>/^\d{8}\d+\*+\d+$/.test(value||'');
const ALIPAY='\u652f\u4ed8\u5b9d',RETURN='\u5145\u503c\u9000\u56de';

// The visible funding identifier can be matched exactly, but remains masked.
// It is not the full merchant order number or an actual bank posting date.
function findReferenceLinkedBankReturns({order,root,credits,proofs,rows,accounts,blocked,identity,unused}){
 const wallet=order.financialAccountId,payers=Object.entries(root.balanceEffects||{}).filter(([id,v])=>BigInt(v)===-BigInt(order.amountMinor)&&accounts.get(id)?.type==='credit_card').map(([id])=>accounts.get(id));
 if(payers.length!==1||root.reportingAccountIds?.[0]!==payers[0].id||BigInt(root.balanceEffects?.[wallet]||0)!==0n||BigInt(root.cashEffects?.[wallet]||0)!==0n)return {fundingEstablished:false,returns:[]};
 const payer=payers[0],amount=BigInt(order.amountMinor),sequences=new Map(proofs.map(p=>[JSON.stringify([p.observation.financialAccountId,p.observation.importId,p.observation.balanceEvidence.sequence]),p]));
 const debits=proofs.filter(p=>p.observation.financialAccountId===wallet&&p.observation.relatedReference===order.sourceTransactionId&&p.bank===ALIPAY&&p.incoming===0n&&p.outgoing===-amount&&(p.observation.description==='\u5728\u7ebf\u652f\u4ed8'||p.observation.description.startsWith('\u652f\u4ed8-'))),fundings=[];
 for(const debit of debits){const d=debit.observation,credit=sequences.get(JSON.stringify([wallet,d.importId,d.balanceEvidence.sequence-1]));if(!credit)continue;const c=credit.observation,gap=Date.parse(d.occurredAt)-Date.parse(c.occurredAt);if(c.description==='\u5145\u503c'&&credit.incoming===amount&&credit.outgoing===0n&&credit.bank.endsWith('\u94f6\u884c')&&c.date===d.date&&gap>=0&&gap<=2000)fundings.push({credit,debit});}
 if(!fundings.length)return {fundingEstablished:false,returns:[]};
 const empty={fundingEstablished:true,returns:[]};
 if(debits.length!==1||fundings.length!==1||payer.status!=='active'||payer.currency!=='CNY'||!/^\d{4}$/.test(payer.maskedIdentifier||''))return empty;
 const {credit:funding,debit}=fundings[0],charge=funding.observation,payment=debit.observation;
 if(bankName(funding.bank)!==bankName(payer.provider)||!maskedReference(charge.relatedReference)||!charge.relatedReference.startsWith(charge.date.replace(/-/g,''))||blocked.has(identity(charge))||blocked.has(identity(payment)))return empty;
 // Count all copies and rival charges before considering owner overrides.
 const sameReferenceCharges=proofs.filter(p=>p.observation.financialAccountId===wallet&&p.bank===funding.bank&&p.observation.relatedReference===charge.relatedReference&&p.incoming>0n&&p.outgoing===0n);
 if(sameReferenceCharges.length!==1)return empty;
 const matching=proofs.filter(p=>p.observation.financialAccountId===wallet&&p.bank===funding.bank&&p.observation.description===RETURN&&p.observation.relatedReference===charge.relatedReference&&p.incoming===0n&&p.outgoing<0n).sort((a,b)=>Date.parse(a.observation.occurredAt)-Date.parse(b.observation.occurredAt));
 if(!matching.length||matching.some(p=>!unused(p)))return empty;
 let returned=0n;const result=[];
 for(const next of matching){
  const n=next.observation,availableCredits=credits.filter(p=>Date.parse(p.observation.occurredAt)<=Date.parse(n.occurredAt)),available=availableCredits.reduce((sum,p)=>sum+p.incoming,0n),last=availableCredits.slice().sort((a,b)=>Date.parse(a.observation.occurredAt)-Date.parse(b.observation.occurredAt)).at(-1),value=-next.outgoing,delay=last?Date.parse(n.occurredAt)-Date.parse(last.observation.occurredAt):-1;
  if(!last||delay<0||delay>7*86400000||value+returned>available||value+returned>amount)return empty;
  // Later actual card receipts supersede this inferred missing-card leg.
  if(rows.some(o=>!o.balanceEvidence&&o.financialAccountId===payer.id&&o.status==='completed'&&o.direction==='credit'&&o.currency==='CNY'&&o.amountMinor===String(value)&&Math.abs(Date.parse(o.date)-Date.parse(n.date))<=7*86400000))return empty;
  returned+=value;
  const ids=availableCredits.map(p=>p.observation.id),linkedReferenceEvidence={fundingReference:charge.relatedReference,returnReference:n.relatedReference,bankChargeReferenceMatched:true,referenceVisibility:'masked',fullUnmaskedFundingReferenceVerified:false,fundingProofObservationId:charge.id,paymentProofObservationId:payment.id,refundProofObservationIds:ids,refundAmountBasis:ids.length===1?'one_original_refund_credit':'sum_of_distinct_original_refund_credits',cumulativeRefundCreditMinor:String(available),cumulativeBankReturnMinor:String(returned),originalBankFundingAmountMinor:String(amount),identityBasis:'original_printed_bank_and_existing_purchase_card_identity',cardIdentityConfidence:root.automaticFunding?.cardIdentityConfidence||root.automaticFunding?.confidence||'existing_purchase_payer_inferred',evidenceObservationIds:[...new Set([order.id,charge.id,payment.id,...ids,n.id])]};
  result.push({proof:next,credit:last,payer,delay,linkedReferenceEvidence});
 }
 return {fundingEstablished:true,returns:result};
}
function findUniqueDatedBankRefundReturn({order,root,credits,proofs,rows,accounts,unused}){
 if(credits.length!==1||!order.paymentChannel||order.rawFields?.['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==order.paymentChannel||!['owner_historical_card_binding','owner_historical_channel_separation'].includes(root.automaticFunding?.method))return [];
 const payer=accounts.get(root.automaticFunding.financialAccountId),credit=credits[0],wallet=order.financialAccountId,c=credit.observation;
 if(payer?.type!=='credit_card'||payer.status!=='active'||payer.currency!=='CNY'||root.reportingAccountIds?.[0]!==payer.id||bankName(order.paymentChannel)!==bankName(payer.provider)||BigInt(root.balanceEffects?.[payer.id]||0)!==-BigInt(order.amountMinor)||BigInt(root.balanceEffects?.[wallet]||0)!==0n||BigInt(root.cashEffects?.[wallet]||0)!==0n)return [];
 const candidates=proofs.filter(p=>p.observation.financialAccountId===wallet&&p.observation.description===RETURN&&p.incoming===0n&&p.outgoing===-credit.incoming&&bankName(p.bank)===bankName(payer.provider)&&maskedReference(p.observation.relatedReference)&&p.observation.relatedReference.startsWith(order.date.replace(/-/g,''))&&Date.parse(p.observation.occurredAt)>=Date.parse(c.occurredAt)&&Date.parse(p.observation.occurredAt)-Date.parse(c.occurredAt)<=2*86400000);
 if(candidates.length!==1)return [];const next=candidates[0],n=next.observation;
 // Include unexplained incoming rows and owner-edited returns as rivals;
 // do not manufacture uniqueness by ignoring inconvenient evidence.
 const incoming=proofs.filter(p=>p.observation.financialAccountId===wallet&&p.bank===ALIPAY&&p.incoming===credit.incoming&&p.outgoing===0n&&Date.parse(p.observation.occurredAt)<=Date.parse(n.occurredAt)&&Date.parse(n.occurredAt)-Date.parse(p.observation.occurredAt)<=2*86400000);
 if(incoming.length!==1||incoming[0].observation.id!==c.id||!unused(next)||rows.some(o=>!o.balanceEvidence&&o.financialAccountId===payer.id&&o.status==='completed'&&o.direction==='credit'&&o.currency==='CNY'&&o.amountMinor===String(credit.incoming)&&Math.abs(Date.parse(o.date)-Date.parse(n.date))<=7*86400000))return [];
 return [{proof:next,credit,payer,delay:Date.parse(n.occurredAt)-Date.parse(c.occurredAt),linkedReferenceEvidence:{method:'unique_dated_original_refund_bank_return',bankChargeReferenceMatched:false,fundingReferenceVerified:false,fundingProofObservationId:null,returnReference:n.relatedReference,referenceVisibility:'masked',fullUnmaskedFundingReferenceVerified:false,returnReferenceOriginalPurchaseDateMatched:true,matchingBasis:'explicit_original_paid_bank_unique_actual_refund_return_and_purchase_date_prefix',refundProofObservationIds:[c.id],cumulativeRefundCreditMinor:String(credit.incoming),cumulativeBankReturnMinor:String(credit.incoming),originalBankFundingAmountMinor:order.amountMinor,originalBankFundingAmountBasis:'original_paid_order_not_an_observed_bank_top_up',identityBasis:'original_declared_bank_and_owner_scoped_historical_card',cardIdentityConfidence:root.automaticFunding.confidence,evidenceObservationIds:[order.id,c.id,n.id]}}];
}
module.exports={findReferenceLinkedBankReturns,findUniqueDatedBankRefundReturn};
