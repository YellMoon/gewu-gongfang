'use strict';

const fail = code => Object.assign(new Error(code), {code});
const integer = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
function validDate(value) { return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value; }
function validateRecord(r) {
  if(!r || !integer(r.amountMinor) || !validDate(r.date) || typeof r.occurredAt!=='string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(r.occurredAt) || Number.isNaN(Date.parse(r.occurredAt)) || !/^[A-Z]{3}$/.test(r.currency||'') || !['debit','credit'].includes(r.direction) || !['expense','income','transfer','refund','loan_drawdown','debt_payment','interest','fee','unknown'].includes(r.kind) || !['completed','pending','failed'].includes(r.status)) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  for(const key of ['balanceMinor','principalMinor','interestMinor','feeMinor']) if(r[key]!==null && !(typeof r[key]==='string' && /^-?(0|[1-9]\d*)$/.test(r[key]) && (key==='balanceMinor'||BigInt(r[key])>=0n))) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  for(const key of ['sourceTransactionId','description','counterparty','category','paymentChannel','paymentAccountHint','relatedReference']) if(typeof r[key]!=='string' || r[key].length>4000) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  if(!r.rawFields || typeof r.rawFields!=='object' || Array.isArray(r.rawFields)) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  if(r.kind==='debt_payment' && ['principalMinor','interestMinor','feeMinor'].every(k=>r[k]!==null) && ['principalMinor','interestMinor','feeMinor'].reduce((s,k)=>s+BigInt(r[k]),0n)!==BigInt(r.amountMinor)) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  return r;
}
const signed = o => BigInt(o.amountMinor)*(o.direction==='credit'?1n:-1n);
const liability = a => ['credit_card','loan'].includes(a?.type);
const calibrationOnly = a => ['investment','insurance','receivable','property','precious_metal','retirement'].includes(a?.type);
const money = () => ({consumptionMinor:0n,incomeMinor:0n,cashInMinor:0n,cashOutMinor:0n,netCashFlowMinor:0n});
const dictionary = () => Object.create(null);
const serial = value => typeof value==='bigint'?value.toString():Array.isArray(value)?value.map(serial):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,serial(v)])):value;
function fundingAccount(o,accounts) {
  if(!o.paymentAccountHint) return null;
  const normalized=value=>{const v=String(value||'').normalize('NFKC').replace(/\s/g,'');const tail=v.match(/(\d{4})[)）]?$/);return tail?'tail:'+tail[1]:v;};
  const matches=accounts.filter(a=>a.id!==o.financialAccountId && a.currency===o.currency && (a.id===o.paymentAccountHint || a.maskedIdentifier && normalized(a.maskedIdentifier)===normalized(o.paymentAccountHint)));
  return matches.length===1?matches[0]:null;
}

