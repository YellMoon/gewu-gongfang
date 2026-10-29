'use strict';
const {validatedWalletProofs}=require('./walletStatementTopUps');
const {fundingIdentity,sameBankAccount}=require('./assetRegister');
const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
const active=l=>l.status!=='deleted'&&!l.deletedAt&&l.deleted!==true;
const amountString=n=>(n/100n)+'.'+String(n%100n).padStart(2,'0');
const zero=v=>BigInt(v||0)===0n;

// The native credit prints each product order number. Equal subsequent bank
// withdrawals may only be established collectively; do not assign their row
// sequence to individual orders or infer a bank card from a clearing channel.
function addGroupedWalletIntermediaryPostings(transactions,observations,accounts,plans,{annotations=[],links=[]}={}){
 const am=new Map(accounts.map(a=>[a.id,a])),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),ties=new Set();
 for(const o of observations){const k=identity(o),p=latest.get(k),v=o.sourceVersionOrdinal||0;if(!p||v>(p.sourceVersionOrdinal||0)){latest.set(k,o);ties.delete(k);}else if(v===(p.sourceVersionOrdinal||0)&&p.id!==o.id)ties.add(k);}
 const rows=[...latest.values()],blocked=new Set(),claimed=new Set();
 for(const a of annotations){const o=byId.get(a.observationId);if(o)blocked.add(identity(o));}
 for(const l of links)if(active(l)||['duplicate','group_duplicate','transfer'].includes(l.type))for(const id of l.observationIds||[]){const o=byId.get(id);if(o)blocked.add(identity(o));}
 const claim=id=>{const o=byId.get(id);if(o)claimed.add(identity(o));};
 for(const t of transactions){for(const e of t.cashPostingEvidence||[])claim(e.proofObservationId);for(const es of Object.values(t.balanceEffectEvents||{}))for(const e of es)claim(e.observationId);}
 for(const ps of plans.values())for(const p of ps){for(const id of p.proofObservationIds||[])claim(id);for(const e of p.events||[])claim(e.observationId);}
 const proofs=validatedWalletProofs(rows,am),groups=new Map();
 for(const t of transactions){
  if(t.sources?.length!==1||t.kind!=='transfer'||t.status!=='completed'||t.currency!=='CNY'||!zero(t.incomeMinor)||!zero(t.consumptionMinor)||t.cashPostingEvidence?.length||t.walletIntermediaryPostings?.length||plans.has(t.id))continue;
  const original=t.sources[0],s=latest.get(identity(original));if(!s||s.id!==original.id||s.balanceEvidence||s.provider!=='alipay'||s.kind!=='transfer'||s.direction!=='neutral'||s.status!=='completed'||s.currency!=='CNY'||s.description!=='\u4f59\u989d\u5b9d-\u8f6c\u51fa\u5230\u94f6\u884c\u5361'||s.accountRelations?.length!==1||s.investmentTrade||s.loanProof)continue;
  const wallet=am.get(s.financialAccountId),r=s.accountRelations[0],fund=am.get(r.financialAccountId),raw=s.rawFields||{},amount=BigInt(s.amountMinor);
  if(wallet?.status!=='active'||wallet.type!=='wallet'||wallet.provider!=='alipay'||wallet.currency!=='CNY'||wallet.sourceProduct||r.product!=='alipay_yuebao'||r.activity!=='investment_withdrawal'||r.role!=='target'||fund?.status!=='active'||fund.type!=='investment'||fund.sourceProduct!=='alipay_yuebao'||fund.currency!=='CNY'||amount<=0n||!require('./mixedPayments').actualSecond(s)||raw['\u91d1\u989d']!==amountString(amount)||raw['\u4ea4\u6613\u8ba2\u5355\u53f7']!==s.sourceTransactionId||raw['\u5546\u54c1\u8bf4\u660e']!==s.description||raw['\u4ea4\u6613\u5bf9\u65b9']!==s.counterparty||raw['\u5546\u5bb6\u8ba2\u5355\u53f7']!==s.relatedReference||raw['\u6536/\u652f']!=='\u4e0d\u8ba1\u6536\u652f'||raw['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==s.paymentChannel)continue;
  const card=fundingIdentity(s.paymentChannel),banks=card?.type==='debit_card'?accounts.filter(a=>a.status==='active'&&a.type==='debit_card'&&a.currency==='CNY'&&sameBankAccount(a,card,s.currency)):[];
  if(banks.length!==1||!/^\d{4}$/.test(banks[0].maskedIdentifier||'')||s.paymentAccountHint&&!String(banks[0].maskedIdentifier||'').endsWith(s.paymentAccountHint))continue;const bank=banks[0],norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd/,'');if(norm(bank.provider)!==norm(s.counterparty))continue;
  const compatible=m=>!Object.entries(m||{}).some(([id,n])=>BigInt(n)!==0n&&!((id===fund.id&&BigInt(n)===-amount)||(id===bank.id&&BigInt(n)===amount)))&&BigInt(m?.[fund.id]||0)===-amount&&BigInt(m?.[bank.id]||0)===amount&&zero(m?.[wallet.id]);
  if(!compatible(t.balanceEffects)||!compatible(t.cashEffects))continue;
  const credits=proofs.filter(p=>p.observation.financialAccountId===wallet.id&&p.observation.date===s.date&&p.bank==='\u652f\u4ed8\u5b9d'&&p.incoming===amount&&p.outgoing===0n&&p.observation.description==='\u8f6c\u8d26'&&p.observation.relatedReference===s.sourceTransactionId&&p.observation.occurredAt===s.occurredAt);
  if(credits.length!==1)continue;
  const key=JSON.stringify([wallet.id,fund.id,bank.id,s.date,s.amountMinor,credits[0].observation.importId]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({t,s,credit:credits[0],wallet,fund,bank,amount});
 }
 for(const members of groups.values()){
  if(members.length<2||members.length>20)continue;members.sort((a,b)=>Date.parse(a.s.occurredAt)-Date.parse(b.s.occurredAt)||a.s.id.localeCompare(b.s.id));const first=members[0],{wallet,fund,bank,amount}=first,n=members.length,date=first.s.date,doc=first.credit.observation.importId,sourceIds=new Set(members.map(m=>m.s.id)),credits=members.map(m=>m.credit);
  const rivals=rows.filter(o=>!o.balanceEvidence&&o.provider==='alipay'&&o.financialAccountId===wallet.id&&o.currency==='CNY'&&o.date===date&&o.status==='completed'&&o.amountMinor===String(amount));if(rivals.length!==n||rivals.some(o=>!sourceIds.has(o.id)))continue;
  const nativeCredits=proofs.filter(p=>p.observation.financialAccountId===wallet.id&&p.observation.importId===doc&&p.observation.date===date&&p.incoming===amount&&p.outgoing===0n);
  if(nativeCredits.length!==n||nativeCredits.some(p=>!credits.some(q=>q.observation.id===p.observation.id)))continue;
  const debits=proofs.filter(p=>p.observation.financialAccountId===wallet.id&&p.observation.importId===doc&&p.observation.date===date&&p.incoming===0n&&p.outgoing===-amount);
  if(debits.length!==n||debits.some(p=>!/^\u63d0\u73b0(?:[\u4e00-\u9fff]{2,4})?$/.test(p.observation.description)||!p.bank.endsWith('\u94f6\u884c'))||new Set(debits.map(p=>p.bank)).size!==1)continue;
  const start=Date.parse(credits[0].observation.occurredAt),end=Math.max(...debits.map(p=>Date.parse(p.observation.occurredAt))),lastCredit=Math.max(...credits.map(p=>Date.parse(p.observation.occurredAt)));
  if(end-start>3600000||debits.some(p=>Date.parse(p.observation.occurredAt)<lastCredit)||new Set([...credits,...debits].map(p=>identity(p.observation))).size!==2*n)continue;
  const involved=[...members.map(m=>m.s),...[...credits,...debits].map(p=>p.observation)];if(involved.some(o=>blocked.has(identity(o))||ties.has(identity(o)))||[...credits,...debits].some(p=>claimed.has(identity(p.observation))))continue;
  // Store one zero-net group, rather than arbitrarily pairing equal debits.
  // Product and receiving-bank cash remain on their original transactions.
  const events=[...credits.map(p=>({observationId:p.observation.id,occurredAt:p.observation.occurredAt,date,deltaMinor:amount})),...debits.map(p=>({observationId:p.observation.id,occurredAt:p.observation.occurredAt,date,deltaMinor:-amount}))].sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)||a.observationId.localeCompare(b.observationId));
  // A source belongs to only one wallet/date/amount/product/bank group.
  // Its unique representative ID also works in desktop and miniapp bundles.
  const groupId='native_grouped_yuebao_wallet:'+first.s.id;
  plans.set(first.t.id,[{method:'native_wallet_intermediary_postings',schema:'grouped-wallet-intermediary-postings-v1',groupId,path:'grouped_product_withdrawals_via_wallet',financialAccountId:wallet.id,sourceObservationId:first.s.id,sourceObservationIds:members.map(m=>m.s.id),groupMemberTransactionIds:members.map(m=>m.t.id),productAccountId:fund.id,receivingAccountId:bank.id,confidence:'inferred_collective_exact_credit_order_and_complete_equal_withdrawal_group',cashEvidenceConfidence:'explicit_original_cash_postings',perOrderAmountMinor:String(amount),amountMinor:String(amount*BigInt(n)),netDeltaMinor:'0',individualWithdrawalIdentity:'undetermined',sourceCreditOrderReferencesMatched:true,sourceWithdrawalOrderReferencesMatched:false,nativeDisbursementChannel:debits[0].observation.rawFields['\u8d44\u91d1\u6e20\u9053'],nativeChannelUsedToSelectReceivingAccount:false,bankCashAndProductPostingsPreserved:true,noNewIncomeOrExpense:true,proofObservationIds:events.map(e=>e.observationId),reversible:true,events}]);
  for(const o of involved)claimed.add(identity(o));
 }
 return plans;
}
module.exports={addGroupedWalletIntermediaryPostings};
