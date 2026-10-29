'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const {isLegacyAlipayPurchase}=require('./legacyAlipayPurchases');
const {actualSecond}=require('./mixedPayments');
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const paymentLabel=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
function namedOldGatewayRetail(source){
 if(source.direction!=='debit'||!/^20\d{14}$/.test(source.sourceTransactionId||'')||!source.sourceTransactionId.startsWith(String(source.date||'').replace(/-/g,'')))return false;
 const description=String(source.description||'').normalize('NFKC'),merchant=source.relatedReference||'',party=String(source.counterparty||'').normalize('NFKC');
 const meituan=party==='\u7f8e\u56e2/\u5927\u4f17\u70b9\u8bc4'&&/^(?:\d{19}|b-\d{6,12}-\d{10})$/.test(merchant)&&/^\u7f8e\u56e2\u7f51(?:[1-9]\d{0,2}\u79cd\u5546\u54c1|\s*-\s*\u8ba2\u5355\u7f16\u53f7\d{6,20})$/.test(description);
 const breakfast=party==='\u676d\u5dde\u7518\u5176\u98df\u9910\u996e\u7ba1\u7406\u6709\u9650\u516c\u53f8'&&/^\d{13}$/.test(merchant)&&/^\u626b\u7801-\u7518\u5176\u98df(?=.*(?:\u5957\u9910|\u5305\u5b50|\u8c46\u6d46)).{1,60}$/.test(description);
 const books=party==='\u5317\u4eac\u5f53\u5f53\u79d1\u6587\u7535\u5b50\u5546\u52a1\u6709\u9650\u516c\u53f8'&&description==='\u5f53\u5f53\u8ba2\u5355'&&/^\d{8,14}$/.test(merchant);
 const coach=party==='\u6052\u751f\u7535\u5b50\u80a1\u4efd\u6709\u9650\u516c\u53f8'&&description==='\u5ba2\u8fd0\u6c7d\u8f66\u7968'&&/^\d{12}$/.test(merchant);
 const cinema=party==='\u7f51\u6613\u5b9d\u6709\u9650\u516c\u53f8'&&/^\d{6,16}$/.test(merchant)&&/^.{2,80}-.{2,40}\u5f71\u9662$/u.test(description);
 const travel=party==='\u643a\u7a0b\u65c5\u884c\u7f51'&&description==='Ctrip Group'&&/^\d{6,10}-\d{8,16}$/.test(merchant);
 const presale=party==='\u4e0a\u6d77\u683c\u74e6\u5546\u52a1\u4fe1\u606f\u54a8\u8be2\u6709\u9650\u516c\u53f8'&&/^\d{12,20}$/.test(merchant)&&/^\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\u524d\u4ed8\u6b3e\u300a[^\u300a\u300b]{1,80}\u300b[1-9]\d*(?:\.\d{1,2})?\u5143\u9884\u552e$/.test(description);
 return Boolean(meituan||cinema||travel||presale||breakfast||books||coach);
}
function namedNativeRetail(source){
 if(namedOldGatewayRetail(source))return true;
 if(source.direction!=='debit'||!/^\d{8}0000100025\d{8,16}$/.test(source.sourceTransactionId||'')||!source.sourceTransactionId.startsWith(source.date.replace(/-/g,'')))return false;
 const movie=source.counterparty==='\u7f8e\u56e2/\u5927\u4f17\u70b9\u8bc4'&&/^\u732b\u773c\u7535\u5f71-\u8ba2\u5355\u7f16\u53f7:\d+$/.test(source.description)&&/^\d{20}$/.test(source.relatedReference||'');
 const order=source.description.match(/^yintai\.com SO#: \*{4}(\d{4})$/),retail=source.counterparty==='\u6d59\u6c5f\u94f6\u6cf0\u7535\u5b50\u5546\u52a1\u6709\u9650\u516c\u53f8'&&order&&/^\d{14}$/.test(source.relatedReference||'')&&source.relatedReference.endsWith(order[1]);
 return Boolean(movie||retail);
}
function nativeSponsoredPaymentBatches(proofs){
 const sequences=new Map(proofs.map(p=>[JSON.stringify([p.observation.financialAccountId,p.observation.importId,p.observation.balanceEvidence.sequence]),p])),batches=[];
 for(const credit of proofs){
  const c=credit.observation,payer=c.description.match(/^\u8f6c\u8d26\u4ee3\u4ed8\u8f6c\u8d26,\u4ee3\u4ed8\u4eba:([^\s,]+?)\u4ee3\u4ed8\u7533\u8bf7(?:\.\.\.)?$/);
  if(!payer||credit.incoming<=0n||credit.outgoing!==0n||credit.bank!=='\u652f\u4ed8\u5b9d')continue;
  const debits=[];let amount=0n;
  for(let offset=1;offset<=10;offset++){
   const p=sequences.get(JSON.stringify([c.financialAccountId,c.importId,c.balanceEvidence.sequence+offset])),o=p?.observation,gap=o?Date.parse(o.occurredAt)-Date.parse(c.occurredAt):-1;
   if(!p||p.incoming!==0n||p.outgoing>=0n||p.bank!=='\u652f\u4ed8\u5b9d'||o.description!=='\u5728\u7ebf\u652f\u4ed8'||o.date!==c.date||gap<0||gap>60000)break;
   debits.push(p);amount-=p.outgoing;if(amount>=credit.incoming)break;
  }
  if(!debits.length||amount!==credit.incoming)continue;
  batches.push({schema:'native-sponsored-wallet-payment-v1',financialAccountId:c.financialAccountId,creditProofObservationId:c.id,debitProofObservationIds:debits.map(p=>p.observation.id),sourceOrderReferences:debits.map(p=>p.observation.relatedReference),amountMinor:String(amount),payerHint:payer[1],payerIdentityKnown:false,personalConsumptionAssumed:false,cashChainBasis:'balanced_contiguous_native_sponsorship_credit_and_order_debits',events:[{observationId:c.id,occurredAt:c.occurredAt,deltaMinor:String(amount)},...debits.map(p=>({observationId:p.observation.id,occurredAt:p.observation.occurredAt,deltaMinor:String(p.outgoing)}))],reversible:true});
 }
 return batches;
}
function findNativeWalletPurchases(observations,accounts,cashPostings,{excludedCounterparties=new Set(),blockedSourceKeys=new Set(),annotations=[],links=[]}={}){
 if(!cashPostings.size)return new Map();
 const am=new Map(accounts.map(a=>[a.id,a])),proofs=new Map(validatedWalletProofs(observations,am).map(p=>[p.observation.id,p])),result=new Map();
 const sequenceProofs=new Map([...proofs.values()].map(p=>[JSON.stringify([p.observation.financialAccountId,p.observation.importId,p.observation.balanceEvidence.sequence]),p]));
 const sponsored=new Set(nativeSponsoredPaymentBatches([...proofs.values()]).flatMap(b=>b.debitProofObservationIds));
 let productFunding;
 for(const source of observations){
  const plan=cashPostings.get(source.id),raw=source.rawFields||{},wallet=am.get(source.financialAccountId),namedRetail=namedNativeRetail(source);
  if(!plan||source.provider!=='alipay'||source.kind!=='transfer'||!(source.direction==='neutral'||namedRetail)||source.status!=='completed'||source.currency!=='CNY'||!/^\d+$/.test(source.amountMinor)||BigInt(source.amountMinor)<=0n||source.accountRelations?.length||source.paymentAccountHint||source.investmentTrade||source.loanProof||source.statementFlow||source.bankStatement||source.brokerage||blockedSourceKeys.has(identity(source))||wallet?.type!=='wallet'||wallet.provider!=='alipay'||wallet.sourceProduct||wallet.status!=='active'||wallet.currency!==source.currency||!['','\u4f59\u989d','\u652f\u4ed8\u5b9d\u4f59\u989d','\u8d26\u6237\u4f59\u989d'].includes(source.paymentChannel)||!actualSecond(source)||excludedCounterparties.has(String(source.counterparty||'').normalize('NFKC').trim()))continue;
  if(plan.method!=='native_order_wallet_cash_posting'||plan.sourceObservationId!==source.id||plan.financialAccountId!==source.financialAccountId||plan.deltaMinor!==String(-BigInt(source.amountMinor)))continue;
  const proof=proofs.get(plan.proofObservationId),p=proof?.observation,elapsed=p?Date.parse(p.occurredAt)-Date.parse(source.occurredAt):-1;
  if(!p||sponsored.has(p.id)||p.financialAccountId!==source.financialAccountId||p.currency!==source.currency||p.relatedReference!==source.sourceTransactionId||proof.delta!==-BigInt(source.amountMinor)||!(p.description==='\u5728\u7ebf\u652f\u4ed8'||namedRetail&&paymentLabel(p.description)===paymentLabel('\u652f\u4ed8-'+source.description))||plan.occurredAt!==p.occurredAt||plan.date!==p.date||elapsed<0||elapsed>31*86400000)continue;
  if(!(source.direction==='neutral'&&raw['\u6536/\u652f']==='\u4e0d\u8ba1\u6536\u652f'||namedRetail&&raw['\u6536/\u652f']==='\u652f\u51fa')||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||raw['\u5546\u54c1\u8bf4\u660e']!==source.description||raw['\u4ea4\u6613\u5bf9\u65b9']!==source.counterparty||raw['\u4ea4\u6613\u65f6\u95f4']!==source.date+' '+source.occurredAt.slice(11,19)||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==source.paymentChannel||raw['\u4ea4\u6613\u5206\u7c7b']!==source.category||raw['\u4ea4\u6613\u5206\u7c7b']!=='\u8f6c\u8d26\u7ea2\u5305'||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==source.sourceTransactionId||raw['\u5546\u5bb6\u8ba2\u5355\u53f7']!==source.relatedReference||!/^20\d{14,38}$/.test(source.sourceTransactionId)||!/^\d+\.\d{2}$/.test(raw['\u91d1\u989d']||'')||BigInt(raw['\u91d1\u989d'].replace('.',''))!==BigInt(source.amountMinor))continue;
  // The independent cash row has established a debit. Reuse only the ordinary
  // merchant-purpose guard with that interpretation; never alter the raw export.
  const cashPurpose={...source,direction:'debit',rawFields:{...raw,'\u6536/\u652f':'\u652f\u51fa'}};
  const retail=isLegacyAlipayPurchase(cashPurpose,{excludedCounterparties});
  const service=source.counterparty==='\u6dd8\u5b9d\uff08\u4e2d\u56fd\uff09\u8f6f\u4ef6\u6709\u9650\u516c\u53f8'&&/^\u5145\u503c:\u670d\u52a1\u5e02\u573a.+\u8ba2\u5355\u4ed8\u6b3e \u4e1a\u52a1\u4ea4\u6613\u53f7:\d+$/.test(source.description)&&/^\d{16,32}$/.test(source.relatedReference)&&!/[\u501f\u8d37]|\u62bc\u91d1|\u4fdd\u8bc1\u91d1|\u9000\u6b3e|\u63d0\u73b0|\u7406\u8d22|\u57fa\u91d1/.test(source.description);
  if(!retail&&!service&&!namedRetail)continue;
  const prior=sequenceProofs.get(JSON.stringify([source.financialAccountId,p.importId,p.balanceEvidence.sequence-1])),priorGap=prior?Date.parse(p.occurredAt)-Date.parse(prior.observation.occurredAt):-1,bankTopUp=namedRetail&&prior?.observation.description==='\u5145\u503c'&&prior.bank.endsWith('\u94f6\u884c')&&prior.incoming===BigInt(source.amountMinor)&&prior.outgoing===0n&&priorGap>=0&&priorGap<=2000;
  const productTopUp=namedRetail&&source.paymentChannel===''&&prior?.bank==='\u5929\u5f18\u57fa\u91d1'&&prior.observation.description==='\u7406\u8d22\u8d4e\u56de\u8d44\u91d1\u8f6c\u5165\u652f\u4ed8\u5b9d\u8d26\u6237\u4f59\u989d\u5b9d\u652f\u4ed8'&&prior.incoming===BigInt(source.amountMinor)&&prior.outgoing===0n&&priorGap>=0&&priorGap<=2000;
  let productPlan;
  if(productTopUp){
   // Preserve the independently proven product payer; never fall back to wallet cash.
   productFunding??=require('./walletIntermediaryPostings').findNativeYuebaoFunding(observations,accounts,{annotations,links});
   productPlan=productFunding.get(source.id);if(!productPlan)continue;
  }
  const preserveFunding=bankTopUp||productTopUp;
  const converted={...source,kind:'expense',direction:'debit',date:preserveFunding?source.date:p.date,occurredAt:preserveFunding?source.occurredAt:p.occurredAt,paymentChannel:preserveFunding?source.paymentChannel:'\u4f59\u989d',automaticClassification:{method:namedRetail?'original_debit_order_native_wallet_payment':'original_neutral_order_native_wallet_payment',confidence:'explicit_native_order_and_balanced_wallet_debit',evidenceObservationIds:[source.id,p.id],sourceIncomeExpenseLabel:raw['\u6536/\u652f'],sourceDirection:source.direction,sourceOccurredAt:source.occurredAt,actualPaymentOccurredAt:p.occurredAt,financialAccountId:source.financialAccountId,...(bankTopUp?{nativeBankFundingRequired:true,bankCreditProofObservationId:prior.observation.id}:{}),...(productPlan?{nativeProductFundingRequired:true,productFundingAccountId:productPlan.financialAccountId,productFundingEvidenceObservationIds:productPlan.evidenceObservationIds}:{}),reversible:true}};
  if(bankTopUp){
   // A real bank top-up must retain its payer route. Never force a wallet
   // expense when owner identity, original bank cash or a veto prevents it.
   const preview=observations.map(o=>o.id===source.id?converted:o),annotatedIds=new Set(observations.filter(o=>blockedSourceKeys.has(identity(o))).map(o=>o.id)),funding=require('./nativeBankFundedOrders').findNativeBankFundedOrders(preview,accounts,{annotatedIds,links});
   if(!funding.has(source.id))continue;
  }
  result.set(source.id,converted);
 }
 return result;
}
module.exports={findNativeWalletPurchases,nativeSponsoredPaymentBatches};