function buildFinanceView(ledger,options={}) {
  const accounts=ledger.accounts||[], originalObservations=ledger.observations||[],originalById=new Map(originalObservations.map(o=>[o.id,o])),latestAnnotations=new Map();
  for(const a of ledger.annotations||[])if(!latestAnnotations.has(a.observationId)||BigInt(a.revision)>BigInt(latestAnnotations.get(a.observationId).revision))latestAnnotations.set(a.observationId,a);
  const observations=originalObservations.map(o=>latestAnnotations.has(o.id)?{...o,...latestAnnotations.get(o.id).patch}:o),links=(ledger.links||[]).filter(l=>l.status!=='deleted'), accountMap=new Map(accounts.map(a=>[a.id,a]));
  const selected=new Set(options.accountIds||accounts.map(a=>a.id));
  const parents=new Map(observations.map(o=>[o.id,o.id]));
  const root=id=>{while(parents.get(id)!==id) id=parents.get(id);return id;};
  const union=(a,b)=>{ if(parents.has(a)&&parents.has(b)) parents.set(root(b),root(a)); };
  const unresolvedAssociations=[];
  const pair=l=>[...l.observationIds].sort().join('|');
  const activePairs=new Set(links.map(pair));
  const blocked=new Set([...(ledger.links||[]).filter(l=>l.status==='deleted'&&l.type==='duplicate'&&!activePairs.has(pair(l))),...links.filter(l=>l.type==='distinct')].map(pair));
  for(const l of links) if(l.type==='duplicate') union(...l.observationIds);
  const sourceVersions=new Map();for(const o of observations)if(o.sourceIdentity){const key=JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity]);if(sourceVersions.has(key))union(sourceVersions.get(key),o.id);else sourceVersions.set(key,o.id);}
  for(const l of links)if(l.type==='transfer'){const pair=observations.filter(o=>l.observationIds.includes(o.id));if(pair.length===2&&pair.every(o=>o.kind==='debt_payment'))union(...l.observationIds);}
  const candidates=new Map(observations.map(o=>[root(o.id),new Set()]));
  // Index traceable references first: unrelated retail observations never require an all-pairs scan.
  const referenceBuckets=new Map(),sourceBuckets=new Map(),moneySourceBuckets=new Map(),candidatePairs=new Map(),oversized=new Set();
  const add=(map,key,o)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(o);};
  for(const o of observations)if(o.status==='completed'){
    const signature=JSON.stringify([o.date,o.amountMinor,o.currency,o.direction]);
    add(moneySourceBuckets,JSON.stringify([o.date,o.amountMinor,o.currency,o.direction,o.financialAccountId]),o);
    if(o.sourceTransactionId)add(sourceBuckets,JSON.stringify([signature,o.financialAccountId,o.provider,o.sourceTransactionId]),o);
    for(const ref of new Set([o.relatedReference,o.sourceTransactionId].filter(Boolean))){add(referenceBuckets,JSON.stringify([signature,ref]),o);if(o.kind==='debt_payment')add(referenceBuckets,JSON.stringify(['repayment',o.date,o.amountMinor,o.currency,ref]),o);}
  }
  for(const group of [...referenceBuckets.values(),...sourceBuckets.values()]){
    if(group.length>256){for(const o of group){oversized.add(o.id);unresolvedAssociations.push({reason:'ambiguous_reference',observationId:o.id,candidateObservationIds:group.filter(s=>s.id!==o.id).slice(0,64).map(s=>s.id),candidateCount:group.length-1});}continue;}
    for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){const a=group[i],b=group[j];candidatePairs.set([a.id,b.id].sort().join('|'),[a,b]);}
  }
  for(const [a,b] of candidatePairs.values()) {
    const repaymentPair=a.kind==='debt_payment'&&b.kind==='debt_payment'&&a.direction!==b.direction&&a.financialAccountId!==b.financialAccountId&&liability(accountMap.get(a.financialAccountId))!==liability(accountMap.get(b.financialAccountId));
    if(a.status!=='completed'||b.status!=='completed'||a.amountMinor!==b.amountMinor||a.currency!==b.currency||a.direction!==b.direction&&!repaymentPair||a.date!==b.date||blocked.has([a.id,b.id].sort().join('|'))||root(a.id)===root(b.id)) continue;
    const sameSource=a.financialAccountId===b.financialAccountId && a.provider===b.provider && a.sourceTransactionId && a.sourceTransactionId===b.sourceTransactionId;
    const ref=a.relatedReference && (a.relatedReference===b.relatedReference || a.relatedReference===b.sourceTransactionId) || b.relatedReference && b.relatedReference===a.sourceTransactionId;
    const funded=(fundingAccount(a,accounts)?.id===b.financialAccountId)||(fundingAccount(b,accounts)?.id===a.financialAccountId);
    if(sameSource || (ref && (funded||repaymentPair) && a.kind===b.kind)) { candidates.get(root(a.id)).add(root(b.id));candidates.get(root(b.id)).add(root(a.id)); }
  }
  for(const [id,set] of candidates){const ids=[...set];if(!oversized.has(id)&&ids.length===1&&!oversized.has(ids[0]) && candidates.get(ids[0]).size===1) union(id,ids[0]); else if(ids.length) unresolvedAssociations.push({reason:'ambiguous_reference',observationId:id,candidateObservationIds:ids});}
  const groups=new Map();for(const o of observations) {const id=root(o.id);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(o);}
  const all=[];
  for(const [id,sources] of groups) {
    const finalSources=sources.filter(s=>s.status==='completed'),eligible=finalSources.length?finalSources:sources;
    const base=[...eligible].sort((a,b)=>(b.sourceVersionOrdinal||0)-(a.sourceVersionOrdinal||0)).find(s=>s.paymentChannel)||[...eligible].sort((a,b)=>(b.sourceVersionOrdinal||0)-(a.sourceVersionOrdinal||0))[0];
    const groupAnnotations=sources.filter(s=>latestAnnotations.has(s.id)).map(s=>latestAnnotations.get(s.id)).sort((a,b)=>BigInt(a.revision)>BigInt(b.revision)?-1:1);
    const original=groupAnnotations[0]?{...base,...groupAnnotations[0].patch}:base;
    const transfer=links.find(l=>l.type==='transfer'&&l.observationIds.some(id=>sources.some(s=>s.id===id)));
    const o=transfer&&original.kind!=='debt_payment'?{...original,kind:'transfer'}:original, amount=BigInt(o.amountMinor);
    let consumption=0n,income=0n;
    if(o.status==='completed') {
      if(['expense','interest','fee'].includes(o.kind)) consumption=amount;
      if(o.kind==='refund') consumption=-amount;
      if(o.kind==='income') income=amount;
      if(o.kind==='debt_payment') {
        if(['principalMinor','interestMinor','feeMinor'].every(k=>o[k]!==null)) consumption=BigInt(o.interestMinor)+BigInt(o.feeMinor);
        else unresolvedAssociations.push({reason:'unsplit_debt_payment',observationId:o.id});
      }
      if(o.kind==='unknown') unresolvedAssociations.push({reason:'unknown_kind',observationId:o.id});
    }
    const effects=new Map(), flow=new Map(),effectTimes=new Map();
    const knownFundingAccounts=[...new Set(sources.filter(s=>s.status==='completed'&&accountMap.get(s.financialAccountId)?.type!=='wallet').map(s=>s.financialAccountId))].map(id=>accountMap.get(id)).filter(Boolean);
    const latestEffects=new Map();for(const s of sources)if(s.sourceIdentity&&s.status==='completed'){const key=JSON.stringify([s.financialAccountId,s.sourceIdentity]);if(!latestEffects.has(key)||(s.sourceVersionOrdinal||0)>(latestEffects.get(key).sourceVersionOrdinal||0))latestEffects.set(key,s);}
    const effectSources=sources.filter(s=>!s.sourceIdentity||s.status==='completed'&&latestEffects.get(JSON.stringify([s.financialAccountId,s.sourceIdentity]))===s);
    for(const s of effectSources) {
      if(s.status!=='completed')continue;
      const a=accountMap.get(s.financialAccountId);if(!a)continue;
      const fund=fundingAccount(s,accounts)||(a.type==='wallet'&&knownFundingAccounts.length===1?knownFundingAccounts[0]:null);
      if(a.type==='wallet' && (s.paymentAccountHint||fund)) {
        if(!fund) unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,paymentAccountHint:s.paymentAccountHint});
        const possibleBankSources=fund?(moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,s.direction,fund.id]))||[]).filter(o=>!sources.some(source=>source.id===o.id)):[];
        const confirmedDistinct=possibleBankSources.length&&possibleBankSources.every(o=>links.some(l=>l.type==='distinct'&&l.observationIds.includes(s.id)&&l.observationIds.includes(o.id)));
        if(possibleBankSources.length&&!confirmedDistinct)unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,candidateObservationIds:possibleBankSources.slice(0,64).map(o=>o.id),candidateCount:possibleBankSources.length});
        if(fund && !sources.some(x=>x.financialAccountId===fund.id) && (!possibleBankSources.length||confirmedDistinct)) { effects.set(fund.id,signed(s)*(liability(fund)?-1n:1n));effectTimes.set(fund.id,s.occurredAt);if(!liability(fund))flow.set(fund.id,signed(s)); }
        continue;
      }
      const balanceDelta=a.type==='loan'&&s.kind==='debt_payment'?(s.principalMinor===null?0n:-BigInt(s.principalMinor)):a.type==='loan'&&s.kind==='loan_drawdown'?BigInt(s.amountMinor):signed(s)*(liability(a)?-1n:1n);
      effects.set(a.id,balanceDelta);
      effectTimes.set(a.id,s.occurredAt);
      if(!liability(a))flow.set(a.id,signed(s));
    }
    const associated=new Set([...sources.map(s=>s.financialAccountId),...effects.keys()]);
    const selectedSources=sources.filter(s=>selected.has(s.financialAccountId));
    all.push({...o,id,observationIds:sources.map(s=>s.id),financialAccountIds:[...associated],sources:sources.map(s=>originalById.get(s.id)),appliedAnnotations:sources.filter(s=>latestAnnotations.has(s.id)).map(s=>latestAnnotations.get(s.id)),consumptionMinor:consumption,incomeMinor:income,balanceEffects:Object.fromEntries(effects),balanceEffectTimes:Object.fromEntries(effectTimes),cashEffects:Object.fromEntries(flow),selectedObservationIds:selectedSources.map(s=>s.id),relatedTransactionId:null});
  }
  for(const t of all) {
    const manual=links.find(l=>l.type==='refund'&&l.observationIds.some(id=>t.observationIds.includes(id)));
    const ref=t.relatedReference;
    if(t.kind==='refund') { const original=all.filter(x=>x.id!==t.id && x.kind==='expense' && x.currency===t.currency && (manual?manual.observationIds.some(id=>x.observationIds.includes(id)):x.sources.some(o=>o.sourceTransactionId===ref))); if(original.length===1){t.relatedTransactionId=original[0].id;t.category=original[0].category;}else unresolvedAssociations.push({reason:'unresolved_refund',observationId:t.observationIds[0],candidateTransactionIds:original.map(o=>o.id)}); }
  }
  const summarize=transactions=>{
    const totals=dictionary(),categories=dictionary(),funding=dictionary(),breakdown=dictionary();
    for(const a of accounts)if(selected.has(a.id))totals[a.currency] ||= money();
    for(const t of transactions) {
      const bucket=totals[t.currency]||(totals[t.currency]=money());bucket.consumptionMinor+=t.consumptionMinor;bucket.incomeMinor+=t.incomeMinor;
      const details=breakdown[t.currency]||(breakdown[t.currency]={cashFundedConsumptionMinor:0n,creditFundedConsumptionMinor:0n,loanPrincipalPaidMinor:0n,interestPaidMinor:0n,feesPaidMinor:0n,unsplitDebtPaymentMinor:0n});
      if(t.status==='completed'&&t.kind==='debt_payment') { if(['principalMinor','interestMinor','feeMinor'].every(k=>t[k]!==null)){details.loanPrincipalPaidMinor+=BigInt(t.principalMinor);details.interestPaidMinor+=BigInt(t.interestMinor);details.feesPaidMinor+=BigInt(t.feeMinor);}else details.unsplitDebtPaymentMinor+=BigInt(t.amountMinor); }
      const cats=categories[t.currency]||(categories[t.currency]=dictionary());if(t.consumptionMinor!==0n)cats[t.category||'Uncategorized']=(cats[t.category||'Uncategorized']||0n)+t.consumptionMinor;
      for(const [id,delta] of Object.entries(t.cashEffects)) if(selected.has(id)) {if(delta>0n)bucket.cashInMinor+=delta;else bucket.cashOutMinor-=delta;}
      bucket.netCashFlowMinor=bucket.cashInMinor-bucket.cashOutMinor;
      const fundingIds=Object.keys(t.cashEffects).length?Object.keys(t.cashEffects):Object.keys(t.balanceEffects);
      for(const id of fundingIds) if(t.consumptionMinor!==0n) {const b=funding[id]||(funding[id]=dictionary());b[t.currency]=(b[t.currency]||0n)+t.consumptionMinor;details[liability(accountMap.get(id))?'creditFundedConsumptionMinor':'cashFundedConsumptionMinor']+=t.consumptionMinor;break;}
    }
    return {currencyTotals:totals,categoryTotals:categories,fundingTotals:funding,fundingBreakdown:breakdown};
  };
  const transactions=all.filter(t=>t.financialAccountIds.some(a=>selected.has(a))&&(!options.startDate||t.date>=options.startDate)&&(!options.endDate||t.date<=options.endDate));
  const summary=summarize(transactions),accountStats=dictionary();
  for(const a of accounts.filter(a=>selected.has(a.id))) {
    const current=transactions.filter(t=>t.financialAccountIds.includes(a.id));const stats={financialAccountId:a.id,currency:a.currency,...money(),balanceMinor:null,balanceAnchor:null,balanceStatus:'uncalibrated'};
    for(const t of current) {const delta=t.cashEffects[a.id]||0n;if(delta>0n)stats.cashInMinor+=delta;else stats.cashOutMinor-=delta;stats.consumptionMinor+=t.consumptionMinor;stats.incomeMinor+=t.incomeMinor;}
    stats.netCashFlowMinor=stats.cashInMinor-stats.cashOutMinor;
    const anchors=(ledger.balanceSnapshots||[]).filter(s=>s.financialAccountId===a.id&&s.currency===a.currency&&(!options.endDate||s.asOf.slice(0,10)<=options.endDate)).map(s=>({...s,time:Date.parse(s.asOf)}));
    if(a.openingBalanceMinor!==null&&a.openingDate && (!options.endDate||a.openingDate<=options.endDate)) anchors.push({id:null,source:'opening_balance',asOf:a.openingDate+'T00:00:00Z',balanceMinor:a.openingBalanceMinor,time:Date.parse(a.openingDate)});
    for(const o of observations)if(o.financialAccountId===a.id&&o.balanceMinor!==null&&o.status==='completed'&&(!options.endDate||o.date<=options.endDate))anchors.push({id:o.id,source:'statement_observation',asOf:o.occurredAt,balanceMinor:o.balanceMinor,time:Date.parse(o.occurredAt)});
    const anchorPriority=s=>s.source==='opening_balance'?0:s.source==='statement_observation'?1:2;
    const createdTime=s=>s.createdAt?Date.parse(s.createdAt):0;
    anchors.sort((x,y)=>y.time-x.time||anchorPriority(y)-anchorPriority(x)||createdTime(y)-createdTime(x));
    if(anchors[0]) {
      const anchor=anchors[0],tied=anchors.filter(s=>s.time===anchor.time&&anchorPriority(s)===anchorPriority(anchor)&&createdTime(s)===createdTime(anchor));
      if(new Set(tied.map(s=>s.balanceMinor)).size>1)unresolvedAssociations.push({reason:'ambiguous_balance_anchor',financialAccountId:a.id,candidateSnapshotIds:tied.map(s=>s.id)});
      else {stats.balanceAnchor={id:anchor.id,source:anchor.source,asOf:anchor.asOf};stats.balanceStatus='calibrated';stats.balanceMinor=BigInt(anchor.balanceMinor);if(!calibrationOnly(a))for(const t of all)if((anchor.source==='opening_balance'?t.date>=a.openingDate:Date.parse(t.balanceEffectTimes[a.id]||t.occurredAt)>anchor.time)&&(!options.endDate||t.date<=options.endDate)){
        if(a.type==='loan'&&t.kind==='debt_payment'&&t.principalMinor===null&&Object.hasOwn(t.balanceEffects,a.id)){stats.balanceMinor=null;stats.balanceStatus='uncalibrated';unresolvedAssociations.push({reason:'unsplit_loan_balance',financialAccountId:a.id,observationId:t.observationIds[0]});break;}
        stats.balanceMinor+=t.balanceEffects[a.id]||0n;
      }}
    }
    accountStats[a.id]=stats;
  }
  let comparison=null;
  if(validDate(options.startDate)&&validDate(options.endDate)&&options.startDate<=options.endDate) {const span=(Date.parse(options.endDate)-Date.parse(options.startDate))/86400000+1;const previousEnd=new Date(Date.parse(options.startDate)-86400000).toISOString().slice(0,10),previousStart=new Date(Date.parse(options.startDate)-span*86400000).toISOString().slice(0,10);comparison={current:{startDate:options.startDate,endDate:options.endDate,...summary},previous:{startDate:previousStart,endDate:previousEnd,...summarize(all.filter(t=>t.date>=previousStart&&t.date<=previousEnd))}};}
  return serial({transactions,accountStats,...summary,comparison,unresolvedAssociations});
}
module.exports={buildFinanceView,validateRecord,validDate};
