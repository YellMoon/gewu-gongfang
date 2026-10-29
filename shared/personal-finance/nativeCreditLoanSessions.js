'use strict';
const {actualSecond}=require('./mixedPayments');
const {annotatedSettlementAccount}=require('./counterpartySettlements');

// A loan can share the wallet with independently known ordinary receipts. Keep
// those receipts separate and preserve their classifications. Matching a closed
// observed cash budget is inference, not an independent absolute balance anchor.
function findNativeCreditLoanSessions(rows,accounts,ctx){
 const {identity,byId,annotations,annotatedKeys,occupied,actualLoanDrawEvidence,links,proofDraw,sweep,debit,separatePayment,preservedDebitKeys}=ctx;
 const map=new Map(accounts.map(a=>[a.id,a])),decisions=new Map();
 for(const[id,a]of annotations){const o=byId.get(id);if(!o)continue;const key=identity(o);if(!decisions.has(key))decisions.set(key,[]);decisions.get(key).push(a);}
 const native=o=>{
  const raw=o.rawFields||{};
  return o.provider==='alipay'&&o.status==='completed'&&actualSecond(o)&&!occupied.has(identity(o))&&raw['\u4ea4\u6613\u65f6\u95f4']===o.occurredAt.slice(0,19).replace('T',' ')&&raw['\u4ea4\u6613\u72b6\u6001']==='\u4ea4\u6613\u6210\u529f'&&raw['\u5546\u54c1\u8bf4\u660e']===o.description&&raw['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']===o.paymentChannel;
 };
 const credit=o=>{
  if(!native(o)||!['income','transfer'].includes(o.kind)||o.direction!=='credit'||o.paymentChannel||o.paymentAccountHint||o.automaticFunding||o.accountRelations?.length||o.investmentTrade||o.loanProof||!['\u8f6c\u8d26','\u6536\u6b3e-\u8f6c\u8d26'].includes(o.description)||o.rawFields['\u6536/\u652f']!=='\u6536\u5165'||o.rawFields['\u4ea4\u6613\u5bf9\u65b9']!==o.counterparty||o.rawFields['\u4ea4\u6613\u8ba2\u5355\u53f7']!==o.sourceTransactionId||BigInt(o.amountMinor)<=0n||![null,undefined,'0'].includes(o.feeMinor))return false;
  const amount=String(o.rawFields['\u91d1\u989d']||'').match(/^(\d+)(?:\.(\d{1,2}))?$/);if(!amount||BigInt(amount[1])*100n+BigInt((amount[2]||'').padEnd(2,'0'))!==BigInt(o.amountMinor))return false;
  const list=decisions.get(identity(o));if(!list?.length)return false;
  return list.every(a=>{
   const p=a.patch;if(a.reset||!p)return false;
   if(o.kind==='income')return p.kind==='income'&&p.category==='\u6682\u6309\u4e2a\u4eba\u6536\u5165\uff08\u7528\u6237\u6388\u6743\u3001\u53ef\u4fee\u6539\uff09'&&Object.keys(p).every(k=>['kind','category'].includes(k));
   if(p.kind!=='transfer'||Object.keys(p).some(k=>!['kind','category','settlementAccountId'].includes(k)))return false;
   try{return Boolean(annotatedSettlementAccount(o,a,accounts));}catch{return false;}
  });
 };
 const productChannels={alipay_yuebao:'\u4f59\u989d\u5b9d',alipay_yulibao:'\u4f59\u5229\u5b9d',alipay_huabei:'\u82b1\u5457'};
 const separateProduct=o=>{
  if(!native(o)||o.paymentAccountHint||o.automaticFunding||o.accountRelations?.length!==1)return false;
  if(annotatedKeys.has(identity(o))){const list=decisions.get(identity(o));if(!list?.length||!list.every(a=>{const p=a.patch;if(a.reset||p?.kind!=='transfer'||Object.keys(p).some(k=>!['kind','category','settlementAccountId'].includes(k)))return false;try{return Boolean(annotatedSettlementAccount(o,a,accounts));}catch{return false;}}))return false;}
  const rel=o.accountRelations[0],a=map.get(rel.financialAccountId);
  if(!a||a.status!=='active'||a.provider!=='alipay'||a.currency!==o.currency||a.sourceProduct!==rel.product)return false;
  if(o.direction==='debit')return rel.role==='funding'&&['funding_outflow','credit_charge'].includes(rel.activity)&&o.paymentChannel===productChannels[rel.product]&&o.rawFields['\u6536/\u652f']==='\u652f\u51fa';
  return !annotatedKeys.has(identity(o))&&o.direction==='credit'&&o.kind==='transfer'&&rel.role==='target'&&rel.activity==='investment_income'&&rel.product==='alipay_yuebao'&&!o.paymentChannel&&o.rawFields['\u6536/\u652f']==='\u6536\u5165'&&/^\u4f59\u989d\u5b9d-\d{4}\.\d{2}\.\d{2}-\u6536\u76ca\u53d1\u653e$/.test(o.description);
 };
 const credits=rows.filter(credit),draws=rows.filter(o=>proofDraw(o)&&!occupied.has(identity(o))),sweeps=rows.filter(o=>sweep(o)&&!occupied.has(identity(o)));
 if(!credits.length||!draws.length||!sweeps.length)return new Map();
 const active=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|'))),vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!active.has([...l.observationIds].sort().join('|'))),proposals=[];
 for(const first of draws)for(const start of credits){
  if(start.financialAccountId!==first.financialAccountId||start.currency!==first.currency||start.date!==first.date||start.occurredAt>=first.occurredAt||Date.parse(first.occurredAt)-Date.parse(start.occurredAt)>12*3600000)continue;
  for(const end of sweeps){
   const duration=Date.parse(end.occurredAt)-Date.parse(start.occurredAt),nextDate=new Date(Date.parse(first.date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
   if(end.financialAccountId!==first.financialAccountId||end.currency!==first.currency||duration<=0||duration>24*3600000||end.occurredAt<=first.occurredAt||end.description!=='\u4f59\u989d\u5b9d-\u81ea\u52a8\u8f6c\u5165'||!(end.date===first.date||end.date===nextDate&&/^0[0-5]:/.test(end.occurredAt.slice(11,17))))continue;
   const window=rows.filter(o=>o.financialAccountId===first.financialAccountId&&o.currency===first.currency&&o.status==='completed'&&o.occurredAt>=start.occurredAt&&o.occurredAt<=end.occurredAt&&!o.loanProof&&!o.balanceEvidence&&!o.investmentTrade);
   const loans=window.filter(o=>draws.includes(o)),receipts=window.filter(o=>credits.includes(o)),uses=window.filter(debit),members=[...loans,...receipts,...uses],keys=new Set(members.map(identity));
   if(loans.length!==1||loans[0].id!==first.id||receipts.length<2||receipts.length>4||!receipts.some(o=>o.occurredAt>first.occurredAt)||uses.length<2||uses.length>20||uses.filter(sweep).length!==1||keys.size!==members.length||members.some(o=>occupied.has(identity(o)))||new Set(members.map(o=>o.occurredAt)).size!==members.length)continue;
   const excluded=window.filter(o=>!keys.has(identity(o))&&(separatePayment(o)||separateProduct(o)));
   if(window.some(o=>!keys.has(identity(o))&&!excluded.includes(o)))continue;
   const inflow=loans.concat(receipts).reduce((n,o)=>n+BigInt(o.amountMinor),0n),outflow=uses.reduce((n,o)=>n+BigInt(o.amountMinor),0n);
   if(inflow!==outflow||rows.some(o=>o.statementFlow&&o.direction==='credit'&&o.currency===first.currency&&Math.abs(Date.parse(o.date)-Date.parse(first.date))<=86400000&&o.amountMinor===first.amountMinor))continue;
   const allKeys=new Set([...members,...excluded].map(identity));
   if(vetoes.some(l=>{const refs=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(identity);return l.type==='group_distinct'?refs.some(k=>allKeys.has(k)):refs.length===l.observationIds.length&&refs.every(k=>allKeys.has(k));}))continue;
   let running=0n,negative=false;for(const o of members.slice().sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt))){running+=(uses.includes(o)?-1n:1n)*BigInt(o.amountMinor);if(running<0n)negative=true;}if(negative||running!==0n)continue;
   proposals.push({first,start,end,loans,receipts,uses,members,excluded,inflow});
  }
 }
 const counts=new Map();for(const p of proposals)for(const o of [...p.members,...p.excluded])counts.set(identity(o),(counts.get(identity(o))||0)+1);
 const out=new Map();for(const p of proposals.filter(p=>[...p.members,...p.excluded].every(o=>counts.get(identity(o))===1))){
  const evidenceObservationIds=[...p.members,...p.excluded].map(o=>o.id).sort();
  out.set(p.first.id,{method:'inferred_loan_wallet_receipt',confidence:'inferred',basis:'actual_loan_proof_and_closed_native_wallet_credit_session',financialAccountId:p.first.financialAccountId,amountMinor:p.first.amountMinor,groupId:'native-credit-wallet-loan-session:'+evidenceObservationIds.join('|'),evidenceObservationIds,loanProofObservationIds:actualLoanDrawEvidence.get(p.first.id),loanTotalMinor:p.first.amountMinor,independentNativeWalletReceiptMinor:String(p.receipts.reduce((n,o)=>n+BigInt(o.amountMinor),0n)),independentNativeWalletReceiptObservationIds:p.receipts.map(o=>o.id).sort(),sessionInflowMinor:String(p.inflow),sessionOutflowMinor:String(p.inflow),sessionStart:p.start.occurredAt,sessionEnd:p.end.occurredAt,overnightAutomaticSweep:p.start.date!==p.end.date,originalDateBoundaryPreserved:true,preservedSettlementAnnotationObservationIds:p.uses.filter(o=>preservedDebitKeys.has(identity(o))).map(o=>o.id).sort(),preservedNativeReceiptAnnotationObservationIds:p.receipts.map(o=>o.id).sort(),supportingDecisionsUnchanged:true,excludedNonWalletObservationIds:p.excluded.map(o=>o.id).sort(),separatePaymentSourcesUnchanged:true,loanCount:1,walletUseCount:p.uses.length,reciprocalUnique:true,separateEconomicTransactions:true,absoluteWalletBalanceIndependentlyKnown:false});
 }
 return out;
}
module.exports={findNativeCreditLoanSessions};
