'use strict';
const {actualSecond}=require('./mixedPayments');
// Missing payer identity does not erase the successful wallet top-up. This
// establishes only the receiving leg; it never supplies a bank, fee or income.
function explicitUnfundedWalletReceipt(o,account){
 const r=o?.rawFields||{},amount=r['\u91d1\u989d'];
 if(o?.provider!=='alipay'||o.status!=='completed'||o.kind!=='transfer'||o.direction!=='neutral'||o.currency!=='CNY'||o.description!=='\u5145\u503c-\u666e\u901a\u5145\u503c'||o.paymentAccountHint||!['','\u4f59\u989d'].includes(o.paymentChannel)||!actualSecond(o)||o.accountRelations?.length||o.investmentTrade||o.brokerage||o.bankStatement||o.statementFlow||account?.id!==o.financialAccountId||account.type!=='wallet'||account.provider!=='alipay'||account.status!=='active'||account.currency!==o.currency||typeof o.amountMinor!=='string'||!/^\d+$/.test(o.amountMinor)||BigInt(o.amountMinor)<=0n)return null;
 if(typeof amount!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(amount)||r['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||r['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||r['\u5546\u54c1\u8bf4\u660e']!==o.description||r['\u4ea4\u6613\u5bf9\u65b9']!==o.counterparty||r['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==o.paymentChannel||!o.sourceTransactionId||r['\u4ea4\u6613\u8ba2\u5355\u53f7']!==o.sourceTransactionId)return null;
 const [whole,fraction='']=amount.split('.');if(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))!==BigInt(o.amountMinor))return null;
 return{method:'native_wallet_topup_receipt',confidence:'explicit_original_receiving_leg',financialAccountId:account.id,amountMinor:o.amountMinor,occurredAt:o.occurredAt,evidenceObservationIds:[o.id],sourceAccountKnown:false,sourceLegInferred:false,incomeRecognized:false};
}
// A confirmed external top-up replaces only the missing funding identity.
// Preserve the already established wallet receipt and post the counterparty
// payable once; never create personal income or debit an owned bank account.
function confirmedExternalWalletTopUp(source,annotation,accounts){
 const patch=annotation?.reset?null:annotation?.patch;
 if(!patch?.settlementAccountId||source?.provider!=='alipay'||source.description!=='\u5145\u503c-\u666e\u901a\u5145\u503c')return null;
 const invalid=()=>Object.assign(new Error('EXTERNAL_WALLET_TOPUP_SETTLEMENT_INVALID'),{code:'EXTERNAL_WALLET_TOPUP_SETTLEMENT_INVALID'});
 const wallet=accounts.find(a=>a.id===source.financialAccountId),receipt=explicitUnfundedWalletReceipt(source,wallet);
 if(!receipt||patch.kind!=='transfer'||Object.keys(patch).some(k=>!['kind','category','settlementAccountId'].includes(k))||source.loanProof||source.balanceEvidence||source.automaticFunding||[source.principalMinor,source.interestMinor,source.feeMinor].some(v=>v!=null&&v!=='0'))throw invalid();
 const effective={...source,...patch,direction:'credit'};
 let target;try{target=require('./counterpartySettlements').annotatedSettlementAccount(effective,annotation,accounts);}catch{throw invalid();}
 if(target?.status!=='active')throw invalid();
 return {...effective,walletTopupReceipt:{...receipt,sourceAccountKnown:true,settlementAccountId:target.id,externalOwnershipConfirmed:true,externalBankCardIdentified:false,sourceLegInferred:false,reversible:true},automaticClassification:{method:'owner_confirmed_counterparty_settlement',confidence:'owner_confirmed',financialAccountId:target.id,evidenceObservationIds:[source.id],sourceDirection:source.direction,fundingOwnership:'external_counterparty'}};
}
module.exports={explicitUnfundedWalletReceipt,confirmedExternalWalletTopUp};
