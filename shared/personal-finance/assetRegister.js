'use strict';
const {annotatedSettlementAccount,isSettlementAccount,inferredSettlementAccount}=require('./counterpartySettlements');
const {ACCOUNT_PRODUCTS,inferAccountRelations}=require('./accountProducts');
const {statementBalances}=require('./balanceEvidence');
const {matchesMortgage}=require('./mortgages');
const {annotatedCounterAccount}=require('./statementAccounts');
const {refreshHistoricalInvestmentRoute}=require('./historicalInvestmentRoutes');
const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
const bankName=v=>norm(v).replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe|\u5de5\u5546|\u519c\u4e1a|\u6c11\u751f|\u90ae\u653f)/,'').replace('\u90ae\u653f\u50a8\u84c4\u94f6\u884c','\u90ae\u50a8\u94f6\u884c');
function fundingIdentity(channel){
 const m=norm(channel).split('&')[0].match(/^(?:\u4e91\u95ea\u4ed8-)?(.+?\u94f6\u884c)(\u4fe1\u7528\u5361\u5206\u671f|\u4fe1\u7528\u5361|\u50a8\u84c4\u5361|\u501f\u8bb0\u5361)?\((\d{4})\)/);
 return m?{bank:bankName(m[1]),type:/\u4fe1\u7528/.test(m[2]||'')?'credit_card':m[2]?'debit_card':null,tail:m[3]}:null;
}
function sameBankAccount(a,f,currency){
 const tail=norm(a.maskedIdentifier).match(/(\d{4})\)?$/)?.[1],bank=fundingIdentity(a.label)?.bank||bankName(a.provider);
 return a.currency===currency&&(!f.type||a.type===f.type)&&tail===f.tail&&bank===f.bank;
}
function accountProposals(ledger){
 const accounts=ledger.accounts||[],candidates=new Map(),issues=new Map(),types=new Map();
 const transit=require('./nativeTransitStoredValue').transitAccountProposal(ledger.observations||[],accounts);if(transit)candidates.set(transit.key,transit);
 const sources=(ledger.observations||[]).filter(o=>o.status==='completed'&&!o.balanceEvidence);
 const found=sources.map(o=>({o,f:fundingIdentity(o.paymentChannel)})).filter(x=>x.f);
 for(const {f} of found)if(f.type){const k=f.bank+f.tail;if(!types.has(k))types.set(k,new Set());types.get(k).add(f.type);}
 for(const {o,f} of found){
  if(!f.type){const t=[...(types.get(f.bank+f.tail)||[])],known=[...new Set(accounts.filter(a=>sameBankAccount(a,f,o.currency)&&['debit_card','credit_card'].includes(a.type)).map(a=>a.type))];if(t.length===1)f.type=t[0];else if(!t.length&&known.length===1)f.type=known[0];}
  const key=[f.bank,f.type||'unknown',f.tail,o.currency].join(':');
  if(!f.type){issues.set(key,{reason:'bank_type_unknown',observationId:o.id,bank:f.bank,tail:f.tail});continue;}
  const matches=accounts.filter(a=>sameBankAccount(a,f,o.currency));
  if(matches.length>1||matches.some(a=>a.status==='archived')){issues.set(key,{reason:'bank_account_ambiguous',observationId:o.id,key});continue;}
  if(matches.length||candidates.has(key))continue;
  candidates.set(key,{key,label:f.bank+(f.type==='credit_card'?'\u4fe1\u7528\u5361':'\u50a8\u84c4\u5361')+'\uff08'+f.tail+'\uff09',provider:f.bank,type:f.type,maskedIdentifier:f.tail,currency:o.currency,balanceConvention:'signed',openingBalanceMinor:null,openingDate:null,status:'active'});
 }
 if(sources.some(o=>norm(o.paymentChannel).startsWith('\u4e0a\u6d77\u94f6\u884c\u4fe1\u7528\u8d2d'))&&!accounts.some(a=>a.sourceProduct==='alipay_shanghai_credit'))
  candidates.set('alipay_shanghai_credit:CNY',{key:'alipay_shanghai_credit:CNY',label:'\u4e0a\u6d77\u94f6\u884c\u4fe1\u7528\u8d2d',provider:'alipay',type:'credit_card',maskedIdentifier:'',currency:'CNY',sourceProduct:'alipay_shanghai_credit',balanceConvention:'signed',openingBalanceMinor:null,openingDate:null,status:'active'});
 for(const o of sources){
  const supported=o.provider==='wechat'&&o.kind==='transfer'&&o.rawFields?.['\u4ea4\u6613\u7c7b\u578b']==='\u8d2d\u4e70\u7406\u8d22\u901a'?'wechat_licaitong':o.provider==='alipay'&&o.kind==='debt_payment'&&[o.description,o.counterparty].join(' ').includes('\u5148\u91c7\u540e\u4ed8')?'alipay_1688_credit':o.provider==='alipay'&&/^\u5b58\u91d1\u5b9d-/.test(o.description)?'alipay_cunjinbao':o.provider==='alipay'&&o.kind==='transfer'&&/^\u6570\u5b57\u4eba\u6c11\u5e01-\u8f6c[\u5165\u51fa]$/.test(o.description)?'alipay_ecny':null;
  const namedProduct=inferAccountRelations(o,o.provider).find(r=>r.role==='target'&&['alipay_feiyuebao','alipay_chaoyuebao','alipay_1688_chengeshe','alipay_guohua_no1_enhanced'].includes(r.product))?.product;
  const reward=inferAccountRelations(o,o.provider).find(r=>r.product==='jd_gangbeng')?.product;
  const legacyWithdrawal=require('./legacyWechatInvestmentWithdrawals').nativeLegacyWechatWithdrawal(o)?'wechat_licaitong':null;
  if(!supported&&!namedProduct&&!reward&&!legacyWithdrawal)continue;
  for(const relation of inferAccountRelations(o,o.provider)){
   if(![supported,namedProduct,reward,legacyWithdrawal].includes(relation.product)||accounts.some(a=>a.sourceProduct===relation.product&&a.currency===o.currency))continue;
   const p=ACCOUNT_PRODUCTS[relation.product],key=relation.product+':'+o.currency;
   candidates.set(key,{key,label:p.label,provider:p.provider,type:p.type,sourceProduct:relation.product,maskedIdentifier:'',currency:o.currency,balanceConvention:'signed',openingBalanceMinor:null,openingDate:null,status:'active'});
  }
 }
 return {accounts:[...candidates.values()],unresolved:[...issues.values()]};
}
const unitsMinor=v=>{const[a,b='']=String(v).split('.');return BigInt(a)*1000000000000n+BigInt(b.padEnd(12,'0'));};
const unitsText=v=>{const a=v<0n?-v:v;return(v<0n?'-':'')+String(a/1000000000000n)+'.'+String(a%1000000000000n).padStart(12,'0').replace(/0+$/,'').padEnd(2,'0');};
function buildAssetRegister(ledger){
 if((ledger.observations||[]).some(o=>o.bankNetwork)){
  const network=ledger.observations.filter(o=>o.bankNetwork),economic=ledger.observations.filter(o=>!o.bankNetwork),ids=new Set(economic.map(o=>o.id)),accountMap=new Map((ledger.accounts||[]).map(a=>[a.id,a])),versions=new Map();
  for(const record of network){
   require('./unionpayNetworkStatement').validateBankNetwork(record.bankNetwork,record);const a=accountMap.get(record.financialAccountId),e=record.bankNetwork;
   if(record.provider!=='unionpay'||!a||!['debit_card','credit_card'].includes(a.type)||a.currency!=='CNY'||a.provider!==e.bank||a.maskedIdentifier!==e.cardTail||record.bankAccount?.type!==a.type)throw new Error('CLOUD_PERSONAL_FINANCE_NETWORK_ACCOUNT_MISMATCH');
   const key=JSON.stringify([record.financialAccountId,record.provider,record.sourceIdentity||record.id]),old=versions.get(key);if(!old||(record.sourceVersionOrdinal||1)>(old.sourceVersionOrdinal||1))versions.set(key,record);
  }
  // Supplemental channel evidence must not compete with a confirmed native
  // cash leg in withdrawal, stored-value, loan or historical funding inference.
  const base=buildAssetRegister({...ledger,observations:economic,annotations:(ledger.annotations||[]).filter(a=>ids.has(a.observationId)),links:(ledger.links||[]).filter(l=>(l.observationIds||[]).every(id=>ids.has(id)))});
  for(const a of base.accounts){const added=[...versions.values()].filter(o=>o.financialAccountId===a.id&&o.status==='completed');if(!added.length)continue;a.evidenceCount+=added.length;a.channels=[...new Set([...a.channels,'unionpay'])];const dates=[a.firstDate,a.lastDate,...added.map(o=>o.date)].filter(Boolean).sort();a.firstDate=dates[0]||null;a.lastDate=dates.at(-1)||null;}
  return base;
 }
 const accounts=ledger.accounts||[],versions=new Map();
 const annotations=new Map();for(const annotation of ledger.annotations||[])if(!annotations.has(annotation.observationId)||BigInt(annotation.revision)>BigInt(annotations.get(annotation.observationId).revision))annotations.set(annotation.observationId,annotation);
 const refundPurposeInputs=(ledger.observations||[]).map(o=>o.provider==='alipay'&&o.kind==='refund'?require('./neutralWalletRefunds').refreshNeutralWalletRefund(o,accounts):o),refundProvenPurchases=require('./closedHuabeiPurchases').findRefundProvenClosedHuabeiPurchases(refundPurposeInputs,accounts,{annotatedIds:new Set([...annotations].filter(([,a])=>!a.reset).map(([id])=>id)),links:ledger.links||[]});
 const settlementSourceKey=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),settlementPolicyOverrides=new Set((ledger.observations||[]).filter(o=>annotations.has(o.id)).map(settlementSourceKey));
 for(const original of ledger.observations||[]){const o=refundProvenPurchases.has(original.id)?{...original,...refundProvenPurchases.get(original.id)}:original;if(o.status!=='completed')continue;const key=[o.financialAccountId,o.provider,o.sourceIdentity||o.id].join(':');if(!versions.has(key)||(o.sourceVersionOrdinal||0)>(versions.get(key).sourceVersionOrdinal||0))versions.set(key,o);}
 const records=[...versions.values()].filter(o=>o.status==='completed').map(o=>annotations.has(o.id)?o:!settlementPolicyOverrides.has(settlementSourceKey(o))?require('./legacyWechatInvestmentWithdrawals').refreshLegacyWechatWithdrawal(refreshHistoricalInvestmentRoute(o,accounts),accounts):refreshHistoricalInvestmentRoute(o,accounts)),confirmations=records.filter(o=>o.investmentTrade),funds=new Map();
 const historicalFundingOptions={annotatedIds:new Set([...annotations].filter(([,a])=>!a.reset).map(([id])=>id)),links:ledger.links||[],statementOwners:require('./statementOwnership').statementOwners(ledger.imports||[],ledger.observations||[])};
 // Use the same purpose-only boundary as the transaction view. An expense
 // label does not remove independent, previously confirmed card evidence.
 const cardIdentityOriginals=new Map((ledger.observations||[]).map(o=>[o.id,o])),cardIdentityBlockers=new Set([...historicalFundingOptions.annotatedIds].filter(id=>!require('./legacyAlipayPurchases').sourceOnlyPurposeReview(cardIdentityOriginals.get(id),annotations.get(id)))),historicalFunding=require('./historicalCardBindings').findHistoricalCardBindings(ledger.observations||[],accounts,{...historicalFundingOptions,annotatedIds:cardIdentityBlockers});
 for(const [id,funding]of require('./nativeNamedChannelFunding').findNativeNamedChannelFunding(ledger.observations||[],accounts,{...historicalFundingOptions,historicalFunding}))historicalFunding.set(id,funding);
 for(const [id,funding]of require('./walletStatementTopUps').findWalletStatementTopUpFunding(ledger.observations||[],accounts,{...historicalFundingOptions,historicalFunding}))historicalFunding.set(id,funding);
 for(const [id,funding]of require('./recalledProductFunding').findRecalledProductFunding(ledger.observations||[],accounts,{...historicalFundingOptions,balanceEvidenceObservations:(ledger.observations||[]).filter(o=>o.balanceEvidence),balanceEvidenceImports:ledger.imports||[]}))historicalFunding.set(id,funding);
 for(const [id,funding]of require('./walletIntermediaryPostings').findNativeYuebaoFunding(ledger.observations||[],accounts,{annotations:ledger.annotations||[],links:ledger.links||[]}))historicalFunding.set(id,funding);
 const nativePensionRoutes=require('./nativePensionCashRoutes').findNativePensionCashRoutes(ledger.observations||[],accounts,historicalFundingOptions);for(const [id,funding]of [...nativePensionRoutes.funding,...nativePensionRoutes.bankDestinations])historicalFunding.set(id,funding);
 const legacyPurchases=require('./legacyNativePurchases'),purchaseInputs=legacyPurchases.legacyPurchaseFundingInputs(ledger.observations||[],accounts,annotations,historicalFundingOptions.statementOwners);
 for(const [id,funding]of require('./nativeBankFundedOrders').findNativeBankFundedOrders(purchaseInputs,accounts,{...historicalFundingOptions,annotations,historicalFunding}))historicalFunding.set(id,funding);
 for(const [id,funding]of legacyPurchases.findLegacyNativePurchaseFunding(purchaseInputs,accounts,{...historicalFundingOptions,annotations,historicalFunding}))historicalFunding.set(id,funding);
 for(const [id,funding]of require('./medicalSettlements').medicalSettlementFunding(ledger.observations||[],accounts,annotations,ledger.links||[]))historicalFunding.set(id,funding);
 const storedValueTopUps=require('./storedValueTopUps').findStoredValueTopUps(ledger.observations||[],accounts,{annotatedIds:new Set((ledger.annotations||[]).map(a=>a.observationId)),links:ledger.links||[]});
 const withdrawalDestinations=require('./walletWithdrawalDestinations').resolveWithdrawalDestinations(ledger.observations||[],accounts,{annotatedIds:new Set([...annotations].filter(([,a])=>!a.reset).map(([id])=>id))}),withdrawalTargets=new Set([...withdrawalDestinations.values()].map(r=>r.financialAccountId));
 const ownerBankDestinations=new Map(),ownerBankHelper=require('./ownerAlipayBankDestinations');
 const recalledRoutes=new Map();for(const source of records)if(annotations.get(source.id)?.patch?.recalledAccountRoute){try{const effective=require('./recalledAccountRoutes').recalledAccountRoute(source,annotations.get(source.id),ledger);if(effective)recalledRoutes.set(source.id,effective);}catch{/* Recollection is never promoted over conflicting original evidence. */}}
 for(const source of records)if(ownerBankHelper.isAnnotation(annotations.get(source.id))){try{ownerBankDestinations.set(source.id,ownerBankHelper.ownerAlipayBankDestination(source,annotations.get(source.id),accounts).ownerBankDestination);}catch{/* Invalid or withdrawn owner choices are not documentary identity evidence. */}}
 for(const o of confirmations){
  const t=o.investmentTrade;if(!t.fundCode)continue;const key=[o.financialAccountId,t.fundCode,o.currency].join(':');
  if(!funds.has(key))funds.set(key,{key,financialAccountId:o.financialAccountId,code:t.fundCode,name:t.fundName,currency:o.currency,boughtUnits:0n,grossMinor:0n,feeMinor:0n,count:0,conversionOutAppliedUnits:0n,conversionInMinor:0n,sourceObservationIds:[],status:'buy_confirmations',balanceMinor:null});
  const f=funds.get(key);if(t.tradeType==='buy'){f.boughtUnits+=unitsMinor(t.confirmedUnits);f.grossMinor+=BigInt(t.confirmedAmountMinor);f.feeMinor+=BigInt(t.feeMinor);f.count++;f.sourceObservationIds.push(o.id);}
 }
 const conversions=confirmations.filter(o=>o.investmentTrade.tradeType==='conversion').map(o=>{
  const t=o.investmentTrade,matches=records.filter(r=>!r.investmentTrade&&r.provider===o.provider&&r.financialAccountId===o.financialAccountId&&r.sourceTransactionId===t.orderId&&r.currency===o.currency&&r.amountMinor===t.appliedAmountMinor&&r.date===t.confirmedAt.slice(0,10)&&r.description.includes('\u300c\u8f6c\u6362\u81f3\u300d'));
  const result={id:o.id,orderId:t.orderId,appliedAt:o.occurredAt,confirmedAt:t.confirmedAt,amountMinor:t.appliedAmountMinor,feeMinor:t.feeMinor,appliedUnits:t.appliedUnits,sourceFundCode:null,targetFundCode:null,sourceFundName:null,targetFundName:null,confirmedInUnits:null,evidenceObservationIds:[o.id],status:'unresolved'};
  if(matches.length!==1)return result;const m=norm(matches[0].description).match(/^\u8682\u8681\u8d22\u5bcc-(.+?)-\u300c\u8f6c\u6362\u81f3\u300d-(.+?)-\u8f6c\u5165\u6210\u529f$/);if(!m)return result;
  const find=name=>[...funds.values()].filter(f=>f.financialAccountId===o.financialAccountId&&norm(f.name)===name&&f.currency===o.currency),from=find(m[1]),to=find(m[2]);
  result.sourceFundName=m[1];result.targetFundName=m[2];result.evidenceObservationIds.push(matches[0].id);
  if(from.length===1){result.sourceFundCode=from[0].code;from[0].conversionOutAppliedUnits+=unitsMinor(t.appliedUnits||'0');from[0].status='conversion_units_pending';}
  if(to.length===1){result.targetFundCode=to[0].code;to[0].conversionInMinor+=BigInt(t.appliedAmountMinor);to[0].status='conversion_units_pending';}
  result.status=from.length===1&&to.length===1?'products_matched':'unresolved';return result;
 });
 const neutralSettlementRecords=records.filter(o=>o.direction==='neutral'&&annotations.get(o.id)?.patch?.settlementAccountId&&!annotations.get(o.id)?.reset),neutralSettlements=new Map();
 if(neutralSettlementRecords.length){const helper=require('./nativeMerchantSettlements'),proofs=helper.settlementCashProofs(ledger);for(const o of neutralSettlementRecords){try{const effective=helper.nativeMerchantSettlement(o,annotations.get(o.id),accounts,ledger.observations||[],proofs);if(effective)neutralSettlements.set(o.id,effective.automaticClassification.financialAccountId);}catch(e){if(e.code!=='COUNTERPARTY_SETTLEMENT_CASH_PROOF_REQUIRED')throw e;}}}
 const nativeMortgage=require('./nativeMortgageStatements').buildNativeMortgageStatements(accounts,records.filter(o=>!require('./nativeMortgageStatements').isNativeMortgageStatement(o)),records.filter(require('./nativeMortgageStatements').isNativeMortgageStatement),{annotatedIds:new Set([...annotations].filter(([,a])=>!a.reset).map(([id])=>id)),links:ledger.links||[]});
 const statementAnchors=[...statementBalances(records,accounts,{includeAvailable:true}),...nativeMortgage.anchors];
 const merchantClaimEvidence=new Map();for(const p of require('./merchantSettlementReceivables').findMerchantSettlementReceivables(ledger)){if(!merchantClaimEvidence.has(p.account.id))merchantClaimEvidence.set(p.account.id,new Set());for(const o of[p.collection,p.withdrawal,p.bankReceipt])merchantClaimEvidence.get(p.account.id).add(o.id);}
 const counterAccountCache=new WeakMap(),fundingMatchCache=new Map();
 const counterAccountFor=o=>{if(!counterAccountCache.has(o))counterAccountCache.set(o,annotatedCounterAccount(o,annotations.get(o.id),accounts));return counterAccountCache.get(o);};
 const fundingMatches=(o,a)=>{let currencies=fundingMatchCache.get(o.paymentChannel);if(!currencies){currencies=new Map();fundingMatchCache.set(o.paymentChannel,currencies);}if(!currencies.has(o.currency)){const f=fundingIdentity(o.paymentChannel);currencies.set(o.currency,new Set(f?accounts.filter(candidate=>sameBankAccount(candidate,f,o.currency)).map(candidate=>candidate.id):[]));}return currencies.get(o.currency).has(a.id);};
 const accountRows=accounts.map(a=>{
  const evidence=records.filter(o=>o.financialAccountId===a.id||historicalFunding.get(o.id)?.financialAccountId===a.id||a.mortgage&&matchesMortgage(o,a.mortgage)||o.accountRelations?.some(r=>r.financialAccountId===a.id)||counterAccountFor(o)?.id===a.id||(()=>{const effective=recalledRoutes.get(o.id);return effective&&(effective.recalledAccountRouteEvidence.sourceAccountId===a.id||effective.recalledAccountRouteEvidence.activity==='investment_withdrawal_receipt'&&effective.accountRelations?.some(r=>r.financialAccountId===a.id));})()||fundingMatches(o,a));
  if(merchantClaimEvidence.has(a.id))for(const o of records)if(merchantClaimEvidence.get(a.id).has(o.id)&&!evidence.includes(o))evidence.push(o);
  const nativeMortgageModel=nativeMortgage.models.find(m=>m.financialAccountId===a.id);if(nativeMortgageModel)for(const o of records)if(nativeMortgageModel.proofObservationIds.includes(o.id)&&!evidence.includes(o))evidence.push(o);
  if(isSettlementAccount(a))for(const o of records)if((o.direction==='neutral'?neutralSettlements.get(o.id):(annotatedSettlementAccount(o,annotations.get(o.id),accounts)||(!settlementPolicyOverrides.has(settlementSourceKey(o))?inferredSettlementAccount(o,accounts):null))?.id)===a.id&&!evidence.includes(o))evidence.push(o);
  if(withdrawalTargets.has(a.id))for(const o of records)if(withdrawalDestinations.get(o.id)?.financialAccountId===a.id&&!evidence.includes(o))evidence.push(o);
  for(const o of records)if(ownerBankDestinations.get(o.id)?.receivingAccountId===a.id&&!evidence.includes(o))evidence.push(o);
  // A destination recollection adds a receipt leg; it does not erase the
  // validated original product or bank payer from the same source document.
  for(const o of records)if(recalledRoutes.get(o.id)?.recalledAccountRouteEvidence.financialAccountId===a.id&&!evidence.includes(o))evidence.push(o);
  for(const o of records)if(storedValueTopUps.get(o.id)?.receivingAccountId===a.id&&!evidence.includes(o))evidence.push(o);
  const snapshots=(ledger.balanceSnapshots||[]).filter(s=>s.financialAccountId===a.id);
  snapshots.push(...statementAnchors.filter(s=>s.financialAccountId===a.id));
  for(let i=0;i<snapshots.length;i++)if(['credit_card','loan'].includes(a.type)&&snapshots[i].balanceConvention!=='signed')snapshots[i]={...snapshots[i],balanceMinor:String(-BigInt(snapshots[i].balanceMinor)),balanceConvention:'signed'};
  snapshots.sort((a,b)=>Date.parse(b.asOf)-Date.parse(a.asOf)||(a.source==='statement_observation'?1:0)-(b.source==='statement_observation'?1:0)||Date.parse(b.createdAt||'1970-01-01')-Date.parse(a.createdAt||'1970-01-01'));
  const candidate=snapshots[0],tied=candidate?snapshots.filter(s=>s.asOf===candidate.asOf&&s.source===candidate.source&&s.balanceKind===candidate.balanceKind):[];
  const ambiguous=new Set(tied.map(s=>s.balanceMinor)).size>1;
  const dates=evidence.map(o=>o.date).sort();
  const bankRecords=records.filter(o=>o.financialAccountId===a.id&&o.bankStatement),bankDates=bankRecords.map(o=>o.date).sort(),statementMonths=[...new Set(bankRecords.map(o=>o.bankStatement.statementDate?.slice(0,7)).filter(Boolean))].sort();
  const bankStatementCoverage={recordCount:bankRecords.length,firstTransactionDate:bankDates[0]||null,lastTransactionDate:bankDates.at(-1)||null,statementMonths};
  return{...a,bankStatementCoverage,group:['credit_card','loan'].includes(a.type)?'\u4fe1\u7528\u8d26\u6237':a.type==='investment'?'\u7406\u8d22\u8d26\u6237':['wallet','debit_card','bank','savings','cash'].includes(a.type)?'\u50a8\u84c4\u8d26\u6237':'\u5176\u4ed6\u8d26\u6237',evidenceCount:evidence.length,channels:[...new Set(evidence.map(o=>o.provider))],firstDate:dates[0]||null,lastDate:dates.at(-1)||null,verifiedBalance:ambiguous?null:candidate||null,balanceStatus:ambiguous?'\u4f59\u989d\u8bc1\u636e\u51b2\u7a81':snapshots.length?'\u6709\u4f59\u989d\u6838\u5bf9\u503c':'\u4f59\u989d\u5f85\u6838\u5bf9'};
 });
 return{accounts:accountRows,products:[...funds.values()].map(f=>({...f,boughtUnits:unitsText(f.boughtUnits),grossMinor:String(f.grossMinor),feeMinor:String(f.feeMinor),conversionOutAppliedUnits:unitsText(f.conversionOutAppliedUnits),conversionInMinor:String(f.conversionInMinor)})),conversions,proposals:accountProposals(ledger)};
}
module.exports={fundingIdentity,sameBankAccount,accountProposals,buildAssetRegister};
