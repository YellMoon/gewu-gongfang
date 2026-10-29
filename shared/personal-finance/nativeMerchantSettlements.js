'use strict';
const {neutralMerchantOrder,nativeUnclassifiedMerchantReceipt}=require('./legacyMerchantReceipts');
const {annotatedSettlementAccount}=require('./counterpartySettlements');
const invalid=()=>Object.assign(new Error('COUNTERPARTY_SETTLEMENT_CASH_PROOF_REQUIRED'),{code:'COUNTERPARTY_SETTLEMENT_CASH_PROOF_REQUIRED'});
function settlementCashProofs(ledger){
 const {findBalanceProofCashPostings,purposeOnlyCashTimingAnnotationIds}=require('./balanceCashPostings');
 return findBalanceProofCashPostings(ledger.observations||[],ledger.accounts||[],{annotatedIds:new Set((ledger.annotations||[]).map(a=>a.observationId)),cashTimingAnnotatedIds:purposeOnlyCashTimingAnnotationIds(ledger.observations||[],ledger.annotations||[],ledger.accounts||[]),links:ledger.links||[]});
}
// The annotation supplies purpose and a counterparty only. Direction, money,
// account and receipt time must come from unique, independently validated cash.
function nativeMerchantSettlement(source,annotation,accounts,observations,proofs){
 const patch=annotation?.reset?null:annotation?.patch;
 if(!patch?.settlementAccountId||source.direction!=='neutral')return null;
 if(!neutralMerchantOrder(source))throw invalid();
 const target=annotatedSettlementAccount({...source,direction:'credit'},annotation,accounts);
 const p=proofs.get(source.id),proof=p&&observations.find(o=>o.id===p.proofObservationId);
 if(!p||!proof||!nativeUnclassifiedMerchantReceipt(source,proof)||p.method!=='native_order_wallet_cash_posting'||p.confidence!=='explicit_original_cash_posting'||!p.preservesUnclassifiedMerchantPurpose||p.sourceObservationId!==source.id||p.financialAccountId!==source.financialAccountId||p.deltaMinor!==source.amountMinor||p.occurredAt!==proof.occurredAt)throw invalid();
 return {...source,...patch,direction:'credit',automaticClassification:{method:'owner_confirmed_counterparty_settlement',confidence:'owner_confirmed_with_original_cash',financialAccountId:target.id,evidenceObservationIds:[source.id,proof.id],cashReceiptProofObservationId:proof.id,sourceDirection:'neutral'}};
}
module.exports={nativeMerchantSettlement,settlementCashProofs};
