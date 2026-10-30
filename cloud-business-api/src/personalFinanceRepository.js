'use strict';
const crypto=require('node:crypto');
const {validateRecord,validDate,buildFinanceView}=require('../../shared/personal-finance/ledger');
const {resolveBillAccount,resolveRelatedBillAccounts}=require('./billAccountResolution');
const {resolveBankAccount,bankAccountKey}=require('./bankAccountResolution');
const {ACCOUNT_PRODUCTS}=require('../../shared/personal-finance/accountProducts');
const {accountProposals}=require('../../shared/personal-finance/assetRegister');
const {validateMortgage,bindMortgageCalibration}=require('../../shared/personal-finance/mortgages');
const {validateBrokerageAccount,validateSecuritiesHistory}=require('../../shared/personal-finance/securities');
const {validateStatementOwner}=require('../../shared/personal-finance/statementOwnership');
const {validateInstallmentLoan}=require('../../shared/personal-finance/installmentLoans');
const {validateWithdrawalFeeAccount}=require('../../shared/personal-finance/withdrawalFeeEvidence');
const {POLICY_KEYS,READ_METADATA_KEYS,settlementAccountFields,settlementPolicyBindings}=require('./financeSettlementPolicy');
const failure=code=>Object.assign(new Error('CLOUD_PERSONAL_FINANCE_'+code),{code:'CLOUD_PERSONAL_FINANCE_'+code});
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max=512)=>{if(typeof v!=='string'||!v.trim()||v!==v.trim()||v.length>max)throw failure('INPUT_INVALID');return v;};
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:stable(v)).digest('hex');
const id=prefix=>prefix+'_'+crypto.randomUUID();
function transactionIdentity(provider,record,fileHash,ordinal){
 if(!record.sourceTransactionId)return hash({fileHash,ordinal});
 // Alipay can reuse a payment order number for a zero-value, non-cash refund.
 // Keep both events without weakening completed-payment amount/direction checks.
 const refundEvent=provider==='alipay'&&record.kind==='refund'&&record.amountMinor==='0'&&record.direction==='neutral'
  ?{event:'zero_non_cash_refund',occurredAt:record.occurredAt}:{};
 return hash({provider,transaction:record.sourceTransactionId,...refundEvent});
}
function scope(input){const a=input?.actor;if(!object(a)||typeof a.accountId!=='string'||!a.accountId.trim()||!Array.isArray(a.roles)||!a.roles.some(r=>['teacher','super_admin'].includes(r)))throw failure('ACCESS_DENIED');return [text(input.tenantId,128),text(a.accountId)];}
const ACCOUNT_KEYS=['id','label','provider','type','maskedIdentifier','currency','openingBalanceMinor','openingDate','status','sourceProduct','balanceConvention','mortgage','installmentLoan','securitiesHistory','withdrawalFeeEstimation','settledLoanEpisodes','fundsRole','walletWithdrawalDestinations','historicalCardBindings','counterpartySettlement','creditFinancing','creditRepaymentBenefits','investmentIncomePolicy','recalledProductFunding','storedValueTopUps','observedDayBalances','termDeposit','wechatRefundEstimates','ownerWalletExpenseAttributions','ownerAlipayFundingDefaults',...POLICY_KEYS];
function accountData(value,accountId){
 if(!object(value)||Object.keys(value).some(k=>!ACCOUNT_KEYS.includes(k)&&!READ_METADATA_KEYS.includes(k)))throw failure('INPUT_INVALID');
 const account={id:accountId||value.id||id('finance_account'),label:value.label,provider:value.provider,type:value.type,maskedIdentifier:value.maskedIdentifier??'',currency:value.currency,openingBalanceMinor:value.openingBalanceMinor??null,openingDate:value.openingDate??null,status:value.status??'active'};
 if(value.balanceConvention!==undefined){if(value.balanceConvention!=='signed')throw failure('INPUT_INVALID');account.balanceConvention='signed';}
 if(value.counterpartySettlement!==undefined){if(account.type!=='receivable'||account.balanceConvention!=='signed'||value.sourceProduct!==undefined)throw failure('INPUT_INVALID');account.counterpartySettlement=require('../../shared/personal-finance/counterpartySettlements').validateCounterpartySettlement(value.counterpartySettlement);}
 if(value.creditFinancing!==undefined){if(account.type!=='credit_card'||account.currency!=='CNY'||value.sourceProduct!==undefined)throw failure('INPUT_INVALID');account.creditFinancing=require('../../shared/personal-finance/creditFinancing').validateCreditFinancing(value.creditFinancing);}
 if(value.fundsRole!==undefined){if(!['personal','studio_public'].includes(value.fundsRole))throw failure('INPUT_INVALID');account.fundsRole=value.fundsRole;}
 if(value.walletWithdrawalDestinations!==undefined){if(account.type!=='wallet'||!['alipay','wechat'].includes(account.provider)||account.currency!=='CNY')throw failure('INPUT_INVALID');account.walletWithdrawalDestinations=require('../../shared/personal-finance/walletWithdrawalDestinations').validateWithdrawalDestinations(value.walletWithdrawalDestinations);}
 if(value.historicalCardBindings!==undefined){account.historicalCardBindings=require('../../shared/personal-finance/historicalCardBindings').validateHistoricalCardBindings(value.historicalCardBindings);const bankTargets=account.type==='debit_card'&&account.historicalCardBindings.rules.every(r=>require('../../shared/personal-finance/historicalCardBindings').statementTargetPolicy(account,r));if(!bankTargets&&(account.type!=='wallet'||!['alipay','wechat','jd'].includes(account.provider)))throw failure('INPUT_INVALID');if(account.provider==='jd'&&account.historicalCardBindings.rules.some(r=>r.usage!=='funding'||!r.sourceTransactionIds))throw failure('INPUT_INVALID');}
 if(value.sourceProduct!==undefined){const product=ACCOUNT_PRODUCTS[value.sourceProduct];if(!product||product.provider!==account.provider||product.type!==account.type)throw failure('INPUT_INVALID');account.sourceProduct=value.sourceProduct;}
 if(value.recalledProductFunding!==undefined&&value.recalledProductFunding!==null){if(account.type!=='wallet'||account.provider!=='alipay'||account.currency!=='CNY'||account.sourceProduct)throw failure('INPUT_INVALID');account.recalledProductFunding=require('../../shared/personal-finance/recalledProductFunding').validateRecalledProductFunding(value.recalledProductFunding);}
 if(value.observedDayBalances!==undefined&&value.observedDayBalances!==null)account.observedDayBalances=require('../../shared/personal-finance/observedDayBalances').validateObservedDayBalances(value.observedDayBalances,account);
 if(value.ownerAlipayFundingDefaults!==undefined&&value.ownerAlipayFundingDefaults!==null)account.ownerAlipayFundingDefaults=require('../../shared/personal-finance/ownerAlipayFundingDefaults').validateOwnerAlipayFundingDefaults(value.ownerAlipayFundingDefaults,account);
 if(value.ownerWalletExpenseAttributions!==undefined&&value.ownerWalletExpenseAttributions!==null)account.ownerWalletExpenseAttributions=require('../../shared/personal-finance/ownerWalletExpenseAttributions').validateOwnerWalletExpenseAttributions(value.ownerWalletExpenseAttributions,account);
 if(value.wechatRefundEstimates!==undefined&&value.wechatRefundEstimates!==null)account.wechatRefundEstimates=require('../../shared/personal-finance/wechatRefundEstimates').validateWechatRefundEstimates(value.wechatRefundEstimates,account);
 if(value.storedValueTopUps!==undefined&&value.storedValueTopUps!==null){if(!require('../../shared/personal-finance/storedValueTopUps').storedValueSourceValid(account))throw failure('INPUT_INVALID');account.storedValueTopUps=require('../../shared/personal-finance/storedValueTopUps').validateStoredValueTopUps(value.storedValueTopUps);}
 if(value.creditRepaymentBenefits!==undefined){if(!require('../../shared/personal-finance/productRepaymentBenefits').benefitSourceValid(account))throw failure('INPUT_INVALID');account.creditRepaymentBenefits=require('../../shared/personal-finance/productRepaymentBenefits').validateCreditRepaymentBenefits(value.creditRepaymentBenefits);}
 if(value.mortgage!==undefined){if(!object(value.mortgage)||account.type!=='loan'||account.currency!=='CNY'||value.mortgage.sourceAccountId===account.id)throw failure('INPUT_INVALID');account.mortgage=validateMortgage(value.mortgage);}
 if(value.installmentLoan!==undefined){if(value.mortgage!==undefined||account.type!=='loan'||account.currency!=='CNY'||value.installmentLoan.sourceAccountId===account.id)throw failure('INPUT_INVALID');account.installmentLoan=validateInstallmentLoan(value.installmentLoan);}
 if(value.termDeposit!==undefined){if(account.type!=='savings'||account.currency!=='CNY'||account.maskedIdentifier!==''||value.sourceProduct!==undefined)throw failure('INPUT_INVALID');account.termDeposit=require('../../shared/personal-finance/bankTermDeposits').validateTermDeposit(value.termDeposit);}
 if(value.investmentIncomePolicy!==undefined){if(account.type!=='investment')throw failure('INPUT_INVALID');account.investmentIncomePolicy=require('../../shared/personal-finance/investmentIncomePolicy').validateInvestmentIncomePolicy(value.investmentIncomePolicy);}
 if(value.securitiesHistory!==undefined){if(account.type!=='investment'||account.currency!=='CNY'||account.sourceProduct)throw failure('INPUT_INVALID');account.securitiesHistory=validateSecuritiesHistory(value.securitiesHistory);}
 if(value.withdrawalFeeEstimation!==undefined){if(account.type!=='wallet'||account.currency!=='CNY'||account.provider!=='wechat')throw failure('INPUT_INVALID');account.withdrawalFeeEstimation=require('../../shared/personal-finance/withdrawalEstimates').validateWithdrawalEstimation(value.withdrawalFeeEstimation);}
 if(value.settledLoanEpisodes!==undefined){if(account.type!=='loan'||!['webank_weilidai','alipay_jiebei'].includes(account.sourceProduct)||account.currency!=='CNY'||value.mortgage!==undefined||value.installmentLoan!==undefined||value.settledLoanEpisodes.sourceAccountId===account.id)throw failure('INPUT_INVALID');account.settledLoanEpisodes=require('../../shared/personal-finance/settledLoanEpisodes').validateSettledLoanEpisodes(value.settledLoanEpisodes);}
 Object.assign(account,settlementAccountFields(value,account));
 text(account.id);text(account.label,128);text(account.provider,128);
 if(!['cash','bank','savings','debit_card','credit_card','wallet','loan','other','investment','insurance','receivable','property','precious_metal','retirement'].includes(account.type)||typeof account.maskedIdentifier!=='string'||account.maskedIdentifier.length>128||!/^[A-Z]{3}$/.test(account.currency||'')||!['active','archived'].includes(account.status))throw failure('INPUT_INVALID');
 if(account.openingBalanceMinor!==null && !(typeof account.openingBalanceMinor==='string'&&/^-?(0|[1-9]\d*)$/.test(account.openingBalanceMinor)))throw failure('INPUT_INVALID');
 if(account.openingDate!==null&&!validDate(account.openingDate)||account.openingBalanceMinor!==null&&account.openingDate===null)throw failure('INPUT_INVALID');return account;
}
function createPersonalFinanceRepository({query,transaction,parseBillFile,archiveSource,fundNavService}={}){
 if(typeof query!=='function'||typeof transaction!=='function'||typeof parseBillFile!=='function'||archiveSource!==undefined&&typeof archiveSource!=='function')throw failure('INPUT_INVALID');
 async function bindMortgage(q,owner,data,prior){
  if(POLICY_KEYS.some(k=>data[k]))settlementPolicyBindings(data,await readLedger(q,owner));
  if(data.creditFinancing){
   const ids=[...data.creditFinancing.drawdownObservationIds,...data.creditFinancing.receiptObservationIds],sources=await q('SELECT data FROM business.personal_finance_observations WHERE tenant_id=$1 AND account_id=$2 AND id=ANY($3::text[])',[...owner,ids]);
   if(sources.rows.length!==ids.length)throw failure('CREDIT_FINANCING_SOURCE_NOT_FOUND');
   const rows=sources.rows.map(r=>r.data),fundingIds=[...new Set(rows.map(o=>o.financialAccountId))],funding=[];for(const id of fundingIds)funding.push(id===data.id?data:await account(q,owner,id));
   const annotations=await q('SELECT DISTINCT ON(observation_id) observation_id,data FROM business.personal_finance_annotations WHERE tenant_id=$1 AND account_id=$2 AND observation_id=ANY($3::text[]) ORDER BY observation_id,revision DESC',[...owner,ids]);
   const model=require('../../shared/personal-finance/creditFinancing').buildCreditFinancing(funding,rows,{annotatedIds:new Set(annotations.rows.filter(r=>!r.data?.reset).map(r=>r.observation_id))})[0];
   if(model?.status!=='reconciled_actual_records')throw failure('CREDIT_FINANCING_INVALID');
  }
  if(prior&&prior.counterpartySettlement&&(JSON.stringify(prior.counterpartySettlement)!==JSON.stringify(data.counterpartySettlement)||prior.currency!==data.currency||prior.type!==data.type||prior.balanceConvention!==data.balanceConvention)){
   const used=await q("SELECT id FROM business.personal_finance_annotations WHERE tenant_id=$1 AND account_id=$2 AND data->'patch'->>'settlementAccountId'=$3 LIMIT 1",[...owner,data.id]);
   if(used.rows.length)throw failure('ACCOUNT_IDENTITY_IMMUTABLE');
  }
  if(data.termDeposit){const target=await account(q,owner,data.termDeposit.bankAccountId);if(!require('../../shared/personal-finance/bankTermDeposits').termDepositBindingValid(data,target))throw failure('TERM_DEPOSIT_BANK_ACCOUNT_INVALID');}
  if(data.walletWithdrawalDestinations)for(const rule of data.walletWithdrawalDestinations.rules){const target=await account(q,owner,rule.financialAccountId);if(!require('../../shared/personal-finance/walletWithdrawalDestinations').destinationBindingValid(data,target,rule))throw failure('WITHDRAWAL_DESTINATION_ACCOUNT_INVALID');}
  if(data.historicalCardBindings)for(const rule of data.historicalCardBindings.rules){const target=await account(q,owner,rule.financialAccountId);if(!require('../../shared/personal-finance/historicalCardBindings').historicalCardBindingValid(data,target,rule))throw failure('HISTORICAL_CARD_BINDING_ACCOUNT_INVALID');}
  if(data.ownerAlipayFundingDefaults)for(const rule of data.ownerAlipayFundingDefaults.rules){const target=rule.financialAccountId===data.id?data:await account(q,owner,rule.financialAccountId);if(!require('../../shared/personal-finance/ownerAlipayFundingDefaults').targetValid(data,target))throw failure('OWNER_ALIPAY_DEFAULT_FUNDING_ACCOUNT_INVALID');}
  if(data.recalledProductFunding)for(const rule of data.recalledProductFunding.rules){const target=await account(q,owner,rule.financialAccountId);if(!require('../../shared/personal-finance/recalledProductFunding').recalledProductFundingValid(data,target,rule))throw failure('RECALLED_PRODUCT_FUNDING_ACCOUNT_INVALID');}
  if(data.storedValueTopUps)for(const rule of data.storedValueTopUps.rules){const target=await account(q,owner,rule.receivingAccountId);if(!require('../../shared/personal-finance/storedValueTopUps').storedValueAccountsValid(data,target))throw failure('STORED_VALUE_TOP_UP_ACCOUNT_INVALID');}
  if(data.creditRepaymentBenefits)for(const rule of data.creditRepaymentBenefits.rules){const target=await account(q,owner,rule.receivingAccountId);if(!require('../../shared/personal-finance/productRepaymentBenefits').benefitAccountValid(data,target))throw failure('REPAYMENT_BENEFIT_ACCOUNT_INVALID');}
  if(data.settledLoanEpisodes){const funding=await account(q,owner,data.settledLoanEpisodes.sourceAccountId);if(funding.type!==(data.sourceProduct==='alipay_jiebei'?'wallet':'debit_card')||data.sourceProduct==='alipay_jiebei'&&funding.provider!=='alipay'||funding.currency!==data.currency||funding.status!=='active')throw failure('MORTGAGE_FUNDING_ACCOUNT_INVALID');}
  if(data.installmentLoan){const funding=await account(q,owner,data.installmentLoan.sourceAccountId);if(!['bank','savings','debit_card'].includes(funding.type)||funding.currency!==data.currency||funding.status!=='active')throw failure('MORTGAGE_FUNDING_ACCOUNT_INVALID');}
  if(!data.mortgage)return;
  const funding=await account(q,owner,data.mortgage.sourceAccountId);
  if(!['bank','savings','debit_card'].includes(funding.type)||funding.currency!==data.currency||funding.status!=='active')throw failure('MORTGAGE_FUNDING_ACCOUNT_INVALID');
  const others=await q("SELECT id FROM business.personal_finance_accounts WHERE tenant_id=$1 AND account_id=$2 AND id<>$3 AND data->>'status'='active' AND data->'mortgage'->>'sourceAccountId'=$4 AND data->'mortgage'->>'loanType'=$5 AND data->'mortgage'->>'statementReference'=$6",[...owner,data.id,data.mortgage.sourceAccountId,data.mortgage.loanType,data.mortgage.statementReference]);
  if(others.rows.length)throw failure('MORTGAGE_ACCOUNT_EXISTS');
  if(data.mortgage.recentSplit?.month===null){const sources=await q('SELECT data FROM business.personal_finance_observations WHERE tenant_id=$1 AND account_id=$2 AND financial_account_id=$3',[...owner,funding.id]);data.mortgage=bindMortgageCalibration(data.mortgage,sources.rows.map(r=>r.data));}
 }
 async function lock(q,owner,expectedRevision){
  await q('INSERT INTO business.personal_finance_owners(tenant_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING',owner);
  const row=(await q('SELECT revision::text AS revision FROM business.personal_finance_owners WHERE tenant_id=$1 AND account_id=$2 FOR UPDATE',owner)).rows[0];
  if(!row)throw failure('UNAVAILABLE');
  if(expectedRevision!==undefined){if(!/^(0|[1-9]\d*)$/.test(String(expectedRevision)))throw failure('INPUT_INVALID');if(String(expectedRevision)!==row.revision)throw failure('REVISION_CONFLICT');}return row.revision;
 }
 async function account(q,owner,financialAccountId){const result=await q('SELECT data FROM business.personal_finance_accounts WHERE tenant_id=$1 AND account_id=$2 AND id=$3',[...owner,text(financialAccountId)]);if(!result.rows[0])throw failure('ACCOUNT_NOT_FOUND');return result.rows[0].data;}
 async function changed(q,owner,action,data){const row=(await q('UPDATE business.personal_finance_owners SET revision=revision+1 WHERE tenant_id=$1 AND account_id=$2 RETURNING revision::text AS revision',owner)).rows[0];await q('INSERT INTO business.personal_finance_audit(id,tenant_id,account_id,revision,action,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[id('finance_audit'),...owner,row.revision,action,JSON.stringify(data)]);return row.revision;}
 function fileInput(input){text(input.filename,256);if(/[\\/\x00-\x1f]/.test(input.filename))throw failure('INPUT_INVALID');if(typeof input.base64!=='string'||input.base64.length>28*1024*1024||input.base64.length%4!==0||/[^A-Za-z0-9+/=]/.test(input.base64))throw failure('INPUT_INVALID');const buffer=Buffer.from(input.base64,'base64');if(!buffer.length||buffer.length>20*1024*1024||buffer.toString('base64')!==input.base64)throw failure('INPUT_INVALID');return buffer;}
 async function parse(input,owner,buffer,q=query){
  const selected=input.financialAccountId?await account(q,owner,input.financialAccountId):null;if(selected&&selected.status!=='active')throw failure('ACCOUNT_ARCHIVED');
  let result=await parseBillFile({filename:input.filename,buffer,fieldMapping:input.fieldMapping,password:input.password});
  if(!object(result)||!Array.isArray(result.records)||!Array.isArray(result.errors)||!Array.isArray(result.warnings)||result.records.length>10000)throw failure('IMPORT_INVALID');
  const network=result.provider==='unionpay'&&result.templateId==='unionpay-network-capture-v1';
  if(network&&!result.errors.length){
   if(!result.records.every(r=>r.bankNetwork))throw failure('IMPORT_INVALID');
   const owned=(await q('SELECT data FROM business.personal_finance_accounts WHERE tenant_id=$1 AND account_id=$2',owner)).rows.map(row=>row.data);
   const bound=require('../../shared/personal-finance/unionpayNetworkStatement').bindUnionpayNetworkAccounts(result.records,owned);
   result={...result,records:bound.records,errors:[...result.errors,...bound.errors],accountIdentity:bound.records.find(r=>r.bankAccount)?.bankAccount};
  }else if(!network&&result.records.some(r=>r.bankNetwork))throw failure('IMPORT_INVALID');
  const errors=[...result.errors];for(let i=0;i<result.records.length;i++)try{validateRecord(result.records[i]);if(selected&&!result.records[i].bankAccount&&result.records[i].currency!==selected.currency)throw failure('CURRENCY_MISMATCH');}catch(error){errors.push({row:i+1,code:error.code||'CLOUD_PERSONAL_FINANCE_INPUT_INVALID'});}
  let statementOwner;try{if(result.statementOwner){if(!['ccb','huaxia','hangzhou','spdb'].includes(result.provider)||result.templateId!==result.provider+'-debit-v1')throw failure('STATEMENT_OWNER_INVALID');statementOwner=validateStatementOwner(result.statementOwner);}}catch(error){errors.push({row:1,code:error.code||'CLOUD_PERSONAL_FINANCE_STATEMENT_OWNER_INVALID'});}
  let statementAccountIdentities;try{if(result.statementAccountIdentities){if(!['ccb','webank','spdb'].includes(result.provider)||result.templateId!==result.provider+'-debit-v1')throw failure('STATEMENT_IDENTITIES_INVALID');const value=require('../../shared/personal-finance/statementAccountIdentities').validateStatementAccountIdentities(result.statementAccountIdentities),ids=new Set(result.records.map(r=>r.sourceTransactionId));if(value.ownMaskedIdentifier!==result.accountIdentity?.maskedIdentifier||value.counterpartFingerprints.some(e=>!ids.has(e.sourceTransactionId)))throw failure('STATEMENT_IDENTITIES_INVALID');statementAccountIdentities=value;}}catch(error){errors.push({row:1,code:error.code||'CLOUD_PERSONAL_FINANCE_STATEMENT_IDENTITIES_INVALID'});}
  const preview={provider:text(result.provider,128),templateId:result.templateId===null?null:text(result.templateId,128),records:result.records,errors,warnings:result.warnings,fileHash:hash(buffer),...(statementOwner?{statementOwner}:{}),...(statementAccountIdentities?{statementAccountIdentities}:{}),...(result.accountIdentity?{accountIdentity:result.accountIdentity}:{})};
  const resolved=await resolution(input,owner,preview,q);
  return {...preview,accountResolution:selected?{status:'matched',account:selected,explicit:true}:resolved.accountResolution,relatedAccountResolutions:resolved.relatedAccountResolutions,bankAccountResolutions:resolved.bankAccountResolutions};
 }
 async function resolution(input,owner,preview,q=query){
  const accounts=preview.errors?.length||!preview.records?.length?[]:(await q('SELECT data FROM business.personal_finance_accounts WHERE tenant_id=$1 AND account_id=$2',owner)).rows.map(row=>row.data);
  const identities=[...new Map((preview.errors.length?[]:preview.records).filter(r=>r.bankAccount).map(r=>[bankAccountKey(r.bankAccount),r.bankAccount])).values()];
  const network=preview.provider==='unionpay'&&preview.templateId==='unionpay-network-capture-v1';
  const bankAccountResolutions=identities.map(identity=>{
   if(!network)return {key:bankAccountKey(identity),identity,...resolveBankAccount({identity,accounts,owner})};
   const matches=accounts.filter(a=>a.provider===identity.provider&&a.type===identity.type&&a.maskedIdentifier===identity.maskedIdentifier&&a.currency===identity.currency&&a.status==='active');
   return {key:bankAccountKey(identity),identity,...(matches.length===1?{status:'matched',account:matches[0]}:{status:matches.length?'ambiguous':'manual',candidates:matches})};
  });
  return {bankAccountResolutions,accountResolution:resolveBillAccount({preview,accounts,owner,selectedAccountId:input.financialAccountId}),relatedAccountResolutions:resolveRelatedBillAccounts({preview,accounts,owner,selectedRelatedAccountIds:input.relatedFinancialAccountIds})};
 }
 async function discover(q,owner,revision){
   const accounts=(await q('SELECT data FROM business.personal_finance_accounts WHERE tenant_id=$1 AND account_id=$2',owner)).rows.map(r=>r.data);
   const observations=(await q('SELECT data FROM business.personal_finance_observations WHERE tenant_id=$1 AND account_id=$2',owner)).rows.map(r=>r.data);
   const proposal=accountProposals({accounts,observations}),created=[];
   for(const {key,...spec} of proposal.accounts){
    const data=accountData({...spec,id:'finance_account_'+hash({owner,key}).slice(0,32)});
    await q('INSERT INTO business.personal_finance_accounts(id,tenant_id,account_id,data) VALUES($1,$2,$3,$4::jsonb)',[data.id,...owner,JSON.stringify(data)]);
    revision=await changed(q,owner,'account_discovered_from_statements',{account:data,evidenceKey:key});created.push(data);
   }
   return {accounts:created,unresolved:proposal.unresolved,revision};
 }
 // JSON aggregation preserves one statement snapshot without retaining a second
 // expanded binary tree for the complete source ledger in PostgreSQL memory.
 async function readLedger(q,owner){const result=await q(`SELECT json_build_object(
   'revision',COALESCE((SELECT revision::text FROM business.personal_finance_owners WHERE tenant_id=$1 AND account_id=$2),'0'),
   'accounts',COALESCE((SELECT json_agg(data ORDER BY ledger_ordinal NULLS LAST,id) FROM business.personal_finance_accounts WHERE tenant_id=$1 AND account_id=$2),'[]'::json),
   'observations',COALESCE((SELECT json_agg(data ORDER BY ledger_ordinal NULLS LAST,data->>'occurredAt',id) FROM business.personal_finance_observations WHERE tenant_id=$1 AND account_id=$2),'[]'::json),
   'annotations',COALESCE((SELECT json_agg(data ORDER BY ledger_ordinal NULLS LAST,revision,id) FROM business.personal_finance_annotations WHERE tenant_id=$1 AND account_id=$2),'[]'::json),
   'links',COALESCE((SELECT json_agg(data ORDER BY ledger_ordinal NULLS LAST,id) FROM business.personal_finance_links WHERE tenant_id=$1 AND account_id=$2),'[]'::json),
   'balanceSnapshots',COALESCE((SELECT json_agg(data ORDER BY ledger_ordinal NULLS LAST,data->>'asOf',id) FROM business.personal_finance_balance_snapshots WHERE tenant_id=$1 AND account_id=$2),'[]'::json),
   'imports',COALESCE((SELECT json_agg(i.data||jsonb_build_object('observationIds',COALESCE((SELECT COALESCE(r.receipt->'importMemberships'->i.id,r.receipt->'observationIds') FROM business.personal_finance_receipts r WHERE r.tenant_id=i.tenant_id AND r.account_id=i.account_id AND (r.receipt->>'importId'=i.id OR r.receipt->'importMemberships' ? i.id)),'[]'::jsonb)) ORDER BY i.ledger_ordinal NULLS LAST,i.created_at,i.id) FROM business.personal_finance_imports i WHERE i.tenant_id=$1 AND i.account_id=$2),'[]'::json),
   'legacyRecords',COALESCE((SELECT json_agg(t.data) FROM (SELECT to_jsonb(r)||jsonb_build_object('legacyType','imported') AS data FROM business.personal_asset_records r WHERE tenant_id=$1 AND account_id=$2 UNION ALL SELECT to_jsonb(r)||jsonb_build_object('legacyType','manual') FROM business.personal_asset_manual_records r WHERE tenant_id=$1 AND account_id=$2 AND deleted=false) t),'[]'::json)) AS ledger`,owner);if(!result.rows[0])throw failure('UNAVAILABLE');return result.rows[0].ledger;}
 const api={
  async getRevision(input){const owner=scope(input),row=(await query('SELECT revision::text AS revision FROM business.personal_finance_owners WHERE tenant_id=$1 AND account_id=$2',owner)).rows[0];return row?.revision||'0';},
  async discoverAccounts(input){const owner=scope(input);return transaction(async q=>discover(q,owner,await lock(q,owner,input.expectedRevision)));},
  async getLedger(input){const ledger=await readLedger(query,scope(input));if(!fundNavService)return ledger;try{return{...ledger,investmentMarketData:await fundNavService.forLedger(ledger)};}catch{return{...ledger,investmentMarketData:{schema:'investment-market-data-v1',series:[],issues:[{reason:'FUND_NAV_UNAVAILABLE'}]}};}},
  async previewImport(input){const owner=scope(input),buffer=fileInput(input);return parse(input,owner,buffer);},
  async resolveImportAccount(input,preview){return resolution(input,scope(input),preview);},
  async import(input){const owner=scope(input),buffer=fileInput(input),key=text(input.idempotencyKey,256);const preview=await parse(input,owner,buffer);if(input.expectedFileHash!==undefined&&input.expectedFileHash!==preview.fileHash)throw failure('IMPORT_SOURCE_CHANGED');if(preview.errors.length||!preview.records.length)throw failure('IMPORT_INVALID');
   const requestHash=hash({financialAccountId:input.financialAccountId??null,...(input.expectedFinancialAccountId!==undefined?{expectedFinancialAccountId:input.expectedFinancialAccountId}:{}),...(input.relatedFinancialAccountIds!==undefined?{relatedFinancialAccountIds:input.relatedFinancialAccountIds}:{}),...(input.expectedRelatedFinancialAccountIds!==undefined?{expectedRelatedFinancialAccountIds:input.expectedRelatedFinancialAccountIds}:{}),fileHash:preview.fileHash,records:preview.records,fieldMapping:input.fieldMapping??null});
   if(input.expectedRevision!==undefined&&!/^(0|[1-9]\d*)$/.test(String(input.expectedRevision)))throw failure('INPUT_INVALID');
   return transaction(async q=>{const currentRevision=await lock(q,owner);const previous=(await q('SELECT request_hash,receipt FROM business.personal_finance_receipts WHERE tenant_id=$1 AND account_id=$2 AND idempotency_key=$3',[...owner,key])).rows[0];
    if(previous){if(previous.request_hash!==requestHash)throw failure('IDEMPOTENCY_CONFLICT');return {...previous.receipt,replayed:true};}
    if(input.expectedRevision!==undefined&&String(input.expectedRevision)!==currentRevision)throw failure('REVISION_CONFLICT');
    const resolutions=await resolution(input,owner,preview,q),related=resolutions.relatedAccountResolutions;
    const resolved=input.financialAccountId?{status:'matched',account:await account(q,owner,input.financialAccountId)}:resolutions.accountResolution;
    if(!['matched','create'].includes(resolved.status))throw failure(resolved.status==='archived'?'ACCOUNT_ARCHIVED':'ACCOUNT_SELECTION_REQUIRED');
    const bankResolutions=resolutions.bankAccountResolutions||[];if(bankResolutions.some(r=>!['matched','create'].includes(r.status)))throw failure('BANK_ACCOUNT_SELECTION_REQUIRED');
    const bankAccountIds=Object.fromEntries(bankResolutions.map(r=>[r.key,r.account.id]));
    const currentAccount=resolved.account,financialAccountId=currentAccount.id;if(input.expectedFinancialAccountId!==undefined&&input.expectedFinancialAccountId!==financialAccountId)throw failure('ACCOUNT_RESOLUTION_CHANGED');
    if(related.some(item=>!['matched','create'].includes(item.status)))throw failure('RELATED_ACCOUNT_SELECTION_REQUIRED');
    const relatedFinancialAccountIds=Object.fromEntries(related.map(item=>[item.product,item.account.id]));
    if(input.expectedRelatedFinancialAccountIds!==undefined){if(!object(input.expectedRelatedFinancialAccountIds)||Object.keys(input.expectedRelatedFinancialAccountIds).some(product=>input.expectedRelatedFinancialAccountIds[product]!==relatedFinancialAccountIds[product])||Object.keys(relatedFinancialAccountIds).some(product=>input.expectedRelatedFinancialAccountIds[product]!==relatedFinancialAccountIds[product]))throw failure('ACCOUNT_RESOLUTION_CHANGED');}
    if(currentAccount.status!=='active')throw failure('ACCOUNT_ARCHIVED');if(preview.records.some(r=>r.bankAccount?r.currency!==r.bankAccount.currency:r.currency!==currentAccount.currency))throw failure('CURRENCY_MISMATCH');if(!archiveSource)throw failure('SOURCE_ARCHIVE_UNAVAILABLE');
    validateBrokerageAccount(currentAccount,preview.records,preview.provider);
    validateWithdrawalFeeAccount(currentAccount,preview.records);
    require('../../shared/personal-finance/loanProofs').validateLoanProofAccount(currentAccount,preview.records);
    if(bankResolutions.length&&bankAccountIds[bankAccountKey(preview.accountIdentity)]!==financialAccountId)throw failure('BANK_ACCOUNT_MISMATCH');
    const accountCreations=[...new Map([resolved,...related,...bankResolutions].map(r=>[r.account.id,r])).values()];
    for(const item of accountCreations)if(item.status==='create'){const data=accountData(item.account);await q('INSERT INTO business.personal_finance_accounts(id,tenant_id,account_id,data) VALUES($1,$2,$3,$4::jsonb)',[data.id,...owner,JSON.stringify(data)]);await changed(q,owner,'account_auto_create',data);}
    const archiveReference=await archiveSource({tenantId:owner[0],ownerAccountId:owner[1],filename:input.filename,buffer,fileHash:preview.fileHash});if(!object(archiveReference)||archiveReference.fileHash!==preview.fileHash||typeof archiveReference.id!=='string')throw failure('SOURCE_ARCHIVE_UNAVAILABLE');
    const importId=id('finance_import'),importData={id:importId,financialAccountId:financialAccountId,provider:preview.provider,templateId:preview.templateId,filename:input.filename,fileHash:preview.fileHash,archiveReference,...(preview.statementOwner?{statementOwner:preview.statementOwner}:{}),...(preview.statementAccountIdentities?{statementAccountIdentities:preview.statementAccountIdentities}:{}),...(bankResolutions.length?{bankFinancialAccountIds:bankAccountIds}:{}),recordCount:preview.records.length,createdAt:new Date().toISOString(),observationIds:[]};
    const importByAccount=new Map([[financialAccountId,importId]]),accountCounts=new Map();
    for(const record of preview.records){const target=record.bankAccount?bankAccountIds[bankAccountKey(record.bankAccount)]:financialAccountId;accountCounts.set(target,(accountCounts.get(target)||0)+1);if(!importByAccount.has(target))importByAccount.set(target,id('finance_import'));}
    for(const [target,accountImportId]of importByAccount){const data={...importData,id:accountImportId,financialAccountId:target,recordCount:accountCounts.get(target)||0};await q('INSERT INTO business.personal_finance_imports(id,tenant_id,account_id,financial_account_id,file_hash,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[accountImportId,...owner,target,preview.fileHash,JSON.stringify(data)]);}
    let insertedCount=0;const observationIds=[];
    for(let ordinal=0;ordinal<preview.records.length;ordinal++){
     const original=preview.records[ordinal],financialAccountId=original.bankAccount?bankAccountIds[bankAccountKey(original.bankAccount)]:currentAccount.id;
     if(!financialAccountId)throw failure('BANK_ACCOUNT_SELECTION_REQUIRED');
     const r=original.accountRelations?.length?{...original,accountRelations:original.accountRelations.map(relation=>({...relation,financialAccountId:relatedFinancialAccountIds[relation.product]}))}:original,sourceIdentity=transactionIdentity(preview.provider,r,preview.fileHash,ordinal),recordFingerprint=hash(r),sourceKey=hash({sourceIdentity,recordFingerprint});
     const priorVersions=(await q('SELECT id,data FROM business.personal_finance_observations WHERE tenant_id=$1 AND account_id=$2 AND financial_account_id=$3 AND transaction_key=$4',[...owner,financialAccountId,sourceIdentity])).rows;
     const prior=priorVersions.find(p=>p.data.recordFingerprint===recordFingerprint);if(prior){observationIds.push(prior.id);continue;}
     if(priorVersions.some(p=>p.data.status==='completed'&&['amountMinor','currency','direction'].some(k=>p.data[k]!==r[k])))throw failure('SOURCE_TRANSACTION_CONFLICT');
     const accountImportId=importByAccount.get(financialAccountId);
     const observation={...r,id:id('finance_observation'),financialAccountId:financialAccountId,provider:preview.provider,importId:accountImportId,sourceOrdinal:ordinal+1,recordFingerprint,sourceIdentity,sourceVersionOrdinal:priorVersions.length+1};
     await q('INSERT INTO business.personal_finance_observations(id,tenant_id,account_id,financial_account_id,import_id,source_key,transaction_key,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[observation.id,...owner,financialAccountId,accountImportId,sourceKey,sourceIdentity,JSON.stringify(observation)]);observationIds.push(observation.id);insertedCount++;
    }
    await discover(q,owner,currentRevision);
    // Import memberships remain in the receipt; source observations are immutable, including their first import.
    const importMemberships=Object.fromEntries([...importByAccount.values()].map(id=>[id,[]]));
    for(let i=0;i<preview.records.length;i++){const r=preview.records[i],target=r.bankAccount?bankAccountIds[bankAccountKey(r.bankAccount)]:financialAccountId;importMemberships[importByAccount.get(target)].push(observationIds[i]);}
    const revision=await changed(q,owner,'import',{importId,observationIds,archiveReference});const receipt={...(bankResolutions.length?{importMemberships}:{}),importId,financialAccountId:financialAccountId,relatedFinancialAccountIds,recordCount:preview.records.length,insertedCount,observationIds,fileHash:preview.fileHash,revision,createdAt:importData.createdAt,replayed:false};
    await q('INSERT INTO business.personal_finance_receipts(tenant_id,account_id,idempotency_key,request_hash,receipt) VALUES($1,$2,$3,$4,$5::jsonb)',[...owner,key,requestHash,JSON.stringify(receipt)]);return receipt;
   });},
  async createAccount(input){const owner=scope(input),data=accountData(input.account);return transaction(async q=>{await lock(q,owner,input.expectedRevision);const exists=await q('SELECT id FROM business.personal_finance_accounts WHERE tenant_id=$1 AND account_id=$2 AND id=$3',[...owner,data.id]);if(exists.rows.length)throw failure('ACCOUNT_EXISTS');await bindMortgage(q,owner,data);await q('INSERT INTO business.personal_finance_accounts(id,tenant_id,account_id,data) VALUES($1,$2,$3,$4::jsonb)',[data.id,...owner,JSON.stringify(data)]);return {account:data,revision:await changed(q,owner,'account_create',data)};});},
  async updateAccount(input){const owner=scope(input);if(!object(input.patch)||Object.keys(input.patch).some(k=>!ACCOUNT_KEYS.includes(k)||k==='id'))throw failure('INPUT_INVALID');return transaction(async q=>{await lock(q,owner,input.expectedRevision);const prior=await account(q,owner,input.id),data=accountData({...prior,...input.patch},input.id);if(data.balanceConvention!==prior.balanceConvention)throw failure('ACCOUNT_IDENTITY_IMMUTABLE');if(data.currency!==prior.currency||data.type!==prior.type||data.provider!==prior.provider||data.maskedIdentifier!==prior.maskedIdentifier||data.sourceProduct!==prior.sourceProduct||data.balanceConvention!==prior.balanceConvention) {const existing=await q("SELECT id FROM business.personal_finance_observations WHERE tenant_id=$1 AND account_id=$2 AND (financial_account_id=$3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(data->'accountRelations','[]'::jsonb)) relation WHERE relation->>'financialAccountId'=$3)) LIMIT 1",[...owner,input.id]);if(existing.rows.length)throw failure('ACCOUNT_IDENTITY_IMMUTABLE');}await bindMortgage(q,owner,data,prior);await q('UPDATE business.personal_finance_accounts SET data=$4::jsonb WHERE tenant_id=$1 AND account_id=$2 AND id=$3',[...owner,input.id,JSON.stringify(data)]);return {account:data,revision:await changed(q,owner,'account_update',{before:prior,after:data})};});},
  async annotateObservation(input){
   const owner=scope(input),allowed=['category','kind','principalMinor','interestMinor','feeMinor','settlementAccountId','assetAllocation','paymentAllocation','commercePayment','recalledAccountRoute','medicalSettlement','conversionTargetEstimate'];text(input.observationId);
   if(!object(input.patch)||Object.keys(input.patch).some(k=>!allowed.includes(k)))throw failure('INPUT_INVALID');
   const reset=Object.keys(input.patch).length===0;
   return transaction(async q=>{
    await lock(q,owner,input.expectedRevision);
    const source=(await q('SELECT data FROM business.personal_finance_observations WHERE tenant_id=$1 AND account_id=$2 AND id=$3',[...owner,input.observationId])).rows[0];if(!source)throw failure('OBSERVATION_NOT_FOUND');
    const previous=(await q('SELECT data FROM business.personal_finance_annotations WHERE tenant_id=$1 AND account_id=$2 AND observation_id=$3 ORDER BY revision DESC LIMIT 1',[...owner,input.observationId])).rows[0];
    const patch=reset?{}:{...(previous?.data.patch||{}),...input.patch};let effective={...source.data,...patch};validateRecord(effective);
    const financialAccount=await account(q,owner,source.data.financialAccountId);
    if(!reset&&patch.conversionTargetEstimate!==undefined)require('../../shared/personal-finance/fundTargetConversions').validateConversionTargetEstimatePolicy(patch.conversionTargetEstimate,source.data);
    if(!reset&&patch.medicalSettlement!==undefined&&patch.medicalSettlement!==null){const ledger=await readLedger(q,owner);effective=require('../../shared/personal-finance/medicalSettlements').confirmedMedicalSettlement(source.data,{patch},ledger.accounts,{links:ledger.links||[]});validateRecord(effective);}
    if(!reset&&patch.recalledAccountRoute){const ledger=await readLedger(q,owner);effective=require('../../shared/personal-finance/recalledAccountRoutes').recalledAccountRoute(source.data,{patch},ledger);}
    if(!reset&&require('../../shared/personal-finance/ownerAlipayBankDestinations').isAnnotation({patch})){const ledger=await readLedger(q,owner);effective=require('../../shared/personal-finance/ownerAlipayBankDestinations').ownerAlipayBankDestination(source.data,{patch},ledger.accounts);}
    if(!reset&&require('../../shared/personal-finance/restrictedCoupons').isRestrictedCouponAnnotation({patch})){const coupon=require('../../shared/personal-finance/restrictedCoupons').ownerConfirmedRestrictedCoupon(source.data,{patch},[financialAccount]);if(!coupon)throw failure('NON_CASH_COUPON_EVIDENCE_INVALID');effective=coupon;}
    if(!reset)effective=require('../../shared/personal-finance/confirmedPlatformReceipts').confirmedPlatformIncomeReceipt(source.data,{patch},[financialAccount])||effective;
    if(!reset&&patch.paymentAllocation!==undefined&&patch.paymentAllocation!==null){const ledger=await readLedger(q,owner);require('../../shared/personal-finance/paymentAllocations').paymentAllocation(source.data,{patch},ledger.accounts,ledger.observations);}
    if(!reset&&patch.commercePayment!==undefined&&patch.commercePayment!==null){const ledger=await readLedger(q,owner);require('../../shared/personal-finance/commercePaymentBenefits').commercePaymentBenefit(source.data,{patch},ledger.accounts,ledger.observations);}
    if(!reset&&patch.assetAllocation!==undefined&&patch.assetAllocation!==null){text(patch.assetAllocation.financialAccountId);const target=await account(q,owner,patch.assetAllocation.financialAccountId);if(target.status!=='active')throw failure('EXPENSE_ASSET_ALLOCATION_INVALID');require('../../shared/personal-finance/expenseAssetAllocations').expenseAssetAllocation(source.data,{patch},[target]);}
    if(!reset&&patch.settlementAccountId!==undefined&&patch.settlementAccountId!==null){
     text(patch.settlementAccountId);const target=await account(q,owner,patch.settlementAccountId);if(target.status!=='active'||!['cash','bank','savings','debit_card','credit_card','wallet'].includes(financialAccount.type))throw failure('COUNTERPARTY_SETTLEMENT_INVALID');
     if(source.data.direction==='neutral'){
      const ledger=await readLedger(q,owner),helper=require('../../shared/personal-finance/nativeMerchantSettlements');
      // Validate the proposed cumulative edit inside the same owner lock. Neither
      // proof IDs nor the derived cash direction are accepted from the client.
      ledger.annotations.push({observationId:input.observationId,patch,revision:String(BigInt(input.expectedRevision??ledger.revision??'0')+1n)});
      const sponsor=require('../../shared/personal-finance/nativeSponsoredSettlements'),merchantFee=require('../../shared/personal-finance/nativeMerchantServiceFees'),guarantee=require('../../shared/personal-finance/nativeGuaranteeSettlements');effective=guarantee.isNativeGuarantee(source.data)?guarantee.validateNativeGuaranteeSettlement(source.data,{patch},ledger):merchantFee.isNativeMerchantServiceFee(source.data)?merchantFee.validateNativeMerchantFeeAllocation(source.data,{patch},ledger):sponsor.annotationRole({patch})?sponsor.validateNativeSponsoredAnnotation(source.data,{patch},ledger):helper.nativeMerchantSettlement(source.data,{patch},ledger.accounts,ledger.observations,helper.settlementCashProofs(ledger));
     }else require('../../shared/personal-finance/counterpartySettlements').annotatedSettlementAccount(source.data,{patch},[target]);
    }
    if(!reset&&(['income','refund','loan_drawdown'].includes(effective.kind)&&effective.direction!=='credit'||['expense','interest','fee'].includes(effective.kind)&&effective.direction!=='debit'||effective.kind==='debt_payment'&&effective.direction!=='debit'&&!['loan','credit_card'].includes(financialAccount.type)&&!patch.paymentAllocation&&effective.automaticRepaymentTarget?.method!=='owner_recalled_jd_repayment_product'))throw failure('INPUT_INVALID');
    const revision=await changed(q,owner,reset?'transaction_annotation_reset':'transaction_annotation',{observationId:input.observationId,before:previous?.data.patch||{},after:patch});
    const annotation={id:id('finance_annotation'),observationId:input.observationId,patch,...(reset?{reset:true}:{}),revision,createdAt:new Date().toISOString()};
    await q('INSERT INTO business.personal_finance_annotations(id,tenant_id,account_id,observation_id,revision,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[annotation.id,...owner,input.observationId,revision,JSON.stringify(annotation)]);
    return {annotation,revision};
   });
  },
  async createLink(input){const owner=scope(input),l=input.link;
   if(object(l)&&l.type==='group_distinct'){
    if(Object.keys(l).some(k=>!['type','observationIds','note'].includes(k))||!Array.isArray(l.observationIds)||l.observationIds.length<2||l.observationIds.length>128||new Set(l.observationIds).size!==l.observationIds.length||l.observationIds.some(i=>typeof i!=='string')||l.note!==undefined&&typeof l.note!=='string')throw failure('INPUT_INVALID');
    return transaction(async q=>{
     await lock(q,owner,input.expectedRevision);
     const ledger=await readLedger(q,owner),requested=[...l.observationIds].sort(),group=buildFinanceView(ledger).reconciliationGroups.find(g=>JSON.stringify(g.observationIds)===JSON.stringify(requested));
     if(!group)throw failure(l.observationIds.length<4?'INPUT_INVALID':'LINK_INCOMPATIBLE');
     const anchors=[group.platformRootIds[0],group.bankRootIds[0]],link={...l,observationIds:requested,id:id('finance_link'),note:l.note||'',status:'active',source:'manual',createdAt:new Date().toISOString()};
     await q('INSERT INTO business.personal_finance_links(id,tenant_id,account_id,observation_a,observation_b,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[link.id,...owner,...anchors,JSON.stringify(link)]);
     return {link,revision:await changed(q,owner,'link_create',link)};
    });
   }
   if(!object(l)||Object.keys(l).some(k=>!['type','observationIds','note'].includes(k))||!['duplicate','transfer','refund','distinct'].includes(l.type)||!Array.isArray(l.observationIds)||l.observationIds.length!==2||l.observationIds[0]===l.observationIds[1]||l.observationIds.some(i=>typeof i!=='string')||l.note!==undefined&&typeof l.note!=='string')throw failure('INPUT_INVALID');return transaction(async q=>{await lock(q,owner,input.expectedRevision);const sources=(await q('SELECT id,data FROM business.personal_finance_observations WHERE tenant_id=$1 AND account_id=$2 AND id=ANY($3::text[])',[...owner,l.observationIds])).rows;if(sources.length!==2)throw failure('OBSERVATION_NOT_FOUND');const annotationRows=(await q('SELECT DISTINCT ON(observation_id) observation_id,data FROM business.personal_finance_annotations WHERE tenant_id=$1 AND account_id=$2 AND observation_id=ANY($3::text[]) ORDER BY observation_id,revision DESC',[...owner,l.observationIds])).rows;const effective=sources.map(s=>({...s.data,...annotationRows.find(r=>r.observation_id===s.id)?.data.patch}));const [a,b]=effective;if(effective.some(s=>s.balanceEvidence)||a.currency!==b.currency||l.type==='duplicate'&&(a.amountMinor!==b.amountMinor||a.direction!==b.direction)||l.type==='transfer'&&(a.amountMinor!==b.amountMinor||a.direction===b.direction)||l.type==='refund'&&!effective.some(s=>s.kind==='refund'))throw failure('LINK_INCOMPATIBLE');
    const prior=await q("SELECT id FROM business.personal_finance_links WHERE tenant_id=$1 AND account_id=$2 AND status='active' AND LEAST(observation_a,observation_b)=LEAST($3,$4) AND GREATEST(observation_a,observation_b)=GREATEST($3,$4)",[...owner,...l.observationIds]);if(prior.rows.length)throw failure('LINK_EXISTS');
    const link={...l,id:id('finance_link'),note:l.note||'',status:'active',source:'manual',createdAt:new Date().toISOString()};await q('INSERT INTO business.personal_finance_links(id,tenant_id,account_id,observation_a,observation_b,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[link.id,...owner,...l.observationIds,JSON.stringify(link)]);return {link,revision:await changed(q,owner,'link_create',link)};});},
  async deleteLink(input){const owner=scope(input);text(input.id);return transaction(async q=>{await lock(q,owner,input.expectedRevision);const row=(await q('SELECT data FROM business.personal_finance_links WHERE tenant_id=$1 AND account_id=$2 AND id=$3',[...owner,input.id])).rows[0];if(!row)throw failure('LINK_NOT_FOUND');const link={...row.data,status:'deleted',deletedAt:new Date().toISOString()};await q("UPDATE business.personal_finance_links SET status='deleted',data=$4::jsonb WHERE tenant_id=$1 AND account_id=$2 AND id=$3",[...owner,input.id,JSON.stringify(link)]);return {link,revision:await changed(q,owner,'link_delete',{before:row.data,after:link})};});},
  async createBalanceSnapshot(input){const owner=scope(input),s=input.snapshot;if(!object(s)||s.balanceConvention!==undefined&&s.balanceConvention!=='signed'||Object.keys(s).some(k=>!['financialAccountId','asOf','balanceMinor','currency','source','sourceObservationId','note','balanceConvention'].includes(k))||typeof s.balanceMinor!=='string'||! /^-?(0|[1-9]\d*)$/.test(s.balanceMinor)||typeof s.asOf!=='string'||!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s.asOf)||Number.isNaN(Date.parse(s.asOf))||!['manual','statement'].includes(s.source)||s.source==='statement'&&!s.sourceObservationId||!/^[A-Z]{3}$/.test(s.currency||''))throw failure('INPUT_INVALID');return transaction(async q=>{await lock(q,owner,input.expectedRevision);const selected=await account(q,owner,s.financialAccountId);if(selected.currency!==s.currency)throw failure('CURRENCY_MISMATCH');if(s.sourceObservationId){const source=(await q('SELECT data FROM business.personal_finance_observations WHERE tenant_id=$1 AND account_id=$2 AND id=$3',[...owner,s.sourceObservationId])).rows[0];if(!source||source.data.financialAccountId!==s.financialAccountId)throw failure('OBSERVATION_NOT_FOUND');if(s.source==='statement'&&(source.data.balanceMinor!==s.balanceMinor||Date.parse(source.data.occurredAt)!==Date.parse(s.asOf)))throw failure('INPUT_INVALID');}if(s.source==='statement'&&s.balanceConvention!==undefined)throw failure('INPUT_INVALID');const snapshot={...s,id:id('finance_snapshot'),createdAt:new Date().toISOString()};await q('INSERT INTO business.personal_finance_balance_snapshots(id,tenant_id,account_id,financial_account_id,data) VALUES($1,$2,$3,$4,$5::jsonb)',[snapshot.id,...owner,s.financialAccountId,JSON.stringify(snapshot)]);return {snapshot,revision:await changed(q,owner,'balance_snapshot',snapshot)};});},
 };
 return Object.freeze(api);
}
module.exports={createPersonalFinanceRepository,validateFinanceAccount:accountData};
