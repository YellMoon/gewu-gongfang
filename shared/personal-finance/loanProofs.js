'use strict';
const money=v=>typeof v==='string'&&/^(0|[1-9]\d*)$/.test(v);
function validateLoanProof(e,r){
 if(!e||e.schema!=='ant-loan-flow-proof-v1'||!/^([a-f0-9]{64})$/.test(e.loanKey)||!['drawdown','repayment'].includes(e.activity)||!['originalPrincipalMinor','principalBalanceMinor','principalMinor','financingCostMinor'].every(k=>money(e[k]))||!Number.isInteger(e.sequence)||e.sequence<1||!Number.isInteger(e.sourcePage)||e.sourcePage<1||typeof e.lender!=='string'||!e.lender||e.lender.length>300||typeof e.ownerFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(e.ownerFingerprint)||!Number.isFinite(Date.parse(e.borrowedAt))||!Number.isFinite(Date.parse(e.observedAt))||r.direction!=='neutral'||r.kind!=='transfer'||r.balanceMinor!==null||r.currency!=='CNY'||r.status!=='completed')throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_INPUT_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_INPUT_INVALID'});
 const amount=BigInt(r.amountMinor),principal=BigInt(e.principalMinor),cost=BigInt(e.financingCostMinor);
 if(principal+cost!==amount||BigInt(e.principalBalanceMinor)>BigInt(e.originalPrincipalMinor)||e.activity==='drawdown'&&(r.occurredAt!==e.borrowedAt||e.originalPrincipalMinor!==r.amountMinor||e.principalBalanceMinor!==r.amountMinor||e.financingCostMinor!=='0'))throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_INPUT_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_INPUT_INVALID'});
 return e;
}
function validateLoanProofAccount(account,records){
 if(!records.some(r=>r.loanProof))return;
 if(account?.status!=='active'||account.type!=='wallet'||account.provider!=='alipay'||account.currency!=='CNY'||records.some(r=>!r.loanProof)||new Set(records.map(r=>r.loanProof.ownerFingerprint)).size!==1)throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_LOAN_PROOF_ACCOUNT_MISMATCH'),{code:'CLOUD_PERSONAL_FINANCE_LOAN_PROOF_ACCOUNT_MISMATCH'});
}
module.exports={validateLoanProof,validateLoanProofAccount};
