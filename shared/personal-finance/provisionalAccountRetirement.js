'use strict';
const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'').replace(/^\u4e2d\u56fd(?=\u5efa\u8bbe|\u5de5\u5546|\u519c\u4e1a|\u6c11\u751f)/,'');
// An archived, never-observed placeholder is an alias rather than another asset
// only after every original channel row has its own verified actual bank leg.
// Keep its balance unknown and expose the reason it is excluded; never fill zero.
function verifiedProvisionalRetirements(ledger,transactions){
 const accounts=ledger.accounts||[],observations=ledger.observations||[],am=new Map(accounts.map(a=>[a.id,a])),raw=new Map(observations.map(o=>[o.id,o])),bySource=new Map(transactions.flatMap(t=>t.observationIds.map(id=>[id,t]))),identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),result=new Map();
 for(const a of accounts){
  if(a.status!=='archived'||a.type!=='debit_card'||a.maskedIdentifier!==''||a.openingBalanceMinor!=null||a.openingDate!=null||observations.some(o=>o.financialAccountId===a.id||o.accountRelations?.some(r=>r.financialAccountId===a.id))||(ledger.imports||[]).some(i=>i.financialAccountId===a.id)||(ledger.balanceSnapshots||[]).some(s=>s.financialAccountId===a.id)||transactions.some(t=>BigInt(t.cashEffects[a.id]||0)!==0n||BigInt(t.balanceEffects[a.id]||0)!==0n))continue;
  const rules=[];for(const source of accounts){if(source.status!=='active'||source.type!=='wallet'||source.provider!=='alipay'||!source.historicalCardBindings)continue;try{require('./historicalCardBindings').validateHistoricalCardBindings(source.historicalCardBindings);}catch{continue;}for(const rule of source.historicalCardBindings.rules)if(rule.identityBasis==='owner_separated_named_channel'&&rule.financialAccountId===a.id&&rule.confidence==='owner_confirmed'&&rule.usage==='funding'&&rule.type===a.type&&norm(rule.institution)===norm(a.provider))rules.push({source,rule});}
  if(!rules.length)continue;const covered=observations.filter(o=>o.status==='completed'&&rules.some(({source,rule})=>o.financialAccountId===source.id&&o.provider===source.provider&&norm(o.paymentChannel)===norm(rule.channel)&&o.date>=rule.periodStart&&o.date<=rule.periodEnd&&(!rule.sourceTransactionIds||rule.sourceTransactionIds.includes(o.sourceTransactionId))));
  if(!covered.length)continue;const events=new Map();for(const o of covered){const key=identity(o);if(!events.has(key))events.set(key,[]);events.get(key).push(o);}const actualIds=new Set(),bankIds=new Set();let complete=true;
  for(const versions of events.values()){const o=versions[0],matched=versions.map(o=>bySource.get(o.id)),t=matched[0];
   if(!t||matched.some(x=>x?.id!==t.id)||versions.some(v=>v.amountMinor!==o.amountMinor||v.currency!==o.currency)||BigInt(t.cashEffects[a.id]||0)!==0n||BigInt(t.balanceEffects[a.id]||0)!==0n){complete=false;break;}
   const bankEvents=new Map();for(const source of t.sources){const b=raw.get(source.id),account=am.get(b?.financialAccountId);if(!b?.statementFlow||!['bank','savings','debit_card'].includes(account?.type)||b.status!=='completed'||!['debit','credit'].includes(b.direction))continue;const key=identity(b);if(!bankEvents.has(key)||(b.sourceVersionOrdinal||0)>(bankEvents.get(key).sourceVersionOrdinal||0))bankEvents.set(key,b);}
   if(bankEvents.size!==1){complete=false;break;}const bank=[...bankEvents.values()][0],target=am.get(bank.financialAccountId);
   if(target.status!=='active'||target.type!=='debit_card'||!/^\d{4}$/.test(target.maskedIdentifier||'')||target.currency!==o.currency||target.id===a.id||norm(target.provider)!==norm(a.provider)||bank.direction!=='debit'||bank.amountMinor!==o.amountMinor||bank.currency!==o.currency||String(t.cashEffects[target.id])!=='-'+o.amountMinor||String(t.balanceEffects[target.id])!=='-'+o.amountMinor){complete=false;break;}
   bankIds.add(bank.id);actualIds.add(target.id);
  }
  if(complete&&bankIds.size===events.size)result.set(a.id,{status:'superseded_provisional_identity',confidence:'inferred_from_reconciled_originals',financialAccountIds:[...actualIds].sort(),sourceObservationIds:covered.map(o=>o.id).sort(),bankEvidenceObservationIds:[...bankIds].sort(),originalTransactionCount:events.size,allOriginalChannelTransactionsIndividuallyEvidenced:true,balanceStillUnknown:true});
 }
 return result;
}
module.exports={verifiedProvisionalRetirements};
