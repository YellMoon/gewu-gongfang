'use strict';

const {ACCOUNT_PRODUCTS,ACCOUNT_RELATION_ACTIVITIES,inferAccountRelations,relationDelta,explicitCardFundingCredit,ambiguousCardCredit}=require('./accountProducts');
const {validateInvestmentTrade,latestInvestmentConfirmations}=require('./investmentTrades');
const {validateBrokerage,buildSecuritiesRegister}=require('./securities');
const {buildFundValuations}=require('./fundValuation');
const {fundingIdentity,sameBankAccount,buildAssetRegister}=require('./assetRegister');
const {statementBalances}=require('./balanceEvidence');
const {statementCoverage,incomeExpenseAccounts,portfolioBalances}=require('./accountAnalytics');
const {buildReviewSummary}=require('./reviewSummary');
const {buildMortgageModels,matchesMortgage}=require('./mortgages');
const {classifyBankPurpose,classifyPlatformPurpose,nonCashAuthorization,legacyRefundPending,closedOrderBankPayments,wechatTeachingBankReceipt}=require('./bankClassification');
const {findWechatWithdrawalMatches,findAlipayNextDayWithdrawalMatches}=require('./withdrawals');
const {statementCounterAccount,annotatedCounterAccount}=require('./statementAccounts');
const {findStatementRepayments,findOwnedBankTransfers,statementCreditRepaymentTarget}=require('./statementTransfers');
const {findOwnedBankTransferGroups}=require('./ownedBankTransferGroups');
const {findHistoricalCardBindings,findHistoricalRepaymentTargets}=require('./historicalCardBindings');
const {findPreciseBankPayments,findMixedProductPayments,findWalletBankTransfers,findDirectProductPayments,findDirectSplitPayments,compatibleBankTradeTime,actualSecond}=require('./mixedPayments');
const {findMissingCardFunding,findProductBankFunding,findDirectProductFunding}=require('./fundingEvidence');
const {findReconciliationGroups,findProductTransferGroups,findStatementMerchantSubsets,findWalletTopUpGroups,findWalletWithdrawalGroups,findMybankWalletProductBridgeGroups}=require('./reconciliationGroups');
const {findCardRefundGroups}=require('./cardRefundGroups');
const {statementOwners}=require('./statementOwnership');
const {buildInstallmentLoans}=require('./installmentLoans');
const {validateWithdrawalFeeEvidence,findWorkbookWithdrawalFeeGroups}=require('./withdrawalFeeEvidence');
const {within,sourceCashTiming,cashEntries,transactionsInRange}=require('./cashTiming');
const {estimateWechatWithdrawals}=require('./withdrawalEstimates');
const {findLegacyProductFunding}=require('./legacyProductFunding');
const {findCommercePaymentTraces}=require('./commercePaymentTraces');
const {buildSettledLoanEpisodes}=require('./settledLoanEpisodes');
const {statementAccountIdentityEvidence}=require('./statementAccountIdentities');
const {personalCashflowPolicies}=require('./personalCashflowPolicies');
const {findLegacyCardFunding}=require('./legacyCardFunding');
const {buildInterestOnlyLoanTail}=require('./interestOnlyLoanTail');
const {findMybankProductCashLegs}=require('./mybankProductCashLegs');
const {findProductCreditRepayments,findFamilyProductPaymentGroups,findProductWalletTopUps}=require('./productPaymentBatches');
const {annotatedSettlementAccount,isSettlementAccount,inferredSettlementAccount}=require('./counterpartySettlements');
const {resolveWithdrawalDestinations,inferSessionWithdrawalDestinations}=require('./walletWithdrawalDestinations');
const {buildCreditFinancing}=require('./creditFinancing');
const {refreshHistoricalInvestmentRoute}=require('./historicalInvestmentRoutes');
const {expenseAssetAllocation}=require('./expenseAssetAllocations');
const {digitalCashExchange}=require('./digitalCash');
const {findLoanWalletReceipts}=require('./loanWalletReceipts');
const {explicitBankOutflowSource}=require('./explicitBankOutflowSource');
const {paymentAllocationPlans,paymentAllocationEffects}=require('./paymentAllocations');
const fail = code => Object.assign(new Error(code), {code});
function statementClassification(o,statementOwner){
  o=classifyPlatformPurpose(classifyBankPurpose(o,{statementOwner}));
  if(o.bankStatement&&o.kind==='refund'&&o.direction==='credit'&&ambiguousCardCredit(o.description))return {...o,kind:'unknown',bankStatement:{...o.bankStatement,nonCash:false},automaticClassification:{method:'ambiguous_card_credit_receipt',confidence:'original_statement_ambiguous',evidenceObservationIds:[o.id]}};
  if(o.bankStatement&&o.kind==='refund'&&o.direction==='credit'&&explicitCardFundingCredit(o.description))return {...o,kind:'debt_payment'};
  if(o.provider!=='huaxia'||o.kind!=='unknown'||o.status!=='completed'||o.direction!=='debit')return o;
  const loan=/\u8d37\u6b3e\u8fd8\u6b3e/.test(o.description)&&/\u4e2a\u4eba\u8d37\u6b3e\u6237/.test(o.counterparty);
  const provident=/\u516c\u79ef\u91d1\u6263\u6b3e/.test(o.description)&&/\u4f4f\u623f\u516c\u79ef\u91d1\u7ba1\u7406\u4e2d\u5fc3/.test(o.counterparty);
  return loan||provident?{...o,kind:'debt_payment'}:o;
}
const integer = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
const financeDayAt=time=>new Date(time+8*3600000).toISOString().slice(0,10);
function validDate(value) { return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value; }
function validateRecord(r) {
  if(!r || !integer(r.amountMinor) || !validDate(r.date) || typeof r.occurredAt!=='string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(r.occurredAt) || Number.isNaN(Date.parse(r.occurredAt)) || !/^[A-Z]{3}$/.test(r.currency||'') || !['debit','credit','neutral'].includes(r.direction) || !['expense','income','transfer','refund','loan_drawdown','debt_payment','interest','fee','unknown'].includes(r.kind) || !['completed','pending','failed'].includes(r.status)) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  for(const key of ['balanceMinor','principalMinor','interestMinor','feeMinor']) if(r[key]!==null && !(typeof r[key]==='string' && /^-?(0|[1-9]\d*)$/.test(r[key]) && (key==='balanceMinor'||BigInt(r[key])>=0n))) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  for(const key of ['sourceTransactionId','description','counterparty','category','paymentChannel','paymentAccountHint','relatedReference']) if(typeof r[key]!=='string' || r[key].length>4000) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  if(!r.rawFields || typeof r.rawFields!=='object' || Array.isArray(r.rawFields)) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  if(r.kind==='debt_payment' && ['principalMinor','interestMinor','feeMinor'].every(k=>r[k]!==null) && ['principalMinor','interestMinor','feeMinor'].reduce((s,k)=>s+BigInt(r[k]),0n)!==BigInt(r.amountMinor)) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  if(r.accountRelations!==undefined&&(!Array.isArray(r.accountRelations)||r.accountRelations.length>4||r.accountRelations.some(v=>!v||!Object.hasOwn(ACCOUNT_PRODUCTS,v.product)||!ACCOUNT_RELATION_ACTIVITIES.has(v.activity)||!['target','funding'].includes(v.role)||v.financialAccountId!==undefined&&(typeof v.financialAccountId!=='string'||!v.financialAccountId||v.financialAccountId.length>512))))throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  if(r.loanProof!==undefined)require('./loanProofs').validateLoanProof(r.loanProof,r);
  if(r.investmentTrade!==undefined)validateInvestmentTrade(r.investmentTrade,r);
  if(r.brokerage!==undefined)validateBrokerage(r.brokerage,r);
  if(r.withdrawalFeeEvidence!==undefined)validateWithdrawalFeeEvidence(r.withdrawalFeeEvidence,r);
  if(r.bankNetwork!==undefined)require('./unionpayNetworkStatement').validateBankNetwork(r.bankNetwork,r);
  if(r.bankAccount!==undefined){const a=r.bankAccount;if(!a||typeof a.provider!=='string'||!['credit_card','debit_card'].includes(a.type)||!/^\d{4}$/.test(a.maskedIdentifier)||a.currency!==r.currency||!r.bankStatement&&!r.balanceEvidence&&!r.statementFlow&&!r.bankNetwork)throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');}
  if(r.bankStatement!==undefined){const e=r.bankStatement;if(!e||!['minsheng-credit-v1','bank-credit-v1','bank-credit-detail-v1'].includes(e.schema)||(e.schema==='bank-credit-detail-v1'?e.statementDate!==undefined:!validDate(e.statementDate))||!validDate(e.postedDate)||!/^\d{4}$/.test(e.cardTail)||e.postedDate<r.date||e.postedDate>e.statementDate||r.balanceMinor!==null||!['expense','refund','debt_payment','interest','fee','unknown','transfer'].includes(r.kind))throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');}
  if(r.balanceEvidence!==undefined){const e=r.balanceEvidence;if(!e||!['alipay-balance-proof-v1','alipay-yuebao-balance-v1','yuebao-asset-certificate-v1','minsheng-credit-balance-v1','bank-credit-balance-v1'].includes(e.schema)||r.amountMinor!=='0'||r.direction!=='neutral'||r.balanceMinor===null||!integer(e.incomeMinor)||!integer(e.expenseMinor)||!Number.isInteger(e.sequence)||e.sequence<1)throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');}
  if(r.statementFlow!==undefined){const e=r.statementFlow;if(!e||!['mybank-current-v1','mybank-yulibao-v1','huaxia-debit-v1','hangzhou-debit-v1','psbc-debit-v1','jsb-debit-v1','ccb-debit-v1','webank-debit-v1','spdb-debit-v1'].includes(e.schema)||!integer(e.incomeMinor)||!integer(e.expenseMinor)||!Number.isInteger(e.sequence)||e.sequence<1||!validDate(e.periodStart)||!validDate(e.periodEnd)||r.balanceMinor===null||BigInt(e.incomeMinor)-BigInt(e.expenseMinor)!==BigInt(r.amountMinor)*(r.direction==='credit'?1n:r.direction==='debit'?-1n:0n))throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');}
  return r;
}
const signed = o => o.direction==='neutral'?0n:BigInt(o.amountMinor)*(o.direction==='credit'?1n:-1n);
const liability = a => ['credit_card','loan'].includes(a?.type);
const mortgageReviewReason = split => split?.confidence==='statement_total_only'?'mortgage_prepayment_split_unknown':split?.confidence==='estimated_reference'?'mortgage_recent_reference_unverified':null;
function repaymentType(sources,accountMap){
  if(sources.some(s=>s.automaticClassification?.method==='explicit_credit_card_repayment'))return 'credit';
  const related=sources.flatMap(s=>[accountMap.get(s.financialAccountId),accountMap.get(s.automaticRepaymentTarget?.financialAccountId),s.automaticClassification?.method==='explicit_owned_counter_account'?accountMap.get(s.automaticClassification.financialAccountId):null,...(s.accountRelations||[]).filter(r=>r.activity==='repayment').map(r=>accountMap.get(r.financialAccountId))]).filter(Boolean);
  if(related.some(a=>a.type==='loan'))return 'loan';
  if(related.some(a=>a.type==='credit_card'))return 'credit';
  const purpose=sources.map(s=>[s.description,s.counterparty,s.category,s.rawFields?.['\u4ea4\u6613\u7c7b\u578b']].join(' ')).join(' ');
  if(/\u4fe1\u7528\u5361|\u82b1\u5457|\u4fe1\u7528\u8d2d/.test(purpose))return 'credit';
  return /\u8d37\u6b3e|\u623f\u8d37|\u501f\u5457|\u501f\u6b3e|\u672c\u606f|\u516c\u79ef\u91d1\u6263\u6b3e/.test(purpose)?'loan':'unknown';
}
const calibrationOnly = a => ['investment','insurance','receivable','property','precious_metal','retirement'].includes(a?.type)&&!['alipay_yulibao','alipay_yuebao'].includes(a?.sourceProduct)&&!isSettlementAccount(a)&&!require('./merchantSettlementReceivables').isMerchantSettlementAccount(a);
const money = () => ({consumptionMinor:0n,incomeMinor:0n,cashInMinor:0n,cashOutMinor:0n,netCashFlowMinor:0n});
const dictionary = () => Object.create(null);
const serial = value => typeof value==='bigint'?value.toString():Array.isArray(value)?value.map(serial):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,serial(v)])):value;
// Remove only a bank statement's known operation/channel envelope. The remaining
// merchant must match in full; a legal-entity alias is not identity evidence.
const statementOperation=/^(?:(?:\u6d88\u8d39|\u9000\u6b3e|\u9000\u8d27)\s+-\s*\u7f51\u8054\s+|\u6d88\u8d39\s+|\(\u6d88\u8d39\)|\u9000\u6b3e\s+|\(\u9000\u6b3e\)|\u9000\u8d27\s+|\(\u9000\u8d27\))/;
const statementMerchantText=value=>String(value||'').normalize('NFKC').replace(statementOperation,'');
function statementPaymentProvider(value){
  const text=statementMerchantText(value);
  if(text==='\u652f\u4ed8\u5b9d\u5feb\u6377\u652f\u4ed8')return 'alipay';
  if(/^(?:\u4eac\u4e1c(?:\u652f\u4ed8|[-\s:]|$)|\u7f51\u94f6\u5728\u7ebf)/.test(text))return 'jd';
  return /^(?:\u652f\u4ed8\u5b9d\u5feb\u6377--|\u652f\u4ed8\u5b9d(?=[-\s:(]|$))/.test(text)?'alipay':/^(?:\u8d22\u4ed8\u901a\u5feb\u6377--|(?:\u5fae\u4fe1\u652f\u4ed8(?:\(\u8d22\u4ed8\u901a\))?|\u8d22\u4ed8\u901a(?:\u516c\u53f8)?)(?=[-\s:(]|$))/.test(text)?'wechat':null;
}
function legacyJdPaymentEnvelope(record){
  if(record.status!=='completed'||record.kind!=='expense'||record.direction!=='debit')return false;
  if(record.provider==='hangzhou'&&record.statementFlow?.schema==='hangzhou-debit-v1')return record.description==='\u6d88\u8d39'&&record.counterparty==='\uff08\u7279\u7ea6\uff09\u4eac\u4e1c\u652f\u4ed8'&&record.rawFields?.description===record.description&&record.rawFields?.counterparty===record.counterparty;
  return record.provider==='ccb'&&record.statementFlow?.schema==='ccb-debit-v1'&&record.description==='\u6d88\u8d39 -\u767d\u6761\u5408\u5e76\u8fd8\u6b3e\u7f51\u94f6\u5e73\u53f0'&&record.rawFields?.['\u6458\u8981']==='\u6d88\u8d39'&&record.rawFields?.['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00']==='-\u767d\u6761\u5408\u5e76\u8fd8\u6b3e\u7f51\u94f6\u5e73\u53f0'&&record.rawFields?.dateBasis==='transaction_date'&&record.rawFields?.['\u4ea4\u6613\u65e5\u671f']===record.date.replace(/-/g,'');
}
function bankPaymentProvider(record){
  const text=String(record.description||'').normalize('NFKC').replace(/^\u5feb\u6377\u652f\u4ed8(?:\u9000\u6b3e)?[-\s:]*/,'');
  // BOCOM retains the original purchase outside the billed installment total.
  // Its later principal rows are neutral/nonCash; this envelope names the
  // original purchase channel and must never turn principal into consumption.
  const originalInstallment=record.provider==='bocom'&&record.kind==='expense'&&record.direction==='debit'&&!record.bankStatement?.nonCash&&record.rawFields?.excludedFromBilledTotal===true;
  const values=[record.counterparty,text].map(v=>originalInstallment?String(v||'').normalize('NFKC').replace(/^\u6d88\u8d39\s+\u5546\u6237\u5206\u671f-/,''):v).map(v=>statementPaymentProvider(v)||(/^(?:\u6df1\u5733\u5e02)?\u8d22\u4ed8\u901a(?:\u652f\u4ed8\u79d1\u6280|\u79d1\u6280)?\u6709\u9650\u516c\u53f8/.test(String(v||''))?'wechat':null)).filter(Boolean);
  const institution=String(record.rawFields?.['\u5bf9\u65b9\u5f00\u6237\u884c']||record.rawFields?.['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']||'').normalize('NFKC').trim();
  if(/^\u652f\u4ed8\u5b9d(?:\(\u4e2d\u56fd\))?(?:\u7f51\u7edc\u6280\u672f\u6709\u9650\u516c\u53f8)?$/.test(institution))values.push('alipay');
  if(/^\u8d22\u4ed8\u901a(?:\u652f\u4ed8\u79d1\u6280)?\u6709\u9650\u516c\u53f8$/.test(institution))values.push('wechat');
  if(record.automaticClassification?.method==='explicit_bank_wallet_top_up')values.push('wechat');
  if(record.provider==='spdb'&&record.statementFlow?.schema==='spdb-debit-v1'&&record.rawFields?.['交易名称']===record.description){if(record.description==='网上支付-支付宝')values.push('alipay');if(record.description==='网上支付-网银在线')values.push('jd');}
  if(record.provider==='hangzhou'&&record.statementFlow?.schema==='hangzhou-debit-v1'&&record.direction==='debit'&&record.description==='\u5361\u901a\u652f\u4ed8'&&['\u5361\u901a\u8d44\u91d1\u6e05\u7b97\u4e13\u6237','\u603b\u884c\u4e1a\u52a1\u5904\u7406\u4e2d\u5fc3'].includes(record.counterparty)&&record.rawFields?.description===record.description&&record.rawFields?.counterparty===record.counterparty)values.push('alipay');
  if(legacyJdPaymentEnvelope(record))values.push('jd');
  const channels=[...new Set(values)];return channels.length===1?channels[0]:channels.length>1?'conflict':null;
}
function projectedBankDirection(record){
  if(record.direction!=='neutral')return record.direction;
  // Alipay's "not income/expense" refund label is not the bank cash direction.
  // Use credit only to find an existing receipt; do not synthesize a cash leg.
  if(record.provider==='alipay'&&record.kind==='refund'&&record.status==='completed'&&BigInt(record.amountMinor)>0n)return 'credit';

  const target=(record.accountRelations||[]).find(r=>r.role==='target');
  if(['investment_deposit','repayment'].includes(target?.activity))return 'debit';
  if(['investment_withdrawal','loan_drawdown'].includes(target?.activity))return 'credit';
  if(record.kind==='debt_payment'&&/\u4fe1\u7528\u5361.*\u8fd8\u6b3e/.test([record.description,record.counterparty,record.rawFields?.['\u4ea4\u6613\u7c7b\u578b']].join(' ')))return 'debit';
  return record.direction;
}
function statementMerchant(value,provider){
  const text=statementMerchantText(value);
  const prefix=provider==='alipay'?/^(?:\u652f\u4ed8\u5b9d\u5feb\u6377--|\u652f\u4ed8\u5b9d[-\s:]+)/:/^(?:\u8d22\u4ed8\u901a\u5feb\u6377--|(?:\u5fae\u4fe1\u652f\u4ed8(?:\(\u8d22\u4ed8\u901a\))?|\u8d22\u4ed8\u901a(?:\u516c\u53f8)?)[-\s:]+)/;
  return prefix.test(text)?text.replace(prefix,'').replace(/[\s\p{P}]/gu,''):null;
}
function fundingAccount(o,accounts) {
  if(o.automaticFunding){const found=accounts.find(a=>a.id===o.automaticFunding.financialAccountId&&a.currency===o.currency&&a.status==='active');if(found)return found;}
  if(o.withdrawalDestination?.method==='owner_confirmed_product_destination'){const found=accounts.find(a=>a.id===o.withdrawalDestination.financialAccountId&&a.currency===o.currency&&a.status==='active');if(found)return found;}
  // A product's payment-channel column names the source product. The explicit
  // withdrawal destination, when present, identifies its receiving bank instead.
  const destination=o.provider==='wechat'&&o.status==='completed'&&o.kind==='transfer'&&String(o.rawFields?.['交易类型']||'').match(/^零钱通转出-到(.+银行\(\d{4}\))$/);
  const identity=fundingIdentity(destination?.[1]||o.paymentChannel);
  if(identity){const matches=accounts.filter(a=>a.id!==o.financialAccountId&&sameBankAccount(a,identity,o.currency));return matches.length===1?matches[0]:null;}
  if(!o.paymentAccountHint) return null;
  const normalized=value=>{const v=String(value||'').normalize('NFKC').replace(/\s/g,'');const tail=v.match(/(\d{4})[)）]?$/);return tail?'tail:'+tail[1]:v;};
  const matches=accounts.filter(a=>a.id!==o.financialAccountId && a.currency===o.currency && (a.id===o.paymentAccountHint || a.maskedIdentifier && normalized(a.maskedIdentifier)===normalized(o.paymentAccountHint)));
  return matches.length===1?matches[0]:null;
}

const RAW_DERIVED_TRANSACTIONS=Symbol('raw-derived-transactions'),PREPARED_FINANCE_VIEW=Symbol('prepared-finance-view');
function prepareFinanceView(ledger){
 if((ledger.observations||[]).some(o=>o.bankNetwork))return require('./unionpayNetworkProjection').prepareNetworkFinanceView(ledger,prepareFinanceView);
 return buildFinanceView(ledger,{},PREPARED_FINANCE_VIEW);
}
function buildFinanceView(ledger,options={},internalMode) {
  if((ledger.observations||[]).some(o=>o.bankNetwork))return require('./unionpayNetworkProjection').buildNetworkFinanceView(ledger,options,buildFinanceView);
  const ownerZeroFeeWithdrawals=new Map();
  const knownRepaymentCashBySource=new Map();
  const accounts=ledger.accounts||[], originalObservations=ledger.observations||[],originalById=new Map(originalObservations.map(o=>[o.id,o])),latestAnnotations=new Map();
  const sourceOwners=statementOwners(ledger.imports||[],originalObservations);
  const accountIdentityEvidence=statementAccountIdentityEvidence(ledger);
  const verifiedOwnerNames=new Set(sourceOwners.values());
  const securities=buildSecuritiesRegister(originalObservations,{accounts,imports:ledger.imports||[]}),securitiesRealizations=new Map(securities.flatMap(a=>a.realizations).map(r=>[r.observationId,r]));
  const investmentRegister=originalObservations.some(o=>o.investmentTrade?.tradeType==='conversion')?buildAssetRegister(ledger):null;
  const identifiedConversions=new Set(investmentRegister?investmentRegister.conversions.filter(c=>c.status==='products_matched').map(c=>c.id):[]);
  const fundValuations=buildFundValuations(ledger,{assetRegister:investmentRegister,asOf:options.endDate});
  for(const a of ledger.annotations||[])if(!latestAnnotations.has(a.observationId)||BigInt(a.revision)>BigInt(latestAnnotations.get(a.observationId).revision))latestAnnotations.set(a.observationId,a);
  // A reset is a new audit entry, not deletion of the original owner decision.
  for(const [id,annotation] of latestAnnotations)if(annotation.reset===true)latestAnnotations.delete(id);
  const posMerchants=require('./posMerchantReceipts'),posMerchantContext=[...latestAnnotations.values()].some(posMerchants.isPosMerchantAnnotation)?posMerchants.buildPosReceiptContext(originalObservations,accounts,{links:ledger.links||[],annotations:ledger.annotations||[]}):null;
  const posTuitionRoutes=new Map(),conflictingPosRoutes=new Set();
  if(posMerchantContext)for(const annotation of latestAnnotations.values())if([posMerchants.TUITION,posMerchants.TUITION_DOCUMENTED].includes(annotation.patch?.category)){
    const source=originalById.get(annotation.observationId);if(!source)continue;
    const receipt=posMerchants.posMerchantReceipt({...source,...annotation.patch},[source],[annotation],accounts,posMerchantContext);
    if(receipt)for(const id of receipt.onwardObservationIds){if(posTuitionRoutes.has(id)&&posTuitionRoutes.get(id).sourceObservationId!==receipt.sourceObservationId)conflictingPosRoutes.add(id);else posTuitionRoutes.set(id,receipt);}
  }
  for(const id of conflictingPosRoutes)posTuitionRoutes.delete(id);
  const storedValueTopUps=require('./storedValueTopUps').findStoredValueTopUps(originalObservations,accounts,{annotatedIds:new Set((ledger.annotations||[]).map(a=>a.observationId)),links:ledger.links||[]});
  const receiptPlans=paymentAllocationPlans(latestAnnotations,accounts,originalObservations,ledger.links||[]),receiptPlanBySource=new Map(receiptPlans.map(p=>[p.sourceObservationId,p]));
  const proofCashPostings=require('./balanceCashPostings').findBalanceProofCashPostings(originalObservations,accounts,{annotatedIds:new Set((ledger.annotations||[]).map(a=>a.observationId)),cashTimingAnnotatedIds:require('./balanceCashPostings').purposeOnlyCashTimingAnnotationIds(originalObservations,ledger.annotations||[],accounts),links:ledger.links||[]});
  for(const [id,p]of require('./partialMerchantCash').findPartialMerchantCash(ledger,latestAnnotations))if(!proofCashPostings.has(id))proofCashPostings.set(id,p);
  const nativeSettlementWalletFunding=require('./balanceCashPostings').findNativeSettlementWalletFunding(originalObservations,accounts,proofCashPostings,latestAnnotations);
  const nativeTelecomWalletFunding=require('./telecomTopups').findNativeTelecomWalletFunding(originalObservations,accounts,proofCashPostings);
  const settlementSourceKey=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),settlementPolicyOverrides=new Set((ledger.annotations||[]).map(a=>originalById.get(a.observationId)).filter(Boolean).map(settlementSourceKey));
  const ownedCreditTargetBlockedSources=new Set([...latestAnnotations.keys()].map(id=>originalById.get(id)).filter(Boolean).map(settlementSourceKey));
  const protectedPurchaseCounterparties=new Set([...verifiedOwnerNames,...accounts.filter(a=>a.counterpartySettlement?.scope!=='annotation_only').map(a=>a.counterpartySettlement?.counterparty).filter(Boolean),...[...latestAnnotations].filter(([,a])=>a.patch?.kind==='transfer'&&/\u5bb6\u5ead|\u672c\u4eba|\u501f\u8fd8/.test(a.patch.category||'')).map(([id])=>originalById.get(id)?.counterparty).filter(Boolean)].map(name=>String(name).normalize('NFKC').trim()));
  const restoredPurchasePurposes=require('./legacyAlipayPurchases').restoredLegacyPurchasePurposes(originalObservations,ledger.annotations||[],{excludedCounterparties:protectedPurchaseCounterparties});
  const rewardBlockedSourceKeys=new Set([...settlementPolicyOverrides,...(ledger.links||[]).flatMap(l=>(l.observationIds||[]).map(id=>originalById.get(id)).filter(Boolean).map(settlementSourceKey))]);
  const creditFinancing=buildCreditFinancing(accounts,originalObservations,{annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[]}),financingSources=new Map();
  const nativeWalletPurchases=require('./nativeWalletPurchases').findNativeWalletPurchases(originalObservations,accounts,proofCashPostings,{excludedCounterparties:protectedPurchaseCounterparties,blockedSourceKeys:settlementPolicyOverrides,annotations:ledger.annotations||[],links:ledger.links||[]});
  const sponsoredHelper=require('./nativeSponsoredSettlements'),sponsoredSettlements=sponsoredHelper.findNativeSponsoredSettlements({...ledger,observations:originalObservations},latestAnnotations);
  for(const m of creditFinancing.filter(m=>m.status==='reconciled_actual_records')){for(const id of m.drawdownObservationIds)financingSources.set(id,{model:m,kind:'transfer'});for(const id of m.receiptObservationIds)financingSources.set(id,{model:m,kind:'loan_drawdown'});}
  const personalCashflowPolicy=personalCashflowPolicies(originalObservations,ledger.annotations||[],{ownerNames:[...new Set(sourceOwners.values())],accounts});
  const returnedWechatTransferPurposes=require('./returnedWechatTransfers').findReturnedWechatTransfers(originalObservations,accounts,{annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[]});
  const neutralWalletRefundCash=require('./neutralWalletRefunds').findNeutralWalletRefundCash(originalObservations,accounts);
  const classified=originalObservations.filter(o=>(!o.balanceEvidence||sponsoredSettlements.has(o.id))&&!o.loanProof&&!require('./nativeMortgageStatements').isNativeMortgageStatement(o)).map(o=>{
    if(latestAnnotations.has(o.id)){
      const medicalAnnotation=latestAnnotations.get(o.id);if(medicalAnnotation.patch?.medicalSettlement){try{return require('./medicalSettlements').confirmedMedicalSettlement(o,medicalAnnotation,accounts,{links:ledger.links||[]});}catch{return {...o,automaticClassification:{method:'medical_settlement_evidence_unresolved',evidenceObservationIds:[o.id]}};}}
      if(latestAnnotations.get(o.id).patch?.recalledAccountRoute){try{return require('./recalledAccountRoutes').recalledAccountRoute(o,latestAnnotations.get(o.id),ledger);}catch{return {...o,automaticClassification:{method:'recalled_account_route_evidence_unresolved',evidenceObservationIds:[o.id]}};}}
      const ownedDestination=require('./ownerAlipayBankDestinations');if(ownedDestination.isAnnotation(latestAnnotations.get(o.id))){try{return ownedDestination.ownerAlipayBankDestination(o,latestAnnotations.get(o.id),accounts);}catch{return {...o,automaticClassification:{method:'owner_bank_destination_evidence_unresolved',evidenceObservationIds:[o.id]}};}}
      if(sponsoredHelper.annotationRole(latestAnnotations.get(o.id)))return sponsoredSettlements.get(o.id)||{...o,category:latestAnnotations.get(o.id).patch.category,automaticClassification:{method:'sponsored_settlement_evidence_unresolved',evidenceObservationIds:[o.id]}};
      const couponHelper=require('./restrictedCoupons'),couponAnnotation=latestAnnotations.get(o.id);if(couponHelper.isRestrictedCouponAnnotation(couponAnnotation)){const coupon=couponHelper.ownerConfirmedRestrictedCoupon(o,couponAnnotation,accounts);return coupon||{...o,category:couponAnnotation.patch.category,automaticClassification:{method:'restricted_coupon_evidence_unresolved',evidenceObservationIds:[o.id]}};}
      const incomeReceipt=require('./confirmedPlatformReceipts').confirmedPlatformIncomeReceipt(o,latestAnnotations.get(o.id),accounts);if(incomeReceipt)return incomeReceipt;
      if(o.direction==='neutral'&&latestAnnotations.get(o.id).patch?.settlementAccountId){
        try{return require('./nativeMerchantSettlements').nativeMerchantSettlement(o,latestAnnotations.get(o.id),accounts,originalObservations,proofCashPostings);}
        catch(e){if(e.code!=='COUNTERPARTY_SETTLEMENT_CASH_PROOF_REQUIRED')throw e;return {...o,...latestAnnotations.get(o.id).patch};}
      }
      const settlement=annotatedSettlementAccount(o,latestAnnotations.get(o.id),accounts);
      if(settlement)return {...o,...latestAnnotations.get(o.id).patch,automaticClassification:{method:'owner_confirmed_counterparty_settlement',confidence:'owner_confirmed',evidenceObservationIds:[o.id],financialAccountId:settlement.id}};
      const annotation=latestAnnotations.get(o.id),annotatedCounter=annotatedCounterAccount(o,annotation,accounts),counter=annotatedCounter||(annotation.patch?.kind==='transfer'?accountIdentityEvidence.get(o.id)?.account:null);
      const annotated={...o,...annotation.patch,...(counter?{automaticClassification:{method:'explicit_owned_counter_account',confidence:annotatedCounter?(annotation.patch.category.startsWith('\u672c\u4eba\u8d26\u6237\u5212\u8f6c\uff08\u7528\u6237\u56de\u5fc6\uff0c\u53ef\u4fee\u6539\uff09\uff1a')?'owner_recalled':'owner_confirmed'):'verified_full_account_identity',evidenceObservationIds:[o.id],financialAccountId:counter.id,...(!annotatedCounter?{identityEvidence:accountIdentityEvidence.get(o.id).evidence}:{})}}:{})};
      const studioRoute=posTuitionRoutes.get(o.id);
      if(studioRoute&&annotated.kind==='transfer'&&annotated.automaticClassification?.financialAccountId===studioRoute.studioAccountId)annotated.automaticClassification={...annotated.automaticClassification,cashRouteEvidence:'owner_confirmed_pos_tuition_onward',evidenceObservationIds:[studioRoute.sourceObservationId,o.id]};
      return o.provider==='alipay'&&o.description==='\u6570\u5b57\u4eba\u6c11\u5e01\u8f6c\u8d26'?refreshHistoricalInvestmentRoute(annotated,accounts):annotated;
    }
    if(storedValueTopUps.has(o.id))return {...o,kind:'transfer',category:'\u4ea4\u901a\u5361\u5145\u503c',storedValueTopUp:storedValueTopUps.get(o.id)};
    if(returnedWechatTransferPurposes.has(o.id))return {...o,...returnedWechatTransferPurposes.get(o.id)};
    const confirmedSettlement=!settlementPolicyOverrides.has(settlementSourceKey(o))&&inferredSettlementAccount(o,accounts);
    if(confirmedSettlement)return {...o,kind:'transfer',category:'\u501f\u8fd8\u6b3e\u5f80\u6765\uff08\u5df2\u786e\u8ba4\u5bf9\u65b9\uff09',automaticClassification:{method:'owner_confirmed_counterparty_settlement',confidence:'owner_confirmed',evidenceObservationIds:[o.id],financialAccountId:confirmedSettlement.id,policySource:'account_counterparty_settlement'}};
    const financing=financingSources.get(o.id);
    if(financing)return {...o,kind:financing.kind,category:'\u88c5\u4fee\u5206\u671f\u501f\u6b3e\uff08\u7528\u6237\u786e\u8ba4\uff09',automaticClassification:{method:'owner_confirmed_credit_financing',confidence:'owner_confirmed',financialAccountId:financing.model.financialAccountId,evidenceObservationIds:financing.model.sourceObservationIds}};
    let value=statementClassification(o,sourceOwners.get(o.id));
    if(nativeWalletPurchases.has(o.id))value=nativeWalletPurchases.get(o.id);
    if(!settlementPolicyOverrides.has(settlementSourceKey(o))&&neutralWalletRefundCash.has(o.id))value={...value,...neutralWalletRefundCash.get(o.id)};
    if(!settlementPolicyOverrides.has(settlementSourceKey(o)))value=require('./legacyWechatInvestmentWithdrawals').refreshLegacyWechatWithdrawal(value,accounts);
    if(!settlementPolicyOverrides.has(settlementSourceKey(o))){value=require('./explicitLivingExpenses').refreshExplicitLivingExpense(value,{excludedCounterparties:protectedPurchaseCounterparties});value=require('./telecomTopups').refreshTelecomServicePurchase(value);value=require('./legacyAlipayPurchases').refreshLegacyAlipayPurchase(value,{excludedCounterparties:protectedPurchaseCounterparties});}
    if(!settlementPolicyOverrides.has(settlementSourceKey(o)))value=require('./zeroValueRewards').refreshZeroValueReward(value);
    value=require('./platformCashRewards').refreshPlatformCashReward(value,{accounts,excludedCounterparties:protectedPurchaseCounterparties,blockedSourceKeys:rewardBlockedSourceKeys});
    value=refreshHistoricalInvestmentRoute(personalCashflowPolicy(value),accounts);
    if(value.kind==='transfer'&&restoredPurchasePurposes.has(o.id))value=restoredPurchasePurposes.get(o.id);
    if(value.automaticClassification?.method==='explicit_telecom_service_purchase'&&nativeTelecomWalletFunding.has(o.id)){const evidence=nativeTelecomWalletFunding.get(o.id);value={...value,automaticClassification:{...value.automaticClassification,evidenceObservationIds:[o.id,evidence.proofObservationId],nativeWalletFundingEvidence:evidence}};}
    if(value.provider==='alipay'&&value.kind==='loan_drawdown'&&value.automaticClassification?.method==='explicit_historical_loan_drawdown'&&!value.accountRelations?.length){const matches=accounts.filter(a=>a.status==='active'&&a.sourceProduct==='alipay_jiebei'&&a.currency===value.currency);if(matches.length===1)value={...value,accountRelations:[{product:'alipay_jiebei',activity:'loan_drawdown',role:'target',financialAccountId:matches[0].id}]};}
    if(value.provider==='alipay'&&value.status==='completed'&&value.kind==='transfer'&&value.description==='转账收款到余额宝'&&value.paymentChannel==='余额'&&value.rawFields?.['商品说明']===value.description&&!(value.accountRelations||[]).some(r=>r.product==='alipay_yuebao')){
      value={...value,accountRelations:inferAccountRelations(value,'alipay').map(r=>{const matches=accounts.filter(a=>a.status==='active'&&a.sourceProduct===r.product&&a.currency===value.currency);return matches.length===1?{...r,financialAccountId:matches[0].id}:r;})};
    }
    // Refresh only this newly supported source format. Resolve through a real
    // product account; never manufacture confirmed fund units or a valuation.
    if(value.provider==='wechat'&&value.status==='completed'&&value.kind==='transfer'&&value.rawFields?.['交易类型']==='购买理财通'&&!(value.accountRelations||[]).some(r=>r.product==='wechat_licaitong')){
      const relations=inferAccountRelations(value,'wechat').map(r=>{const matches=accounts.filter(a=>a.status!=='archived'&&a.sourceProduct===r.product&&a.currency===value.currency);return matches.length===1?{...r,financialAccountId:matches[0].id}:r;});
      value={...value,accountRelations:relations};
    }
    if(value.provider==='alipay'&&value.kind==='debt_payment'&&[value.description,value.counterparty].join(' ').includes('\u5148\u91c7\u540e\u4ed8')&&!(value.accountRelations||[]).some(r=>r.product==='alipay_1688_credit')){const relation=inferAccountRelations(value,'alipay').find(r=>r.product==='alipay_1688_credit'),matches=accounts.filter(a=>a.status!=='archived'&&a.sourceProduct==='alipay_1688_credit'&&a.currency===value.currency);if(relation)value={...value,accountRelations:[...(value.accountRelations||[]),{...relation,...(matches.length===1?{financialAccountId:matches[0].id}:{})}]};}
    // Original JD payment parts name a reward product, not a bank cash leg.
    // Respect existing relations and decisions on every version of the source.
    if(value.provider==='jd'&&!value.accountRelations?.length&&!settlementPolicyOverrides.has(settlementSourceKey(o))){
      const rewards=inferAccountRelations(value,'jd');
      if(rewards.length)value={...value,accountRelations:rewards.map(r=>{const matches=accounts.filter(a=>a.status==='active'&&a.sourceProduct===r.product&&a.provider==='jd'&&a.type==='wallet'&&a.currency===value.currency);return matches.length===1?{...r,financialAccountId:matches[0].id}:r;})};
    }
    const fullIdentity=accountIdentityEvidence.get(o.id);
    const ownedCreditTarget=ownedCreditTargetBlockedSources.has(settlementSourceKey(o))?null:require('./statementTransfers').explicitOwnedCreditRepaymentTarget(value,accounts,{statementOwner:sourceOwners.get(o.id)});
    if(ownedCreditTarget&&(!fullIdentity||fullIdentity.account.id===ownedCreditTarget.financialAccountId))return {...value,kind:'debt_payment',automaticRepaymentTarget:ownedCreditTarget,automaticClassification:{method:'explicit_owned_counter_account',confidence:'verified_source_owner_and_statement_card',financialAccountId:ownedCreditTarget.financialAccountId,evidenceObservationIds:[o.id]}};
    const counter=value.status==='completed'&&['debit','credit'].includes(value.direction)&&value.statementFlow&&value.kind==='unknown'?(fullIdentity?.account||statementCounterAccount(value,accounts)):null;
    const digital=digitalCashExchange(value,accounts);if(digital)return {...value,kind:'transfer',automaticClassification:{method:'explicit_digital_cash_exchange',confidence:'explicit_statement_purpose',evidenceObservationIds:[o.id],financialAccountId:digital.id}};
    return counter?{...value,kind:counter.type==='credit_card'&&value.direction==='debit'?'debt_payment':'transfer',automaticClassification:{method:'explicit_owned_counter_account',confidence:fullIdentity?'verified_full_account_identity':'explicit_statement_purpose',evidenceObservationIds:[o.id],financialAccountId:counter.id,...(fullIdentity?{identityEvidence:fullIdentity.evidence}:{})}}:value;
  });
  const nativeBankOffsets=require('./nativeBankOffsets').findNativeBankOffsets(classified,accounts,ledger.imports||[],{annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[]});for(let i=0;i<classified.length;i++)if(nativeBankOffsets.has(classified[i].id))classified[i]={...classified[i],...nativeBankOffsets.get(classified[i].id)};
  const refundProvenPurchases=require('./closedHuabeiPurchases').findRefundProvenClosedHuabeiPurchases(classified,accounts,{annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[]});for(let i=0;i<classified.length;i++)if(refundProvenPurchases.has(classified[i].id))classified[i]={...classified[i],...refundProvenPurchases.get(classified[i].id)};
  const closedOrderPurposes=closedOrderBankPayments(classified,accounts,{fundingAccount,annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[]});for(let i=0;i<classified.length;i++)if(closedOrderPurposes.has(classified[i].id))classified[i]={...classified[i],...closedOrderPurposes.get(classified[i].id)};
  const refundedPayments=require('./refundedMybankPayments').refundedMybankPayments(classified,accounts,{annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[]});for(let i=0;i<classified.length;i++)if(refundedPayments.has(classified[i].id))classified[i]={...classified[i],...refundedPayments.get(classified[i].id)};
  // An earlier owner-confirmed transfer label may be retained while original
  // bank counter-account evidence identifies its opposite actual cash leg.
  // Any additional owner field or custom classification still blocks inference.
  const classifiedByIdentity=new Map();for(const o of classified){if(!classifiedByIdentity.has(o.id))classifiedByIdentity.set(o.id,[]);classifiedByIdentity.get(o.id).push(o);}
  const ownedBankAnnotationBlockers=new Set([...latestAnnotations].filter(([id,a])=>!(a.patch?.kind==='transfer'&&(a.patch.category==='本人同名账户划转（原件户名一致，可修改）'||(classifiedByIdentity.get(id)||[]).some(o=>o.automaticClassification?.method==='explicit_owned_counter_account'&&o.automaticClassification.confidence==='owner_confirmed'&&accounts.some(target=>target.id===o.automaticClassification.financialAccountId&&target.type==='debit_card')))&&Object.keys(a.patch).every(k=>['kind','category'].includes(k))&&(classifiedByIdentity.get(id)||[]).some(o=>o.kind==='transfer'&&o.statementFlow))).map(([id])=>id));
  const preservedSelfTransferIds=new Set([...latestAnnotations].filter(([id,a])=>a.patch?.kind==='transfer'&&a.patch.category==='\u672c\u4eba\u540c\u540d\u8d26\u6237\u5212\u8f6c\uff08\u539f\u4ef6\u6237\u540d\u4e00\u81f4\uff0c\u53ef\u4fee\u6539\uff09'&&Object.keys(a.patch).every(k=>['kind','category'].includes(k))&&(classifiedByIdentity.get(id)||[]).some(o=>o.kind==='transfer'&&o.statementFlow)).map(([id])=>id));
  const ownedBankTransfers=findOwnedBankTransfers(classified,accounts,{annotatedIds:ownedBankAnnotationBlockers,links:ledger.links||[],statementOwners:sourceOwners}),ownedBankById=new Map();for(const m of ownedBankTransfers)for(const s of [m.debit,m.credit])ownedBankById.set(s.id,m);
  for(let i=0;i<classified.length;i++){const o=classified[i],m=ownedBankById.get(o.id);if(m&&o.kind==='unknown')classified[i]={...o,kind:'transfer',automaticClassification:{method:'paired_owned_bank_transfer',confidence:'inferred',evidenceObservationIds:[m.debit.id,m.credit.id],identityEvidenceObservationIds:m.identityEvidenceObservationIds}};}
  const ownedBankGroups=findOwnedBankTransferGroups(classified,accounts,{annotatedIds:ownedBankAnnotationBlockers,matchedObservationIds:new Set(ownedBankTransfers.flatMap(m=>[m.debit.id,m.credit.id])),statementOwners:sourceOwners,links:ledger.links||[]}),ownedGroupById=new Map();for(const g of ownedBankGroups)for(const id of g.observationIds)ownedGroupById.set(id,g);
  for(let i=0;i<classified.length;i++){const o=classified[i],g=ownedGroupById.get(o.id);if(g)classified[i]={...o,kind:'transfer',automaticClassification:{method:g.method,confidence:g.confidence,evidenceObservationIds:g.observationIds,financialAccountId:o.financialAccountId===g.sourceAccountId?g.targetAccountId:g.sourceAccountId,count:g.count,individualIdentity:g.individualIdentity}};}
  const confirmedSettlementIds=new Set(classified.filter(o=>latestAnnotations.has(o.id)&&o.automaticClassification?.method==='owner_confirmed_counterparty_settlement').map(o=>o.id));
  const preliminaryLoanProofs=require('./loanProofModels').buildLoanProofModels(accounts,classified,originalObservations.filter(o=>o.loanProof),{annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[]}),proofAnchoredLoanReceipts=new Map();
  for(const model of preliminaryLoanProofs)for(const draw of model.drawdowns){const p=classified.find(o=>o.id===draw.observationId),bank=p&&fundingAccount(p,accounts);if(!p||p.kind!=='loan_drawdown'||p.description!=='\u8682\u8681\u501f\u5457\u653e\u6b3e\u81f3\u94f6\u884c\u5361'||bank?.type!=='debit_card')continue;for(const b of classified){const annotation=latestAnnotations.get(b.id),patch=annotation?.patch;if(!patch||patch.kind!=='transfer'||patch.category!=='\u63a8\u7b97\u672c\u4eba\u652f\u4ed8\u5b9d\u8d44\u91d1\u8f6c\u56de\uff08\u7528\u6237\u6388\u6743\u3001\u6765\u6e90\u4ea7\u54c1\u672a\u6807\u660e\uff09'||Object.keys(patch).some(k=>!['kind','category'].includes(k))||!b.statementFlow||b.status!=='completed'||b.direction!=='credit'||b.financialAccountId!==bank.id||b.date!==p.date||b.amountMinor!==p.amountMinor||b.currency!==p.currency)continue;proofAnchoredLoanReceipts.set(b.id,{loanObservationId:p.id,proofObservationIds:draw.proofObservationIds,annotationId:annotation.id});}}
  // A purpose-only review does not revoke already confirmed payer-card facts.
  const priorPurposeReviewSources=new Set((ledger.annotations||[]).filter(require('./legacyAlipayPurchases').requiresPurposeReview).map(a=>originalById.get(a.observationId)).filter(Boolean).map(settlementSourceKey));
  const purposeReviewOnlyIds=new Set([...latestAnnotations].filter(([id,a])=>require('./legacyAlipayPurchases').sourceOnlyPurposeReview(originalById.get(id),a,{priorPurposeReview:originalById.has(id)&&priorPurposeReviewSources.has(settlementSourceKey(originalById.get(id)))})).map(([id])=>id));
  const fundingAnnotationIds=new Set([...latestAnnotations.keys()].filter(id=>!confirmedSettlementIds.has(id)&&!proofAnchoredLoanReceipts.has(id)&&!purposeReviewOnlyIds.has(id)));
  const fundingOptions={bankPaymentProvider,annotations:latestAnnotations,annotatedIds:fundingAnnotationIds,settlementObservationIds:confirmedSettlementIds,links:ledger.links||[],statementOwners:sourceOwners,ownedBankObservationIds:new Set(ownedBankTransfers.flatMap(m=>[m.debit.id,m.credit.id]))},historicalFunding=findHistoricalCardBindings(classified,accounts,fundingOptions);
  const nativeNamedFunding=require('./nativeNamedChannelFunding').findNativeNamedChannelFunding(classified,accounts,{...fundingOptions,historicalFunding});for(const [id,funding]of nativeNamedFunding)historicalFunding.set(id,funding);
  // A materialized sponsored receipt shares its identity with its zero-value
  // proof. Keep the untouched proof in continuity inputs, exactly once.
  const classifiedWithOriginalBalanceProofs=[...originalObservations.filter(o=>o.balanceEvidence),...classified.filter(o=>!originalById.get(o.id)?.balanceEvidence)];
  for(const [id,funding]of require('./walletStatementTopUps').findWalletStatementTopUpFunding(classifiedWithOriginalBalanceProofs,accounts,{...fundingOptions,historicalFunding}))historicalFunding.set(id,funding);
  const nativeBankOrderFunding=require('./nativeBankFundedOrders').findNativeBankFundedOrders(classified,accounts,{...fundingOptions,historicalFunding,balanceEvidenceObservations:originalObservations.filter(o=>o.balanceEvidence)});for(const [id,funding]of nativeBankOrderFunding)historicalFunding.set(id,funding);
  for(const [id,funding]of require('./legacyNativePurchases').findLegacyNativePurchaseFunding(classifiedWithOriginalBalanceProofs,accounts,{...fundingOptions,historicalFunding}))historicalFunding.set(id,funding);
  for(const [id,funding]of require('./walletIntermediaryPostings').findNativeYuebaoFunding(classifiedWithOriginalBalanceProofs,accounts,{annotations:ledger.annotations||[],links:ledger.links||[]}))historicalFunding.set(id,funding);
  const loanWalletReceipts=findLoanWalletReceipts(classified,accounts,fundingOptions);for(let i=0;i<classified.length;i++)if(loanWalletReceipts.has(classified[i].id))classified[i]={...classified[i],automaticWalletReceipt:loanWalletReceipts.get(classified[i].id)};
  const inferredDestinations=inferSessionWithdrawalDestinations(classified,accounts,{annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[]});
  const knownDestinations=new Map([...inferredDestinations,...resolveWithdrawalDestinations(classified,accounts,{annotatedIds:new Set(latestAnnotations.keys())})]);
  const separatedFundingInputs=classified.map(o=>({...o,...(historicalFunding.get(o.id)?.identityBasis==='owner_separated_named_channel'?{automaticFunding:historicalFunding.get(o.id)}:{}),...(knownDestinations.has(o.id)?{withdrawalDestination:knownDestinations.get(o.id)}:{})}));
  const originalProductRoutes=require('./originalProductRoutes').findOriginalProductRoutes(separatedFundingInputs,accounts,fundingOptions);
  for(let i=0;i<classified.length;i++){const route=originalProductRoutes.get(classified[i].id);if(route?.inferredProduct)classified[i]={...classified[i],accountRelations:[{product:route.product,role:'target',activity:'investment_withdrawal',financialAccountId:route.productAccountId}],automaticClassification:{method:'source_statement_product_withdrawal',confidence:'inferred',evidenceObservationIds:route.evidenceObservationIds}};}
  const nativePensionRoutes=require('./nativePensionCashRoutes').findNativePensionCashRoutes(classified,accounts,{...fundingOptions,balanceEvidenceObservations:originalObservations.filter(o=>o.balanceEvidence)});
  const missingCardFunding=new Map([...historicalFunding,...findLegacyProductFunding(separatedFundingInputs,accounts,{...fundingOptions,historicalFunding,annotatedIds:new Set([...fundingOptions.annotatedIds].filter(id=>!preservedSelfTransferIds.has(id)))}),...findLegacyCardFunding(classified,accounts,fundingOptions),...findMissingCardFunding(classified,accounts,fundingOptions),...findProductBankFunding(classified,accounts,fundingOptions),...findDirectProductFunding(classified,accounts,fundingOptions),...findMybankProductCashLegs(classified,accounts,fundingOptions),...require('./recalledProductFunding').findRecalledProductFunding(classified,accounts,{...fundingOptions,balanceEvidenceObservations:originalObservations.filter(o=>o.balanceEvidence),balanceEvidenceImports:ledger.imports||[]}),...originalProductRoutes,...[...historicalFunding].filter(([,v])=>v.identityBasis==='owner_separated_named_channel'),...nativeNamedFunding,...nativePensionRoutes.funding]),funded=classified.map(o=>nativePensionRoutes.bankDestinations.has(o.id)?{...o,kind:'transfer',automaticClassification:nativePensionRoutes.bankDestinations.get(o.id)}:missingCardFunding.has(o.id)?{...o,...(missingCardFunding.get(o.id).inferredKind?{kind:missingCardFunding.get(o.id).inferredKind}:{}),...(missingCardFunding.get(o.id).inferredDirection?{direction:missingCardFunding.get(o.id).inferredDirection}:{}),...(missingCardFunding.get(o.id).actualPaidMinor?{amountMinor:missingCardFunding.get(o.id).actualPaidMinor}:{}),automaticFunding:missingCardFunding.get(o.id)}:o);
  for(let i=0;i<funded.length;i++){const o=funded[i],funding=o.automaticFunding,proof=proofAnchoredLoanReceipts.get(funding?.evidenceObservationIds?.[0]);if(proof&&proof.loanObservationId===o.id&&funding.method==='source_statement_legacy_product')funded[i]={...o,automaticFunding:{...funding,sourceProofObservationIds:proof.proofObservationIds,supersededAnnotationIds:[proof.annotationId],basis:'actual_loan_document_supersedes_provisional_unspecified_product'}};}
  const confirmedDestinations=new Map([...inferredDestinations,...resolveWithdrawalDestinations(funded,accounts,{annotatedIds:new Set(latestAnnotations.keys())})]);for(let i=0;i<funded.length;i++)if(confirmedDestinations.has(funded[i].id))funded[i]={...funded[i],withdrawalDestination:confirmedDestinations.get(funded[i].id)};
  const historicalFreeWithdrawals=require('./historicalAlipayWithdrawalFees').findHistoricalAlipayFreeWithdrawals(originalObservations,accounts,proofCashPostings,{destinations:confirmedDestinations,annotations:ledger.annotations||[],links:ledger.links||[]});
  const historicalRepaymentTargets=findHistoricalRepaymentTargets(funded,accounts,{annotatedIds:new Set(latestAnnotations.keys())});for(let i=0;i<funded.length;i++)if(historicalRepaymentTargets.has(funded[i].id))funded[i]={...funded[i],...(historicalRepaymentTargets.get(funded[i].id).policyScope==='source_transaction'?{kind:'debt_payment'}:{}),automaticRepaymentTarget:historicalRepaymentTargets.get(funded[i].id)};
  for(let i=0;i<funded.length;i++){const o=funded[i],target=!latestAnnotations.has(o.id)&&statementCreditRepaymentTarget(o,accounts);if(target)funded[i]={...o,automaticRepaymentTarget:target};}
  const nativeMortgages=require('./nativeMortgageStatements').buildNativeMortgageStatements(accounts,funded,originalObservations.filter(require('./nativeMortgageStatements').isNativeMortgageStatement),{annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[]});funded.push(...nativeMortgages.additions);
  const mortgageModels=buildMortgageModels(accounts,funded,{annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[],nativeModels:nativeMortgages.models}),mortgageBySource=new Map(),mortgageSplit=new Map(),historicalMortgageBySource=new Map();
  const installmentOptions={annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[],balanceSnapshots:ledger.balanceSnapshots||[]};
  const actualLoanProofs=require('./loanProofModels').buildLoanProofModels(accounts,funded,originalObservations.filter(o=>o.loanProof),installmentOptions),actualLoanSourceIds=new Set(actualLoanProofs.flatMap(m=>m.sourceObservationIds));
  for(const model of actualLoanProofs){for(const d of model.drawdowns){const i=funded.findIndex(o=>o.id===d.observationId);if(i>=0){const s=funded[i];funded[i]={...s,kind:'loan_drawdown',accountRelations:[...(s.accountRelations||[]).filter(r=>!(r.role==='target'&&r.product==='alipay_jiebei')),{product:'alipay_jiebei',role:'target',activity:'loan_drawdown',financialAccountId:model.financialAccountId}]};}}for(const p of model.periods)for(const id of p.observationIds){const i=funded.findIndex(o=>o.id===id);if(i>=0){const s=funded[i];funded[i]={...s,kind:'debt_payment',accountRelations:[...(s.accountRelations||[]).filter(r=>!(r.role==='target'&&r.product==='alipay_jiebei')),{product:'alipay_jiebei',role:'target',activity:'repayment',financialAccountId:model.financialAccountId}]};}}}
  const proofLoanWalletReceipts=findLoanWalletReceipts(funded,accounts,{...fundingOptions,actualLoanDrawEvidence:new Map(actualLoanProofs.flatMap(m=>m.drawdowns.map(d=>[d.observationId,d.proofObservationIds])))});for(let i=0;i<funded.length;i++)if(proofLoanWalletReceipts.has(funded[i].id)&&!funded[i].automaticWalletReceipt)funded[i]={...funded[i],automaticWalletReceipt:proofLoanWalletReceipts.get(funded[i].id)};
  const inferredLoanOptions={...installmentOptions,annotatedIds:new Set([...installmentOptions.annotatedIds,...actualLoanSourceIds])};
  const installmentLoans=[...actualLoanProofs,...buildInstallmentLoans(accounts,funded,installmentOptions),...buildSettledLoanEpisodes(accounts,funded,inferredLoanOptions),...buildInterestOnlyLoanTail(accounts,funded,inferredLoanOptions),...require('./recalledAccountRoutes').buildRecalledLoanRouteModels(ledger,funded)],installmentBySource=new Map(),installmentDraws=new Map();
  for(const model of installmentLoans.filter(m=>m.status==='reconciled_settled')){if(model.drawdowns)for(const d of model.drawdowns)installmentDraws.set(d.observationId,{...model,originalPrincipalMinor:d.principalMinor});else installmentDraws.set(model.drawdownObservationId,model);for(const p of model.periods)for(const id of p.observationIds)installmentBySource.set(id,{...p,financialAccountId:model.financialAccountId,sourceAccountId:model.sourceAccountId});}
  for(const model of mortgageModels){for(const o of classified)if(matchesMortgage(o,accounts.find(a=>a.id===model.financialAccountId).mortgage)){if(!mortgageBySource.has(o.id))mortgageBySource.set(o.id,[]);mortgageBySource.get(o.id).push(model.financialAccountId);}for(const p of [...model.periods,...model.prepayments])for(const id of p.observationIds)mortgageSplit.set(id,{...p,financialAccountId:model.financialAccountId});}
  for(const model of mortgageModels.filter(m=>['inferred_reconciled_history','actual_bank_statement'].includes(m.status)))for(const p of model.postingSplits||[...model.periods,...model.prepayments])for(const id of p.observationIds){historicalMortgageBySource.set(id,{...p,financialAccountId:model.financialAccountId,sourceAccountId:model.sourceAccountId});if(model.status==='actual_bank_statement'){mortgageSplit.set(id,{...p,financialAccountId:model.financialAccountId});mortgageBySource.set(id,[model.financialAccountId]);}}
  const observations=funded.map(o=>{const split=mortgageSplit.get(o.id);return split&&(split.confidence.startsWith('user_confirmed')||split.confidence==='actual_bank_statement')&&split.observationIds.length===1&&!latestAnnotations.has(o.id)?{...o,kind:'debt_payment',principalMinor:split.principalMinor,interestMinor:split.interestMinor,feeMinor:'0'}:o;}),links=(ledger.links||[]).filter(l=>l.status!=='deleted'&&l.observationIds.every(id=>!originalById.get(id)?.balanceEvidence)), accountMap=new Map(accounts.map(a=>[a.id,a]));
  const selected=new Set(options.accountIds||accounts.map(a=>a.id));
  const coveredByStatement=statementCoverage(observations);
  const parents=new Map(observations.map(o=>[o.id,o.id]));
  const root=id=>{while(parents.get(id)!==id) id=parents.get(id);return id;};
  const union=(a,b)=>{ if(parents.has(a)&&parents.has(b)) parents.set(root(b),root(a)); };
  const unresolvedAssociations=[],information=[];
  unresolvedAssociations.push(...nativeMortgages.issues);
  for(const m of actualLoanProofs)for(const issue of m.issues)unresolvedAssociations.push({...issue,financialAccountId:m.financialAccountId,affectedObservationIds:issue.proofObservationIds});
  for(const m of creditFinancing)if(m.status!=='reconciled_actual_records')unresolvedAssociations.push({reason:'credit_financing_evidence_conflict',financialAccountId:m.financialAccountId});
  for(const m of mortgageModels)if(m.calibrationVerification?.status==='requires_review')unresolvedAssociations.push({reason:'mortgage_calibration_conflict',financialAccountId:m.financialAccountId,...m.calibrationVerification,referenceMatch:m.referenceMatch});
  for(const m of installmentLoans)if(m.status!=='reconciled_settled')unresolvedAssociations.push({reason:'installment_loan_schedule_conflict',financialAccountId:m.financialAccountId});
  for(const register of securities)if(!register.cashBalanceComplete||!register.realizedGainComplete)unresolvedAssociations.push({reason:'brokerage_history_incomplete',financialAccountId:register.financialAccountId,affectedObservationIds:register.issues.map(i=>i.observationId),cashBalanceComplete:register.cashBalanceComplete,realizedGainComplete:register.realizedGainComplete});
  const pair=l=>[...l.observationIds].sort().join('|');
  const activePairs=new Set(links.map(pair));
  const blocked=new Set([...(ledger.links||[]).filter(l=>l.status==='deleted'&&l.type==='duplicate'&&!activePairs.has(pair(l))),...links.filter(l=>l.type==='distinct')].map(pair));
  for(const l of links) if(l.type==='duplicate') union(...l.observationIds);
  for(const p of receiptPlans)for(const id of p.observationIds.slice(1))union(p.sourceObservationId,id);
  const sourceVersions=new Map();for(const o of observations)if(o.sourceIdentity){const key=JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity]);if(sourceVersions.has(key))union(sourceVersions.get(key),o.id);else sourceVersions.set(key,o.id);}
  for(const model of installmentLoans.filter(m=>m.status==='reconciled_settled'))for(const p of model.periods)for(const id of p.observationIds.slice(1))union(p.observationIds[0],id);
  for(const model of mortgageModels.filter(m=>m.status==='inferred_reconciled_history'))for(const p of model.periods)for(const id of p.observationIds.slice(1))union(p.observationIds[0],id);
  for(const l of links)if(l.type==='transfer'){const pair=observations.filter(o=>l.observationIds.includes(o.id));if(pair.length===2&&pair.every(o=>o.kind==='debt_payment'))union(...l.observationIds);}
  const candidates=new Map(observations.map(o=>[root(o.id),new Set()]));
  // Index traceable references first: unrelated retail observations never require an all-pairs scan.
  const referenceBuckets=new Map(),sourceBuckets=new Map(),moneySourceBuckets=new Map(),candidatePairs=new Map(),oversized=new Set();
  const add=(map,key,o)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(o);};
  for(const o of observations)if(o.status==='completed'){
    const signature=JSON.stringify([o.date,o.amountMinor,o.currency,o.direction]);
    add(moneySourceBuckets,JSON.stringify([o.date,o.amountMinor,o.currency,o.direction,o.financialAccountId]),o);
    if(o.sourceTransactionId)add(sourceBuckets,JSON.stringify([signature,o.financialAccountId,o.provider,o.sourceTransactionId]),o);
    for(const ref of new Set([o.relatedReference,o.sourceTransactionId].filter(Boolean))){add(referenceBuckets,JSON.stringify([signature,ref]),o);if(o.kind==='debt_payment')add(referenceBuckets,JSON.stringify(['repayment',o.date,o.amountMinor,o.currency,ref]),o);}
  }
  for(const group of [...referenceBuckets.values(),...sourceBuckets.values()]){
    if(group.length>256){for(const o of group){oversized.add(o.id);unresolvedAssociations.push({reason:'ambiguous_reference',observationId:o.id,candidateObservationIds:group.filter(s=>s.id!==o.id).slice(0,64).map(s=>s.id),candidateCount:group.length-1});}continue;}
    for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){const a=group[i],b=group[j];candidatePairs.set([a.id,b.id].sort().join('|'),[a,b]);}
  }
  for(const [a,b] of candidatePairs.values()) {
    const repaymentPair=a.kind==='debt_payment'&&b.kind==='debt_payment'&&a.direction!==b.direction&&a.financialAccountId!==b.financialAccountId&&liability(accountMap.get(a.financialAccountId))!==liability(accountMap.get(b.financialAccountId));
    if(a.status!=='completed'||b.status!=='completed'||a.amountMinor!==b.amountMinor||a.currency!==b.currency||a.direction!==b.direction&&!repaymentPair||a.date!==b.date||blocked.has([a.id,b.id].sort().join('|'))||root(a.id)===root(b.id)) continue;
    const sameSource=a.financialAccountId===b.financialAccountId && a.provider===b.provider && a.sourceTransactionId && a.sourceTransactionId===b.sourceTransactionId;
    const ref=a.relatedReference && (a.relatedReference===b.relatedReference || a.relatedReference===b.sourceTransactionId) || b.relatedReference && b.relatedReference===a.sourceTransactionId;
    const funded=(fundingAccount(a,accounts)?.id===b.financialAccountId)||(fundingAccount(b,accounts)?.id===a.financialAccountId);
    if(sameSource || (ref && (funded||repaymentPair) && a.kind===b.kind)) { candidates.get(root(a.id)).add(root(b.id));candidates.get(root(b.id)).add(root(a.id)); }
  }
  for(const [id,set] of candidates){const ids=[...set];if(!oversized.has(id)&&ids.length===1&&!oversized.has(ids[0]) && candidates.get(ids[0]).size===1) union(id,ids[0]); else if(ids.length) unresolvedAssociations.push({reason:'ambiguous_reference',observationId:id,candidateObservationIds:ids});}
  // Card statement receipts have no platform order ID. A unique merchant,
  // funding-card, trade-date, amount and direction match can link them. We keep
  // uncertain overlaps visible rather than silently asserting an identity.
  const statementOverlaps=new Map(),statementMatches=new Map(),statementReverse=new Map();
  // User decisions address observations, but every source version of either
  // observation belongs to that decision. Do not bypass it through a new import.
  const statementBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort())));
  const merchant=v=>String(v||'').normalize('NFKC').replace(/^(?:\u652f\u4ed8\u5b9d|\u8d22\u4ed8\u901a|\u5fae\u4fe1\u652f\u4ed8|\u94f6\u8054\u626b\u7801)[-\s:]*/,'').replace(/[\s\p{P}]/gu,'');
  for(const s of observations){
    if(!['alipay','wechat','jd'].includes(s.provider)||s.status!=='completed')continue;
    const fund=fundingAccount(s,accounts);if(!fund)continue;
    const possible=(moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,s.direction,fund.id]))||[]).filter(b=>b.bankStatement&&b.kind===s.kind&&compatibleBankTradeTime(s,b)&&!statementBlocked.has(JSON.stringify([root(s.id),root(b.id)].sort()))&&root(s.id)!==root(b.id));
    if(!possible.length)continue;
    statementOverlaps.set(s.id,possible);
    const name=merchant(s.counterparty),matches=possible.filter(b=>{
      const text=b.counterparty||b.description,channel=bankPaymentProvider(b);
      if(channel&&channel!==s.provider)return false;
      const other=merchant(text),operationName=statementOperation.test(String(text||'').normalize('NFKC'))?statementMerchantText(text).replace(/[\s\p{P}]/gu,''):null;
      return name&&other&&(name===other||Math.min(name.length,other.length)>=4&&(name.startsWith(other)||other.startsWith(name))||name===statementMerchant(text,s.provider)||name===operationName);
    });
    const sourceRoot=root(s.id);
    for(const bankRoot of new Set(matches.map(b=>root(b.id)))){
      if(!statementMatches.has(sourceRoot))statementMatches.set(sourceRoot,new Set());
      if(!statementReverse.has(bankRoot))statementReverse.set(bankRoot,new Set());
      statementMatches.get(sourceRoot).add(bankRoot);statementReverse.get(bankRoot).add(sourceRoot);
    }
  }
  for(const [s,bankRoots] of statementMatches)if(bankRoots.size===1){const b=[...bankRoots][0];if(statementReverse.get(b).size===1)union(s,b);}
  // Approved reversible inference: an explicit bank channel, known funding card,
  // date, amount, currency and direction identify a pair only when both source
  // roots have exactly one candidate. Merchant/legal-entity names may differ.
  const automaticByObservation=new Map(),channelMatches=new Map(),channelReverse=new Map(),channelEvidence=new Map();
  for(const [id,patch]of returnedWechatTransferPurposes){const e=patch.automaticClassification;automaticByObservation.set(id,[{method:e.method,confidence:e.confidence,observationIds:e.evidenceObservationIds,evidence:e}]);}
  for(const m of require('./delayedClosedOrderRefunds').findDelayedClosedOrderRefunds(observations,accounts,{rootOf:root,fundingAccount,bankMerchant:o=>statementMerchant(o.counterparty||o.description,'alipay'),annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[]})){
    const association={method:'closed_order_next_day_refund',confidence:'inferred',observationIds:m.members.map(o=>o.id),evidence:m.evidence};
    for(const o of[m.refund,m.credit])automaticByObservation.set(o.id,[...(automaticByObservation.get(o.id)||[]),association]);
    union(m.refund.id,m.credit.id);
  }
  for(const m of require('./verifiedMerchantAliases').findVerifiedMerchantAliases(observations,accounts,{rootOf:root,fundingAccount,bankPaymentProvider,platformMerchant:o=>merchant(o.counterparty),bankMerchant:(o,p)=>statementMerchant(o.counterparty||o.description,p),annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[]})){const association={method:'verified_merchant_alias',confidence:'inferred',observationIds:m.members.map(o=>o.id),evidence:m.evidence};for(const o of m.members){automaticByObservation.set(o.id,[...(automaticByObservation.get(o.id)||[]),association]);union(m.platform.id,o.id);}}
  const commerceTraces=findCommercePaymentTraces(observations,{annotatedIds:new Set(latestAnnotations.keys()),annotations:latestAnnotations,links:ledger.links||[],accounts,rootOf:root}),commerceTraceByObservation=new Map();
  for(const trace of commerceTraces){const {commerce,payment,bank}=trace,members=[commerce,payment,...(bank?[bank]:[])],association={method:trace.method,confidence:trace.confidence,observationIds:members.map(s=>s.id),evidence:trace.evidence};for(const s of members){commerceTraceByObservation.set(s.id,trace);automaticByObservation.set(s.id,[...(automaticByObservation.get(s.id)||[]),association]);union(commerce.id,s.id);}}
  for(const p of observations){const funding=p.automaticFunding;if(!['source_statement_legacy_product','source_statement_mybank_product_cash_leg'].includes(funding?.method)&&!(funding?.method==='source_statement_legacy_card'&&['unique_native_bank_for_explicit_legacy_paid_order','unique_original_bank_and_native_paid_order'].includes(funding.identityBasis)))continue;const b=observations.find(o=>o.id===funding.evidenceObservationIds[0]);if(!b||root(p.id)===root(b.id))continue;const association={method:funding.method,confidence:'inferred',observationIds:[p.id,b.id],evidence:funding};for(const s of [p,b])automaticByObservation.set(s.id,[...(automaticByObservation.get(s.id)||[]),association]);union(p.id,b.id);}
  const creditDiscounts=[...require('./creditRepaymentDiscounts').findCreditRepaymentDiscounts(observations,accounts,{rootOf:root,annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[],bankPaymentProvider,statementOwners:sourceOwners}),...require('./productRepaymentBenefits').findProductRepaymentBenefits(observations,accounts,{rootOf:root,annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[],statementOwners:sourceOwners})],creditDiscountById=new Map();
  for(const m of creditDiscounts){const ids=[...new Set([m.platform.id,m.bank.id,m.credit.id])],association={method:m.method,confidence:m.confidence,observationIds:ids,evidence:{cashPaidMinor:m.platform.amountMinor,cardReceivedMinor:m.credit.amountMinor,discountMinor:m.discountMinor,...(m.serviceFeeMinor!==undefined?{orderOriginalPriceMinor:m.orderOriginalPriceMinor,serviceFeeMinor:m.serviceFeeMinor,feeConfidence:m.feeConfidence,netBenefitMinor:m.netBenefitMinor,feeRuleUrl:m.feeRuleUrl}:{}),cashAccountId:m.bank.financialAccountId,creditAccountId:m.credit.financialAccountId,reciprocalUnique:true}};for(const id of ids){creditDiscountById.set(id,m);automaticByObservation.set(id,[...(automaticByObservation.get(id)||[]),association]);union(m.platform.id,id);}}
  const bankStatementRoots=new Set(observations.filter(o=>o.bankStatement||o.statementFlow).map(o=>root(o.id)));
  const occupiedStatementRoots=new Set(observations.filter(o=>['alipay','wechat','jd'].includes(o.provider)&&bankStatementRoots.has(root(o.id))).map(o=>root(o.id)));
  const channelBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort())));
  const channelAnnotatedRoots=new Set([...latestAnnotations.keys()].filter(id=>{const p=latestAnnotations.get(id)?.patch,provisional=p&&Object.keys(p).every(k=>['kind','category'].includes(k))&&(p.kind==='expense'&&p.category==='暂按个人支出（用户授权、可修改）'||p.kind==='income'&&p.category==='暂按个人收入（用户授权、可修改）');const confirmedFamily=p&&Object.keys(p).every(k=>['kind','category'].includes(k))&&p.kind==='transfer'&&p.category==='\u5bb6\u5ead\u5185\u90e8\u5212\u8f6c\uff08\u90ed\u96c5\u840d\uff0c\u7528\u6237\u786e\u8ba4\uff09';return parents.has(id)&&!confirmedSettlementIds.has(id)&&!provisional&&!confirmedFamily;}).map(root));
  for(const s of observations){
    const sr=root(s.id);
    if(!['alipay','wechat','jd'].includes(s.provider)||s.status!=='completed'||bankStatementRoots.has(sr)||channelAnnotatedRoots.has(sr))continue;
    const fund=fundingAccount(s,accounts);if(!fund)continue;
    const direction=projectedBankDirection(s);
    for(const b of moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,direction,fund.id]))||[]){
      const br=root(b.id);
      if(!compatibleBankTradeTime(s,b))continue;
      if(legacyJdPaymentEnvelope(b)&&(ledger.links||[]).some(l=>l.type==='group_distinct'&&l.status!=='deleted'&&l.observationIds.some(id=>parents.has(id)&&[sr,br].includes(root(id)))))continue;
      const receivingCard=accountMap.get(b.automaticRepaymentTarget?.financialAccountId),issuerName=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/\u4fe1\u7528\u5361\u8fd8\u6b3e$/,'').replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe|\u5de5\u5546|\u519c\u4e1a)/,'');
      const ownedRepaymentPayer=b.automaticRepaymentTarget?.confidence==='verified_source_owner_and_statement_card'&&b.kind==='debt_payment'&&b.direction==='debit'&&s.kind==='debt_payment'&&['alipay','wechat'].includes(s.provider)&&!s.accountRelations?.length&&fund.id===b.financialAccountId&&receivingCard?.type==='credit_card'&&issuerName(s.counterparty)===issuerName(receivingCard.provider)&&(!s.automaticRepaymentTarget||s.automaticRepaymentTarget.financialAccountId===receivingCard.id);
      if(ownedRepaymentPayer&&(ledger.links||[]).some(l=>l.type==='group_distinct'&&l.status!=='deleted'&&l.observationIds.some(id=>parents.has(id)&&[sr,br].includes(root(id)))))continue;
      const explicitPaymentPurpose=b.kind==='expense'&&['transfer','debt_payment'].includes(s.kind)&&bankPaymentProvider(b)===s.provider&&(/^(?:\u6d88\u8d39\s+|\u5feb\u6377\u652f\u4ed8[-\s]|\u652f\u4ed8\u5b9d\u5feb\u6377\u652f\u4ed8$|\u4eac\u4e1c\u652f\u4ed8\u5feb\u6377\u652f\u4ed8$)/.test(String(b.description||b.counterparty||'').normalize('NFKC'))||b.provider==='hangzhou'&&b.statementFlow?.schema==='hangzhou-debit-v1'&&b.description==='\u6d88\u8d39'&&s.provider==='alipay'&&s.kind==='transfer'&&s.direction==='debit');
      const jdRepayment=s.provider==='jd'&&s.kind==='debt_payment'&&(s.accountRelations||[]).some(r=>r.product==='jd_baitiao'&&r.role==='target'&&r.activity==='repayment')&&b.kind==='expense'&&b.statementFlow&&(b.description==='\u6d88\u8d39'&&/^\u4eac\u4e1c-(?:\u4eac\u4e1c(?:\u767d\u6761\u53ca\u91d1\u6761\u4e1a\u52a1\u7f51\u94f6\u5e73\u53f0|\u91d1\u878d)|\u767d\u6761\u5408\u5e76\u8fd8\u6b3e\u7f51\u94f6\u5e73\u53f0)$/.test(b.counterparty)||legacyJdPaymentEnvelope(b));
      const jdProductDeposit=s.provider==='jd'&&s.kind==='transfer'&&(s.accountRelations||[]).some(r=>r.product==='jd_xiaojinku'&&r.role==='target'&&r.activity==='investment_deposit')&&b.kind==='expense'&&b.statementFlow&&b.description==='\u6d88\u8d39'&&b.counterparty==='\u4eac\u4e1c-\u80af\u7279\u745e\u5c0f\u91d1\u5e93\u7f51\u94f6\u5e73\u53f0';
      const genericBocomRemittance=b.provider==='bocom'&&b.kind==='debt_payment'&&b.description==='代发款项 信用卡还款'&&b.rawFields?.statementCredit===true&&b.rawFields?.statementAmountMinor==='-'+b.amountMinor;
      const genericCmbRemittance=b.provider==='cmb'&&b.bankStatement?.schema==='bank-credit-v1'&&b.bankStatement.provider==='cmb'&&b.kind==='debt_payment'&&b.direction==='credit'&&b.description==='\u8d22\u4ed8\u901a\u8fd8\u6b3e'&&b.rawFields?.statementCredit===true&&b.rawFields?.statementAmountMinor==='-'+b.amountMinor&&b.rawFields?.dateBasis==='transaction_date'&&b.rawFields?.tradeDate===b.date;
      const genericRefundReceipt=s.kind==='refund'&&direction==='credit'&&b.direction==='credit'&&b.bankStatement&&!b.bankStatement.nonCash&&(b.kind==='unknown'&&ambiguousCardCredit(b.description)||genericBocomRemittance||genericCmbRemittance)&&fund.type==='credit_card';
      if(genericRefundReceipt&&observations.some(x=>x.status==='completed'&&x.kind==='debt_payment'&&['alipay','wechat'].includes(x.provider)&&['neutral','debit'].includes(x.direction)&&x.date===s.date&&x.amountMinor===s.amountMinor&&x.currency===s.currency&&String(x.counterparty||'').normalize('NFKC').replace(/\s/g,'').replace(/\u4fe1\u7528\u5361\u8fd8\u6b3e$/,'')===String(fund.provider).normalize('NFKC').replace(/\s/g,'')))continue;
      const platformServiceFee=s.provider==='alipay'&&s.kind==='fee'&&s.direction==='debit'&&b.kind==='expense'&&b.direction==='debit'&&b.bankStatement&&!b.bankStatement.nonCash;
      const compatibleKind=b.kind===s.kind||wechatTeachingBankReceipt(s,b)||platformServiceFee||explicitPaymentPurpose||jdRepayment||jdProductDeposit||genericRefundReceipt||b.statementFlow&&b.kind==='unknown'&&!latestAnnotations.has(b.id)&&['expense','income','refund','transfer','debt_payment'].includes(s.kind);
      const bankChannel=bankPaymentProvider(b),explicitDebitPayment=b.statementFlow&&b.kind==='unknown'&&/^(?:\u5feb\u6377\u652f\u4ed8|\u94f6\u8054\u5feb\u6377)$/.test(String(b.description||'').trim()),undisclosedCardChannel=bankChannel===null&&(b.bankStatement&&['expense','refund','income','interest','fee'].includes(b.kind)||explicitDebitPayment||genericRefundReceipt||ownedRepaymentPayer);
      if(!(b.bankStatement||b.statementFlow)||!compatibleKind||occupiedStatementRoots.has(br)||channelAnnotatedRoots.has(br)||bankChannel!==s.provider&&!undisclosedCardChannel||channelBlocked.has(JSON.stringify([sr,br].sort())))continue;
      if(!channelMatches.has(sr))channelMatches.set(sr,new Set());if(!channelReverse.has(br))channelReverse.set(br,new Set());
      channelMatches.get(sr).add(br);channelReverse.get(br).add(sr);
      const key=JSON.stringify([sr,br]),previous=channelEvidence.get(key);
      if(!previous||(s.sourceVersionOrdinal||0)>(previous.s.sourceVersionOrdinal||0)||(b.sourceVersionOrdinal||0)>(previous.b.sourceVersionOrdinal||0))channelEvidence.set(key,{s,b,fund,ownedRepaymentPayer});
    }
  }
  for(const [sr,bankRoots] of channelMatches)if(bankRoots.size===1){
    const br=[...bankRoots][0];if(channelReverse.get(br).size!==1)continue;
    const {s,b,fund,ownedRepaymentPayer}=channelEvidence.get(JSON.stringify([sr,br]));
    const association={method:bankPaymentProvider(b)===s.provider?'unique_channel_funding':'unique_card_funding',confidence:'inferred',observationIds:[s.id,b.id],evidence:{financialAccountId:fund.id,date:s.date,amountMinor:s.amountMinor,currency:s.currency,direction:projectedBankDirection(s),platform:s.provider,bankPlatformDisclosed:bankPaymentProvider(b)===s.provider,reciprocalUnique:true,...(ownedRepaymentPayer?{receivingAccountId:b.automaticRepaymentTarget.financialAccountId,identityBasis:'verified_owner_counter_card_and_platform_payer'}:{})}};
    automaticByObservation.set(s.id,[association]);automaticByObservation.set(b.id,[association]);union(sr,br);
  }
  // A repayment receipt may say neutral (not income/expense), while its bank
  // statement records a credit. Require the named receiving bank plus payer
  // card/channel evidence and reciprocal uniqueness, including source versions.
  const preciseOptions={rootOf:root,fundingAccount,bankPaymentProvider,statementOwners:sourceOwners,annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[]};
  const creditRepaymentCostById=new Map();
  for(const match of require('./wechatCreditRepaymentCosts').findWechatCreditRepaymentCosts(observations,accounts,preciseOptions)){
    const {platform:p,credit:c}=match,association={method:match.method,confidence:match.confidence,observationIds:[p.id,c.id],evidence:match.evidence};
    const at=observations.findIndex(o=>o.id===p.id);observations[at]={...p,automaticFunding:{...p.automaticFunding,financialAccountId:match.payerAccountId,method:match.method,confidence:match.confidence,evidenceObservationIds:[p.id,c.id]},automaticRepaymentTarget:{...p.automaticRepaymentTarget,financialAccountId:c.financialAccountId,method:match.method,confidence:match.confidence,evidenceObservationIds:[p.id,c.id]}};
    for(const s of[p,c]){creditRepaymentCostById.set(s.id,match);automaticByObservation.set(s.id,[...(automaticByObservation.get(s.id)||[]),association]);}union(p.id,c.id);
  }
  for(const match of require('./ambiguousJdRepaymentCash').findAmbiguousJdRepaymentCash(observations,accounts,preciseOptions)){
    const {platform:p,bank:b}=match,association={method:'ambiguous_jd_repayment_cash',confidence:'inferred',observationIds:[p.id,b.id],evidence:match.evidence};
    for(const s of[p,b])automaticByObservation.set(s.id,[...(automaticByObservation.get(s.id)||[]),association]);union(p.id,b.id);
  }
  for(const match of require('./sourceNamedProductBankReceipts').findSourceNamedProductBankReceipts(observations,accounts,{...preciseOptions,annotations:latestAnnotations})){
    const {platform:p,bank:b}=match,association={method:'source_named_product_bank_receipt',confidence:'inferred',observationIds:[p.id,b.id],evidence:match.evidence};
    const at=observations.findIndex(o=>o.id===p.id);observations[at]={...p,automaticFunding:{...p.automaticFunding,financialAccountId:b.financialAccountId,method:association.method,confidence:'inferred_from_explicit_source_and_actual_bank_receipt',evidenceObservationIds:[p.id,b.id]}};
    for(const source of[p,b])automaticByObservation.set(source.id,[...(automaticByObservation.get(source.id)||[]),association]);union(p.id,b.id);
  }
  for(const match of require('./namedYuebaoBankReceipts').findNamedYuebaoBankReceipts(observations,accounts,preciseOptions)){
    const {platform:p,bank:b}=match,association={method:'named_yuebao_bank_receipt',confidence:'inferred',observationIds:[p.id,b.id],evidence:match.evidence};
    for(const source of[p,b])automaticByObservation.set(source.id,[...(automaticByObservation.get(source.id)||[]),association]);union(p.id,b.id);
  }
  for(const match of findPreciseBankPayments(observations,accounts,preciseOptions)){
    const {platform:p,bank:b,seconds}=match,association={method:'precise_bank_payment_time',confidence:'inferred',observationIds:[p.id,b.id],evidence:{financialAccountId:b.financialAccountId,date:p.date,amountMinor:p.amountMinor,currency:p.currency,secondsAfter:seconds,reciprocalUnique:true}};
    for(const source of [p,b])automaticByObservation.set(source.id,[...(automaticByObservation.get(source.id)||[]),association]);union(p.id,b.id);
  }
  const directClearingByObservation=new Map();
  for(const match of findDirectProductPayments(observations,accounts,preciseOptions)){
    const {platform:p,product:b,seconds,nominalAccountId}=match,members=match.clearing?.members||[p,b],association={method:'direct_product_payment',confidence:'inferred',observationIds:members.map(o=>o.id),evidence:{financialAccountId:b.financialAccountId,nominalAccountId,date:p.date,amountMinor:p.amountMinor,currency:p.currency,secondsAfter:seconds,bankStatementCovered:true,reciprocalUnique:true,...(match.clearing?{actualClearingBankNetMinor:'0',actualClearingObservationIds:match.clearing.members.filter(o=>o.statementFlow?.schema==='mybank-current-v1').map(o=>o.id)}:{})}};
    for(const source of members){automaticByObservation.set(source.id,[...(automaticByObservation.get(source.id)||[]),association]);if(match.clearing)directClearingByObservation.set(source.id,match.clearing);union(p.id,source.id);}
  }
  const walletTransferByObservation=new Map();
  for(const match of ownedBankTransfers){const association={method:'paired_owned_bank_transfer',confidence:'inferred',observationIds:[match.debit.id,match.credit.id],evidence:{date:match.debit.date,amountMinor:match.debit.amountMinor,currency:match.debit.currency,debitAccountId:match.debit.financialAccountId,creditAccountId:match.credit.financialAccountId,identityEvidenceObservationIds:match.identityEvidenceObservationIds,...(match.debit.date!==match.credit.date?{debitDate:match.debit.date,creditDate:match.credit.date,dateBasis:'both_original_statement_dates',statementDateDifferenceDays:(Date.parse(match.debit.date)-Date.parse(match.credit.date))/86400000}:{}),reciprocalUnique:true}};for(const s of [match.debit,match.credit])automaticByObservation.set(s.id,[...(automaticByObservation.get(s.id)||[]),association]);union(match.debit.id,match.credit.id);}
  for(const allowSlowMybankTopUp of [false,true])for(const match of findWalletBankTransfers(observations,accounts,{...preciseOptions,allowSlowMybankTopUp})){
    const association={method:match.method,confidence:'inferred',observationIds:[match.platform.id,match.bank.id],evidence:{walletAccountId:match.walletAccountId||match.platform.financialAccountId,bankAccountId:match.bank.financialAccountId,date:match.platform.date,amountMinor:match.platform.amountMinor,currency:match.platform.currency,secondsAfter:match.seconds,walletDeltaMinor:match.walletDeltaMinor,reciprocalUnique:true,...(match.identityBasis?{identityBasis:match.identityBasis}:{}),...(match.sourceDirectionBasis?{sourceDirectionBasis:match.sourceDirectionBasis}:{}),...(match.timingBasis?{timingBasis:match.timingBasis}:{})}};
    for(const source of [match.platform,match.bank]){walletTransferByObservation.set(source.id,match);automaticByObservation.set(source.id,[...(automaticByObservation.get(source.id)||[]),association]);}union(match.platform.id,match.bank.id);
  }
  for(const match of require('./mixedPayments').findLegacyInvestmentBankReceipts(observations,accounts,preciseOptions)){
    const {platform:p,bank:b,productAccountId,product,seconds}=match,method='precise_legacy_product_bank_receipt',evidence={product,productAccountId,bankAccountId:b.financialAccountId,date:p.date,currency:p.currency,amountMinor:p.amountMinor,secondsAfter:seconds,reciprocalUnique:true,followingPurchaseDestinationInferred:false},association={method,confidence:'inferred',observationIds:[p.id,b.id],evidence};
    const index=observations.findIndex(o=>o.id===p.id);observations[index]={...observations[index],automaticFunding:{financialAccountId:b.financialAccountId,method,confidence:'inferred',evidenceObservationIds:[b.id],...evidence}};
    for(const s of[p,b])automaticByObservation.set(s.id,[...(automaticByObservation.get(s.id)||[]),association]);union(p.id,b.id);
  }
  for(const match of require('./mixedPayments').findKatongPersonalPayments(observations,accounts,{...preciseOptions,annotations:latestAnnotations})){
    const {platform:p,bank:b,evidence}=match,method='verified_katong_personal_payment',association={method,confidence:'inferred',observationIds:[p.id,b.id],evidence};
    const index=observations.findIndex(o=>o.id===p.id);observations[index]={...observations[index],automaticFunding:{financialAccountId:b.financialAccountId,method,confidence:'inferred',evidenceObservationIds:[b.id],...evidence}};
    for(const s of[p,b])automaticByObservation.set(s.id,[...(automaticByObservation.get(s.id)||[]),association]);union(p.id,b.id);
  }
  const mixedFundingByObservation=new Map(directClearingByObservation);
  for(const match of [...findMixedProductPayments(observations,accounts,preciseOptions),...findDirectSplitPayments(observations,accounts,preciseOptions),...findProductCreditRepayments(observations,accounts,preciseOptions),...require('./nativeMixedHuabeiRepayments').findNativeMixedHuabeiRepayments(observations,accounts,{...preciseOptions,originalObservations,imports:ledger.imports||[]}),...findProductWalletTopUps(observations,accounts,preciseOptions)]){
    const association={method:match.method||'mixed_product_payment',confidence:'inferred',observationIds:match.members.map(o=>o.id),evidence:{date:match.platform.date,currency:match.platform.currency,amountMinor:match.platform.amountMinor,allocations:match.allocation,clearingAmountMinor:match.clearingCredit?.amountMinor||'0',preciseOriginalTimestamps:true,reciprocalUnique:true,...(match.nativeWalletSplitEvidence?{nativeWalletSplitEvidence:match.nativeWalletSplitEvidence}:{})}};
    for(const source of match.members){mixedFundingByObservation.set(source.id,match);automaticByObservation.set(source.id,[...(automaticByObservation.get(source.id)||[]),association]);union(match.platform.id,source.id);}
  }
  const lateBocomReceipt=b=>b.provider==='bocom'&&b.bankStatement?.schema==='bank-credit-v1'&&!b.bankStatement.nonCash&&b.kind==='unknown'&&b.description==='\u4ee3\u53d1\u6b3e\u9879'&&b.rawFields?.statementCredit===true&&b.rawFields?.statementAmountMinor==='-'+b.amountMinor&&b.rawFields?.dateBasis==='transaction_date'&&b.rawFields?.tradeDate===b.date&&b.rawFields?.postedDate===b.date&&b.bankStatement.postedDate===b.date;
  const repaymentReceipts=new Map(),repaymentMatches=new Map(),repaymentReverse=new Map(),lateRepaymentEvidence=new Map();
  const repaymentBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort()))),repaymentAnnotatedRoots=new Set([...latestAnnotations.keys()].filter(id=>parents.has(id)).map(root));
  for(const b of observations)if(b.status==='completed'&&(b.kind==='debt_payment'||b.kind==='unknown'&&(ambiguousCardCredit(b.description)||/^\u7f51\u8054\u5165\u8d26-(?:\u652f\u4ed8\u5b9d\u7f51\u8054|\u652f\u4ed8\u5b9d)$/.test(b.description)))&&b.direction==='credit'&&b.bankStatement&&accountMap.get(b.financialAccountId)?.type==='credit_card'){add(repaymentReceipts,JSON.stringify([b.date,b.amountMinor,b.currency]),b);if(lateBocomReceipt(b))add(repaymentReceipts,JSON.stringify([new Date(Date.parse(b.date)-86400000).toISOString().slice(0,10),b.amountMinor,b.currency]),b);const posted=b.bankStatement.postedDate;if(posted&&Date.parse(posted)-Date.parse(b.date)===86400000)add(repaymentReceipts,JSON.stringify([posted,b.amountMinor,b.currency]),b);}
  for(const s of observations){
    if(!['alipay','wechat'].includes(s.provider)||s.kind!=='debt_payment'||s.status!=='completed'||!['neutral','debit'].includes(s.direction)||repaymentAnnotatedRoots.has(root(s.id)))continue;
    const bank=String(s.counterparty||'').normalize('NFKC').replace(/\s/g,'').replace(/信用卡还款$/,''),fund=fundingAccount(s,accounts);
    if(!/\u94f6\u884c$/.test(bank))continue;
    const matches=(repaymentReceipts.get(JSON.stringify([s.date,s.amountMinor,s.currency]))||[]).filter(b=>{
      const a=accountMap.get(b.financialAccountId),text=[b.description,b.counterparty].join(' '),channel=s.provider==='alipay'?/\u652f\u4ed8\u5b9d/:/\u5fae\u4fe1|\u8d22\u4ed8\u901a/;
      const ownerReceipt=b.provider==='cib'&&b.kind==='debt_payment'&&!b.bankStatement.nonCash&&verifiedOwnerNames.size===1&&b.description.startsWith([...verifiedOwnerNames][0]+'/\u4ed8\u6b3e\u5c3e\u53f7:')&&/^\d{4}\/\u94f6\u8054\u5165\u8d26$/.test(b.description.slice(([...verifiedOwnerNames][0]+'/\u4ed8\u6b3e\u5c3e\u53f7:').length));
      const cgbClearingReceipt=b.provider==='cgb'&&b.bankStatement?.schema==='bank-credit-v1'&&b.bankStatement.provider==='cgb'&&b.kind==='debt_payment'&&!b.bankStatement.nonCash&&b.direction==='credit'&&b.rawFields?.statementCredit===true&&b.rawFields?.statementAmountMinor==='-'+b.amountMinor&&b.rawFields?.cardTail===a.maskedIdentifier&&b.bankStatement.cardTail===a.maskedIdentifier&&b.description==='(\u8fd8\u6b3e)\u7f51\u4e0a\u652f\u4ed8\u8de8\u884c\u6e05\u7b97\u7cfb\u7edf\u8fd8\u6b3e(\u4eba\u884c)';
      if(cgbClearingReceipt&&(ledger.links||[]).some(l=>l.type==='group_distinct'&&l.status!=='deleted'&&l.observationIds.some(id=>parents.has(id)&&[root(s.id),root(b.id)].includes(root(id)))))return false;
      const explicitReceipt=ownerReceipt||b.kind==='debt_payment'&&!b.bankStatement.nonCash&&/\u7f51\u94f6\u4e92\u8054\u8fd8\u6b3e|\u672c\u884c\u81ea\u52a9\u8f6c\u5165|\u7f51\u8054\u81ea\u52a9\u8f6c\u5165/.test(b.description)||b.kind==='unknown'&&ambiguousCardCredit(b.description)||b.kind==='debt_payment'&&(/\u4fe1\u7528\u5361\u8fd8\u6b3e/.test(text)||/^\u8f6c[\u5e10\u8d26]\u8fd8\u6b3e$/.test(b.description)),competingRefund=b.kind==='unknown'&&observations.some(x=>x.id!==s.id&&x.provider===s.provider&&x.kind==='refund'&&x.status==='completed'&&x.date===s.date&&x.amountMinor===s.amountMinor&&x.currency===s.currency&&(!fundingAccount(x,accounts)||fundingAccount(x,accounts)?.id===a.id));
      if(b.date!==s.date&&!(b.bankStatement.postedDate===s.date&&Date.parse(s.date)-Date.parse(b.date)===86400000)){
        if(!lateBocomReceipt(b)||Date.parse(b.date)-Date.parse(s.date)!==86400000||!actualSecond(s)||s.occurredAt.slice(11,19)<'23:00:00'||s.automaticRepaymentTarget?.financialAccountId!==a.id)return false;
        const dates=new Set([s.date,b.date]);
        if(observations.some(x=>root(x.id)!==root(s.id)&&x.status==='completed'&&dates.has(x.date)&&x.amountMinor===s.amountMinor&&x.currency===s.currency&&(x.kind==='refund'&&['alipay','wechat','jd'].includes(x.provider)&&(!fundingAccount(x,accounts)||fundingAccount(x,accounts)?.id===a.id)||x.statementFlow&&x.direction==='debit'&&['unknown','transfer','debt_payment'].includes(x.kind)&&['bank','debit_card','savings'].includes(accountMap.get(x.financialAccountId)?.type))))return false;
        if((ledger.links||[]).some(l=>l.type==='group_distinct'&&l.status!=='deleted'&&l.observationIds.some(id=>parents.has(id)&&[root(s.id),root(b.id)].includes(root(id)))))return false;
        lateRepaymentEvidence.set(JSON.stringify([root(s.id),root(b.id)]),{dateBasis:'late_platform_payment_next_day_bank_receipt',paymentDate:s.date,creditTradeDate:b.date,creditPostedDate:b.bankStatement.postedDate,confirmedCreditAccountId:a.id});
      }
      return a.label.normalize('NFKC').replace(/\s/g,'').startsWith(bank)&&!competingRefund&&!repaymentAnnotatedRoots.has(root(b.id))&&!repaymentBlocked.has(JSON.stringify([root(s.id),root(b.id)].sort()))&&(explicitReceipt||cgbClearingReceipt||channel.test(text)||fund?.maskedIdentifier&&text.includes(fund.maskedIdentifier));
    });
    const unique=[...new Set(matches.map(b=>root(b.id)))];
    for(const br of unique){if(br===root(s.id))continue;if(!repaymentMatches.has(root(s.id)))repaymentMatches.set(root(s.id),new Set());repaymentMatches.get(root(s.id)).add(br);if(!repaymentReverse.has(br))repaymentReverse.set(br,new Set());repaymentReverse.get(br).add(root(s.id));}
  }
  for(const [s,bs] of repaymentMatches)if(bs.size===1){const b=[...bs][0];if(repaymentReverse.get(b).size===1){const association={method:'credit_repayment_receipt',confidence:'inferred',observationIds:[s,b],evidence:{reciprocalUnique:true,namedReceivingBank:true,...(lateRepaymentEvidence.get(JSON.stringify([s,b]))||{})}};for(const id of [s,b])automaticByObservation.set(id,[...(automaticByObservation.get(id)||[]),association]);union(s,b);}}
  // A fund confirmation has its own source ID but repeats the platform order
  // number. Bind that receipt to the purchase so the proven fee gets its actual
  // funding account. Cash paid and gross subscription values remain distinct.
  const fundPayments=new Map(),fundMatches=new Map(),fundReverse=new Map(),fundEvidence=new Map();
  const fundBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort())));
  for(const p of observations)if(p.status==='completed'&&!p.investmentTrade&&p.kind==='transfer'&&p.sourceTransactionId&&(p.accountRelations||[]).some(r=>r.product==='alipay_funds'&&r.activity==='investment_deposit'&&r.role==='target'))add(fundPayments,JSON.stringify([p.financialAccountId,p.provider,p.currency,p.sourceTransactionId]),p);
  for(const c of observations){
    if(c.status!=='completed'||c.kind!=='transfer'||c.investmentTrade?.tradeType!=='buy')continue;
    const cr=root(c.id),trade=c.investmentTrade;
    for(const p of fundPayments.get(JSON.stringify([c.financialAccountId,c.provider,c.currency,trade.orderId]))||[]){
      const target=(c.accountRelations||[]).find(r=>r.product==='alipay_funds'&&r.role==='target')?.financialAccountId;
      const pr=root(p.id);if(cr===pr||!target||!(p.accountRelations||[]).some(r=>r.product==='alipay_funds'&&r.role==='target'&&r.financialAccountId===target)||p.date<c.date||p.date>trade.confirmedAt.slice(0,10)||fundBlocked.has(JSON.stringify([cr,pr].sort())))continue;
      if(!fundMatches.has(cr))fundMatches.set(cr,new Set());if(!fundReverse.has(pr))fundReverse.set(pr,new Set());
      fundMatches.get(cr).add(pr);fundReverse.get(pr).add(cr);fundEvidence.set(JSON.stringify([cr,pr]),{c,p});
    }
  }
  for(const [cr,paymentRoots] of fundMatches)if(paymentRoots.size===1){const pr=[...paymentRoots][0];if(fundReverse.get(pr).size!==1)continue;const {c,p}=fundEvidence.get(JSON.stringify([cr,pr]));const evidence={method:'fund_confirmation_order',confidence:'reference',observationIds:[c.id,p.id],evidence:{samePlatformOrder:true,currency:c.currency}};automaticByObservation.set(c.id,[...(automaticByObservation.get(c.id)||[]),evidence]);automaticByObservation.set(p.id,[...(automaticByObservation.get(p.id)||[]),evidence]);union(pr,cr);}
  const productReceiptByObservation=new Map(),productMatches=new Map(),productReverse=new Map(),productEvidence=new Map();
  const productBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort())));
  const productAnnotatedRoots=new Set([...latestAnnotations.keys()].filter(id=>parents.has(id)&&!preservedSelfTransferIds.has(id)).map(root));
  for(const p of observations){
    if(p.provider!=='alipay'||p.status!=='completed'||p.kind!=='transfer'||productAnnotatedRoots.has(root(p.id)))continue;
    const target=(p.accountRelations||[]).find(r=>r.role==='target'&&r.product==='alipay_yulibao'&&['investment_deposit','investment_withdrawal'].includes(r.activity));if(!target)continue;
    const direction=target.activity==='investment_deposit'?'credit':'debit',pr=root(p.id);
    for(const b of moneySourceBuckets.get(JSON.stringify([p.date,p.amountMinor,p.currency,direction,target.financialAccountId]))||[]){
      const br=root(b.id),seconds=(Date.parse(b.occurredAt)-Date.parse(p.occurredAt))/1000,limit=p.automaticFunding?.method==='source_statement_product_funding'&&p.automaticFunding.evidenceObservationIds.includes(b.id)?30:10;
      if(b.statementFlow?.schema!=='mybank-yulibao-v1'||b.kind!=='transfer'||pr===br||seconds<0||seconds>limit||!actualSecond(p)||!actualSecond(b)||productAnnotatedRoots.has(br)||productBlocked.has(JSON.stringify([pr,br].sort())))continue;
      if(!productMatches.has(pr))productMatches.set(pr,new Set());if(!productReverse.has(br))productReverse.set(br,new Set());productMatches.get(pr).add(br);productReverse.get(br).add(pr);
      const key=JSON.stringify([pr,br]),previous=productEvidence.get(key),pv=p.sourceVersionOrdinal||0,bv=b.sourceVersionOrdinal||0;
      if(!previous||pv>(previous.p.sourceVersionOrdinal||0)||pv===(previous.p.sourceVersionOrdinal||0)&&bv>(previous.b.sourceVersionOrdinal||0))productEvidence.set(key,{p,b,seconds});
    }
  }
  for(const [pr,receipts] of productMatches)if(receipts.size===1){const br=[...receipts][0];if(productReverse.get(br).size!==1)continue;const match=productEvidence.get(JSON.stringify([pr,br])),{p,b,seconds}=match,fund=statementCounterAccount(b,accounts)||(p.automaticFunding?.method==='source_statement_product_funding'?accountMap.get(p.automaticFunding.financialAccountId):null);match.fund=fund;
    const association={method:'product_statement_time',confidence:'inferred',observationIds:[p.id,b.id],evidence:{financialAccountId:b.financialAccountId,fundingAccountId:fund?.id||null,date:p.date,amountMinor:p.amountMinor,currency:p.currency,bankDirection:b.direction,secondsAfter:seconds,reciprocalUnique:true}};
    for(const source of [p,b]){productReceiptByObservation.set(source.id,match);automaticByObservation.set(source.id,[...(automaticByObservation.get(source.id)||[]),association]);}union(pr,br);
  }
  const productLegMatches=new Map(),productLegReverse=new Map(),productLegEvidence=new Map();
  const productLegBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort())));
  const productLegAnnotatedRoots=new Set([...latestAnnotations.keys()].filter(id=>parents.has(id)).map(root));
  for(const match of new Set(productReceiptByObservation.values())){
    const {b,fund}=match;if(!fund)continue;const br=root(b.id),direction=b.direction==='credit'?'debit':'credit';
    for(const leg of moneySourceBuckets.get(JSON.stringify([b.date,b.amountMinor,b.currency,direction,fund.id]))||[]){
      const lr=root(leg.id),seconds=Math.abs(Date.parse(leg.occurredAt)-Date.parse(b.occurredAt))/1000;
      const explicitFunding=b&&match.p.automaticFunding?.method==='source_statement_product_funding'&&match.p.automaticFunding.evidenceObservationIds.includes(leg.id);
      if(!leg.statementFlow||!['transfer',...(explicitFunding?['unknown']:[])].includes(leg.kind)||lr===br||(!explicitFunding&&(seconds>10||!/\u57fa\u91d1|\u4f59\u5229\u5b9d/.test(leg.description+' '+leg.counterparty)))||productLegAnnotatedRoots.has(lr)||productLegAnnotatedRoots.has(br)||productLegBlocked.has(JSON.stringify([br,lr].sort())))continue;
      if(!productLegMatches.has(br))productLegMatches.set(br,new Set());if(!productLegReverse.has(lr))productLegReverse.set(lr,new Set());productLegMatches.get(br).add(lr);productLegReverse.get(lr).add(br);productLegEvidence.set(JSON.stringify([br,lr]),{b,leg,seconds});
    }
  }
  for(const [br,legs] of productLegMatches)if(legs.size===1){const lr=[...legs][0];if(productLegReverse.get(lr).size!==1)continue;const {b,leg,seconds}=productLegEvidence.get(JSON.stringify([br,lr]));const association={method:'product_statement_time',confidence:'inferred',observationIds:[b.id,leg.id],evidence:{financialAccountId:b.financialAccountId,fundingAccountId:leg.financialAccountId,date:b.date,amountMinor:b.amountMinor,currency:b.currency,bankDirection:b.direction,secondsApart:seconds,reciprocalUnique:true}};for(const s of [b,leg])automaticByObservation.set(s.id,[...(automaticByObservation.get(s.id)||[]),association]);union(br,lr);}
  const payerBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort()))),payerAnnotatedRoots=new Set([...latestAnnotations.keys()].filter(id=>parents.has(id)).map(root));
  const originalProductRepayments=require('./directProductCreditRepayments').findDirectProductCreditRepayments(observations,accounts,{rootOf:root,annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[],statementOwners:sourceOwners});
  for(const {credit,debit,target,method,independentOtherPairs} of originalProductRepayments){
    const association={method:'named_credit_repayment_receipt',confidence:'inferred',observationIds:[credit.id,debit.id],evidence:{identityBasis:method,...(independentOtherPairs.length?{jointOtherOriginals:independentOtherPairs.flatMap(m=>[m.debit.id,m.credit.id])}:{}),paymentAccountId:debit.financialAccountId,receivingAccountId:target.id,date:credit.date,paymentDate:debit.date,creditTradeDate:credit.date,creditPostedDate:credit.bankStatement.postedDate||credit.date,dateBasis:debit.date===credit.date?'original_trade_date':'original_next_day_credit_trade_date',amountMinor:credit.amountMinor,currency:credit.currency,reciprocalUnique:true}};
    for(const s of [credit,debit])automaticByObservation.set(s.id,[...(automaticByObservation.get(s.id)||[]),association]);union(credit.id,debit.id);
  }
  const occupiedProductRepaymentRoots=new Set(originalProductRepayments.flatMap(m=>[root(m.debit.id),root(m.credit.id)]));
  const payerIncompatibleRoots=new Set(observations.filter(o=>['expense','income','refund','interest','fee'].includes(o.kind)||(o.accountRelations||[]).some(r=>r.activity.startsWith('investment_'))).map(o=>root(o.id)));
  for(const {credit,debit,evidenceBasis,dateBasis,ownerEvidenceObservationIds} of findStatementRepayments(observations.filter(o=>!occupiedProductRepaymentRoots.has(root(o.id))),accounts,{rootOf:root,statementOwners:sourceOwners,links:ledger.links||[],isBlocked:(a,b)=>payerBlocked.has(JSON.stringify([root(a),root(b)].sort())),annotatedIds:new Set(observations.filter(o=>payerAnnotatedRoots.has(root(o.id))).map(o=>o.id))})){
    if(payerIncompatibleRoots.has(root(credit.id))||payerIncompatibleRoots.has(root(debit.id))||observations.some(o=>root(o.id)===root(credit.id)&&fundingAccount(o,accounts)&&fundingAccount(o,accounts).id!==debit.financialAccountId))continue;
    const association={method:evidenceBasis==='explicit_payer_card'?'statement_payer_card':'named_credit_repayment_receipt',confidence:'inferred',observationIds:[credit.id,debit.id],evidence:{paymentAccountId:debit.financialAccountId,receivingAccountId:credit.financialAccountId,identityBasis:evidenceBasis,...(ownerEvidenceObservationIds?{ownerEvidenceObservationIds}:{}),dateBasis,paymentDate:debit.date,creditTradeDate:credit.date,creditPostedDate:credit.bankStatement.postedDate||credit.date,date:credit.date,amountMinor:credit.amountMinor,currency:credit.currency,reciprocalUnique:true}};
    for(const s of [credit,debit])automaticByObservation.set(s.id,[...(automaticByObservation.get(s.id)||[]),association]);union(credit.id,debit.id);
  }
  const withdrawalByObservation=new Map(),withdrawalBankRoots=new Set(observations.filter(o=>o.bankStatement||o.statementFlow).map(o=>root(o.id)));
  const withdrawalOccupied=new Set(observations.filter(o=>['alipay','wechat','jd'].includes(o.provider)&&withdrawalBankRoots.has(root(o.id))).map(o=>root(o.id)));
  const withdrawalBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort())));
  const annotatedRoots=new Set([...latestAnnotations.keys()].filter(id=>parents.has(id)).map(root));
  const withdrawalOptions={rootOf:root,isBlocked:(a,b)=>withdrawalBlocked.has(JSON.stringify([root(a),root(b)].sort())),occupiedBankRoots:withdrawalOccupied,annotatedIds:new Set(observations.filter(o=>annotatedRoots.has(root(o.id))).map(o=>o.id)),statementOwners:sourceOwners,links:ledger.links||[]};
  const withdrawals=[...findWechatWithdrawalMatches(observations,accounts,withdrawalOptions),...findAlipayNextDayWithdrawalMatches(observations,accounts,withdrawalOptions),...require('./nativeOwnerWithdrawals').findNativeOwnerWithdrawals(observations,accounts,{...withdrawalOptions,annotations:latestAnnotations,annotatedIds:new Set((ledger.annotations||[]).map(a=>a.observationId)),balanceEvidenceObservations:originalObservations.filter(o=>o.balanceEvidence)})];
  for(const match of withdrawals){
    const association={method:match.method,confidence:match.confidence,observationIds:[match.wallet.id,match.bank.id],evidence:{financialAccountId:match.targetAccountId,date:match.wallet.date,currency:match.wallet.currency,grossMinor:match.grossMinor,netMinor:match.netMinor,feeMinor:match.feeMinor,feeCapMinor:match.feeCapMinor,feeRuleSource:match.feeRuleSource,matchBasis:match.matchBasis,bankReceiptDelaySeconds:match.bankReceiptDelaySeconds,reciprocalUnique:true,...(match.separateDates?{separateDates:true,bankReceiptDate:match.bankReceiptDate}:{}),...(match.method==='native_owner_bank_withdrawal'?{walletCashOccurredAt:match.walletCashOccurredAt,walletCashDate:match.walletCashDate,walletCashProofObservationId:match.walletCashProofObservationId,sourceOrderReferencePrintedOnCashProof:false,sourceOrderReferencePrintedOnBankReceipt:false,nativeBankCardTailPrinted:false,bankTimePrecision:match.bankTimePrecision,confirmedOtherPartyReceiptsExcluded:match.confirmedOtherPartyReceiptsExcluded,...(match.preservedPurposeAnnotationId?{preservedPurposeAnnotationId:match.preservedPurposeAnnotationId}:{}),reversible:true}:{})}};
    for(const source of [match.wallet,match.bank]){withdrawalByObservation.set(source.id,match);automaticByObservation.set(source.id,[...(automaticByObservation.get(source.id)||[]),association]);}
    if(!match.separateDates)union(match.wallet.id,match.bank.id);
  }
  const feeGroups=findWorkbookWithdrawalFeeGroups(observations,accounts,{rootOf:root,annotatedIds:new Set(latestAnnotations.keys()),occupiedRoots:new Set(withdrawals.flatMap(m=>[root(m.wallet.id),root(m.bank.id)])),links:ledger.links||[],imports:ledger.imports||[]}),feeGroupByObservation=new Map();
  for(const group of feeGroups){const association={method:group.method,confidence:group.confidence,observationIds:group.observationIds,evidence:group.evidence};for(const id of group.observationIds){feeGroupByObservation.set(id,group);automaticByObservation.set(id,[...(automaticByObservation.get(id)||[]),association]);union(group.wallets[0].id,id);}}
  const withdrawalEstimates=estimateWechatWithdrawals(observations,accounts,{rootOf:root,annotatedIds:new Set(latestAnnotations.keys()),occupiedRoots:new Set([...withdrawals.flatMap(m=>[root(m.wallet.id),root(m.bank.id)]),...feeGroups.flatMap(g=>g.observationIds.map(root))]),links:ledger.links||[]}),withdrawalEstimateByRoot=new Map(withdrawalEstimates.map(e=>[root(e.wallet.id),e]));
  const groupOptions={rootOf:root,fundingAccount,bankPaymentProvider,annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[],imports:ledger.imports||[],balanceObservations:originalObservations.filter(o=>o.balanceEvidence),platformMerchant:o=>merchant(o.counterparty),bankMerchant:(o,p)=>statementMerchant(o.counterparty||o.description,p)},primaryGroups=[...findReconciliationGroups(observations,accounts,groupOptions),...findProductTransferGroups(observations,accounts,groupOptions),...require('./nativeBankCheckoutBridges').findNativeCombinedBankPaymentGroups(observations,accounts,groupOptions)],primaryRoots=new Set(primaryGroups.flatMap(g=>[...g.platformRootIds,...g.bankRootIds])),groupCandidates=[...primaryGroups,...findStatementMerchantSubsets(observations,accounts,groupOptions).filter(g=>![...g.platformRootIds,...g.bankRootIds].some(id=>primaryRoots.has(id)))],groupUses=new Map(),reconciliationByRoot=new Map();
  for(const group of groupCandidates)for(const id of [...group.platformRootIds,...group.bankRootIds])groupUses.set(id,(groupUses.get(id)||0)+1);
  const walletTopUpGroups=[...findWalletTopUpGroups(observations,accounts,{...groupOptions,statementOwners:sourceOwners}),...findWalletWithdrawalGroups(observations,accounts,{...groupOptions,statementOwners:sourceOwners})].filter(g=>![...g.platformRootIds,...g.bankRootIds].some(id=>groupUses.has(id)));
  const occupiedGroupRoots=new Set([...groupCandidates,...walletTopUpGroups].flatMap(g=>[...g.platformRootIds,...g.bankRootIds]));
  const walletProductBridges=findMybankWalletProductBridgeGroups(observations,accounts,groupOptions).filter(g=>![...g.platformRootIds,...g.bankRootIds].some(id=>occupiedGroupRoots.has(id)));
  const refundGroupOccupied=new Set([...occupiedGroupRoots,...walletProductBridges.flatMap(g=>[...g.platformRootIds,...g.bankRootIds])]),cardRefundGroups=findCardRefundGroups(observations,accounts,groupOptions).filter(g=>![...g.platformRootIds,...g.bankRootIds].some(id=>refundGroupOccupied.has(id)));
  const priorPaymentRoots=new Set([...refundGroupOccupied,...cardRefundGroups.flatMap(g=>[...g.platformRootIds,...g.bankRootIds])]);
  const familyProductGroups=findFamilyProductPaymentGroups(observations,accounts,groupOptions).filter(g=>![...g.platformRootIds,...g.bankRootIds].some(id=>priorPaymentRoots.has(id)));
  const closedOrderOccupied=new Set([...priorPaymentRoots,...familyProductGroups.flatMap(g=>[...g.platformRootIds,...g.bankRootIds])]),closedOrderGroups=require('./closedOrderGroups').findClosedOrderGroups(observations,accounts,groupOptions).filter(g=>![...g.platformRootIds,...g.bankRootIds].some(id=>closedOrderOccupied.has(id)));
  const combinedOccupied=new Set([...closedOrderOccupied,...closedOrderGroups.flatMap(g=>[...g.platformRootIds,...g.bankRootIds])]),combinedTaobaoGroups=require('./combinedTaobaoPayments').findCombinedTaobaoPaymentGroups(observations,accounts,groupOptions).filter(g=>![...g.platformRootIds,...g.bankRootIds].some(id=>combinedOccupied.has(id)));
  const combinedFamilyOccupied=new Set([...combinedOccupied,...combinedTaobaoGroups.flatMap(g=>[...g.platformRootIds,...g.bankRootIds])]),combinedFamilyGroups=require('./combinedFamilyCardPayments').findCombinedFamilyCardPayments(observations,accounts,groupOptions).filter(g=>![...g.platformRootIds,...g.bankRootIds].some(id=>combinedFamilyOccupied.has(id)));
  const reconciliationGroups=[...groupCandidates.filter(g=>[...g.platformRootIds,...g.bankRootIds].every(id=>groupUses.get(id)===1)),...walletTopUpGroups,...walletProductBridges,...cardRefundGroups,...familyProductGroups,...closedOrderGroups,...combinedTaobaoGroups,...combinedFamilyGroups];
  const settledBankRoots=new Set(observations.filter(o=>o.bankStatement||o.statementFlow).map(o=>root(o.id))),settledPlatformRoots=new Set(observations.filter(o=>['alipay','wechat','jd'].includes(o.provider)&&settledBankRoots.has(root(o.id))).map(o=>root(o.id)));
  for(const group of reconciliationGroups)for(const id of [...group.platformRootIds,...group.bankRootIds])reconciliationByRoot.set(id,group);
  const sameReconciliation=(a,b)=>{const g=reconciliationByRoot.get(root(a));return Boolean(g&&(g===reconciliationByRoot.get(root(b))||settledPlatformRoots.has(root(b))));};
  const groups=new Map();for(const o of observations) {const id=root(o.id);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(o);}
  const all=[];
  for(const [id,sources] of groups) {
    const finalSources=sources.filter(s=>s.status==='completed'),eligible=finalSources.length?finalSources:sources;
    const ordered=[...eligible].sort((a,b)=>(b.sourceVersionOrdinal||0)-(a.sourceVersionOrdinal||0));
    // A proven next-day bank debit keeps the original platform economic date.
    const base=ordered.find(s=>creditDiscountById.get(s.id)?.platform.id===s.id)||ordered.find(s=>receiptPlanBySource.has(s.id))||ordered.find(s=>(automaticByObservation.get(s.id)||[]).some(a=>(['source_named_product_bank_receipt','wechat_credit_repayment_net_cost','unique_channel_funding','unique_card_funding','wechat_withdrawal_net_receipt','statement_payer_card','precise_bank_payment_time','direct_product_payment','mixed_product_payment','direct_split_payment','precise_wallet_bank_transfer','named_wallet_top_up','named_credit_repayment_receipt','ambiguous_jd_repayment_cash','verified_katong_personal_payment','precise_legacy_product_bank_receipt','source_statement_legacy_product','source_statement_mybank_product_cash_leg'].includes(a.method)||a.method==='source_statement_legacy_card'&&s.provider==='alipay'&&a.evidence?.identityBasis==='unique_original_bank_and_native_paid_order'&&a.evidence.bankSettlementLagDays===1&&Date.parse(a.evidence.bankCashDate)-Date.parse(s.date)===86400000||a.method==='product_statement_time'&&s.provider==='alipay')&&a.observationIds[0]===s.id))||ordered.find(s=>s.paymentChannel)||ordered[0];
    const nativeBankMixed=require('./nativeBankFundedOrders').nativeBankMixedAllocation(base,sources,nativeBankOrderFunding);
    const receiptPlan=receiptPlanBySource.get(base.id),creditDiscount=creditDiscountById.get(base.id),creditRepaymentCost=sources.map(s=>creditRepaymentCostById.get(s.id)).find(Boolean);
    const storedValueTopUp=sources.map(s=>storedValueTopUps.get(s.id)).find(Boolean);
    const withdrawal=sources.map(s=>withdrawalByObservation.get(s.id)).find(m=>m&&(!m.separateDates||sources.some(s=>s.id===m.wallet.id))),settledWithdrawalBank=sources.map(s=>withdrawalByObservation.get(s.id)).find(m=>m?.separateDates&&sources.some(s=>s.id===m.bank.id));
    const mixedPayment=sources.map(s=>mixedFundingByObservation.get(s.id)).find(Boolean);
    const walletTransfer=sources.map(s=>walletTransferByObservation.get(s.id)).find(Boolean);
    const feeGroup=sources.map(s=>feeGroupByObservation.get(s.id)).find(Boolean);
    const commerceTrace=sources.map(s=>commerceTraceByObservation.get(s.id)).find(Boolean);
    const withdrawalEstimate=withdrawalEstimateByRoot.get(id);
    if(sources.every(s=>s.withdrawalFeeEvidence))continue;
    const groupAnnotations=sources.filter(s=>latestAnnotations.has(s.id)).map(s=>latestAnnotations.get(s.id)).sort((a,b)=>BigInt(a.revision)>BigInt(b.revision)?-1:1);
    const installmentPayment=sources.map(s=>installmentBySource.get(s.id)).find(Boolean);
    const installmentDraw=sources.map(s=>installmentDraws.get(s.id)).find(Boolean);
    const historicalMortgage=sources.map(s=>historicalMortgageBySource.get(s.id)).find(Boolean);
    const original=feeGroup?{...base,kind:'transfer',direction:'debit',amountMinor:feeGroup.evidence.grossMinor,feeMinor:feeGroup.evidence.feeMinor}:historicalMortgage?{...base,kind:'debt_payment',date:historicalMortgage.date,amountMinor:historicalMortgage.amountMinor,principalMinor:historicalMortgage.principalMinor,interestMinor:historicalMortgage.interestMinor,feeMinor:'0'}:installmentPayment?{...base,kind:'debt_payment',date:installmentPayment.date,amountMinor:installmentPayment.amountMinor,principalMinor:installmentPayment.principalMinor,interestMinor:installmentPayment.interestMinor??null,feeMinor:installmentPayment.feeMinor??null}:commerceTrace?.method==='owner_confirmed_commerce_payment_benefit'?{...commerceTrace.commerce,...latestAnnotations.get(commerceTrace.commerce.id).patch,amountMinor:commerceTrace.payment.amountMinor}:groupAnnotations[0]?{...base,...groupAnnotations[0].patch}:settledWithdrawalBank?{...base,kind:'transfer'}:commerceTrace?.method==='commerce_native_net_payment_trace'?commerceTrace.payment:base;
    const transfer=links.find(l=>l.type==='transfer'&&l.observationIds.some(id=>sources.some(s=>s.id===id)));
    const purchaseEvidence=!groupAnnotations.length&&original.provider==='alipay'&&original.rawFields?.['\u4ea4\u6613\u5206\u7c7b']==='\u8f6c\u8d26\u7ea2\u5305'&&original.kind==='transfer'&&original.direction==='debit'&&!original.accountRelations?.length&&!original.automaticClassification&&!/\u8f6c\u51fa|\u8f6c\u5165|\u63d0\u73b0|\u5145\u503c|\u8fd8\u6b3e|\u501f|\u8d37|\u57fa\u91d1|\u7406\u8d22|\u4f59\u989d\u5b9d|\u4f59\u5229\u5b9d|\u96f6\u94b1\u901a|\u8bc1\u5238|\u62bc\u91d1|\u4fdd\u8bc1\u91d1/.test(original.description+' '+original.counterparty)?sources.filter(s=>(s.bankStatement||s.statementFlow)&&s.kind==='expense'&&s.direction==='debit'):[];
    const reconciliation=reconciliationByRoot.get(id),reconciliationRole=reconciliation?.bankRootIds.includes(id)?'bank_evidence':reconciliation?'platform_order':null;
    const retailGroupEvidence=!groupAnnotations.length&&reconciliationRole==='platform_order'&&reconciliation?.evidence.inferredPlatformKind==='expense'?reconciliation.observationIds.filter(id=>{const source=originalById.get(id);return (source?.bankStatement||reconciliation?.method==='combined_taobao_payment_group'&&source?.statementFlow)&&source.kind==='expense'&&source.direction==='debit';}):[];
    const classifiedOriginal=creditDiscount?{...original,kind:'debt_payment'}:installmentDraw?{...original,kind:'loan_drawdown',...(installmentDraw.confidence==='actual_loan_proof'?{category:'\u501f\u5457\u501f\u6b3e\u5230\u8d26',automaticClassification:{method:'actual_loan_proof_drawdown',confidence:'actual_loan_proof',evidenceObservationIds:installmentDraw.drawdowns.find(d=>sources.some(s=>s.id===d.observationId))?.proofObservationIds||[]}}:{})}:retailGroupEvidence.length?{...original,kind:'expense',automaticClassification:{method:'source_statement_purchase_group',confidence:'inferred',evidenceObservationIds:retailGroupEvidence,individualIdentity:'undetermined'}}:purchaseEvidence.length?{...original,kind:'expense',automaticClassification:{method:'source_statement_purchase_purpose',confidence:'inferred',evidenceObservationIds:purchaseEvidence.map(s=>s.id)}}:original;
    const ownerBankDestinations=sources.filter(s=>s.ownerBankDestination).map(s=>s.ownerBankDestination),classifiedWithOwnerDestination=ownerBankDestinations.length===1?{...classifiedOriginal,ownerBankDestination:ownerBankDestinations[0]}:classifiedOriginal;
    const o=transfer&&classifiedWithOwnerDestination.kind!=='debt_payment'?{...classifiedWithOwnerDestination,kind:'transfer'}:classifiedWithOwnerDestination, amount=BigInt(o.amountMinor);
    const repayment=o.kind==='debt_payment'?(installmentPayment?'loan':repaymentType(sources,accountMap)):null;
    const assetAnnotations=groupAnnotations.filter(a=>a.patch?.assetAllocation);if(assetAnnotations.length>1)throw fail('EXPENSE_ASSET_ALLOCATION_INVALID');
    const assetAllocation=assetAnnotations.length?expenseAssetAllocation(originalById.get(assetAnnotations[0].observationId),assetAnnotations[0],accounts):null;
    let consumption=0n,income=0n;
    if(o.status==='completed') {
      if(['expense','interest','fee'].includes(o.kind)) consumption=assetAllocation?BigInt(assetAllocation.expenseMinor):amount;
      if(o.kind==='refund') consumption=-amount;
      if(o.kind==='income') income=o.direction==='debit'?-amount:amount;
      if(o.kind==='debt_payment') {
        if(installmentPayment)consumption=BigInt(installmentPayment.financingCostMinor);
        else if(['principalMinor','interestMinor','feeMinor'].every(k=>o[k]!==null)) consumption=BigInt(o.interestMinor)+BigInt(o.feeMinor);
        else if(repayment==='loan'&&mortgageReviewReason(mortgageSplit.get(o.id)))unresolvedAssociations.push({reason:mortgageReviewReason(mortgageSplit.get(o.id)),observationId:o.id});
        else if(repayment==='loan'&&!mortgageSplit.has(o.id)){const loans=mortgageBySource.get(o.id)||[],blockedModel=loans.length===1&&mortgageModels.find(m=>m.financialAccountId===loans[0]&&m.status==='rate_constraint_conflict');if(blockedModel)information.push({reason:'mortgage_split_withheld_due_to_owner_rate_constraint',observationId:o.id,financialAccountId:loans[0],accountReviewReason:'mortgage_calibration_conflict',principalAndInterestUnknown:true});else unresolvedAssociations.push({reason:loans.length===1?'mortgage_history_model_gap':'unsplit_debt_payment',observationId:o.id});}
        else if(repayment==='unknown')unresolvedAssociations.push({reason:'unresolved_debt_account',observationId:o.id});
      }
      if((o.kind==='unknown'||['restricted_coupon_evidence_unresolved','sponsored_settlement_evidence_unresolved','owner_bank_destination_evidence_unresolved','recalled_account_route_evidence_unresolved'].includes(o.automaticClassification?.method))&&reconciliationRole!=='bank_evidence'&&!o.bankStatement?.nonCash&&!nonCashAuthorization(o)) unresolvedAssociations.push({reason:'unknown_kind',observationId:o.id});
    }
    if(o.status==='completed'&&groupAnnotations.some(require('./legacyAlipayPurchases').requiresPurposeReview))unresolvedAssociations.push({reason:'unknown_kind',observationId:o.id,basis:'annotated_purpose_review_cash_source_preserved',annotationIds:groupAnnotations.filter(require('./legacyAlipayPurchases').requiresPurposeReview).map(a=>a.id)});
    if(o.kind==='transfer'&&o.direction==='credit')for(const source of sources)if(require('./legacyMerchantReceipts').unclassifiedMerchantCredit(originalById.get(source.id),o,accounts))unresolvedAssociations.push({reason:'unknown_kind',observationId:source.id,basis:'merchant_credit_income_or_pass_through_unconfirmed',orderReference:source.sourceTransactionId,originalCashAndPurposePreserved:true});
    if(legacyRefundPending(o,originalObservations))unresolvedAssociations.push({reason:'legacy_refund_settlement_unknown',observationId:o.id});
    const posSettlementFee=require('./posSettlementFees').explicitPosSettlementFee(o,sources,groupAnnotations,accounts,observations);
    if(posSettlementFee)consumption+=BigInt(posSettlementFee.feeMinor);
    const posMerchantReceipt=posMerchantContext?posMerchants.posMerchantReceipt(o,sources,groupAnnotations,accounts,posMerchantContext):null;
    if(posMerchantReceipt?.purpose==='studio_tuition'){
      if(posMerchantReceipt.fee.feeMinor!==null){consumption+=BigInt(posMerchantReceipt.fee.feeMinor);income+=BigInt(posMerchantReceipt.fee.feeMinor);}
      else unresolvedAssociations.push({reason:'pos_settlement_fee_unknown',observationId:o.id,basis:'tuition_net_receipt_known_gross_and_fee_unresolved'});
    }
    if(groupAnnotations.some(posMerchants.isPosMerchantAnnotation)&&!posMerchantReceipt)unresolvedAssociations.push({reason:'pos_onward_route_requires_review',observationId:o.id});
    if(creditRepaymentCost)consumption+=BigInt(creditRepaymentCost.netCostMinor);
    if(o.kind==='loan_drawdown'&&groupAnnotations.some(require('./posSettlementFees').isConfirmedPosCashAdvanceAnnotation))unresolvedAssociations.push({reason:'unresolved_credit_cash_advance',observationId:o.id});
    if(['statement_merchant_subset_group','closed_order_purchase_group','combined_taobao_payment_group','native_combined_bank_payment_group'].includes(reconciliation?.method)){if(reconciliationRole==='platform_order')consumption=0n;}else if(reconciliationRole==='bank_evidence')consumption=0n;
    const investmentConfirmations=latestInvestmentConfirmations(sources);
    const brokerageSources=new Map();for(const source of sources)if(source.brokerage&&source.status==='completed'){const key=JSON.stringify([source.financialAccountId,source.sourceIdentity||source.id]);const previous=brokerageSources.get(key);if(!previous||(source.sourceVersionOrdinal||0)>(previous.sourceVersionOrdinal||0))brokerageSources.set(key,source);}
    for(const source of brokerageSources.values()){if(['buy','sell','repo_open','fund_buy','fund_redeem'].includes(source.brokerage.activity))consumption+=BigInt(source.brokerage.feeMinor);if(source.brokerage.activity==='repo_close')income+=BigInt(source.interestMinor);const realized=securitiesRealizations.get(source.id);if(realized)income+=BigInt(realized.priceGainBeforeFeesMinor);}
    const investmentIncomeRecognitions=[...brokerageSources.values()].map(source=>securitiesRealizations.get(source.id)).filter(r=>r?.recognition).map(r=>({...r.recognition,securityCode:r.securityCode,netGainMinor:r.netGainMinor,priceGainBeforeFeesMinor:r.priceGainBeforeFeesMinor}));
    consumption+=investmentConfirmations.reduce((sum,source)=>sum+BigInt(source.investmentTrade.feeMinor),0n)+(withdrawal?BigInt(withdrawal.feeMinor):0n)+(feeGroup?BigInt(feeGroup.evidence.feeMinor):0n)+(withdrawalEstimate?BigInt(withdrawalEstimate.feeMinor):0n);
    for(const confirmation of investmentConfirmations)if(!confirmation.investmentTrade.fundCode&&!identifiedConversions.has(confirmation.id))unresolvedAssociations.push({reason:'unidentified_fund_conversion',observationId:confirmation.id});
    const effects=new Map(), flow=new Map(),effectTimes=new Map(),legacyPurchasesWithoutPayer=new Set();
    const knownFundingAccounts=[...new Set(sources.filter(s=>s.status==='completed'&&accountMap.get(s.financialAccountId)?.type!=='wallet').map(s=>s.financialAccountId))].map(id=>accountMap.get(id)).filter(Boolean);
    const latestEffects=new Map();for(const s of sources)if(s.sourceIdentity&&s.status==='completed'){const key=JSON.stringify([s.financialAccountId,s.sourceIdentity]);if(!latestEffects.has(key)||(s.sourceVersionOrdinal||0)>(latestEffects.get(key).sourceVersionOrdinal||0))latestEffects.set(key,s);}
    const effectSources=sources.filter(s=>!s.sourceIdentity||s.status==='completed'&&latestEffects.get(JSON.stringify([s.financialAccountId,s.sourceIdentity]))===s);
    let walletTopupReceipt=null;
    for(const s of effectSources) {
      if(s.status!=='completed')continue;
      if(nonCashAuthorization(s))continue;
      if(receiptPlan||creditDiscount)continue;
      if(s.withdrawalFeeEvidence)continue;
      if(feeGroup?.wallets.some(w=>w.id===s.id))continue;
      if(commerceTrace&&s.id===commerceTrace.commerce.id)continue;
      const a=accountMap.get(s.financialAccountId);if(!a)continue;
      if(storedValueTopUp?.sourceObservationId===s.id){effects.set(a.id,-BigInt(storedValueTopUp.cashPaidMinor));flow.set(a.id,-BigInt(storedValueTopUp.cashPaidMinor));effectTimes.set(a.id,s.occurredAt);effects.set(storedValueTopUp.receivingAccountId,BigInt(storedValueTopUp.creditedMinor));effectTimes.set(storedValueTopUp.receivingAccountId,s.occurredAt);income+=BigInt(storedValueTopUp.nonCashBenefitMinor);continue;}
      if(reconciliation?.method==='combined_taobao_payment_group'&&reconciliationRole==='platform_order')continue;
      if(reconciliation?.method==='native_combined_bank_payment_group'&&reconciliationRole==='platform_order')continue;
      if(reconciliation?.method==='combined_family_card_payment_group'&&reconciliationRole==='platform_order')continue;
      if(reconciliation?.method==='family_product_payment_group'&&reconciliationRole==='platform_order')continue;
      if(reconciliation?.method==='balanced_wallet_top_up_group'&&reconciliationRole==='platform_order'){effects.set(a.id,BigInt(s.amountMinor));flow.set(a.id,BigInt(s.amountMinor));effectTimes.set(a.id,s.occurredAt);continue;}
      if(reconciliation?.method==='balanced_wallet_withdrawal_group'&&reconciliationRole==='platform_order'){effects.set(a.id,-BigInt(s.amountMinor));flow.set(a.id,-BigInt(s.amountMinor));effectTimes.set(a.id,s.occurredAt);continue;}
      if(s.bankStatement?.nonCash&&s.direction==='neutral')continue;
      if(s.brokerage&&s.direction==='neutral')continue;
      if(s.ownerBankDestination){
        const d=s.ownerBankDestination,amount=BigInt(s.amountMinor),represented=sources.some(b=>b.id!==s.id&&b.financialAccountId===d.receivingAccountId&&b.statementFlow&&b.direction==='credit'&&b.amountMinor===s.amountMinor),covered=coveredByStatement(d.receivingAccountId,s.currency,Date.parse(s.occurredAt))||observations.some(b=>b.financialAccountId===d.receivingAccountId&&b.statementFlow&&(b.statementFlow.periodStart<=s.date&&b.statementFlow.periodEnd>=s.date||b.date===s.date&&b.direction==='credit'&&b.amountMinor===s.amountMinor));
        Object.assign(d,{bankReceiptSeparatelyVerified:represented,receiptBasis:represented?'original_bank_receipt':covered?'requires_available_bank_receipt':d.completedPlatformTransfer?'completed_platform_transfer_outside_bank_statement_coverage':'unverified_withdrawal_net',receivingCashConfidence:represented?'bank_original':!covered&&d.completedPlatformTransfer?'derived_from_completed_platform_transfer':'unverified'});
        effects.set(d.payerAccountId,-amount);flow.set(d.payerAccountId,-amount);effectTimes.set(d.payerAccountId,s.occurredAt);
        if(!represented){if(covered||!d.completedPlatformTransfer)unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,targetAccountId:d.receivingAccountId,basis:'owner_confirmed_destination_requires_actual_bank_cash'});else{effects.set(d.receivingAccountId,amount);flow.set(d.receivingAccountId,amount);effectTimes.set(d.receivingAccountId,s.occurredAt);}}
        continue;
      }
      if(mixedPayment&&s.id===mixedPayment.platform.id)continue;
      if(walletTransfer&&s.id===walletTransfer.platform.id)continue;
      if(s.provider==='alipay'&&s.kind==='transfer'&&['neutral','debit'].includes(s.direction)&&!s.accountRelations?.length&&/^\u63d0\u73b0-(?:\u5feb\u901f|\u666e\u901a|\u5b9e\u65f6)\u63d0\u73b0$/.test(s.description)&&(s.withdrawalDestination?.feeHandling==='owner_confirmed_zero'||historicalFreeWithdrawals.has(s.id))&&(s.feeMinor===null||s.feeMinor==='0')&&!observations.some(p=>p.financialAccountId===s.financialAccountId&&p.date===s.date&&p.withdrawalFeeEvidence?.feeMinor!==undefined&&p.withdrawalFeeEvidence.feeMinor!==null&&BigInt(p.withdrawalFeeEvidence.feeMinor)>0n)){
        const target=s.withdrawalDestination.financialAccountId,represented=sources.some(b=>b.financialAccountId===target&&b.statementFlow&&b.direction==='credit'),covered=observations.some(b=>b.financialAccountId===target&&b.statementFlow&&b.statementFlow.periodStart<=s.date&&b.statementFlow.periodEnd>=s.date),amount=BigInt(s.amountMinor);effects.set(a.id,-amount);flow.set(a.id,-amount);effectTimes.set(a.id,s.occurredAt);
        if(covered&&!represented){unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,targetAccountId:target});continue;}
        const historicalFee=historicalFreeWithdrawals.get(s.id);if(!represented){effects.set(target,amount);flow.set(target,amount);effectTimes.set(target,historicalFee?.nativeCashOccurredAt||s.occurredAt);}ownerZeroFeeWithdrawals.set(s.id,historicalFee||{method:'owner_confirmed_zero_fee_withdrawal',confidence:s.withdrawalDestination.feeConfidence||'owner_confirmed',walletAccountId:a.id,financialAccountId:target,date:s.date,grossMinor:s.amountMinor,netMinor:s.amountMinor,feeMinor:'0',confirmedAt:s.withdrawalDestination.confirmedAt,bankReceipt:represented?'original_statement':'derived_from_platform_withdrawal'});continue;
      }
      const knownRepaymentCash=repayment==='credit'&&!groupAnnotations.length&&effectSources.length===1?require('./discountedProductRepaymentCash').discountedProductRepaymentCash(originalById.get(s.id),accounts):null;
      if(knownRepaymentCash){const payer=knownRepaymentCash.financialAccountId,delta=-BigInt(knownRepaymentCash.cashPaidMinor);effects.set(payer,delta);flow.set(payer,delta);effectTimes.set(payer,s.occurredAt);knownRepaymentCash.receivingAccountId=s.automaticRepaymentTarget?.financialAccountId||null;const confirmed=require('./discountedProductRepaymentCash').ownerConfirmedRepaymentReceipt(knownRepaymentCash,originalById.get(s.id),accounts,originalObservations,ledger.links||[]);if(confirmed){Object.assign(knownRepaymentCash,confirmed);effects.set(confirmed.receivingAccountId,BigInt(confirmed.cardReceivedMinor));effectTimes.set(confirmed.receivingAccountId,s.occurredAt);income=BigInt(confirmed.nonCashBenefitMinor);}knownRepaymentCashBySource.set(s.id,knownRepaymentCash);continue;}
      if(repayment==='credit'&&s.provider==='alipay'&&s.kind==='debt_payment'&&s.direction==='neutral'&&!s.accountRelations?.length&&sources.some(b=>b.bankStatement&&b.direction==='credit'&&accountMap.get(b.financialAccountId)?.type==='credit_card')&&!sources.some(b=>b.id!==s.id&&b.direction==='debit'&&(b.bankStatement||b.statementFlow))&&!fundingAccount(s,accounts)&&!['\u4f59\u989d','\u8d26\u6237\u4f59\u989d','\u652f\u4ed8\u5b9d\u4f59\u989d','\u4f59\u989d\u5b9d'].includes(s.paymentChannel)){
        unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,paymentAccountHint:s.paymentChannel});continue;
      }
      if(repayment==='credit'&&s.automaticRepaymentTarget&&['alipay','wechat'].includes(s.provider)&&s.kind==='debt_payment'){
        const product=s.paymentChannel==='\u4f59\u989d\u5b9d'?accounts.filter(x=>x.status==='active'&&x.sourceProduct==='alipay_yuebao'&&x.currency===s.currency):[],walletCash=!s.paymentAccountHint&&['\u4f59\u989d','\u8d26\u6237\u4f59\u989d','\u652f\u4ed8\u5b9d\u4f59\u989d','\u96f6\u94b1'].includes(s.paymentChannel),payer=fundingAccount(s,accounts)||(walletCash?a:product.length===1?product[0]:null),target=s.automaticRepaymentTarget.financialAccountId,amount=BigInt(s.amountMinor);
        if(!payer){unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,paymentAccountHint:s.paymentChannel});if(s.automaticRepaymentTarget.payerStatus!=='unknown')continue;}
        if(payer){const representedCash=sources.some(b=>b.id!==s.id&&b.financialAccountId===payer.id&&(b.statementFlow||b.bankStatement)),possibleCash=(moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,'debit',payer.id]))||[]).filter(b=>b.id!==s.id&&!sources.some(o=>o.id===b.id));
        if(!representedCash&&(possibleCash.length||['bank','debit_card','savings'].includes(payer.type)&&coveredByStatement(payer.id,s.currency,Date.parse(s.occurredAt))))unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,targetAccountId:payer.id,candidateObservationIds:possibleCash.map(b=>b.id),basis:'confirmed_repayment_payer_requires_actual_cash'});
        else if(!representedCash){effects.set(payer.id,-amount);effectTimes.set(payer.id,s.occurredAt);if(!liability(payer))flow.set(payer.id,-amount);}}
        const represented=sources.some(b=>b.financialAccountId===target&&b.bankStatement&&b.direction==='credit'),dates=[s.date,new Date(Date.parse(s.date)+86400000).toISOString().slice(0,10)],possible=dates.flatMap(date=>moneySourceBuckets.get(JSON.stringify([date,s.amountMinor,s.currency,'credit',target]))||[]).filter(b=>b.bankStatement&&!b.bankStatement.nonCash&&!sources.some(o=>o.id===b.id));
        if(!represented&&possible.length)unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,targetAccountId:target,candidateObservationIds:possible.map(b=>b.id),basis:'confirmed_credit_identity_requires_available_receipt'});else if(!represented){effects.set(target,amount);effectTimes.set(target,s.occurredAt);}continue;
      }
      // A platform's neutral label does not erase the explicitly named payer.
      // Only a real receiving card receipt supplies the opposite liability leg.
      if(repayment==='credit'&&s.provider==='alipay'&&s.kind==='debt_payment'&&s.direction==='neutral'&&!s.accountRelations?.length&&['\u4f59\u989d','\u8d26\u6237\u4f59\u989d','\u652f\u4ed8\u5b9d\u4f59\u989d','\u4f59\u989d\u5b9d'].includes(s.paymentChannel)){
        const payers=s.paymentChannel==='\u4f59\u989d\u5b9d'?accounts.filter(x=>x.status==='active'&&x.sourceProduct==='alipay_yuebao'&&x.currency===s.currency):[a];
        if(payers.length===1){const payer=payers[0],delta=-BigInt(s.amountMinor),actual=sources.some(b=>b.financialAccountId===payer.id&&(b.statementFlow||b.bankStatement));if(!actual){effects.set(payer.id,delta);flow.set(payer.id,delta);effectTimes.set(payer.id,s.occurredAt);}const target=s.automaticRepaymentTarget?.financialAccountId;if(target&&!sources.some(b=>b.financialAccountId===target&&b.bankStatement)){effects.set(target,-delta);effectTimes.set(target,s.occurredAt);}continue;}
        unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,paymentAccountHint:s.paymentChannel});continue;
      }
      if(['alipay_withdrawal_actual_receipt','native_owner_bank_withdrawal'].includes(withdrawal?.method)&&s.id===withdrawal.wallet.id){const delta=-BigInt(s.amountMinor);effects.set(a.id,delta);flow.set(a.id,delta);effectTimes.set(a.id,s.occurredAt);continue;}
      const withdrawalTarget=s.provider==='wechat'&&s.kind==='transfer'&&s.rawFields?.['\u4ea4\u6613\u7c7b\u578b']==='\u96f6\u94b1\u63d0\u73b0'&&['neutral','debit'].includes(s.direction)?withdrawal?accountMap.get(withdrawal.targetAccountId):fundingAccount(s,accounts):null;
      if(repayment==='credit'&&s.automaticRepaymentTarget?.nominalFundingAccountId&&s.provider==='alipay'&&s.kind==='debt_payment'&&s.direction==='neutral'&&!s.accountRelations?.length){
        const payer=fundingAccount(s,accounts),target=s.automaticRepaymentTarget.financialAccountId;
        if(payer&&['debit_card','investment'].includes(payer.type)&&payer.id!==target){const amount=BigInt(s.amountMinor);if(!sources.some(b=>b.financialAccountId===payer.id&&(b.statementFlow||b.bankStatement))){if(coveredByStatement(payer.id,s.currency,Date.parse(s.occurredAt)))unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,targetAccountId:payer.id,basis:'covered_repayment_payer_requires_original_cash'});else{effects.set(payer.id,-amount);flow.set(payer.id,-amount);effectTimes.set(payer.id,s.occurredAt);}}if(!sources.some(b=>b.financialAccountId===target&&b.bankStatement)){effects.set(target,amount);effectTimes.set(target,s.occurredAt);}continue;}
      }
      if(withdrawalTarget&&['bank','debit_card','savings'].includes(withdrawalTarget.type)){
        const delta=-BigInt(s.amountMinor);effects.set(a.id,delta);effectTimes.set(a.id,s.occurredAt);flow.set(a.id,delta);
        if(!withdrawal&&!feeGroup&&!withdrawalEstimate)unresolvedAssociations.push({reason:'withdrawal_net_fee_unknown',observationId:s.id,targetAccountId:withdrawalTarget.id,grossMinor:s.amountMinor});
        continue;
      }
      if(['explicit_statement_credit_repayment_target','owner_historical_named_statement_credit_repayment_target'].includes(s.automaticRepaymentTarget?.method)){
        const target=s.automaticRepaymentTarget.financialAccountId,amount=BigInt(s.amountMinor);effects.set(a.id,-amount);flow.set(a.id,-amount);effectTimes.set(a.id,s.occurredAt);
        const represented=sources.some(b=>b.financialAccountId===target&&b.bankStatement&&b.direction==='credit'),possible=(moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,'credit',target]))||[]).filter(b=>b.bankStatement&&!sources.some(o=>o.id===b.id));
        const possiblePlatform=s.automaticRepaymentTarget.confidence==='verified_source_owner_and_statement_card'?observations.filter(p=>!sources.some(o=>o.id===p.id)&&['alipay','wechat'].includes(p.provider)&&p.kind==='debt_payment'&&p.status==='completed'&&p.date===s.date&&p.amountMinor===s.amountMinor&&p.currency===s.currency&&fundingAccount(p,accounts)?.id===s.financialAccountId&&p.automaticRepaymentTarget?.financialAccountId===target):[];
        if(!represented&&(possible.length||possiblePlatform.length))unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,targetAccountId:target,candidateObservationIds:[...possible,...possiblePlatform].map(b=>b.id),basis:'explicit_credit_target_requires_matching_available_receipt'});else if(!represented){effects.set(target,amount);effectTimes.set(target,s.occurredAt);}continue;
      }
      if(installmentPayment?.confidence==='actual_loan_proof'&&installmentPayment.observationIds.includes(s.id)){
        const p=installmentPayment,channel=s.paymentChannel.replace(/&(?:\u7ea2\u5305|\u4f18\u60e0)$/,''),probe={...s,paymentChannel:channel,paymentAccountHint:''};
        const product=channel==='\u4f59\u989d\u5b9d'?accounts.filter(x=>x.status==='active'&&x.sourceProduct==='alipay_yuebao'&&x.currency===s.currency):[],fund=fundingAccount(probe,accounts)||(/^(?:\u4f59\u989d|\u8d26\u6237\u4f59\u989d|\u652f\u4ed8\u5b9d\u4f59\u989d)$/.test(channel)?a:product.length===1?product[0]:null);
        if(!fund){unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,paymentAccountHint:s.paymentChannel});continue;}
        const represented=sources.some(b=>b.financialAccountId===fund.id&&b.id!==s.id&&(b.statementFlow||b.bankStatement)),possible=(moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,'debit',fund.id]))||[]).filter(b=>b.id!==s.id&&!sources.some(o=>o.id===b.id));
        if(!represented&&(possible.length||['bank','debit_card','savings'].includes(fund.type)&&coveredByStatement(fund.id,s.currency,Date.parse(s.occurredAt))))unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,targetAccountId:fund.id,candidateObservationIds:possible.map(b=>b.id),basis:'actual_loan_proof_cash_requires_available_bank_original'});
        else if(!represented){effects.set(fund.id,-BigInt(s.amountMinor));flow.set(fund.id,-BigInt(s.amountMinor));effectTimes.set(fund.id,s.occurredAt);}continue;
      }
      const mortgageIds=mortgageBySource.get(s.id)||[];
      if(mortgageIds.length===1){const loanId=mortgageIds[0],principal=s.principalMinor===null?0n:BigInt(s.principalMinor);effects.set(loanId,principal);effectTimes.set(loanId,s.occurredAt);}
      else if(mortgageIds.length>1)unresolvedAssociations.push({reason:'ambiguous_mortgage_account',observationId:s.id});
      const shanghai=s.provider==='alipay'&&s.paymentChannel.startsWith('\u4e0a\u6d77\u94f6\u884c\u4fe1\u7528\u8d2d')?accounts.filter(a=>a.sourceProduct==='alipay_shanghai_credit'&&a.currency===s.currency):[];
      const relations=(s.accountRelations||[]).map(r=>shanghai.length===1&&r.role==='funding'&&r.product==='alipay_huabei'?{...r,product:'alipay_shanghai_credit',financialAccountId:shanghai[0].id}:r);
      for(const relation of relations){const target=accountMap.get(relation.financialAccountId);if(!target||target.currency!==s.currency){unresolvedAssociations.push({reason:'unresolved_product_account',observationId:s.id,product:relation.product});continue;}const delta=relationDelta(relation,BigInt(s.amountMinor),s);if(delta===0n&&effects.has(target.id)&&['investment_confirmation','investment_exchange','investment_fee'].includes(relation.activity))continue;effects.set(target.id,delta);effectTimes.set(target.id,s.occurredAt);if(!liability(target)&&!ACCOUNT_PRODUCTS[target.sourceProduct]?.nonCash)flow.set(target.id,delta);}
      if(relations.length){
        if(relations.some(r=>r.role==='funding'))continue;
        const target=relations.find(r=>r.role==='target');
        if(['investment_income','investment_exchange','investment_confirmation'].includes(target?.activity))continue;
        const incoming=['investment_withdrawal','loan_drawdown','funding_outflow'].includes(target?.activity),delta=BigInt(s.amountMinor)*(incoming?1n:-1n);
        if(target?.activity==='loan_drawdown'&&s.automaticWalletReceipt?.method==='inferred_loan_wallet_receipt'&&s.automaticWalletReceipt.financialAccountId===a.id){effects.set(a.id,delta);flow.set(a.id,delta);effectTimes.set(a.id,s.occurredAt);continue;}
        if(target?.activity==='investment_withdrawal'&&s.automaticWalletReceipt?.method==='native_legacy_investment_wallet_receipt'&&s.automaticWalletReceipt.financialAccountId===a.id){effects.set(a.id,delta);flow.set(a.id,delta);effectTimes.set(a.id,s.occurredAt);continue;}
        const productReceipt=productReceiptByObservation.get(s.id),fund=fundingAccount(s,accounts)||productReceipt?.fund||require('./knownBankWalletBridges').groupedCcbProductPayer(s,effectSources,accountMap);
        if(fund){
          if(fund.id===a.id&&['explicit_alipay_redemption_and_payee_email','explicit_native_wallet_redemption_receipt'].includes(s.automaticFunding?.destinationBasis)){effects.set(a.id,delta);effectTimes.set(a.id,s.occurredAt);flow.set(a.id,delta);continue;}
          const possible=(moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,incoming?'credit':'debit',fund.id]))||[]).filter(candidate=>!sources.some(source=>source.id===candidate.id));
          const distinct=possible.length&&possible.every(candidate=>links.some(l=>l.type==='distinct'&&l.observationIds.includes(s.id)&&l.observationIds.includes(candidate.id)));
          const represented=sources.some(source=>source.financialAccountId===fund.id);
          const grouped=possible.length&&possible.every(candidate=>sameReconciliation(s.id,candidate.id));
          const receiptRequired=s.withdrawalDestination?.method==='owner_confirmed_product_destination'&&s.withdrawalDestination.cashLegBasis==='requires_bank_receipt';
          if(!represented&&!grouped&&(receiptRequired||possible.length&&!distinct))unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,targetAccountId:fund.id,candidateObservationIds:possible.slice(0,64).map(candidate=>candidate.id),candidateCount:possible.length});
          else if(!represented&&!grouped){effects.set(fund.id,delta);effectTimes.set(fund.id,s.occurredAt);if(!liability(fund))flow.set(fund.id,delta);}
        }
        else if(!s.paymentAccountHint&&(/^(余额|账户余额|支付宝余额|零钱)$/.test((s.paymentChannel||'').trim())||s.provider==='alipay'&&incoming&&!s.paymentChannel&&/^(?:\u4f59\u989d\u5b9d-\u8f6c\u51fa\u5230\u4f59\u989d|\u8682\u8681\u501f\u5457\u653e\u6b3e\u81f3\u4f59\u989d)$/.test(s.description)||s.provider==='wechat'&&s.kind==='transfer'&&s.rawFields?.['交易类型']==='零钱通转出-到零钱'&&target?.product==='wechat_lingqiantong'&&incoming)){effects.set(a.id,delta);effectTimes.set(a.id,s.occurredAt);flow.set(a.id,delta);}
        else unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,paymentAccountHint:s.paymentAccountHint});
        continue;
      }
      if((s.provider==='jd'||a.type==='wallet'&&['alipay','wechat'].includes(s.provider)&&/\u94f6\u884c/.test(s.paymentChannel))&&!fundingAccount(s,accounts)&&!(a.type==='wallet'&&knownFundingAccounts.length===1)){if(!nonCashAuthorization(s))unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,paymentAccountHint:s.paymentChannel});continue;}
      if(a.type==='wallet'&&!knownFundingAccounts.length&&!fundingAccount(s,accounts)&&s.automaticClassification?.method==='medical_settlement_evidence_unresolved'){legacyPurchasesWithoutPayer.add(s.id);unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,basis:'medical_settlement_confirmation_invalid_or_stale'});continue;}
      if(a.type==='wallet'&&!knownFundingAccounts.length&&!fundingAccount(s,accounts)&&require('./counterpartySettlements').settlementMerchantFundingMissing(s)&&!nativeSettlementWalletFunding.has(s.id)){unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,basis:'confirmed_settlement_merchant_payer_not_exported'});continue;}
      if(a.type==='wallet'&&!receiptPlan&&!mixedPayment&&!knownFundingAccounts.length&&!fundingAccount(s,accounts)&&!nativeTelecomWalletFunding.has(s.id)&&require('./legacyNativePurchases').legacyPurchasePayerMissing(s)){legacyPurchasesWithoutPayer.add(s.id);const medical=require('./legacyNativePurchases').isOriginalNonSelfPayMedicalPayment(s);unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,basis:medical?'original_non_self_pay_medical_settlement_payer_not_exported':'original_paid_merchant_order_payer_not_exported',...(medical?{settlementBreakdownRequired:true,cashAccountExcluded:a.id}:{})});continue;}
      const unfundedReceipt=effectSources.length===1&&!groupAnnotations.length&&!ownedCreditTargetBlockedSources.has(settlementSourceKey(s))&&!knownFundingAccounts.length&&s.kind==='transfer'&&s.direction==='neutral'&&!s.accountRelations?.length&&!s.automaticFunding&&!s.withdrawalDestination&&!s.automaticRepaymentTarget&&!fundingAccount(s,accounts)&&require('./unfundedWalletReceipts').explicitUnfundedWalletReceipt(originalById.get(s.id),a);
      if(unfundedReceipt){walletTopupReceipt=unfundedReceipt;const delta=BigInt(unfundedReceipt.amountMinor);effects.set(a.id,delta);flow.set(a.id,delta);effectTimes.set(a.id,s.occurredAt);unresolvedAssociations.push({reason:'unresolved_account_movement',observationId:s.id,basis:'native_wallet_receipt_source_unknown',receivingAccountId:a.id});continue;}
      const sourceOnlyBankOutflow=(!ownedCreditTargetBlockedSources.has(settlementSourceKey(s))||s.automaticClassification?.method==='owner_bank_destination_evidence_unresolved')&&explicitBankOutflowSource(s,accounts);
      if(sourceOnlyBankOutflow){const sourceId=sourceOnlyBankOutflow.financialAccountId,delta=-BigInt(sourceOnlyBankOutflow.amountMinor);effects.set(sourceId,delta);flow.set(sourceId,delta);effectTimes.set(sourceId,s.occurredAt);unresolvedAssociations.push({reason:'unresolved_account_movement',observationId:s.id,basis:'source_outflow_known_receiving_bank_and_fee_unverified',sourceAccountId:sourceId});continue;}
      if(['owner_confirmed_wallet_top_up','statement_confirmed_wallet_top_up'].includes(s.automaticFunding?.method)&&a.type==='wallet'){
        const target=fundingAccount(s,accounts),amount=BigInt(s.amountMinor);effects.set(a.id,amount);flow.set(a.id,amount);effectTimes.set(a.id,s.automaticFunding.method==='statement_confirmed_wallet_top_up'?s.automaticFunding.proofOccurredAt:s.occurredAt);
        const represented=target&&sources.some(b=>b.financialAccountId===target.id&&b.statementFlow&&b.direction==='debit'),possible=target?(moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,'debit',target.id]))||[]):[];
        if(!target)unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id});
        else if(!represented&&(possible.length||coveredByStatement(target.id,s.currency,Date.parse(s.occurredAt))))unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,targetAccountId:target.id,basis:'owner_confirmed_top_up_requires_covered_bank_receipt'});
        else if(!represented){effects.set(target.id,-amount);flow.set(target.id,-amount);effectTimes.set(target.id,s.occurredAt);}continue;
      }
      if(s.automaticClassification?.method==='explicit_wallet_top_up'&&a.type==='wallet'){
        const delta=BigInt(s.amountMinor);effects.set(a.id,delta);effectTimes.set(a.id,s.occurredAt);flow.set(a.id,delta);
      }
      const repaymentCredit=s.kind==='debt_payment'&&repayment==='credit';
      const provenRepaymentFunding=repaymentCredit&&sources.some(x=>x.direction==='debit'&&x.financialAccountId===fundingAccount(s,accounts)?.id&&(x.bankStatement||x.statementFlow));
      if(s.direction==='neutral'&&['transfer','debt_payment'].includes(s.kind)&&!(s.automaticClassification?.method==='native_zero_value_reward'&&require('./zeroValueRewards').isZeroValueReward(s))&&!provenRepaymentFunding&&!(repaymentCredit&&sources.some(x=>x.direction==='credit'&&accountMap.get(x.financialAccountId)?.type==='credit_card')))unresolvedAssociations.push({reason:'unresolved_account_movement',observationId:s.id,...(s.withdrawalDestination?.method==='inferred_same_session_withdrawal_destination'?{targetAccountId:s.withdrawalDestination.financialAccountId,basis:'destination_inferred_net_receipt_and_fee_unverified',evidenceObservationIds:s.withdrawalDestination.evidenceObservationIds}:{})});

      // A receiving card receipt is not the payer of an explicit wallet debit.
      // Keep the original wallet leg when matching that receipt into the group.
      const walletRepayment=repaymentCredit&&s.provider==='wechat'&&a.type==='wallet'&&s.direction==='debit'&&!s.paymentAccountHint&&s.paymentChannel==='\u96f6\u94b1';
      const fund=fundingAccount(s,accounts)||(a.type==='wallet'&&!walletRepayment&&knownFundingAccounts.length===1?knownFundingAccounts[0]:null);
      if(a.type==='wallet' && (s.paymentAccountHint||fund)) {
        if(!fund) unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,paymentAccountHint:s.paymentAccountHint});
        const direction=repaymentCredit&&s.direction==='neutral'?'debit':s.direction,delta=direction==='debit'?-BigInt(s.amountMinor):signed(s);
        const possibleBankSources=fund?(moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,direction,fund.id]))||[]).filter(o=>!sources.some(source=>source.id===o.id)):[];
        const confirmedDistinct=possibleBankSources.length&&possibleBankSources.every(o=>links.some(l=>l.type==='distinct'&&l.observationIds.includes(s.id)&&l.observationIds.includes(o.id)));
        if(possibleBankSources.length&&!confirmedDistinct&&!sources.some(source=>source.financialAccountId===fund.id)&&!possibleBankSources.every(b=>(sameReconciliation(s.id,b.id)||reconciliation&&bankPaymentProvider(b)&&bankPaymentProvider(b)!==s.provider)))unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,candidateObservationIds:possibleBankSources.slice(0,64).map(o=>o.id),candidateCount:possibleBankSources.length});
        if(fund && !sources.some(x=>x.financialAccountId===fund.id) && (!possibleBankSources.length||confirmedDistinct)) { effects.set(fund.id,delta);effectTimes.set(fund.id,s.occurredAt);if(!liability(fund)&&!s.automaticFunding?.nonCashProductReward)flow.set(fund.id,delta); }
        continue;
      }
      const balanceDelta=a.type==='loan'&&s.kind==='debt_payment'?(s.principalMinor===null?0n:BigInt(s.principalMinor)):a.type==='loan'&&s.kind==='loan_drawdown'?-BigInt(s.amountMinor):signed(s);
      effects.set(a.id,balanceDelta);
      effectTimes.set(a.id,s.occurredAt);
      if(!liability(a))flow.set(a.id,signed(s));
      // An explicitly owned but unclassified asset can receive a balance leg.
      // Its cash status remains unknown until its actual account type is known.
      const counter=s.kind==='transfer'&&(s.automaticClassification?.method==='explicit_owned_counter_account'&&['owner_confirmed','owner_recalled'].includes(s.automaticClassification.confidence)||s.automaticClassification?.method==='explicit_digital_cash_exchange'&&s.automaticClassification.confidence==='explicit_statement_purpose'||s.automaticClassification?.method==='native_named_investment_destination'&&s.automaticClassification.confidence==='inferred_unique_named_native_cash_route')?accountMap.get(s.automaticClassification.financialAccountId):null;
      // Older identity-only annotations may name an intermediary bank rather
      // than its underlying product. Derive cash only from the explicit recalled
      // cash-route format, while preserving the native statement as authority.
      if(counter?.type==='debit_card'&&(s.automaticClassification.confidence==='owner_recalled'||s.automaticClassification.cashRouteEvidence==='owner_confirmed_pos_tuition_onward'&&counter.fundsRole==='studio_public')&&s.statementFlow&&['bank','savings','debit_card'].includes(a.type)&&!sources.some(o=>o.financialAccountId===counter.id&&o.statementFlow)){
        const opposite=s.direction==='credit'?'debit':'credit',possible=moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,opposite,counter.id]))||[];
        if(possible.length||coveredByStatement(counter.id,s.currency,Date.parse(s.occurredAt)))unresolvedAssociations.push({reason:'unresolved_account_movement',observationId:s.id,financialAccountId:counter.id,basis:'owner_confirmed_bank_counter_requires_actual_statement_cash',candidateObservationIds:possible.map(o=>o.id)});
        else{effects.set(counter.id,-signed(s));flow.set(counter.id,-signed(s));effectTimes.set(counter.id,s.occurredAt);}
      }
      const cashProduct=counter&&(['alipay_yuebao','alipay_yulibao','wechat_lingqiantong'].includes(counter.sourceProduct)||counter.sourceProduct==='alipay_ecny'&&counter.type==='wallet');
      const ownedLicaitong=counter?.type==='investment'&&counter.sourceProduct==='wechat_licaitong';
      // An explicitly confirmed gross principal equal to the original cash
      // receipt identifies this borrowing leg. A net receipt alone cannot prove
      // gross principal; repayments still require their actual principal split.
      const ownedLoanDrawdown=counter?.type==='loan'&&s.direction==='credit'&&['bank','savings','debit_card'].includes(a.type)&&s.statementFlow&&s.principalMinor===s.amountMinor&&s.interestMinor==='0'&&s.feeMinor==='0';
      if(counter?.type==='loan'&&s.direction==='credit'&&!ownedLoanDrawdown)unresolvedAssociations.push({reason:'unresolved_account_movement',observationId:s.id,financialAccountId:counter.id,basis:'loan_drawdown_principal_not_confirmed'});
      if(counter&&(cashProduct||ownedLicaitong||ownedLoanDrawdown||['other','receivable'].includes(counter.type))&&!coveredByStatement(counter.id,s.currency,Date.parse(s.occurredAt))&&!sources.some(source=>source.financialAccountId===counter.id)){
        const opposite=s.direction==='credit'?'debit':'credit',possible=moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,opposite,counter.id]))||[];
        if(!possible.length){effects.set(counter.id,-signed(s));effectTimes.set(counter.id,s.occurredAt);if(cashProduct)flow.set(counter.id,-signed(s));}
      }
    }
    if(assetAllocation){if(o.kind!=='expense'||effects.has(assetAllocation.financialAccountId))throw fail('EXPENSE_ASSET_ALLOCATION_INVALID');effects.set(assetAllocation.financialAccountId,BigInt(assetAllocation.amountMinor));effectTimes.set(assetAllocation.financialAccountId,o.occurredAt);}
    // Borrowing/lending changes a signed receivable/payable, never a second cash
    // receipt. Multiple originals of one economic transaction post this leg once.
    const settlements=effectSources.filter(s=>s.automaticClassification?.method==='owner_confirmed_counterparty_settlement');
    if(settlements.length){
      if(new Set(settlements.map(s=>JSON.stringify([s.automaticClassification.financialAccountId,s.amountMinor,s.direction]))).size!==1)throw fail('COUNTERPARTY_SETTLEMENT_CONFLICT');
      const s=settlements[0],target=s.automaticClassification.financialAccountId;
      effects.set(target,-signed(s));effectTimes.set(target,s.occurredAt);
      if(s.direction==='credit'&&groupAnnotations.some(a=>a.patch?.category==='\u8bfe\u7a0b\u4efb\u52a1\u7ed3\u7b97\u56de\u6b3e\uff08\u672c\u91d1\u4e0e\u6536\u76ca\u5f85\u62c6\u5206\uff09')){effects.set(target,0n);unresolvedAssociations.push({reason:'unsplit_task_settlement',observationId:s.id,financialAccountId:target});}
    }
    if(withdrawalEstimate){const e=withdrawalEstimate,time=e.wallet.occurredAt;effects.set(e.targetAccountId,BigInt(e.netMinor));flow.set(e.targetAccountId,BigInt(e.netMinor));effectTimes.set(e.targetAccountId,time);}
    if(feeGroup){const e=feeGroup.evidence,time=feeGroup.proof.occurredAt;effects.set(e.walletAccountId,-BigInt(e.grossMinor));flow.set(e.walletAccountId,-BigInt(e.grossMinor));effectTimes.set(e.walletAccountId,time);effects.set(feeGroup.targetAccountId,BigInt(e.netMinor));flow.set(feeGroup.targetAccountId,BigInt(e.netMinor));effectTimes.set(feeGroup.targetAccountId,time);}
    if(historicalMortgage){const p=historicalMortgage,actual=effectSources.filter(s=>p.observationIds.includes(s.id)),cash=actual.reduce((sum,s)=>sum+signed(s),0n),time=actual.map(s=>s.occurredAt).sort().at(-1);effects.set(p.sourceAccountId,cash);flow.set(p.sourceAccountId,cash);effectTimes.set(p.sourceAccountId,time);effects.set(p.financialAccountId,BigInt(p.principalMinor));effectTimes.set(p.financialAccountId,time);}
    if(installmentPayment){
      const p=installmentPayment,actual=effectSources.filter(s=>p.observationIds.includes(s.id)),cash=actual.reduce((sum,s)=>sum+signed(s),0n),time=actual.map(s=>s.occurredAt).sort().at(-1);
      if(!p.platformFunding){effects.set(p.sourceAccountId,cash);flow.set(p.sourceAccountId,cash);effectTimes.set(p.sourceAccountId,time);}effects.set(p.financialAccountId,BigInt(p.principalMinor));effectTimes.set(p.financialAccountId,time);
    }
    for(const s of effectSources){const model=installmentDraws.get(s.id);if(model){effects.set(model.financialAccountId,-BigInt(model.originalPrincipalMinor));effectTimes.set(model.financialAccountId,s.occurredAt);}}
    if(walletTransfer){const {platform,walletDeltaMinor}=walletTransfer,walletAccountId=walletTransfer.walletAccountId||platform.financialAccountId,delta=BigInt(walletDeltaMinor);effects.set(walletAccountId,delta);flow.set(walletAccountId,delta);effectTimes.set(walletAccountId,platform.occurredAt);}
    if(mixedPayment){
      const actual=new Map();for(const source of [...mixedPayment.bankDebits,mixedPayment.clearingCredit,mixedPayment.product].filter(Boolean))actual.set(source.financialAccountId,(actual.get(source.financialAccountId)||0n)+signed(source));
      for(const [accountId,delta]of actual){effects.set(accountId,delta);flow.set(accountId,delta);effectTimes.set(accountId,mixedPayment.clearingCredit?.occurredAt||mixedPayment.product.occurredAt);}
      if(mixedPayment.method==='product_funded_monthly_credit_repayment'){
        effects.set(mixedPayment.targetAccountId,BigInt(mixedPayment.platform.amountMinor));effectTimes.set(mixedPayment.targetAccountId,mixedPayment.platform.occurredAt);
        if(mixedPayment.walletAccountId){const delta=-BigInt(mixedPayment.walletAmountMinor);effects.set(mixedPayment.walletAccountId,delta);flow.set(mixedPayment.walletAccountId,delta);effectTimes.set(mixedPayment.walletAccountId,mixedPayment.walletOccurredAt||mixedPayment.platform.occurredAt);}
      }
      if(mixedPayment.method==='product_funded_wallet_top_up'){const delta=BigInt(mixedPayment.walletCreditMinor);effects.set(mixedPayment.walletAccountId,delta);flow.set(mixedPayment.walletAccountId,delta);effectTimes.set(mixedPayment.walletAccountId,mixedPayment.platform.occurredAt);}
    }
    if(creditDiscount){const m=creditDiscount;effects.clear();flow.clear();effectTimes.clear();effects.set(m.bank.financialAccountId,-BigInt(m.bank.amountMinor));flow.set(m.bank.financialAccountId,-BigInt(m.bank.amountMinor));effectTimes.set(m.bank.financialAccountId,m.bank.occurredAt);effects.set(m.credit.financialAccountId,BigInt(m.credit.amountMinor));effectTimes.set(m.credit.financialAccountId,m.credit.occurredAt);income=BigInt(m.discountMinor);if(m.serviceFeeMinor!==undefined)consumption=BigInt(m.serviceFeeMinor);}
    if(receiptPlan){const allocation=paymentAllocationEffects(receiptPlan,effectSources,accounts,o);effects.clear();flow.clear();effectTimes.clear();for(const [id,value]of allocation.effects)effects.set(id,value);for(const [id,value]of allocation.flow)flow.set(id,value);for(const [id,value]of allocation.times)effectTimes.set(id,value);}
    if(nativeBankMixed){const p=nativeBankMixed.plan;effects.clear();flow.clear();effectTimes.clear();for(const part of nativeBankMixed.parts){const delta=-BigInt(part.amountMinor);effects.set(part.financialAccountId,delta);effectTimes.set(part.financialAccountId,part.financialAccountId===p.walletAccountId?p.proofDebitOccurredAt:p.proofCreditOccurredAt);if(!liability(accountMap.get(part.financialAccountId)))flow.set(part.financialAccountId,delta);}}
    if(repayment==='credit'&&o.status==='completed'&&BigInt(o.amountMinor)>0n&&!sources.every(s=>s.bankStatement?.nonCash)&&!sources.some(nonCashAuthorization)&&![...effects].some(([id,d])=>accountMap.get(id)?.type==='credit_card'&&d>0n))unresolvedAssociations.push({reason:knownRepaymentCashBySource.get(o.id)?.receivingAccountId?'credit_repayment_received_amount_unknown':'unresolved_debt_account',observationId:o.id,basis:'credit_repayment_requires_receiving_liability_leg'});
    const coveredEffects=[];
    for(const [accountId] of effects){
      const coverage=coveredByStatement(accountId,o.currency,Date.parse(effectTimes.get(accountId)||o.occurredAt));
      if(coverage&&!effectSources.some(s=>s.financialAccountId===accountId&&s.statementFlow)){
        effects.delete(accountId);flow.delete(accountId);effectTimes.delete(accountId);
        coveredEffects.push({financialAccountId:accountId,importId:coverage.importId});
      }
    }
    // Interest explicitly reported by the owning statement must not be counted
    // again from a platform's product relationship.
    if(income!==0n&&coveredEffects.some(e=>sources.some(s=>(s.accountRelations||[]).some(r=>r.financialAccountId===e.financialAccountId&&r.activity==='investment_income'))))income=0n;
    const statisticsExclusions=[];
    const proofCashPlans=require('./balanceCashPostings').planBalanceProofCashPostings(effectSources,proofCashPostings,flow,effects);
    sponsoredHelper.appendSponsoredCashPlans(effectSources,sponsoredSettlements,flow,effects,proofCashPlans);
    if(withdrawal?.method==='native_owner_bank_withdrawal'&&sources.some(s=>s.id===withdrawal.wallet.id)){const w=withdrawal,delta=-BigInt(w.grossMinor);if(effects.get(w.wallet.financialAccountId)!==delta||flow.get(w.wallet.financialAccountId)!==delta||proofCashPlans.some(p=>p.financialAccountId===w.wallet.financialAccountId))throw fail('NATIVE_OWNER_WITHDRAWAL_CASH_CONFLICT');proofCashPlans.push({method:'native_withdrawal_wallet_cash_posting',sourceObservationId:w.wallet.id,proofObservationId:w.walletCashProofObservationId,financialAccountId:w.wallet.financialAccountId,deltaMinor:String(delta),sourceOccurredAt:w.wallet.occurredAt,occurredAt:w.walletCashOccurredAt,date:w.walletCashDate,confidence:'explicit_original_cash_posting',reversible:true});}
    for(const p of proofCashPlans){effects.set(p.financialAccountId,BigInt(p.deltaMinor));flow.set(p.financialAccountId,BigInt(p.deltaMinor));effectTimes.set(p.financialAccountId,p.occurredAt);}
    for(const s of settlements){const p=proofCashPlans.find(p=>p.sourceObservationId===s.id&&p.financialAccountId===s.financialAccountId);if(p&&effects.has(s.automaticClassification.financialAccountId)){if(p.partialMerchantSettlement)effects.set(s.automaticClassification.financialAccountId,-BigInt(p.deltaMinor));effectTimes.set(s.automaticClassification.financialAccountId,p.occurredAt);}}
    for(const s of sources){const overlap=statementOverlaps.get(s.id);if(overlap?.length&&!sources.some(b=>(b.bankStatement||b.statementFlow)&&b.financialAccountId===fundingAccount(s,accounts)?.id)&&!overlap.every(b=>(sameReconciliation(s.id,b.id)||reconciliation&&bankPaymentProvider(b)&&bankPaymentProvider(b)!==s.provider))){statisticsExclusions.push({observationId:s.id,candidateObservationIds:overlap.map(b=>b.id),reason:'card_statement_overlap_requires_review'});}}
    const pendingConsumption=statisticsExclusions.length?consumption:0n,pendingIncome=statisticsExclusions.length?income:0n;
    if(statisticsExclusions.length){consumption=0n;income=0n;unresolvedAssociations.push(...statisticsExclusions);}
    const ownerRepaymentReceipt=sources.map(s=>knownRepaymentCashBySource.get(s.id)).find(c=>c?.receivingLiabilityLeg==='owner_confirmed_derived');
    const incomeExpenseAllocations=storedValueTopUp?{[storedValueTopUp.receivingAccountId]:{consumptionMinor:0n,incomeMinor:income}}:ownerRepaymentReceipt?{[ownerRepaymentReceipt.receivingAccountId]:{consumptionMinor:0n,incomeMinor:income}}:creditRepaymentCost?{[creditRepaymentCost.payerAccountId]:{consumptionMinor:consumption,incomeMinor:0n}}:creditDiscount?{...(creditDiscount.serviceFeeMinor!==undefined?{[creditDiscount.bank.financialAccountId]:{consumptionMinor:BigInt(creditDiscount.serviceFeeMinor),incomeMinor:0n}}:{}),[creditDiscount.credit.financialAccountId]:{consumptionMinor:0n,incomeMinor:BigInt(creditDiscount.discountMinor)}}:reconciliation?.method==='family_product_payment_group'&&reconciliationRole==='platform_order'?{[reconciliation.evidence.productAccountId]:{consumptionMinor:consumption,incomeMinor:0n}}:nativeBankMixed?Object.fromEntries(nativeBankMixed.parts.map(p=>[p.financialAccountId,{consumptionMinor:BigInt(p.amountMinor),incomeMinor:0n}])):receiptPlan?Object.fromEntries(receiptPlan.parts.map(a=>[a.financialAccountId,{consumptionMinor:o.kind==='expense'?BigInt(a.amountMinor):0n,incomeMinor:0n}])):mixedPayment?Object.fromEntries(mixedPayment.allocation.map(a=>[a.financialAccountId,{consumptionMinor:['expense','interest','fee'].includes(o.kind)?BigInt(a.amountMinor):0n,incomeMinor:0n}])):null;
    const actualProofPayers=installmentPayment?.confidence==='actual_loan_proof'?[...flow].filter(([id,d])=>d<0n&&!liability(accountMap.get(id))).map(([id])=>id):[];
    const reportingAccountIds=posSettlementFee?[]:actualProofPayers.length===1?actualProofPayers:incomeExpenseAllocations?Object.keys(incomeExpenseAllocations):feeGroup?[feeGroup.evidence.walletAccountId]:withdrawal?[withdrawal.wallet.financialAccountId]:withdrawalEstimate?[withdrawalEstimate.wallet.financialAccountId]:incomeExpenseAccounts(effectSources.filter(s=>!legacyPurchasesWithoutPayer.has(s.id)&&(!commerceTrace||s.id!==commerceTrace.commerce.id)),accounts,fundingAccount,effects);
    const reportSelected=reportingAccountIds.some(id=>selected.has(id))||accounts.every(a=>selected.has(a.id));
    if(!reportingAccountIds.length&&(consumption!==0n||income!==0n))unresolvedAssociations.push({reason:'unallocated_income_expense',observationId:o.id});
    const automaticAssociations=[...new Set(sources.flatMap(s=>automaticByObservation.get(s.id)||[])),...(reconciliation?[reconciliation]:[])];
    const associated=new Set([...sources.map(s=>s.financialAccountId),...sources.filter(s=>s.withdrawalDestination).map(s=>s.withdrawalDestination.financialAccountId),...sources.filter(s=>s.automaticFunding).map(s=>s.automaticFunding.financialAccountId),...sources.filter(s=>s.automaticClassification?.method==='explicit_owned_counter_account').map(s=>s.automaticClassification.financialAccountId),...sources.flatMap(s=>(s.accountRelations||[]).map(r=>r.financialAccountId).filter(Boolean)),...sources.map(s=>knownRepaymentCashBySource.get(s.id)?.receivingAccountId).filter(Boolean),...effects.keys(),...reportingAccountIds]);
    const selectedSources=sources.filter(s=>selected.has(s.financialAccountId));
    const cashTiming=require('./balanceCashPostings').cashPostingTiming(sourceCashTiming(effectSources,flow,effects),proofCashPlans);
    const recalledFundingSources=sources.filter(s=>s.automaticFunding?.method==='owner_recalled_product_funding');
    const recalledFundingTrace=!o.automaticFunding&&recalledFundingSources.length===1?{automaticFunding:recalledFundingSources[0].automaticFunding}:{};
    all.push({...o,...(nativeBankMixed?{nativeBankMixedAllocation:nativeBankMixed}:{}),...recalledFundingTrace,id,...(posMerchantReceipt?{posMerchantReceipt}:{}),...(storedValueTopUp?{storedValueTopUp}:{}),...(walletTopupReceipt?{walletTopupReceipt}:{}),...(creditRepaymentCost?{creditRepaymentCost:{...creditRepaymentCost.evidence,confidence:creditRepaymentCost.confidence}}:{}),...(posSettlementFee?{posSettlementFee}:{}),...(creditDiscount?{creditRepaymentDiscount:{cashPaidMinor:creditDiscount.platform.amountMinor,cardReceivedMinor:creditDiscount.credit.amountMinor,discountMinor:creditDiscount.discountMinor,...(creditDiscount.serviceFeeMinor!==undefined?{orderOriginalPriceMinor:creditDiscount.orderOriginalPriceMinor,serviceFeeMinor:creditDiscount.serviceFeeMinor,feeConfidence:creditDiscount.feeConfidence,netBenefitMinor:creditDiscount.netBenefitMinor,feeRuleUrl:creditDiscount.feeRuleUrl}:{}),confidence:creditDiscount.confidence,sourceObservationIds:[...new Set([creditDiscount.platform.id,creditDiscount.bank.id,creditDiscount.credit.id])],incomeBasis:'non_cash_credit_repayment_benefit'}}:{}),...cashTiming,automaticAssociations,incomeExpenseAllocations,reconciliationGroup:reconciliation?{id:reconciliation.id,role:reconciliationRole,count:reconciliation.evidence.count,individualIdentity:'undetermined'}:null,mortgageSplit:mortgageSplit.has(o.id)?{confidence:mortgageSplit.get(o.id).confidence,month:mortgageSplit.get(o.id).month,financialAccountId:mortgageSplit.get(o.id).financialAccountId}:null,repaymentType:repayment,reportingAccountIds,coveredEffects,statisticsExclusions,pendingConsumptionMinor:pendingConsumption,pendingIncomeMinor:pendingIncome,selectedConsumptionMinor:incomeExpenseAllocations?Object.entries(incomeExpenseAllocations).reduce((sum,[accountId,a])=>sum+(selected.has(accountId)?a.consumptionMinor:0n),0n):reportSelected?consumption:0n,selectedIncomeMinor:incomeExpenseAllocations?Object.entries(incomeExpenseAllocations).reduce((sum,[accountId,a])=>sum+(selected.has(accountId)?a.incomeMinor:0n),0n):reportSelected?income:0n,...(investmentIncomeRecognitions.length?{investmentIncomeRecognitions}:{}),investmentConfirmations:investmentConfirmations.map(source=>({id:source.id,date:source.date,...source.investmentTrade})),observationIds:sources.map(s=>s.id),financialAccountIds:[...associated],sources:sources.map(s=>originalById.get(s.id)),appliedAnnotations:sources.filter(s=>latestAnnotations.has(s.id)).map(s=>latestAnnotations.get(s.id)),consumptionMinor:consumption,incomeMinor:income,balanceEffects:Object.fromEntries(effects),balanceEffectTimes:Object.fromEntries(effectTimes),cashEffects:Object.fromEntries(flow),selectedObservationIds:selectedSources.map(s=>s.id),relatedTransactionId:null});
  }
  for(const t of all){const p=t.observationIds.map(id=>historicalMortgageBySource.get(id)).find(p=>p?.confidence==='actual_bank_statement');if(p)t.actualMortgageStatementEvidence={method:p.associationMethod,confidence:'actual_bank_statement',financialAccountId:p.financialAccountId,proofObservationIds:p.proofObservationIds,sourceObservationIds:p.observationIds,principalMinor:p.principalMinor,interestMinor:p.interestMinor,loanPrincipalBalanceMinor:p.balanceMinor,reversible:true,originalBankCashPreserved:true};}
  const termDeposits=require('./bankTermDeposits'),termDepositResult=termDeposits.buildTermDepositPlans(ledger,all,sourceOwners);termDeposits.applyTermDepositPlans(all,termDepositResult,selected);unresolvedAssociations.push(...termDepositResult.issues);
  const walletIntermediaries=require('./walletIntermediaryPostings'),walletIntermediaryPlans=walletIntermediaries.findWalletIntermediaryPostings(all,originalObservations,accounts,{annotatedIds:new Set(latestAnnotations.keys()),annotations:ledger.annotations||[],links:ledger.links||[]});
  require('./nativePensionCashRoutes').addNativePensionBridges(all,nativePensionRoutes,walletIntermediaryPlans);
  require('./nativeBankFundedOrders').addNativeBankFundedOrderBridges(all,nativeBankOrderFunding,originalObservations,walletIntermediaryPlans);
  require('./knownBankWalletBridges').addKnownBankWalletBridges(all,originalObservations,accounts,walletIntermediaryPlans,{annotations:latestAnnotations,annotationHistory:ledger.annotations||[],annotatedIds:new Set((ledger.annotations||[]).map(a=>a.observationId)),links:ledger.links||[]});
  require('./nativeBankCheckoutBridges').addNativeBankCheckoutBridges(ledger,all,walletIntermediaryPlans);
  require('./combinedBankWalletBridges').addCombinedBankWalletBridges(ledger,all,walletIntermediaryPlans);
  require('./combinedCreditWalletBridges').addCombinedCreditWalletBridges(ledger,all,walletIntermediaryPlans);
  require('./nativePersonalPacketBridges').addNativePersonalPacketBridges(ledger,all,walletIntermediaryPlans);
  walletIntermediaries.addInterleavedYuebaoWithdrawals(all,originalObservations,accounts,walletIntermediaryPlans,{annotatedIds:new Set((ledger.annotations||[]).map(a=>a.observationId)),annotations:ledger.annotations||[],links:ledger.links||[]});
  require('./telecomTopups').addUnallocatedNativeBankServiceCash(all,originalObservations,accounts,proofCashPostings,walletIntermediaryPlans,{unallocatedSourceIds:new Set(unresolvedAssociations.filter(i=>i.reason==='unresolved_funding_account'&&i.basis==='original_paid_merchant_order_payer_not_exported').map(i=>i.observationId)),annotations:ledger.annotations||[],links:ledger.links||[]});
  require('./groupedWalletIntermediaryPostings').addGroupedWalletIntermediaryPostings(all,originalObservations,accounts,walletIntermediaryPlans,{annotations:ledger.annotations||[],links:ledger.links||[]});
  for(let index=0;index<all.length;index++){all[index]=walletIntermediaries.withWalletIntermediaryPostings(all[index],walletIntermediaryPlans.get(all[index].id));const allocation=all[index].nativeBankMixedAllocation;if(allocation){all[index]=require('./nativeBankFundedOrders').withNativeBankMixedCashEvents(all[index],allocation,originalObservations);delete all[index].nativeBankMixedAllocation;}}
  require('./nativeOrderRefunds').appendNativeOrderRefunds(ledger,all,selected,(derived,range)=>buildFinanceView(derived,range,RAW_DERIVED_TRANSACTIONS));
  require('./nativeClosedOrderCash').appendNativeClosedOrderCash(ledger,all,selected,(derived,range)=>buildFinanceView(derived,range,RAW_DERIVED_TRANSACTIONS));
  require('./nativeClosedHuabeiCash').append(ledger,all,selected,(derived,range)=>buildFinanceView(derived,range,RAW_DERIVED_TRANSACTIONS));
  require('./nativeUnassignedGuaranteeCash').append(ledger,all,selected,unresolvedAssociations,(derived,range)=>buildFinanceView(derived,range,RAW_DERIVED_TRANSACTIONS));
  require('./nativeGuaranteeSettlements').append(ledger,all,selected,(derived,range)=>buildFinanceView(derived,range,RAW_DERIVED_TRANSACTIONS));
  require('./nativeCombinedOrderCash').appendNativeCombinedOrderCash(ledger,all,selected,(derived,range)=>buildFinanceView(derived,range,RAW_DERIVED_TRANSACTIONS));
  require('./nativeTransitStoredValue').applyNativeTransitStoredValue(ledger,all,selected,unresolvedAssociations);
  require('./nativeGroupedBankTopUps').appendNativeGroupedBankTopUps(ledger,all,selected,unresolvedAssociations,(derived,range)=>buildFinanceView(derived,range,RAW_DERIVED_TRANSACTIONS));
  require('./groupedWalletWithdrawalPostings').applyGroupedWalletWithdrawalPostings(ledger,all);
  require('./nativeOwnerWithdrawals').applyNativeMatchedWithdrawalCashTiming(ledger,all);
  require('./nativeMerchantServiceFees').appendNativeMerchantServiceFees(ledger,all,selected,(derived,range)=>buildFinanceView(derived,range,RAW_DERIVED_TRANSACTIONS));
  require('./nativeBuyerCreditFees').appendNativeBuyerCreditFees(ledger,all,selected,(derived,range)=>buildFinanceView(derived,range,RAW_DERIVED_TRANSACTIONS));
  require('./nativeYuebaoRewardDeposits').applyNativeYuebaoRewardDeposits(ledger,all,selected);
  require('./historicalInterestWalletCredits').applyHistoricalInterestWalletCredits(ledger,all,proofCashPostings);
  require('./closedFundedTransfers').appendClosedFundedTransfers(ledger,all,selected,(derived,range)=>buildFinanceView(derived,range,RAW_DERIVED_TRANSACTIONS));
  require('./closedFundedTransfers').restoreReferencedTransferRefundPurposes(ledger,all);
  require('./nativeStandaloneYuebaoRedemptions').appendNativeStandaloneYuebaoRedemptions(ledger,all,selected,(derived,range)=>buildFinanceView(derived,range,RAW_DERIVED_TRANSACTIONS));
  require('./merchantSettlementReceivables').applyMerchantSettlementReceivables(ledger,all,selected,unresolvedAssociations);
  require('./ownerWalletExpenseAttributions').applyOwnerWalletExpenseAttributions(ledger,all,selected,unresolvedAssociations);
  require('./ownerAlipayFundingDefaults').applyOwnerAlipayFundingDefaults(ledger,all,selected,unresolvedAssociations);
  for(const t of all){const split=t.observationIds.map(id=>installmentBySource.get(id)).find(Boolean);if(split)t.installmentLoanSplit=split;const fee=t.observationIds.map(id=>feeGroupByObservation.get(id)).find(Boolean);if(fee)t.withdrawalFeeConfirmation=fee.evidence;const estimated=withdrawalEstimateByRoot.get(t.id);if(estimated){if(estimated.evidence.schema==='wechat-original-statement-fee-v1')t.withdrawalFeeConfirmation=estimated.evidence;else t.withdrawalFeeEstimate=estimated.evidence;}const zero=t.observationIds.map(id=>ownerZeroFeeWithdrawals.get(id)).find(Boolean);if(zero&&!t.withdrawalFeeConfirmation)t.withdrawalFeeConfirmation=zero;}
  const wechatRefundEstimates=require('./wechatRefundEstimates').applyWechatRefundEstimates(ledger,all,selected,unresolvedAssociations);
  require('./wechatSelfPacketClaims').applyNativeSelfPacketClaims(ledger,all,selected);
  const expenseReferences=new Map(),transactionsByObservation=new Map();for(const t of all){for(const id of t.observationIds)transactionsByObservation.set(id,t);if(t.kind==='expense')for(const ref of new Set(t.sources.map(s=>s.sourceTransactionId).filter(Boolean))){const key=JSON.stringify([t.currency,ref]);if(!expenseReferences.has(key))expenseReferences.set(key,[]);expenseReferences.get(key).push(t);}}
  const refundProvenOriginals=new Map();for(const t of all)if(t.automaticClassification?.method==='refund_proven_closed_huabei_purchase')refundProvenOriginals.set(t.automaticClassification.refundObservationId,t);
  for(const t of all) {
    const knownCash=t.observationIds.map(id=>knownRepaymentCashBySource.get(id)).find(Boolean);if(knownCash)t.knownRepaymentCash=knownCash;
    if(t.automaticClassification?.method==='unique_returned_wechat_transfer')t.relatedTransactionId=transactionsByObservation.get(t.automaticClassification.pairedObservationId)?.id||null;
    const manual=links.find(l=>l.type==='refund'&&l.observationIds.some(id=>t.observationIds.includes(id)));
    const ref=t.relatedReference;
    const provedRefundOriginals=refundProvenOriginals.size&&t.kind==='refund'&&!manual?[...new Set(t.observationIds.map(id=>refundProvenOriginals.get(id)).filter(Boolean))]:[];
    if(provedRefundOriginals.length===1){t.relatedTransactionId=provedRefundOriginals[0].id;t.category=provedRefundOriginals[0].category;continue;}
    if(t.kind==='refund') { const original=manual?[...new Set(manual.observationIds.map(id=>transactionsByObservation.get(id)).filter(x=>x&&x.id!==t.id&&x.kind==='expense'&&x.currency===t.currency))].sort((a,b)=>all.indexOf(a)-all.indexOf(b)):ref?expenseReferences.get(JSON.stringify([t.currency,ref]))||[]:[]; if(original.length===1){t.relatedTransactionId=original[0].id;t.category=original[0].category;}else (original.length>1||manual?unresolvedAssociations:information).push({reason:original.length>1||manual?'unresolved_refund':'refund_original_unavailable',observationId:t.observationIds[0],candidateTransactionIds:original.map(o=>o.id)}); }
  }
  require('./nativeRentDisbursementTiming').applyNativeRentDisbursementTiming(ledger,all);
  if(internalMode===RAW_DERIVED_TRANSACTIONS)return all;
  const closedCashSettlements=require('./closedCashSettlements').applyClosedCashSettlements(ledger,all,selected,unresolvedAssociations);
  const collectiveTiming=require('./collectiveWalletWithdrawalTiming'),balanceTimingGroups=collectiveTiming.planCollectiveWalletWithdrawalTiming(ledger,all,reconciliationGroups);
  for(const group of balanceTimingGroups)for(const id of group.platformRootIds){const t=all.find(t=>t.id===id);t.collectiveBalanceTiming={groupId:group.id,individualIdentity:'undetermined',sourceEffectTimePreserved:true,actualCashEventsRecordedOnGroup:true};}
  const preparedTransactions=all,preparedIssues=unresolvedAssociations,preparedFundValuations=fundValuations,effectiveSourceAccounts=new Map(observations.map(o=>[o.id,o.financialAccountId]));
  const finalize=(options={})=>{
  const selected=new Set(options.accountIds||accounts.map(a=>a.id));
  const all=internalMode===PREPARED_FINANCE_VIEW?require('./preparedScopeSelection').projectSelectedTransactions(preparedTransactions,accounts,selected,effectiveSourceAccounts):preparedTransactions;
  const unresolvedAssociations=[...preparedIssues];
  const fundValuations=internalMode===PREPARED_FINANCE_VIEW&&options.endDate?buildFundValuations(ledger,{assetRegister:investmentRegister,asOf:options.endDate}):preparedFundValuations;
  const summarize=(transactions,range=options)=>{
    const totals=dictionary(),categories=dictionary(),funding=dictionary(),breakdown=dictionary();
    for(const a of accounts)if(selected.has(a.id))totals[a.currency] ||= money();
    for(const t of transactions) {
      const economic=within(t.date,range),bucket=totals[t.currency]||(totals[t.currency]=money());if(economic){bucket.consumptionMinor+=t.selectedConsumptionMinor;bucket.incomeMinor+=t.selectedIncomeMinor;}
      const details=breakdown[t.currency]||(breakdown[t.currency]={cashFundedConsumptionMinor:0n,creditFundedConsumptionMinor:0n,loanPrincipalPaidMinor:0n,interestPaidMinor:0n,feesPaidMinor:0n,financingCostPaidMinor:0n,unsplitDebtPaymentMinor:0n});
      if(economic&&t.status==='completed'&&t.kind==='debt_payment'&&t.reportingAccountIds.some(id=>selected.has(id))) { if(t.installmentLoanSplit){details.loanPrincipalPaidMinor+=BigInt(t.installmentLoanSplit.principalMinor);details.financingCostPaidMinor+=BigInt(t.installmentLoanSplit.financingCostMinor);}else if(['principalMinor','interestMinor','feeMinor'].every(k=>t[k]!==null)){details.loanPrincipalPaidMinor+=BigInt(t.principalMinor);details.interestPaidMinor+=BigInt(t.interestMinor);details.feesPaidMinor+=BigInt(t.feeMinor);}else if(t.repaymentType==='loan'&&(!t.mortgageSplit||mortgageReviewReason(t.mortgageSplit)))details.unsplitDebtPaymentMinor+=BigInt(t.amountMinor); }
      if(economic&&t.status==='completed'&&t.creditRepaymentCost&&t.reportingAccountIds.some(id=>selected.has(id)))details.feesPaidMinor+=BigInt(t.creditRepaymentCost.netCostMinor);
      if(economic&&t.status==='completed'&&t.posMerchantReceipt?.purpose==='studio_tuition'&&t.posMerchantReceipt.fee.feeMinor!==null&&t.reportingAccountIds.some(id=>selected.has(id)))details.feesPaidMinor+=BigInt(t.posMerchantReceipt.fee.feeMinor);
      const cats=categories[t.currency]||(categories[t.currency]=dictionary());if(economic&&t.selectedConsumptionMinor!==0n)cats[t.category||'Uncategorized']=(cats[t.category||'Uncategorized']||0n)+t.selectedConsumptionMinor;
      for(const [id,delta] of cashEntries(t,range)) if(selected.has(id)) {if(delta>0n)bucket.cashInMinor+=delta;else bucket.cashOutMinor-=delta;}
      bucket.netCashFlowMinor=bucket.cashInMinor-bucket.cashOutMinor;
      if(!economic)continue;const fundingIds=t.reportingAccountIds;
      if(t.incomeExpenseAllocations){for(const [id,a]of Object.entries(t.incomeExpenseAllocations))if(selected.has(id)){const b=funding[id]||(funding[id]=dictionary());b[t.currency]=(b[t.currency]||0n)+a.consumptionMinor;details[liability(accountMap.get(id))?'creditFundedConsumptionMinor':'cashFundedConsumptionMinor']+=a.consumptionMinor;}}else for(const id of fundingIds) if(selected.has(id)&&t.selectedConsumptionMinor!==0n) {const b=funding[id]||(funding[id]=dictionary());b[t.currency]=(b[t.currency]||0n)+t.selectedConsumptionMinor;details[liability(accountMap.get(id))?'creditFundedConsumptionMinor':'cashFundedConsumptionMinor']+=t.selectedConsumptionMinor;break;}
    }
    return {currencyTotals:totals,categoryTotals:categories,fundingTotals:funding,fundingBreakdown:breakdown};
  };
  const transactions=transactionsInRange(all,selected,options);
  const unallocatedTaskSources=new Map(unresolvedAssociations.filter(i=>i.reason==='unsplit_task_settlement').map(i=>[i.observationId,i.financialAccountId]));
  const summary=summarize(transactions),accountStats=dictionary(),provisionalRetirements=require('./provisionalAccountRetirement').verifiedProvisionalRetirements(ledger,all);
  const statementAnchors=[...statementBalances(originalObservations,accounts),...nativeMortgages.anchors.filter(a=>!options.endDate||a.asOf.slice(0,10)<=options.endDate)];
  for(const a of accounts.filter(a=>selected.has(a.id))) {
    const current=transactions.filter(t=>t.financialAccountIds.includes(a.id));const stats={financialAccountId:a.id,currency:a.currency,...money(),balanceMinor:null,balanceAnchor:null,balanceStatus:'uncalibrated'};
    if(provisionalRetirements.has(a.id)){stats.balanceExcludedReason='superseded_provisional_identity';stats.identityResolution=provisionalRetirements.get(a.id);}
    for(const t of current) {for(const [id,delta]of cashEntries(t,options))if(id===a.id){if(delta>0n)stats.cashInMinor+=delta;else stats.cashOutMinor-=delta;}if(!within(t.date,options))continue;if(t.incomeExpenseAllocations){stats.consumptionMinor+=t.incomeExpenseAllocations[a.id]?.consumptionMinor||0n;stats.incomeMinor+=t.incomeExpenseAllocations[a.id]?.incomeMinor||0n;}else if(t.reportingAccountIds.includes(a.id)){stats.consumptionMinor+=t.consumptionMinor;stats.incomeMinor+=t.incomeMinor;}}
    stats.netCashFlowMinor=stats.cashInMinor-stats.cashOutMinor;
    if(isSettlementAccount(a)){
      let settlementMovement=0n;for(const e of collectiveTiming.accountBalancePostings(all,a.id,balanceTimingGroups))if(within(financeDayAt(Date.parse(e.occurredAt)),options))settlementMovement+=BigInt(e.deltaMinor);stats.settlementMovementMinor=settlementMovement;
      stats.unallocatedSettlementReceiptMinor=current.filter(t=>within(t.date,options)&&t.observationIds.some(id=>unallocatedTaskSources.get(id)===a.id)).reduce((n,t)=>n+BigInt(t.amountMinor),0n);
      stats.settlementMovementComplete=stats.unallocatedSettlementReceiptMinor===0n;
    }
    const targetTime=options.endDate?Date.parse(options.endDate+'T23:59:59.999+08:00'):Infinity;
    let anchors=(ledger.balanceSnapshots||[]).filter(s=>s.financialAccountId===a.id&&s.currency===a.currency).map(s=>({...s,time:Date.parse(s.asOf)}));
    if(a.openingBalanceMinor!==null&&a.openingDate) anchors.push({id:null,source:'opening_balance',balanceConvention:a.balanceConvention,asOf:a.openingDate+'T00:00:00+08:00',balanceMinor:a.openingBalanceMinor,time:Date.parse(a.openingDate+'T00:00:00+08:00')});
    anchors.push(...statementAnchors.filter(s=>s.financialAccountId===a.id&&s.currency===a.currency));
    const prior=anchors.filter(s=>s.time<=targetTime);
    anchors=prior.length?prior:calibrationOnly(a)?[]:anchors;
    for(const anchor of anchors)if(liability(a)&&anchor.balanceConvention!=='signed')anchor.balanceMinor=(-BigInt(anchor.balanceMinor)).toString();
    const anchorPriority=s=>s.source==='opening_balance'?0:s.source==='statement_observation'?1:2;
    const createdTime=s=>s.createdAt?Date.parse(s.createdAt):0;
    anchors.sort((x,y)=>(prior.length?y.time-x.time:x.time-y.time)||anchorPriority(y)-anchorPriority(x)||createdTime(y)-createdTime(x));
    if(anchors[0]) {
      const anchor=anchors[0],tied=anchors.filter(s=>s.time===anchor.time&&anchorPriority(s)===anchorPriority(anchor)&&createdTime(s)===createdTime(anchor));
      if(new Set(tied.map(s=>s.balanceMinor)).size>1)unresolvedAssociations.push({reason:'ambiguous_balance_anchor',financialAccountId:a.id,candidateSnapshotIds:tied.map(s=>s.id)});
      else {stats.balanceAnchor={id:anchor.id,source:anchor.source,asOf:anchor.asOf};stats.balanceStatus='calibrated';stats.balanceMinor=BigInt(anchor.balanceMinor);stats.balanceAsOf=options.endDate||financeDayAt(anchor.time);const reverse=anchor.time>targetTime;if(reverse)stats.balanceStatus='derived';if(!calibrationOnly(a))balanceTransactions:for(const event of collectiveTiming.accountBalancePostings(all,a.id,balanceTimingGroups)){const t=event.transaction,time=Date.parse(event.occurredAt);if(reverse?time>targetTime&&time<=anchor.time:(anchor.source==='opening_balance'?time>=anchor.time:time>anchor.time)&&time<=targetTime){
        if(t.observationIds.some(id=>unallocatedTaskSources.get(id)===a.id)){stats.balanceMinor=null;stats.balanceStatus='uncalibrated';unresolvedAssociations.push({reason:'unsplit_settlement_balance',financialAccountId:a.id,observationId:t.observationIds[0]});break balanceTransactions;}
        if(a.type==='loan'&&t.kind==='debt_payment'&&t.principalMinor===null&&Object.hasOwn(t.balanceEffects,a.id)){stats.balanceMinor=null;stats.balanceStatus='uncalibrated';unresolvedAssociations.push({reason:'unsplit_loan_balance',financialAccountId:a.id,observationId:t.observationIds[0]});break balanceTransactions;}
        stats.balanceMinor+=BigInt(event.deltaMinor)*(reverse?-1n:1n);
        if(!options.endDate&&!reverse&&BigInt(event.deltaMinor)!==0n){const movementDate=financeDayAt(time);if(movementDate>stats.balanceAsOf)stats.balanceAsOf=movementDate;}
        if(Object.hasOwn(t.balanceEffects,a.id))stats.balanceStatus='derived';
      }}}
    }
    const mortgage=mortgageModels.find(m=>m.financialAccountId===a.id);
    if(mortgage){const eligible=(mortgage.balanceEvents||mortgage.periods).filter(p=>!options.endDate||p.date<=options.endDate),last=eligible.at(-1);stats.estimatedBalanceMinor=mortgage.status==='actual_bank_statement'||last===undefined?null:String(-BigInt(last.balanceMinor));stats.estimateAsOf=mortgage.status==='actual_bank_statement'?null:last?.date||null;stats.estimateStatus=mortgage.status;if(mortgage.status==='actual_bank_statement')stats.actualMortgageStatement={confidence:'actual_bank_statement',proofObservationIds:mortgage.proofObservationIds,asOf:mortgage.asOf};}
    const installment=installmentLoans.find(m=>m.financialAccountId===a.id);
    if(installment){const last=installment.balanceEvents.filter(p=>!options.endDate||p.date<=options.endDate).at(-1);stats.estimatedBalanceMinor=last?String(-BigInt(last.balanceMinor)):null;stats.estimateAsOf=last?.date||null;stats.estimateStatus=installment.status;}
    const financing=creditFinancing.find(m=>m.financialAccountId===a.id&&m.status==='reconciled_actual_records');
    if(financing){const last=financing.balanceEvents.filter(p=>!options.endDate||p.date<=options.endDate).at(-1);stats.estimatedBalanceMinor=last?String(-BigInt(last.balanceMinor)):null;stats.estimatedPrincipalMinor=last?String(-BigInt(last.principalMinor)):null;stats.estimatedAccruedCostMinor=last?.accruedCostMinor||null;stats.estimateAsOf=last?.date||null;stats.estimateStatus=financing.status;}
    if(a.termDeposit&&options.endDate&&options.endDate<a.termDeposit.knownFrom){stats.balanceMinor=null;stats.balanceAnchor=null;stats.balanceStatus='uncalibrated';stats.balanceAsOf=null;}
    accountStats[a.id]=stats;
  }
  let comparison=null;
  if(validDate(options.startDate)&&validDate(options.endDate)&&options.startDate<=options.endDate) {const span=(Date.parse(options.endDate)-Date.parse(options.startDate))/86400000+1;const previousEnd=new Date(Date.parse(options.startDate)-86400000).toISOString().slice(0,10),previousStart=new Date(Date.parse(options.startDate)-span*86400000).toISOString().slice(0,10);comparison={current:{startDate:options.startDate,endDate:options.endDate,...summary},previous:{startDate:previousStart,endDate:previousEnd,...summarize(transactionsInRange(all,selected,{startDate:previousStart,endDate:previousEnd}),{startDate:previousStart,endDate:previousEnd})}};}
  const balanceChecks=require('./balanceReconciliation'),balanceReconciliation=balanceChecks.reconcileIndependentBalances(ledger,all,{accountIds:selected,balanceTimingGroups,additionalStatementAnchors:nativeMortgages.anchors});
  unresolvedAssociations.push(...balanceChecks.balanceReviewIssues(balanceReconciliation));
  const review=buildReviewSummary(unresolvedAssociations,transactions,accounts);
  return serial({balanceReconciliation,...(wechatRefundEstimates.length?{wechatRefundEstimates}:{}),...(closedCashSettlements.length?{closedCashSettlements}:{}),...(balanceTimingGroups.length?{balanceTimingGroups}:{}),transactions,creditFinancing,...(termDepositResult.models.length?{termDeposits:termDepositResult.models.filter(m=>selected.has(m.financialAccountId)||selected.has(m.bankAccountId))}:{}),reconciliationGroups:[...reconciliationGroups,...feeGroups.map(({proof,wallets,...g})=>g)],securities,fundValuations:fundValuations.filter(v=>selected.has(v.financialAccountId)),installmentLoans:installmentLoans.filter(m=>selected.has(m.financialAccountId)||selected.has(m.sourceAccountId)),investmentTrades:transactions.flatMap(t=>t.investmentConfirmations),mortgages:mortgageModels.filter(m=>selected.has(m.financialAccountId)||selected.has(m.sourceAccountId)),accountStats,portfolioBalances:portfolioBalances(accountStats),...summary,comparison,unresolvedAssociations,information,review});
  };
  return internalMode===PREPARED_FINANCE_VIEW?finalize:finalize(options);
}
module.exports={buildFinanceView,prepareFinanceView,validateRecord,validDate};
