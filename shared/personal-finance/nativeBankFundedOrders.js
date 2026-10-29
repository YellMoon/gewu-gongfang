'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const {actualSecond}=require('./mixedPayments');
const {validateHistoricalCardBindings,historicalCardBindingValid}=require('./historicalCardBindings');
const {isSettlementAccount}=require('./counterpartySettlements');
const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const norm=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe|\u5de5\u5546|\u519c\u4e1a|\u6c11\u751f)/,'');
// Some native tables put the successful status below the recharge title.
// Count both literal forms for the selected cash row and all of its rivals.
const nativeRecharge=o=>['\u5145\u503c','\u5145\u503c\u4ea4\u6613\u6210\u529f'].includes(o.description);
// An explicitly selected order can use the owner's small payment-benefit
// inference policy. Native cash, full source reference and historical card
// identity still have to pass every ordinary funding check below.
function nativeCreditDifference(source,patch,debit){
 const p=patch?.commercePayment;if(!p||p.schema!=='native-credit-payment-v1'||p.basis!=='owner_authorized_inferred_credit_payment_discount'||Object.keys(p).some(k=>!['schema','bankCreditObservationId','walletDebitObservationId','discountMinor','basis'].includes(k))||typeof p.discountMinor!=='string'||!/^\d+$/.test(p.discountMinor)||BigInt(p.discountMinor)<=0n||BigInt(p.discountMinor)>100n||p.walletDebitObservationId!==debit.id||typeof p.bankCreditObservationId!=='string'||source.kind!=='expense'||source.paymentChannel||source.paymentAccountHint||[source.feeMinor,source.interestMinor].some(v=>v!==undefined&&v!==null&&v!=='0')||BigInt(source.amountMinor)!==BigInt(debit.balanceEvidence.expenseMinor)+BigInt(p.discountMinor))return null;
 return p;
}
function findNativeBankFundedOrders(observations,accounts,{balanceEvidenceObservations=[],annotatedIds=new Set(),annotations=new Map(),links=[],historicalFunding=new Map()}={}){
 if(!balanceEvidenceObservations.length&&!observations.some(o=>o.balanceEvidence?.schema==='alipay-balance-proof-v1'))return new Map();
 // Materialized accounting rows may share the original cash proof's identity
 // and version. Validate its untouched original, while newer versions and
 // explicit cash-proof annotations retain their ordinary vetoes below.
 const originals=[...balanceEvidenceObservations,...observations],byId=new Map(originals.map(o=>[o.id,o])),latest=new Map(),am=new Map(accounts.map(a=>[a.id,a]));
 for(const o of originals)if(!latest.has(key(o))||(o.sourceVersionOrdinal||0)>(latest.get(key(o)).sourceVersionOrdinal||0))latest.set(key(o),o);
 const rows=[...latest.values()],proofs=validatedWalletProofs(rows,am);if(!proofs.length)return new Map();
 const annotated=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(key)),active=links.filter(l=>l.status!=='deleted'),activeSets=new Set(active.map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!activeSets.has([...l.observationIds].sort().join('|')));
 const sources=new Map(),sequences=new Map(),bankCash=new Map(),proposals=[],policies=new Map();
 for(const a of accounts)if(a.historicalCardBindings){try{policies.set(a.id,validateHistoricalCardBindings(a.historicalCardBindings));}catch{/* Invalid identity evidence never becomes a payer. */}}
 for(const o of rows){if(!o.balanceEvidence&&o.provider==='alipay'&&o.sourceTransactionId){const k=JSON.stringify([o.financialAccountId,o.sourceTransactionId]);if(!sources.has(k))sources.set(k,[]);sources.get(k).push(o);}if(o.status==='completed'&&o.direction==='debit'&&!o.balanceEvidence&&['bank','savings','debit_card','credit_card'].includes(am.get(o.financialAccountId)?.type)&&!o.bankStatement?.nonCash){const k=JSON.stringify([o.financialAccountId,o.date,o.amountMinor,o.currency]);if(!bankCash.has(k))bankCash.set(k,[]);bankCash.get(k).push(o);}}
 for(const p of proofs)sequences.set(JSON.stringify([p.observation.financialAccountId,p.observation.importId,p.observation.balanceEvidence.sequence]),p);
 for(const negative of proofs){
  const debit=negative.observation,possible=sources.get(JSON.stringify([debit.financialAccountId,debit.relatedReference]))||[];
  if(possible.length!==1||negative.incoming!==0n||negative.outgoing>=0n||negative.bank!=='\u652f\u4ed8\u5b9d'||!(debit.description==='\u5728\u7ebf\u652f\u4ed8'||debit.description.startsWith('\u652f\u4ed8-')))continue;
  const s=possible[0],r=s.rawFields||{},wallet=am.get(s.financialAccountId),amount=-negative.outgoing,delay=(Date.parse(debit.occurredAt)-Date.parse(s.occurredAt))/1000,annotation=annotations.get(s.id),patch=annotation?.reset?null:annotation?.patch,mixedChannel=norm(s.paymentChannel).match(/^(.+\u94f6\u884c)&\u4f59\u989d$/);
  const difference=nativeCreditDifference(s,patch,debit),differenceAnnotation=difference&&Object.keys(patch).every(k=>['kind','category','commercePayment'].includes(k));
  const namedCashOrder=s.automaticClassification?.method==='original_debit_order_native_wallet_payment'&&s.automaticClassification.nativeBankFundingRequired===true&&s.automaticClassification.sourceOccurredAt===s.occurredAt&&s.automaticClassification.actualPaymentOccurredAt===debit.occurredAt&&s.automaticClassification.evidenceObservationIds?.includes(debit.id);
  const telecomSource=s.kind==='expense'?require('./telecomTopups').refreshTelecomServicePurchase({...s,kind:'transfer',automaticClassification:undefined}):null,telecomPayment=telecomSource?.kind==='expense'&&telecomSource.automaticClassification?.method==='explicit_telecom_service_purchase';
  const legacyPayment=s.kind==='expense'&&s.automaticClassification?.method==='explicit_legacy_alipay_paid_order'&&require('./legacyAlipayPurchases').isLegacyAlipayPurchase({...s,kind:'transfer',category:r['\u4ea4\u6613\u5206\u7c7b']});
  // Cash evidence identifies the actual payer independently of who ultimately
  // bears a shop operating payment. Keep its explicit purpose review open.
  const pendingPurpose=require('./legacyAlipayPurchases').requiresPurposeReview(annotation)&&require('./legacyAlipayPurchases').sourceOnlyPurposeReview(s,annotation);
  const settlement=am.get(s.settlementAccountId),purposeOnly=pendingPurpose||patch&&Object.keys(patch).every(k=>['kind','category'].includes(k))&&patch.kind==='expense',settlementOnly=patch&&patch.kind==='transfer'&&Object.keys(patch).every(k=>['kind','category','settlementAccountId'].includes(k))&&patch.settlementAccountId===settlement?.id&&isSettlementAccount(settlement);
  if(wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.sourceProduct||wallet.currency!=='CNY'||s.currency!=='CNY'||s.status!=='completed'||s.direction!=='debit'||!(s.kind==='expense'||s.kind==='transfer'&&(isSettlementAccount(settlement)||pendingPurpose))||s.accountRelations?.length||s.investmentTrade||s.loanProof||s.automaticFunding||historicalFunding.has(s.id)||s.paymentChannel&&!mixedChannel||mixedChannel&&s.kind!=='expense'||s.paymentAccountHint||!actualSecond(s)||s.date!==debit.date||s.amountMinor!==String(amount)&&!differenceAnnotation||!Number.isInteger(delay)||delay<0||delay>(namedCashOrder||telecomPayment||legacyPayment||purposeOnly||settlementOnly?86400:60)||r['\u6536/\u652f']!=='\u652f\u51fa'||!(r['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'||telecomPayment&&r['\u4ea4\u6613\u72b6\u6001']==='\u5145\u503c\u6210\u529f')||r['\u5546\u54c1\u8bf4\u660e']!==s.description||r['\u4ea4\u6613\u8ba2\u5355\u53f7']!==s.sourceTransactionId||r['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==(s.paymentChannel||'')||!/^\d+\.\d{2}$/.test(r['\u91d1\u989d']||'')||BigInt(r['\u91d1\u989d'].replace('.',''))!==BigInt(s.amountMinor)||annotated.has(key(s))&&!purposeOnly&&!settlementOnly&&!pendingPurpose&&!differenceAnnotation)continue;
  const positive=sequences.get(JSON.stringify([wallet.id,debit.importId,debit.balanceEvidence.sequence-1]));if(!positive)continue;const credit=positive.observation,seconds=(Date.parse(debit.occurredAt)-Date.parse(credit.occurredAt))/1000;
  if(namedCashOrder&&s.automaticClassification.bankCreditProofObservationId!==credit.id)continue;
  const bankAmount=positive.incoming,implicitMixed=!s.paymentChannel&&s.kind==='expense'&&bankAmount>0n&&bankAmount<amount;if(difference&&(difference.bankCreditObservationId!==credit.id||proofs.filter(p=>p.observation.financialAccountId===wallet.id&&p.observation.relatedReference===s.sourceTransactionId&&p.outgoing<0n).length!==1))continue;
  if((mixedChannel||implicitMixed?bankAmount<=0n||bankAmount>=amount||mixedChannel&&positive.bank!==mixedChannel[1]:bankAmount!==amount)||positive.outgoing!==0n||credit.date!==s.date||!nativeRecharge(credit)||!positive.bank.endsWith('\u94f6\u884c')||!Number.isInteger(seconds)||seconds<0||seconds>2||annotated.has(key(credit))||annotated.has(key(debit)))continue;
  const competingCredits=proofs.filter(p=>{const o=p.observation,seconds=(Date.parse(debit.occurredAt)-Date.parse(o.occurredAt))/1000;return o.importId===debit.importId&&o.financialAccountId===wallet.id&&o.date===s.date&&nativeRecharge(o)&&p.bank.endsWith('\u94f6\u884c')&&p.incoming>0n&&p.incoming<=amount&&p.outgoing===0n&&seconds>=0&&seconds<=2;});if(competingCredits.length!==1)continue;
  const rules=(policies.get(wallet.id)?.rules||[]).filter(rule=>rule.usage!=='repayment_target'&&norm(rule.channel)===positive.bank&&norm(rule.institution)===positive.bank&&rule.periodStart<=s.date&&rule.periodEnd>=s.date&&(!rule.sourceTransactionIds||rule.sourceTransactionIds.includes(s.sourceTransactionId))&&historicalCardBindingValid(wallet,am.get(rule.financialAccountId),rule));
  if(rules.length!==1)continue;const rule=rules[0],payer=am.get(rule.financialAccountId);if((mixedChannel||implicitMixed||difference)&&payer.type!=='credit_card')continue;
  // A real bank debit must be reconciled as another source of the same event;
  // this missing-original path must never invent an additional bank posting.
  const dates=[-1,0,1].map(offset=>new Date(Date.parse(s.date)+offset*86400000).toISOString().slice(0,10));if(dates.some(date=>[String(bankAmount),...(difference?[s.amountMinor]:[])].some(value=>bankCash.has(JSON.stringify([payer.id,date,value,s.currency])))))continue;
  const members=[s,credit,debit],identities=new Set(members.map(key)),veto=vetoes.some(l=>{const ids=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(key);return l.type==='group_distinct'?ids.some(id=>identities.has(id)):ids.length===l.observationIds.length&&ids.every(id=>identities.has(id));})||active.some(l=>(l.type==='duplicate'||mixedChannel||implicitMixed||difference)&&l.observationIds.some(id=>byId.has(id)&&identities.has(key(byId.get(id))))&&l.observationIds.some(id=>!byId.has(id)||!identities.has(key(byId.get(id)))));
  if((mixedChannel||implicitMixed)&&[s.feeMinor,s.interestMinor].some(v=>v!==undefined&&v!==null&&v!=='0'))continue;
  proposals.push({s,credit,debit,payer,rule,members,bankAmount,difference,differenceAnnotationId:differenceAnnotation?annotation.id:null,mixed:Boolean(mixedChannel||implicitMixed),implicitMixed,blocked:veto,preservedPurposeAnnotationId:purposeOnly||settlementOnly||pendingPurpose?annotation.id:null});
 }
 const uses=new Map();for(const p of proposals)for(const o of p.members)uses.set(key(o),(uses.get(key(o))||0)+1);
 const out=new Map();for(const p of proposals){if(p.blocked||p.members.some(o=>uses.get(key(o))!==1))continue;
  out.set(p.s.id,{financialAccountId:p.payer.id,method:'native_bank_funded_order',confidence:'inferred_unique_order_and_native_cash_pair',cardIdentityConfidence:p.rule.confidence,identityBasis:'native_printed_bank_and_owner_scoped_historical_card',statementBank:p.rule.institution,statementCardTailPrinted:false,maskedIdentifier:p.payer.maskedIdentifier,identityPolicyConfirmedAt:p.rule.confirmedAt,identityPolicyPeriodStart:p.rule.periodStart,identityPolicyPeriodEnd:p.rule.periodEnd,evidenceObservationIds:p.members.map(o=>o.id),proofObservationIds:[p.credit.id,p.debit.id],sourceTransactionId:p.s.sourceTransactionId,amountMinor:p.difference?String(p.bankAmount):p.s.amountMinor,...(p.difference?{actualPaidMinor:String(p.bankAmount),orderAmountMinor:p.s.amountMinor,paymentDifferenceMinor:p.difference.discountMinor,paymentDifferenceClassification:'credit_payment_discount',paymentDifferenceConfidence:'owner_authorized_inferred',paymentDifferenceBasis:p.difference.basis,paymentDifferenceAnnotationId:p.differenceAnnotationId,amountBasis:'original_native_wallet_payment'}:{}),...(p.mixed?{paymentMode:'bank_and_wallet',paymentModeBasis:p.implicitMixed?'complete_native_cash_breakdown_with_missing_export_channel':'explicit_export_mixed_channel',bankAmountMinor:String(p.bankAmount),walletAmountMinor:String(BigInt(p.s.amountMinor)-p.bankAmount),walletAccountId:p.s.financialAccountId}:{}),orderOccurredAt:p.s.occurredAt,proofCreditOccurredAt:p.credit.occurredAt,proofDebitOccurredAt:p.debit.occurredAt,reversible:true,...(p.preservedPurposeAnnotationId?{preservedPurposeAnnotationId:p.preservedPurposeAnnotationId}:{})});
 }
 return out;
}
function addNativeBankFundedOrderBridges(transactions,funding,observations,plans){
 if(!funding.size)return plans;const sources=new Map(observations.map(o=>[o.id,o]));
 for(const t of transactions)for(const id of t.observationIds){const plan=funding.get(id);if(!plan||plan.paymentMode==='bank_and_wallet'||t.automaticFunding?.method!=='native_bank_funded_order'||t.automaticFunding.financialAccountId!==plan.financialAccountId)continue;
  const source=sources.get(id),credit=sources.get(plan.proofObservationIds[0]),debit=sources.get(plan.proofObservationIds[1]),amount=BigInt(plan.amountMinor);if(!source||!credit||!debit||BigInt(t.balanceEffects[plan.financialAccountId]||0)!==-amount||BigInt(t.balanceEffects[source.financialAccountId]||0)!==0n||BigInt(t.cashEffects[source.financialAccountId]||0)!==0n)continue;
  if((plans.get(t.id)||[]).some(p=>p.proofObservationIds.some(id=>plan.proofObservationIds.includes(id))))continue;
  const bridge={financialAccountId:source.financialAccountId,sourceObservationId:id,method:'native_wallet_intermediary_postings',confidence:plan.confidence,cashEvidenceConfidence:'explicit_original_cash_postings',path:'historical_card_top_up_and_order_payment',amountMinor:plan.amountMinor,netDeltaMinor:'0',proofObservationIds:plan.proofObservationIds,payerAccountId:plan.financialAccountId,cardIdentityConfidence:plan.cardIdentityConfidence,reversible:true,events:[{occurredAt:credit.occurredAt,date:credit.date,deltaMinor:amount,observationId:credit.id},{occurredAt:debit.occurredAt,date:debit.date,deltaMinor:-amount,observationId:debit.id}]};plans.set(t.id,[...(plans.get(t.id)||[]),bridge]);
 }
 return plans;
}
module.exports={findNativeBankFundedOrders,addNativeBankFundedOrderBridges};

// A mixed payment is one purchase with two real funding legs. The wallet's
// bank top-up and full merchant debit remain separate native balance events;
// their nonzero net is the wallet portion, not a second purchase.
function nativeBankMixedAllocation(source,sources,funding){
 const p=funding.get(source.id);if(p?.paymentMode!=='bank_and_wallet')return null;
 if(sources.length!==1||sources[0].id!==source.id||source.kind!=='expense'||source.direction!=='debit'||source.amountMinor!==p.amountMinor||source.automaticFunding?.financialAccountId!==p.financialAccountId)throw new Error('NATIVE_BANK_MIXED_PAYMENT_CONFLICT');
 return {plan:p,parts:[{financialAccountId:p.financialAccountId,amountMinor:p.bankAmountMinor},{financialAccountId:p.walletAccountId,amountMinor:p.walletAmountMinor}]};
}
function withNativeBankMixedCashEvents(transaction,allocation,observations){
 if(!allocation)return transaction;
 const p=allocation.plan,walletId=p.walletAccountId,amount=BigInt(p.amountMinor),bankAmount=BigInt(p.bankAmountMinor),walletAmount=BigInt(p.walletAmountMinor),byId=new Map(observations.map(o=>[o.id,o])),credit=byId.get(p.proofObservationIds[0]),debit=byId.get(p.proofObservationIds[1]);
 if(!credit||!debit||bankAmount+walletAmount!==amount||BigInt(transaction.balanceEffects[p.financialAccountId]||0)!==-bankAmount||BigInt(transaction.balanceEffects[walletId]||0)!==-walletAmount||BigInt(transaction.cashEffects[walletId]||0)!==-walletAmount||transaction.balanceEffectEvents?.[walletId]||transaction.walletIntermediaryPostings?.some(b=>b.financialAccountId===walletId))throw new Error('NATIVE_BANK_MIXED_CASH_CONFLICT');
 const events=[{occurredAt:credit.occurredAt,date:credit.date,deltaMinor:bankAmount,observationId:credit.id},{occurredAt:debit.occurredAt,date:debit.date,deltaMinor:-amount,observationId:debit.id}];
 return {...transaction,balanceEffectEvents:{...transaction.balanceEffectEvents,[walletId]:events},cashEffectEvents:{...transaction.cashEffectEvents,[walletId]:[{date:debit.date,deltaMinor:-walletAmount}]},nativeMixedPayment:{...p,events,netWalletDeltaMinor:String(-walletAmount)}};
}
module.exports.nativeBankMixedAllocation=nativeBankMixedAllocation;
module.exports.withNativeBankMixedCashEvents=withNativeBankMixedCashEvents;
