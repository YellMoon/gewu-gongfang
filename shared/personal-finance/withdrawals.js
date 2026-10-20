'use strict';
const {fundingIdentity,sameBankAccount}=require('./assetRegister');
const FEE_RULE_SOURCE='https://posts.tenpay.com/posts/f21920786968630a00e9079824f26969.html';
// The bank records net receipts; the wallet export includes the charged fee.
// A fee cap is only a candidate constraint, never a fee estimate. Exemptions
// and vouchers make it unsafe to synthesize a missing bank net amount.
function findWechatWithdrawalMatches(observations,accounts,{rootOf=id=>id,isBlocked=()=>false,occupiedBankRoots=new Set(),annotatedIds=new Set()}={}){
 const candidates=new Map(),reverse=new Map(),evidence=new Map();
 const annotatedRoots=new Set(observations.filter(o=>annotatedIds.has(o.id)).map(o=>rootOf(o.id)));
 const latest=new Map();for(const o of observations){const key=JSON.stringify([rootOf(o.id),o.provider,o.financialAccountId]);if(!latest.has(key)||(o.sourceVersionOrdinal||0)>(latest.get(key).sourceVersionOrdinal||0))latest.set(key,o);}
 const records=[...latest.values()];
 for(const w of records){
  if(w.provider!=='wechat'||w.status!=='completed'||w.kind!=='transfer'||!['neutral','debit'].includes(w.direction)||w.rawFields?.['\u4ea4\u6613\u7c7b\u578b']!=='\u96f6\u94b1\u63d0\u73b0'||annotatedIds.has(w.id))continue;
  const identity=fundingIdentity(w.paymentChannel),targets=identity?accounts.filter(a=>a.status!=='archived'&&a.id!==w.financialAccountId&&['bank','debit_card','savings'].includes(a.type)&&sameBankAccount(a,identity,w.currency)):[];
  if(targets.length!==1)continue;
  const wr=rootOf(w.id),target=targets[0];if(occupiedBankRoots.has(wr)||annotatedRoots.has(wr))continue;
  for(const b of records){
   if(!b.statementFlow||b.financialAccountId!==target.id||b.status!=='completed'||b.direction!=='credit'||b.currency!==w.currency||b.date!==w.date||!['unknown','transfer'].includes(b.kind)||annotatedIds.has(b.id))continue;
   const bankText=[b.description,b.counterparty].join(' '),explicitChannel=/\u8d22\u4ed8\u901a|\u5fae\u4fe1\u96f6\u94b1\u63d0\u73b0/.test(bankText);
   // Some bank receipts omit the wallet channel but retain a real second-level
   // timestamp. Only a receipt in the next two seconds may substitute for that
   // missing channel; a date-only statement's synthetic time is not evidence.
   const delay=(Date.parse(b.occurredAt)-Date.parse(w.occurredAt))/1000;
   const preciseReceipt=b.statementFlow.timePrecision==='second'&&Number.isInteger(delay)&&delay>=0&&delay<=2&&!/\u652f\u4ed8\u5b9d/.test(bankText);
   if(!explicitChannel&&!preciseReceipt)continue;
   const br=rootOf(b.id);if(wr===br||occupiedBankRoots.has(br)||annotatedRoots.has(br)||isBlocked(w.id,b.id))continue;
   const gross=BigInt(w.amountMinor),net=BigInt(b.amountMinor),fee=gross-net,normal=(net+500n)/1000n,cap=normal>10n?normal:10n;
   if(net<=0n||fee<0n||fee>cap)continue;
   if(!candidates.has(wr))candidates.set(wr,new Set());if(!reverse.has(br))reverse.set(br,new Set());candidates.get(wr).add(br);reverse.get(br).add(wr);
   const key=JSON.stringify([wr,br]),previous=evidence.get(key);
   if(!previous||(w.sourceVersionOrdinal||0)>(previous.wallet.sourceVersionOrdinal||0)||(b.sourceVersionOrdinal||0)>(previous.bank.sourceVersionOrdinal||0))evidence.set(key,{wallet:w,bank:b,targetAccountId:target.id,grossMinor:w.amountMinor,netMinor:b.amountMinor,feeMinor:String(fee),feeCapMinor:String(cap),feeRuleSource:FEE_RULE_SOURCE,matchBasis:explicitChannel?'explicit_bank_channel':'precise_bank_receipt_time',bankReceiptDelaySeconds:preciseReceipt?delay:null});
  }
 }
 const matches=[];for(const [wr,banks] of candidates)if(banks.size===1){const br=[...banks][0];if(reverse.get(br)?.size===1)matches.push({...evidence.get(JSON.stringify([wr,br])),walletRoot:wr,bankRoot:br,confidence:'inferred',method:'wechat_withdrawal_net_receipt'});}
 return matches;
}
module.exports={findWechatWithdrawalMatches,FEE_RULE_SOURCE};
