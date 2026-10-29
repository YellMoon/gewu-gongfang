'use strict';
// Preserve both bank postings. A full original account fingerprint, adjacent
// native sequence and equal opposite cash amounts prove an internal offset;
// neither a second card nor a hidden income/expense split is invented.
function findNativeBankOffsets(observations,accounts,imports,{annotatedIds=new Set(),links=[]}={}){
 const byId=new Map(observations.map(o=>[o.id,o])),am=new Map(accounts.map(a=>[a.id,a])),identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity)),result=new Map();
 const vetoed=new Set(links.filter(l=>l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type)||l.status==='deleted'&&l.type==='duplicate').flatMap(l=>l.observationIds));
 for(const imp of imports){const a=am.get(imp.financialAccountId),meta=imp.statementAccountIdentities,owner=imp.statementOwner?.fullName;
  if(imp.provider!=='ccb'||imp.templateId!=='ccb-debit-v1'||!/^[a-f0-9]{64}$/.test(imp.fileHash||'')||!owner||a?.status!=='active'||a.type!=='debit_card'||a.maskedIdentifier!==meta?.ownMaskedIdentifier)continue;
  try{require('./statementAccountIdentities').validateStatementAccountIdentities(meta);require('./statementOwnership').validateStatementOwner(imp.statementOwner);}catch{continue;}
  const ownIds=new Set(meta.counterpartFingerprints.filter(e=>e.fingerprint===meta.ownAccountFingerprint&&e.maskedIdentifier===a.maskedIdentifier).map(e=>e.sourceTransactionId)),rows=(imp.observationIds||[]).map(id=>byId.get(id)).filter(Boolean).sort((x,y)=>(x.statementFlow?.sequence||0)-(y.statementFlow?.sequence||0));
  const valid=o=>o.financialAccountId===a.id&&o.provider==='ccb'&&o.status==='completed'&&o.kind==='unknown'&&o.currency===a.currency&&o.statementFlow?.schema==='ccb-debit-v1'&&ownIds.has(o.sourceTransactionId)&&!blocked.has(identity(o))&&!vetoed.has(o.id)&&o.counterparty===owner&&o.rawFields?.dateBasis==='transaction_date'&&o.rawFields['\u4ea4\u6613\u65e5\u671f']===o.date.replace(/-/g,'')&&o.rawFields['\u4ea4\u6613\u5730\u70b9/\u9644\u8a00']==='\u5efa\u884c\u6d59\u6c5f\u5206\u884c\u5e10\u52a1\u4e2d'&&typeof o.balanceMinor==='string'&&BigInt(o.amountMinor)>0n;
  for(let i=0;i<rows.length-1;i++){const c=rows[i],d=rows[i+1];if(!valid(c)||!valid(d)||c.direction!=='credit'||d.direction!=='debit'||c.date!==d.date||c.amountMinor!==d.amountMinor||d.statementFlow.sequence!==c.statementFlow.sequence+1||c.rawFields['\u6458\u8981']!=='\u8f6c\u8d26\u5b58\u5165'||d.rawFields['\u6458\u8981']!=='\u8f6c\u8d26\u652f\u53d6'||BigInt(c.balanceMinor)-BigInt(c.amountMinor)!==BigInt(d.balanceMinor))continue;
   const proof={method:'native_same_account_offsetting_entries',confidence:'explicit_original_cash_pair',evidenceObservationIds:[c.id,d.id],sourceImportId:imp.id,ownAccountIdentityVerified:true,doesNotIdentifyAnotherCardOrProduct:true};for(const o of [c,d])result.set(o.id,{kind:'transfer',automaticClassification:proof});
  }
 }
 return result;
}
module.exports={findNativeBankOffsets};
