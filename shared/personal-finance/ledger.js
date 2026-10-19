'use strict';

const {ACCOUNT_PRODUCTS,ACCOUNT_RELATION_ACTIVITIES,relationDelta}=require('./accountProducts');
const {validateInvestmentTrade,latestInvestmentConfirmations}=require('./investmentTrades');
const {fundingIdentity,sameBankAccount}=require('./assetRegister');
const {statementBalances}=require('./balanceEvidence');
const {statementCoverage,incomeExpenseAccounts,portfolioBalances}=require('./accountAnalytics');
const fail = code => Object.assign(new Error(code), {code});
const integer = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
function validDate(value) { return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value; }
function validateRecord(r) {
  if(!r || !integer(r.amountMinor) || !validDate(r.date) || typeof r.occurredAt!=='string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(r.occurredAt) || Number.isNaN(Date.parse(r.occurredAt)) || !/^[A-Z]{3}$/.test(r.currency||'') || !['debit','credit','neutral'].includes(r.direction) || !['expense','income','transfer','refund','loan_drawdown','debt_payment','interest','fee','unknown'].includes(r.kind) || !['completed','pending','failed'].includes(r.status)) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  for(const key of ['balanceMinor','principalMinor','interestMinor','feeMinor']) if(r[key]!==null && !(typeof r[key]==='string' && /^-?(0|[1-9]\d*)$/.test(r[key]) && (key==='balanceMinor'||BigInt(r[key])>=0n))) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  for(const key of ['sourceTransactionId','description','counterparty','category','paymentChannel','paymentAccountHint','relatedReference']) if(typeof r[key]!=='string' || r[key].length>4000) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  if(!r.rawFields || typeof r.rawFields!=='object' || Array.isArray(r.rawFields)) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  if(r.kind==='debt_payment' && ['principalMinor','interestMinor','feeMinor'].every(k=>r[k]!==null) && ['principalMinor','interestMinor','feeMinor'].reduce((s,k)=>s+BigInt(r[k]),0n)!==BigInt(r.amountMinor)) throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  if(r.accountRelations!==undefined&&(!Array.isArray(r.accountRelations)||r.accountRelations.length>4||r.accountRelations.some(v=>!v||!Object.hasOwn(ACCOUNT_PRODUCTS,v.product)||!ACCOUNT_RELATION_ACTIVITIES.has(v.activity)||!['target','funding'].includes(v.role)||v.financialAccountId!==undefined&&(typeof v.financialAccountId!=='string'||!v.financialAccountId||v.financialAccountId.length>512))))throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
  if(r.investmentTrade!==undefined)validateInvestmentTrade(r.investmentTrade,r);
  if(r.bankStatement!==undefined){const e=r.bankStatement;if(!e||e.schema!=='minsheng-credit-v1'||!validDate(e.statementDate)||!validDate(e.postedDate)||!/^\d{4}$/.test(e.cardTail)||e.postedDate<r.date||e.postedDate>e.statementDate||r.balanceMinor!==null||!['expense','refund','debt_payment'].includes(r.kind))throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');}
  if(r.balanceEvidence!==undefined){const e=r.balanceEvidence;if(!e||!['alipay-balance-proof-v1','alipay-yuebao-balance-v1','yuebao-asset-certificate-v1','minsheng-credit-balance-v1'].includes(e.schema)||r.amountMinor!=='0'||r.direction!=='neutral'||r.balanceMinor===null||!integer(e.incomeMinor)||!integer(e.expenseMinor)||!Number.isInteger(e.sequence)||e.sequence<1)throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');}
  if(r.statementFlow!==undefined){const e=r.statementFlow;if(!e||!['mybank-current-v1','mybank-yulibao-v1','huaxia-debit-v1'].includes(e.schema)||!integer(e.incomeMinor)||!integer(e.expenseMinor)||!Number.isInteger(e.sequence)||e.sequence<1||!validDate(e.periodStart)||!validDate(e.periodEnd)||r.balanceMinor===null||BigInt(e.incomeMinor)-BigInt(e.expenseMinor)!==BigInt(r.amountMinor)*(r.direction==='credit'?1n:r.direction==='debit'?-1n:0n))throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');}
  return r;
}
const signed = o => o.direction==='neutral'?0n:BigInt(o.amountMinor)*(o.direction==='credit'?1n:-1n);
const liability = a => ['credit_card','loan'].includes(a?.type);
const calibrationOnly = a => ['investment','insurance','receivable','property','precious_metal','retirement'].includes(a?.type)&&!['alipay_yulibao','alipay_yuebao'].includes(a?.sourceProduct);
const money = () => ({consumptionMinor:0n,incomeMinor:0n,cashInMinor:0n,cashOutMinor:0n,netCashFlowMinor:0n});
const dictionary = () => Object.create(null);
const serial = value => typeof value==='bigint'?value.toString():Array.isArray(value)?value.map(serial):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,serial(v)])):value;
function fundingAccount(o,accounts) {
  const identity=fundingIdentity(o.paymentChannel);
  if(identity){const matches=accounts.filter(a=>a.id!==o.financialAccountId&&sameBankAccount(a,identity,o.currency));return matches.length===1?matches[0]:null;}
  if(!o.paymentAccountHint) return null;
  const normalized=value=>{const v=String(value||'').normalize('NFKC').replace(/\s/g,'');const tail=v.match(/(\d{4})[)）]?$/);return tail?'tail:'+tail[1]:v;};
  const matches=accounts.filter(a=>a.id!==o.financialAccountId && a.currency===o.currency && (a.id===o.paymentAccountHint || a.maskedIdentifier && normalized(a.maskedIdentifier)===normalized(o.paymentAccountHint)));
  return matches.length===1?matches[0]:null;
}

