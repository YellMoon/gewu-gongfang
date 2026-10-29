'use strict';
const {isSettlementAccount}=require('../../shared/personal-finance/counterpartySettlements');
const POLICY_KEYS=Object.freeze(['closedCashSettlement','closedActivityFundingScope','merchantSettlementReceivable']);
const READ_METADATA_KEYS=Object.freeze(['key','createdAt']);
const failure=code=>Object.assign(new Error('CLOUD_PERSONAL_FINANCE_'+code),{code:'CLOUD_PERSONAL_FINANCE_'+code});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max=512)=>typeof v==='string'&&v.length>0&&v.length<=max&&v===v.trim();
const day=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const instant=v=>text(v,64)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&day(v.slice(0,10))&&Number.isFinite(Date.parse(v));
const keys=(v,allowed)=>object(v)&&Object.keys(v).every(k=>allowed.includes(k));
const ids=(v,limit=10000)=>Array.isArray(v)&&v.length>0&&v.length<=limit&&v.every(id=>text(id))&&new Set(v).size===v.length;
const zeroScope=a=>isSettlementAccount(a)&&a.openingBalanceMinor==='0'&&day(a.openingDate);
function settlementAccountFields(value,account){
 const result={};
 if(value.key!==undefined){if(!account.sourceProduct||value.key!==account.sourceProduct+':'+account.currency)throw failure('ACCOUNT_METADATA_INVALID');result.key=value.key;}
 if(value.createdAt!==undefined){if(!instant(value.createdAt))throw failure('ACCOUNT_METADATA_INVALID');result.createdAt=value.createdAt;}
 const closed=value.closedCashSettlement;
 if(closed!==undefined&&closed!==null){
  if(!zeroScope(account)||!keys(closed,['schema','ownerConfirmedClosed','basis','openingBasis','transactionIds','sourceScope','scopePlatformLabels','ownerAuthorizationAt','reversible','externalFunding'])||closed.schema!=='closed-cash-settlement-v1'||closed.ownerConfirmedClosed!==true||closed.basis!=='owner_confirmed_aggregate_receipts_minus_outlays'||closed.openingBasis!=='zero_before_first_bound_movement'||!ids(closed.transactionIds)||closed.sourceScope!==undefined&&!text(closed.sourceScope)||closed.scopePlatformLabels!==undefined&&!ids(closed.scopePlatformLabels,64)||closed.ownerAuthorizationAt!==undefined&&!instant(closed.ownerAuthorizationAt)||closed.reversible!==undefined&&closed.reversible!==true)throw failure('CLOSED_SETTLEMENT_POLICY_INVALID');
  if(closed.externalFunding!==undefined&&(!Array.isArray(closed.externalFunding)||closed.externalFunding.length>128||new Set(closed.externalFunding.map(f=>f?.transactionId)).size!==closed.externalFunding.length||closed.externalFunding.some(f=>!keys(f,['transactionId','settlementAccountId','amountMinor','ownerConfirmedAppliedToActivity'])||!text(f.transactionId)||!text(f.settlementAccountId)||f.settlementAccountId===account.id||!text(f.amountMinor,32)||!/^([1-9]\d*)$/.test(f.amountMinor)||f.ownerConfirmedAppliedToActivity!==true||closed.transactionIds.includes(f.transactionId))))throw failure('CLOSED_SETTLEMENT_POLICY_INVALID');
  result.closedCashSettlement=structuredClone(closed);
 }
 const funding=value.closedActivityFundingScope;
 if(funding!==undefined&&funding!==null){if(!zeroScope(account)||!keys(funding,['schema','transactionId','ownerBasis','openingBasis'])||funding.schema!=='closed-activity-funding-v1'||!text(funding.transactionId)||!text(funding.ownerBasis)||!text(funding.openingBasis))throw failure('CLOSED_ACTIVITY_FUNDING_INVALID');result.closedActivityFundingScope=structuredClone(funding);}
 const merchant=value.merchantSettlementReceivable;
 if(merchant!==undefined&&merchant!==null){
  if(account.status!=='active'||account.type!=='receivable'||account.provider!=='alipay'||account.currency!=='CNY'||account.balanceConvention!=='signed'||account.openingBalanceMinor!=='0'||!day(account.openingDate)||!keys(merchant,['schema','scope','openingBasis','underlyingPlatformBalanceNotInferred','claims'])||merchant.schema!=='merchant-settlement-receivable-v1'||merchant.scope!=='bound_original_claims_only'||merchant.openingBasis!=='zero_before_first_bound_claim'||merchant.underlyingPlatformBalanceNotInferred!==true||!Array.isArray(merchant.claims)||!merchant.claims.length||merchant.claims.length>10000)throw failure('MERCHANT_SETTLEMENT_POLICY_INVALID');
  const used=new Set();for(const c of merchant.claims){const names=['collectionObservationId','withdrawalObservationId','bankReceiptObservationId','walletBalanceImportId','walletBalanceFileHash'];if(!keys(c,names)||!names.every(k=>text(c[k]))||!/^[a-f0-9]{64}$/.test(c.walletBalanceFileHash))throw failure('MERCHANT_SETTLEMENT_POLICY_INVALID');for(const id of[c.collectionObservationId,c.withdrawalObservationId,c.bankReceiptObservationId]){if(used.has(id))throw failure('MERCHANT_SETTLEMENT_POLICY_INVALID');used.add(id);}}
  result.merchantSettlementReceivable=structuredClone(merchant);
 }
 return result;
}
function settlementPolicyBindings(account,ledger){
 const observations=new Map((ledger.observations||[]).map(o=>[o.id,o])),imports=new Map((ledger.imports||[]).map(i=>[i.id,i])),accounts=new Map((ledger.accounts||[]).map(a=>[a.id,a]));accounts.set(account.id,account);
 const source=id=>{const o=observations.get(id);if(!o||o.currency!==account.currency)throw failure('SETTLEMENT_POLICY_SOURCE_NOT_FOUND');return o;};
 if(account.closedActivityFundingScope)source(account.closedActivityFundingScope.transactionId);
 if(account.closedCashSettlement){for(const id of account.closedCashSettlement.transactionIds)source(id);for(const f of account.closedCashSettlement.externalFunding||[]){source(f.transactionId);const peer=accounts.get(f.settlementAccountId);if(!peer||!isSettlementAccount(peer)||peer.currency!==account.currency||peer.openingBalanceMinor!=='0'||peer.closedActivityFundingScope?.transactionId!==f.transactionId)throw failure('SETTLEMENT_POLICY_COUNTER_ACCOUNT_INVALID');}}
 if(account.merchantSettlementReceivable)for(const c of account.merchantSettlementReceivable.claims){const collection=source(c.collectionObservationId),withdrawal=source(c.withdrawalObservationId),receipt=source(c.bankReceiptObservationId),document=imports.get(c.walletBalanceImportId);if(!document||document.fileHash!==c.walletBalanceFileHash||document.financialAccountId!==collection.financialAccountId||collection.financialAccountId!==withdrawal.financialAccountId||!accounts.has(collection.financialAccountId)||!accounts.has(receipt.financialAccountId))throw failure('MERCHANT_SETTLEMENT_SOURCE_INVALID');}
}
module.exports={POLICY_KEYS,READ_METADATA_KEYS,settlementAccountFields,settlementPolicyBindings};
