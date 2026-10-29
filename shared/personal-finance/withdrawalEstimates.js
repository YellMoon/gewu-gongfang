'use strict';
const {fundingIdentity,sameBankAccount}=require('./assetRegister');
const RULE_SOURCE='https://www.xinhuanet.com/politics/2016-03/04/c_1118236646.htm';
function validateWithdrawalEstimation(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['schema','enabled','approvedAt','ruleVersion'].includes(k))||v.schema!=='wechat-withdrawal-estimation-v1'||typeof v.enabled!=='boolean'||v.ruleVersion!=='20160301-20250724'||typeof v.approvedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(v.approvedAt)||Number.isNaN(Date.parse(v.approvedAt)))throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_WITHDRAWAL_ESTIMATION_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_WITHDRAWAL_ESTIMATION_INVALID'});
 return v;
}
function invertGross(gross){
 const guess=(gross+500n)/1001n,candidates=new Set();
 for(const fee of [10n,guess-1n,guess,guess+1n]){if(fee<10n||fee>=gross)continue;const net=gross-fee,computed=(net+500n)/1000n;if((computed<10n?10n:computed)===fee)candidates.add(net.toString());}
 if(candidates.size!==1)return null;const net=BigInt([...candidates][0]);return {netMinor:String(net),feeMinor:String(gross-net)};
}
function proofMayCoverWithdrawal(proof,w,dayWallets){
 const e=proof.withdrawalFeeEvidence;if(!e||typeof e.grossMinor!=='string'||!/^\d{1,20}$/.test(e.grossMinor)||typeof e.feeMinor!=='string'||!/^\d{1,20}$/.test(e.feeMinor)||!Array.isArray(e.sourceRows)||!e.sourceRows.length||dayWallets.length>16)return true;
 const target=BigInt(e.grossMinor),netBasis=target+BigInt(e.feeMinor),allowance=BigInt(Math.min(dayWallets.length,e.sourceRows.length)),near=n=>n>=target-allowance&&n<=target+allowance||n===netBasis;
 let sums=new Set([BigInt(w.amountMinor)]);if([...sums].some(near))return true;
 for(const other of dayWallets.filter(o=>o.id!==w.id)){const amount=BigInt(other.amountMinor);for(const n of [...sums]){const next=n+amount;if(near(next))return true;if(next<=netBasis+allowance)sums.add(next);}}
 return false;
}
function estimateWechatWithdrawals(observations,accounts,{rootOf=id=>id,occupiedRoots=new Set(),annotatedIds=new Set(),links=[]}={}){
 const byAccount=new Map(accounts.map(a=>[a.id,a])),latest=new Map(),blocked=new Set();
 for(const o of observations){const key=JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);if(!latest.has(key)||(o.sourceVersionOrdinal||0)>(latest.get(key).sourceVersionOrdinal||0))latest.set(key,o);if(annotatedIds.has(o.id))blocked.add(rootOf(o.id));}
 for(const link of links)for(const id of link.observationIds||[])blocked.add(rootOf(id));
 const rows=[...latest.values()],proofDays=new Map(),ranges=new Map();for(const p of rows.filter(o=>o.withdrawalFeeEvidence)){const key=JSON.stringify([p.financialAccountId,p.date]);if(!proofDays.has(key))proofDays.set(key,[]);proofDays.get(key).push(p);}
 for(const o of rows)if(o.statementFlow&&o.status==='completed'){if(!ranges.has(o.financialAccountId))ranges.set(o.financialAccountId,[]);ranges.get(o.financialAccountId).push([o.statementFlow.periodStart,o.statementFlow.periodEnd]);}
 const wallets=rows.filter(o=>o.provider==='wechat'&&o.status==='completed'&&o.kind==='transfer'&&['neutral','debit'].includes(o.direction)&&o.rawFields?.['\u4ea4\u6613\u7c7b\u578b']==='\u96f6\u94b1\u63d0\u73b0').sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id)),withdrawnLowerBounds=new Map(),estimates=[];
 for(const w of wallets){
  const gross=BigInt(w.amountMinor),prior=withdrawnLowerBounds.get(w.financialAccountId)||0n;
  // Even the maximum historical regular fee leaves this much actual withdrawal.
  // Known withdrawals alone can establish exhaustion of the shared free quota.
  if(w.date>='2016-03-01')withdrawnLowerBounds.set(w.financialAccountId,prior+(gross>10n?gross*1000n/1001n-10n:0n));
  const nativeFee=require('./wechatStatementFees').wechatStatementFee(w),policy=byAccount.get(w.financialAccountId)?.withdrawalFeeEstimation;if(!nativeFee&&!policy)continue;if(policy)validateWithdrawalEstimation(policy);
  if(!nativeFee&&(!policy.enabled||w.currency!=='CNY'||w.date<'2016-03-01'||w.date>'2025-07-24'||prior<100000n)||occupiedRoots.has(rootOf(w.id))||blocked.has(rootOf(w.id)))continue;
  const nearbyProofs=proofDays.get(JSON.stringify([w.financialAccountId,w.date]))||[],dayWallets=wallets.filter(o=>o.financialAccountId===w.financialAccountId&&o.date===w.date);if(!nativeFee&&(nearbyProofs.length>32||nearbyProofs.some(p=>proofMayCoverWithdrawal(p,w,dayWallets))))continue;
  const f=fundingIdentity(w.paymentChannel);if(!f)continue;const targets=accounts.filter(a=>a.status==='active'&&['bank','debit_card','savings'].includes(a.type)&&a.id!==w.financialAccountId&&sameBankAccount(a,f,w.currency));if(targets.length!==1)continue;const target=targets[0];
  if((ranges.get(target.id)||[]).some(([start,end])=>w.date>=start&&w.date<=end))continue;
  if(nativeFee){estimates.push({wallet:w,targetAccountId:target.id,feeMinor:nativeFee.feeMinor,netMinor:nativeFee.netMinor,evidence:{...nativeFee,walletAccountId:w.financialAccountId,targetAccountId:target.id,date:w.date,bankReceipt:'derived_from_original_platform_gross_and_fee',actualBankReceiptAvailable:false,replaceWhenActualReceiptAvailable:true}});continue;}
  const inferred=invertGross(gross);if(!inferred)continue;
  estimates.push({wallet:w,targetAccountId:target.id,...inferred,evidence:{schema:'wechat-withdrawal-estimate-v1',confidence:'estimated',grossMinor:w.amountMinor,...inferred,walletAccountId:w.financialAccountId,targetAccountId:target.id,date:w.date,ruleVersion:policy.ruleVersion,approvedAt:policy.approvedAt,source:RULE_SOURCE,rateNumerator:'1',rateDenominator:'1000',minimumFeeMinor:'10',feeBasis:'net_receipt',rounding:'half_up_fen',freeQuotaExhaustedByObservedWithdrawals:true,priorWithdrawalLowerBoundMinor:String(prior),voucherAssumption:'no_additional_discount',receiptDateAssumption:'withdrawal_date',actualBankReceiptAvailable:false,replaceWhenActualReceiptAvailable:true,...(nearbyProofs.length?{workbookComparison:'different_amounts_not_applied',unmatchedWorkbookProofs:nearbyProofs.map(p=>({observationId:p.id,grossMinor:p.withdrawalFeeEvidence.grossMinor,feeMinor:p.withdrawalFeeEvidence.feeMinor}))}:{})}});
 }
 return estimates;
}
module.exports={validateWithdrawalEstimation,estimateWechatWithdrawals,invertGross};
