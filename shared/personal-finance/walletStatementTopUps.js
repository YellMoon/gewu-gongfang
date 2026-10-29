'use strict';

const norm=value=>String(value??'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe|\u5de5\u5546|\u519c\u4e1a|\u6c11\u751f)/,'');
const key=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]);
function money(value,optional=false){const text=norm(value);if(optional&&!text)return 0n;if(!/^-?\d+\.\d{2}$/.test(text))return null;const [whole,fraction]=text.replace('-','').split('.');return(BigInt(whole)*100n+BigInt(fraction))*(text.startsWith('-')?-1n:1n);}
function nativeWalletProof(o,accounts){
 const a=accounts.get(o.financialAccountId),e=o.balanceEvidence,r=o.rawFields||{};
 if(o.provider!=='alipay'||o.currency!=='CNY'||o.status!=='completed'||o.kind!=='transfer'||o.direction!=='neutral'||o.amountMinor!=='0'||a?.type!=='wallet'||a.provider!=='alipay'||a.sourceProduct||a.status!=='active'||a.currency!==o.currency||e?.schema!=='alipay-balance-proof-v1'||e.balanceKind&&e.balanceKind!=='total'||!Number.isInteger(e.sequence)||e.sequence<1||!o.importId||!o.relatedReference||r['\u6d41\u6c34\u53f7']!==o.relatedReference||r['\u65f6\u95f4']!==o.date+o.occurredAt.slice(11,19)||r['\u540d\u79f0\u5907\u6ce8']!==o.description||!/^\d+$/.test(e.incomeMinor)||!/^\d+$/.test(e.expenseMinor)||!/^\d+$/.test(o.balanceMinor??''))return null;
 const incoming=money(r['\u6536\u5165'],true),outgoing=money(r['\u652f\u51fa'],true),balance=money(r['\u8d26\u6237\u4f59\u989d']);
 if(incoming===null||outgoing===null||balance===null||incoming<0n||outgoing>0n||Boolean(incoming)===Boolean(outgoing)||String(incoming)!==e.incomeMinor||String(-outgoing)!==e.expenseMinor||String(balance)!==o.balanceMinor||!r['\u8d44\u91d1\u6e20\u9053'])return null;
 return{observation:o,incoming,outgoing,balance,delta:incoming+outgoing,bank:norm(r['\u8d44\u91d1\u6e20\u9053'])};
}
function validatedWalletProofs(rows,accounts){
 const groups=new Map();
 for(const o of rows)if(o.balanceEvidence?.schema==='alipay-balance-proof-v1'){
  const groupKey=JSON.stringify([o.financialAccountId,o.importId]);
  if(!groups.has(groupKey))groups.set(groupKey,[]);
  groups.get(groupKey).push(o);
 }
 const valid=[];
 for(const originals of groups.values()){
  const records=originals.map(o=>nativeWalletProof(o,accounts));
  if(records.some(o=>!o))continue;
  records.sort((a,b)=>a.observation.balanceEvidence.sequence-b.observation.balanceEvidence.sequence);
  if(records.some((r,i)=>r.observation.balanceEvidence.sequence!==i+1||i&&Date.parse(r.observation.occurredAt)<Date.parse(records[i-1].observation.occurredAt)||i&&records[i-1].balance+r.delta!==r.balance))continue;
  const first=records[0];if(first.observation.balanceEvidence.openingBeforeFirstMinor!==String(first.balance-first.delta))continue;
  valid.push(...records);
 }
 return valid;
}
function confirmedStudioBankIdentity(wallet,bank,accounts,observations){
 const targets=accounts.filter(a=>a.status==='active'&&a.type==='debit_card'&&a.currency==='CNY'&&norm(a.provider)===bank);
 if(targets.length!==1||targets[0].fundsRole!=='studio_public'||!/^\d{4}$/.test(targets[0].maskedIdentifier||''))return null;
 const target=targets[0];
 const destinations=(wallet.walletWithdrawalDestinations?.rules||[]).filter(r=>norm(r.institution)===bank&&r.financialAccountId===target.id&&!r.sourceTransactionIds&&Number.isFinite(Date.parse(r.confirmedAt)));
 const declarations=(wallet.historicalCardBindings?.rules||[]).filter(r=>r.identityBasis==='owner_confirmed_top_up_source'&&r.usage==='funding'&&r.confidence==='owner_confirmed'&&r.type==='debit_card'&&r.maskedIdentifier===target.maskedIdentifier&&r.financialAccountId===target.id&&norm(r.institution)===bank&&Array.isArray(r.sourceTransactionIds)&&r.sourceTransactionIds.length===1&&observations.some(o=>o.financialAccountId===wallet.id&&o.sourceTransactionId===r.sourceTransactionIds[0]&&o.date===r.periodStart&&r.periodStart===r.periodEnd&&o.status==='completed'&&o.kind==='transfer'&&o.description==='\u5145\u503c-\u666e\u901a\u5145\u503c'));
 if(destinations.length!==1||!declarations.length)return null;
 return{target,identityBasis:'explicit_statement_bank_and_owner_confirmed_studio_account',ownerBankIdentityConfirmedAt:destinations[0].confirmedAt,ownerConfirmedSourceTransactions:declarations.flatMap(r=>r.sourceTransactionIds)};
}
function findWalletStatementTopUpFunding(observations,accounts,{annotatedIds=new Set(),links=[],historicalFunding=new Map()}={}){
 const byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),am=new Map(accounts.map(a=>[a.id,a]));
 for(const o of observations)if(!latest.has(key(o))||(o.sourceVersionOrdinal||0)>(latest.get(key(o)).sourceVersionOrdinal||0))latest.set(key(o),o);
 const rows=[...latest.values()],blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(key)),activePairs=new Set(links.filter(l=>l.status!=='deleted').map(l=>[...l.observationIds].sort().join('|')));
 const vetoes=links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate'&&!activePairs.has([...l.observationIds].sort().join('|')));
 const proofs=validatedWalletProofs(rows,am),proposals=[];
 for(const proof of proofs){
  const p=proof.observation,wallet=am.get(p.financialAccountId);
  if(proof.incoming<=0n||proof.outgoing!==0n||p.description!=='\u5145\u503c\u5230\u4f59\u989d'||!proof.bank.endsWith('\u94f6\u884c'))continue;
  const identity=confirmedStudioBankIdentity(wallet,proof.bank,accounts,rows);if(!identity)continue;
  for(const source of rows){
   const r=source.rawFields||{},seconds=(Date.parse(p.occurredAt)-Date.parse(source.occurredAt))/1000;
   if(source.balanceEvidence||source.financialAccountId!==wallet.id||source.provider!=='alipay'||source.currency!=='CNY'||source.status!=='completed'||source.kind!=='transfer'||source.direction!=='neutral'||source.description!=='\u5145\u503c-\u666e\u901a\u5145\u503c'||!['\u4f59\u989d','\u8d26\u6237\u4f59\u989d','\u652f\u4ed8\u5b9d\u4f59\u989d'].includes(source.paymentChannel)||source.paymentAccountHint||source.accountRelations?.length||source.automaticFunding||historicalFunding.has(source.id)||source.date!==p.date||source.sourceTransactionId!==p.relatedReference||source.amountMinor!==String(proof.incoming)||r['\u4ea4\u6613\u8ba2\u5355\u53f7']!==source.sourceTransactionId||r['\u5546\u54c1\u8bf4\u660e']!==source.description||r['\u6536/\u4ed8\u6b3e\u65b9\u5f0f']!==source.paymentChannel||r['\u4ea4\u6613\u72b6\u6001']!=='\u4ea4\u6613\u6210\u529f'||money(r['\u91d1\u989d'])!==proof.incoming||!Number.isInteger(seconds)||seconds<0||seconds>60)continue;
   const members=new Set([key(source),key(p)]),veto=vetoes.some(l=>{const ids=l.observationIds.map(id=>byId.get(id)).filter(Boolean).map(key);return l.type==='group_distinct'?ids.some(id=>members.has(id)):ids.length===l.observationIds.length&&ids.every(id=>members.has(id));});
   proposals.push({source,proof:p,identity,blocked:veto||blocked.has(key(source))||blocked.has(key(p))});
  }
 }
 const uses=new Map();for(const p of proposals)for(const o of[p.source,p.proof])uses.set(key(o),(uses.get(key(o))||0)+1);
 return new Map(proposals.filter(p=>!p.blocked&&uses.get(key(p.source))===1&&uses.get(key(p.proof))===1).map(({source,proof,identity})=>[source.id,{financialAccountId:identity.target.id,method:'statement_confirmed_wallet_top_up',confidence:'inferred',identityBasis:identity.identityBasis,evidenceObservationIds:[source.id,proof.id],statementBank:identity.target.provider,bankCardTailPrinted:false,maskedIdentifier:identity.target.maskedIdentifier,ownerBankIdentityConfirmedAt:identity.ownerBankIdentityConfirmedAt,ownerConfirmedSourceTransactions:identity.ownerConfirmedSourceTransactions,proofReference:proof.relatedReference,orderOccurredAt:source.occurredAt,proofOccurredAt:proof.occurredAt,postingDelaySeconds:(Date.parse(proof.occurredAt)-Date.parse(source.occurredAt))/1000,reversible:true}]));
}
module.exports={findWalletStatementTopUpFunding,validatedWalletProofs};