function buildFinanceView(ledger,options={}) {
  const accounts=ledger.accounts||[], originalObservations=ledger.observations||[],originalById=new Map(originalObservations.map(o=>[o.id,o])),latestAnnotations=new Map();
  for(const a of ledger.annotations||[])if(!latestAnnotations.has(a.observationId)||BigInt(a.revision)>BigInt(latestAnnotations.get(a.observationId).revision))latestAnnotations.set(a.observationId,a);
  const observations=originalObservations.filter(o=>!o.balanceEvidence).map(o=>latestAnnotations.has(o.id)?{...o,...latestAnnotations.get(o.id).patch}:o),links=(ledger.links||[]).filter(l=>l.status!=='deleted'&&l.observationIds.every(id=>!originalById.get(id)?.balanceEvidence)), accountMap=new Map(accounts.map(a=>[a.id,a]));
  const selected=new Set(options.accountIds||accounts.map(a=>a.id));
  const coveredByStatement=statementCoverage(observations);
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
  // Card statement receipts have no platform order ID. A unique merchant,
  // funding-card, trade-date, amount and direction match can link them. We keep
  // uncertain overlaps visible rather than silently asserting an identity.
  const statementOverlaps=new Map(),statementMatches=new Map(),statementReverse=new Map();
  const merchant=v=>String(v||'').normalize('NFKC').replace(/^(?:\u652f\u4ed8\u5b9d|\u8d22\u4ed8\u901a|\u5fae\u4fe1\u652f\u4ed8|\u94f6\u8054\u626b\u7801)[-\s:]*/,'').replace(/[\s\p{P}]/gu,'');
  for(const s of observations){
    if(!['alipay','wechat'].includes(s.provider)||s.status!=='completed')continue;
    const fund=fundingAccount(s,accounts);if(!fund)continue;
    const possible=(moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,s.direction,fund.id]))||[]).filter(b=>b.bankStatement&&b.kind===s.kind&&!blocked.has([s.id,b.id].sort().join('|'))&&root(s.id)!==root(b.id));
    if(!possible.length)continue;
    statementOverlaps.set(s.id,possible);
    const name=merchant(s.counterparty),matches=possible.filter(b=>{const other=merchant(b.counterparty||b.description);return name&&other&&(name===other||Math.min(name.length,other.length)>=4&&(name.startsWith(other)||other.startsWith(name)));});
    if(matches.length===1){statementMatches.set(s.id,matches[0].id);if(!statementReverse.has(matches[0].id))statementReverse.set(matches[0].id,[]);statementReverse.get(matches[0].id).push(s.id);}
  }
  for(const [s,b] of statementMatches)if(statementReverse.get(b).length===1)union(s,b);
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
      if(o.kind==='income') income=o.direction==='debit'?-amount:amount;
      if(o.kind==='debt_payment') {
        if(['principalMinor','interestMinor','feeMinor'].every(k=>o[k]!==null)) consumption=BigInt(o.interestMinor)+BigInt(o.feeMinor);
        else unresolvedAssociations.push({reason:'unsplit_debt_payment',observationId:o.id});
      }
      if(o.kind==='unknown') unresolvedAssociations.push({reason:'unknown_kind',observationId:o.id});
    }
    const investmentConfirmations=latestInvestmentConfirmations(sources);
    consumption+=investmentConfirmations.reduce((sum,source)=>sum+BigInt(source.investmentTrade.feeMinor),0n);
    for(const confirmation of investmentConfirmations)if(!confirmation.investmentTrade.fundCode)unresolvedAssociations.push({reason:'unidentified_fund_conversion',observationId:confirmation.id});
    const effects=new Map(), flow=new Map(),effectTimes=new Map();
    const knownFundingAccounts=[...new Set(sources.filter(s=>s.status==='completed'&&accountMap.get(s.financialAccountId)?.type!=='wallet').map(s=>s.financialAccountId))].map(id=>accountMap.get(id)).filter(Boolean);
    const latestEffects=new Map();for(const s of sources)if(s.sourceIdentity&&s.status==='completed'){const key=JSON.stringify([s.financialAccountId,s.sourceIdentity]);if(!latestEffects.has(key)||(s.sourceVersionOrdinal||0)>(latestEffects.get(key).sourceVersionOrdinal||0))latestEffects.set(key,s);}
    const effectSources=sources.filter(s=>!s.sourceIdentity||s.status==='completed'&&latestEffects.get(JSON.stringify([s.financialAccountId,s.sourceIdentity]))===s);
    for(const s of effectSources) {
      if(s.status!=='completed')continue;
      const a=accountMap.get(s.financialAccountId);if(!a)continue;
      const shanghai=s.provider==='alipay'&&s.paymentChannel.startsWith('\u4e0a\u6d77\u94f6\u884c\u4fe1\u7528\u8d2d')?accounts.filter(a=>a.sourceProduct==='alipay_shanghai_credit'&&a.currency===s.currency):[];
      const relations=(s.accountRelations||[]).map(r=>shanghai.length===1&&r.role==='funding'&&r.product==='alipay_huabei'?{...r,product:'alipay_shanghai_credit',financialAccountId:shanghai[0].id}:r);
      for(const relation of relations){const target=accountMap.get(relation.financialAccountId);if(!target||target.currency!==s.currency){unresolvedAssociations.push({reason:'unresolved_product_account',observationId:s.id,product:relation.product});continue;}const delta=relationDelta(relation,BigInt(s.amountMinor),s);effects.set(target.id,delta);effectTimes.set(target.id,s.occurredAt);if(!liability(target))flow.set(target.id,delta);}
      if(relations.length){
        if(relations.some(r=>r.role==='funding'))continue;
        const target=relations.find(r=>r.role==='target');
        if(['investment_income','investment_exchange','investment_confirmation'].includes(target?.activity))continue;
        const incoming=['investment_withdrawal','loan_drawdown'].includes(target?.activity),delta=BigInt(s.amountMinor)*(incoming?1n:-1n);
        const fund=fundingAccount(s,accounts);
        if(fund){
          const possible=(moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,incoming?'credit':'debit',fund.id]))||[]).filter(candidate=>!sources.some(source=>source.id===candidate.id));
          const distinct=possible.length&&possible.every(candidate=>links.some(l=>l.type==='distinct'&&l.observationIds.includes(s.id)&&l.observationIds.includes(candidate.id)));
          if(possible.length&&!distinct)unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,candidateObservationIds:possible.slice(0,64).map(candidate=>candidate.id),candidateCount:possible.length});
          else {effects.set(fund.id,delta);effectTimes.set(fund.id,s.occurredAt);if(!liability(fund))flow.set(fund.id,delta);}
        }
        else if(!s.paymentAccountHint&&/^(余额|账户余额|支付宝余额|零钱)$/.test((s.paymentChannel||'').trim())){effects.set(a.id,delta);effectTimes.set(a.id,s.occurredAt);flow.set(a.id,delta);}
        else unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,paymentAccountHint:s.paymentAccountHint});
        continue;
      }
      if(s.direction==='neutral'&&['transfer','debt_payment'].includes(s.kind))unresolvedAssociations.push({reason:'unresolved_account_movement',observationId:s.id});

      const fund=fundingAccount(s,accounts)||(a.type==='wallet'&&knownFundingAccounts.length===1?knownFundingAccounts[0]:null);
      if(a.type==='wallet' && (s.paymentAccountHint||fund)) {
        if(!fund) unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,paymentAccountHint:s.paymentAccountHint});
        const possibleBankSources=fund?(moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,s.direction,fund.id]))||[]).filter(o=>!sources.some(source=>source.id===o.id)):[];
        const confirmedDistinct=possibleBankSources.length&&possibleBankSources.every(o=>links.some(l=>l.type==='distinct'&&l.observationIds.includes(s.id)&&l.observationIds.includes(o.id)));
        if(possibleBankSources.length&&!confirmedDistinct)unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,candidateObservationIds:possibleBankSources.slice(0,64).map(o=>o.id),candidateCount:possibleBankSources.length});
        if(fund && !sources.some(x=>x.financialAccountId===fund.id) && (!possibleBankSources.length||confirmedDistinct)) { effects.set(fund.id,signed(s));effectTimes.set(fund.id,s.occurredAt);if(!liability(fund))flow.set(fund.id,signed(s)); }
        continue;
      }
      const balanceDelta=a.type==='loan'&&s.kind==='debt_payment'?(s.principalMinor===null?0n:BigInt(s.principalMinor)):a.type==='loan'&&s.kind==='loan_drawdown'?-BigInt(s.amountMinor):signed(s);
      effects.set(a.id,balanceDelta);
      effectTimes.set(a.id,s.occurredAt);
      if(!liability(a))flow.set(a.id,signed(s));
    }
    const coveredEffects=[];
    for(const [accountId] of effects){
      const coverage=coveredByStatement(accountId,o.currency,Date.parse(effectTimes.get(accountId)||o.occurredAt));
      if(coverage&&!effectSources.some(s=>s.financialAccountId===accountId&&s.statementFlow)){
        effects.delete(accountId);flow.delete(accountId);effectTimes.delete(accountId);
        coveredEffects.push({financialAccountId:accountId,importId:coverage.importId});
      }
    }
    // Interest explicitly reported by the owning statement must not be counted
    // again from a platform's product relationship.
    if(income!==0n&&coveredEffects.some(e=>sources.some(s=>(s.accountRelations||[]).some(r=>r.financialAccountId===e.financialAccountId&&r.activity==='investment_income'))))income=0n;
    const statisticsExclusions=[];
    for(const s of sources){const overlap=statementOverlaps.get(s.id);if(overlap?.length&&!overlap.some(b=>sources.some(source=>source.id===b.id))){statisticsExclusions.push({observationId:s.id,candidateObservationIds:overlap.map(b=>b.id),reason:'card_statement_overlap_requires_review'});}}
    const pendingConsumption=statisticsExclusions.length?consumption:0n,pendingIncome=statisticsExclusions.length?income:0n;
    if(statisticsExclusions.length){consumption=0n;income=0n;unresolvedAssociations.push(...statisticsExclusions);}
    const reportingAccountIds=incomeExpenseAccounts(effectSources,accounts,fundingAccount,effects);
    const reportSelected=reportingAccountIds.some(id=>selected.has(id))||accounts.every(a=>selected.has(a.id));
    if(!reportingAccountIds.length&&(consumption!==0n||income!==0n))unresolvedAssociations.push({reason:'unallocated_income_expense',observationId:o.id});
    const associated=new Set([...sources.map(s=>s.financialAccountId),...sources.flatMap(s=>(s.accountRelations||[]).map(r=>r.financialAccountId).filter(Boolean)),...effects.keys(),...reportingAccountIds]);
    const selectedSources=sources.filter(s=>selected.has(s.financialAccountId));
    all.push({...o,id,reportingAccountIds,coveredEffects,statisticsExclusions,pendingConsumptionMinor:pendingConsumption,pendingIncomeMinor:pendingIncome,selectedConsumptionMinor:reportSelected?consumption:0n,selectedIncomeMinor:reportSelected?income:0n,investmentConfirmations:investmentConfirmations.map(source=>({id:source.id,date:source.date,...source.investmentTrade})),observationIds:sources.map(s=>s.id),financialAccountIds:[...associated],sources:sources.map(s=>originalById.get(s.id)),appliedAnnotations:sources.filter(s=>latestAnnotations.has(s.id)).map(s=>latestAnnotations.get(s.id)),consumptionMinor:consumption,incomeMinor:income,balanceEffects:Object.fromEntries(effects),balanceEffectTimes:Object.fromEntries(effectTimes),cashEffects:Object.fromEntries(flow),selectedObservationIds:selectedSources.map(s=>s.id),relatedTransactionId:null});
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
      const bucket=totals[t.currency]||(totals[t.currency]=money());bucket.consumptionMinor+=t.selectedConsumptionMinor;bucket.incomeMinor+=t.selectedIncomeMinor;
      const details=breakdown[t.currency]||(breakdown[t.currency]={cashFundedConsumptionMinor:0n,creditFundedConsumptionMinor:0n,loanPrincipalPaidMinor:0n,interestPaidMinor:0n,feesPaidMinor:0n,unsplitDebtPaymentMinor:0n});
      if(t.status==='completed'&&t.kind==='debt_payment'&&t.reportingAccountIds.some(id=>selected.has(id))) { if(['principalMinor','interestMinor','feeMinor'].every(k=>t[k]!==null)){details.loanPrincipalPaidMinor+=BigInt(t.principalMinor);details.interestPaidMinor+=BigInt(t.interestMinor);details.feesPaidMinor+=BigInt(t.feeMinor);}else details.unsplitDebtPaymentMinor+=BigInt(t.amountMinor); }
      const cats=categories[t.currency]||(categories[t.currency]=dictionary());if(t.selectedConsumptionMinor!==0n)cats[t.category||'Uncategorized']=(cats[t.category||'Uncategorized']||0n)+t.selectedConsumptionMinor;
      for(const [id,delta] of Object.entries(t.cashEffects)) if(selected.has(id)) {if(delta>0n)bucket.cashInMinor+=delta;else bucket.cashOutMinor-=delta;}
      bucket.netCashFlowMinor=bucket.cashInMinor-bucket.cashOutMinor;
      const fundingIds=t.reportingAccountIds;
      for(const id of fundingIds) if(selected.has(id)&&t.selectedConsumptionMinor!==0n) {const b=funding[id]||(funding[id]=dictionary());b[t.currency]=(b[t.currency]||0n)+t.selectedConsumptionMinor;details[liability(accountMap.get(id))?'creditFundedConsumptionMinor':'cashFundedConsumptionMinor']+=t.selectedConsumptionMinor;break;}
    }
    return {currencyTotals:totals,categoryTotals:categories,fundingTotals:funding,fundingBreakdown:breakdown};
  };
  const transactions=all.filter(t=>t.financialAccountIds.some(a=>selected.has(a))&&(!options.startDate||t.date>=options.startDate)&&(!options.endDate||t.date<=options.endDate));
  const summary=summarize(transactions),accountStats=dictionary();
  const statementAnchors=statementBalances(originalObservations,accounts);
  for(const a of accounts.filter(a=>selected.has(a.id))) {
    const current=transactions.filter(t=>t.financialAccountIds.includes(a.id));const stats={financialAccountId:a.id,currency:a.currency,...money(),balanceMinor:null,balanceAnchor:null,balanceStatus:'uncalibrated'};
    for(const t of current) {const delta=t.cashEffects[a.id]||0n;if(delta>0n)stats.cashInMinor+=delta;else stats.cashOutMinor-=delta;if(t.reportingAccountIds.includes(a.id)){stats.consumptionMinor+=t.consumptionMinor;stats.incomeMinor+=t.incomeMinor;}}
    stats.netCashFlowMinor=stats.cashInMinor-stats.cashOutMinor;
    const targetTime=options.endDate?Date.parse(options.endDate+'T23:59:59.999+08:00'):Infinity;
    let anchors=(ledger.balanceSnapshots||[]).filter(s=>s.financialAccountId===a.id&&s.currency===a.currency).map(s=>({...s,time:Date.parse(s.asOf)}));
    if(a.openingBalanceMinor!==null&&a.openingDate) anchors.push({id:null,source:'opening_balance',balanceConvention:a.balanceConvention,asOf:a.openingDate+'T00:00:00+08:00',balanceMinor:a.openingBalanceMinor,time:Date.parse(a.openingDate+'T00:00:00+08:00')});
    anchors.push(...statementAnchors.filter(s=>s.financialAccountId===a.id&&s.currency===a.currency));
    const prior=anchors.filter(s=>s.time<=targetTime);
    anchors=prior.length?prior:calibrationOnly(a)?[]:anchors;
    for(const anchor of anchors)if(liability(a)&&anchor.balanceConvention!=='signed')anchor.balanceMinor=(-BigInt(anchor.balanceMinor)).toString();
    const anchorPriority=s=>s.source==='opening_balance'?0:s.source==='statement_observation'?1:2;
    const createdTime=s=>s.createdAt?Date.parse(s.createdAt):0;
    anchors.sort((x,y)=>(prior.length?y.time-x.time:x.time-y.time)||anchorPriority(y)-anchorPriority(x)||createdTime(y)-createdTime(x));
    if(anchors[0]) {
      const anchor=anchors[0],tied=anchors.filter(s=>s.time===anchor.time&&anchorPriority(s)===anchorPriority(anchor)&&createdTime(s)===createdTime(anchor));
      if(new Set(tied.map(s=>s.balanceMinor)).size>1)unresolvedAssociations.push({reason:'ambiguous_balance_anchor',financialAccountId:a.id,candidateSnapshotIds:tied.map(s=>s.id)});
      else {stats.balanceAnchor={id:anchor.id,source:anchor.source,asOf:anchor.asOf};stats.balanceStatus='calibrated';stats.balanceMinor=BigInt(anchor.balanceMinor);stats.balanceAsOf=options.endDate||anchor.asOf.slice(0,10);const reverse=anchor.time>targetTime;if(reverse)stats.balanceStatus='derived';if(!calibrationOnly(a))for(const t of all){const time=Date.parse(t.balanceEffectTimes[a.id]||t.occurredAt);if(reverse?time>targetTime&&time<=anchor.time:(anchor.source==='opening_balance'?time>=anchor.time:time>anchor.time)&&time<=targetTime){
        if(a.type==='loan'&&t.kind==='debt_payment'&&t.principalMinor===null&&Object.hasOwn(t.balanceEffects,a.id)){stats.balanceMinor=null;stats.balanceStatus='uncalibrated';unresolvedAssociations.push({reason:'unsplit_loan_balance',financialAccountId:a.id,observationId:t.observationIds[0]});break;}
        stats.balanceMinor+=(t.balanceEffects[a.id]||0n)*(reverse?-1n:1n);
        if(Object.hasOwn(t.balanceEffects,a.id))stats.balanceStatus='derived';
      }}}
    }
    accountStats[a.id]=stats;
  }
  let comparison=null;
  if(validDate(options.startDate)&&validDate(options.endDate)&&options.startDate<=options.endDate) {const span=(Date.parse(options.endDate)-Date.parse(options.startDate))/86400000+1;const previousEnd=new Date(Date.parse(options.startDate)-86400000).toISOString().slice(0,10),previousStart=new Date(Date.parse(options.startDate)-span*86400000).toISOString().slice(0,10);comparison={current:{startDate:options.startDate,endDate:options.endDate,...summary},previous:{startDate:previousStart,endDate:previousEnd,...summarize(all.filter(t=>t.financialAccountIds.some(id=>selected.has(id))&&t.date>=previousStart&&t.date<=previousEnd))}};}
  return serial({transactions,investmentTrades:transactions.flatMap(t=>t.investmentConfirmations),accountStats,portfolioBalances:portfolioBalances(accountStats),...summary,comparison,unresolvedAssociations});
}
module.exports={buildFinanceView,validateRecord,validDate};
