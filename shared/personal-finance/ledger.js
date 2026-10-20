'use strict';

const {ACCOUNT_PRODUCTS,ACCOUNT_RELATION_ACTIVITIES,relationDelta,explicitCardFundingCredit}=require('./accountProducts');
const {validateInvestmentTrade,latestInvestmentConfirmations}=require('./investmentTrades');
const {fundingIdentity,sameBankAccount,buildAssetRegister}=require('./assetRegister');
const {statementBalances}=require('./balanceEvidence');
const {statementCoverage,incomeExpenseAccounts,portfolioBalances}=require('./accountAnalytics');
const {buildReviewSummary}=require('./reviewSummary');
const {buildMortgageModels,matchesMortgage}=require('./mortgages');
const {classifyBankPurpose,classifyPlatformPurpose,nonCashAuthorization}=require('./bankClassification');
const {findWechatWithdrawalMatches}=require('./withdrawals');
const {statementCounterAccount}=require('./statementAccounts');
const {findStatementRepayments}=require('./statementTransfers');
const {findReconciliationGroups}=require('./reconciliationGroups');
const fail = code => Object.assign(new Error(code), {code});
function statementClassification(o){
  o=classifyPlatformPurpose(classifyBankPurpose(o));
  if(o.bankStatement&&o.kind==='refund'&&o.direction==='credit'&&explicitCardFundingCredit(o.description))return {...o,kind:'debt_payment'};
  if(o.provider!=='huaxia'||o.kind!=='unknown'||o.status!=='completed'||o.direction!=='debit')return o;
  const loan=/\u8d37\u6b3e\u8fd8\u6b3e/.test(o.description)&&/\u4e2a\u4eba\u8d37\u6b3e\u6237/.test(o.counterparty);
  const provident=/\u516c\u79ef\u91d1\u6263\u6b3e/.test(o.description)&&/\u4f4f\u623f\u516c\u79ef\u91d1\u7ba1\u7406\u4e2d\u5fc3/.test(o.counterparty);
  return loan||provident?{...o,kind:'debt_payment'}:o;
}
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
  if(r.bankAccount!==undefined){const a=r.bankAccount;if(!a||typeof a.provider!=='string'||!['credit_card','debit_card'].includes(a.type)||!/^\d{4}$/.test(a.maskedIdentifier)||a.currency!==r.currency||!r.bankStatement&&!r.balanceEvidence&&!r.statementFlow)throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');}
  if(r.bankStatement!==undefined){const e=r.bankStatement;if(!e||!['minsheng-credit-v1','bank-credit-v1','bank-credit-detail-v1'].includes(e.schema)||(e.schema==='bank-credit-detail-v1'?e.statementDate!==undefined:!validDate(e.statementDate))||!validDate(e.postedDate)||!/^\d{4}$/.test(e.cardTail)||e.postedDate<r.date||e.postedDate>e.statementDate||r.balanceMinor!==null||!['expense','refund','debt_payment','interest','fee','unknown','transfer'].includes(r.kind))throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');}
  if(r.balanceEvidence!==undefined){const e=r.balanceEvidence;if(!e||!['alipay-balance-proof-v1','alipay-yuebao-balance-v1','yuebao-asset-certificate-v1','minsheng-credit-balance-v1','bank-credit-balance-v1'].includes(e.schema)||r.amountMinor!=='0'||r.direction!=='neutral'||r.balanceMinor===null||!integer(e.incomeMinor)||!integer(e.expenseMinor)||!Number.isInteger(e.sequence)||e.sequence<1)throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');}
  if(r.statementFlow!==undefined){const e=r.statementFlow;if(!e||!['mybank-current-v1','mybank-yulibao-v1','huaxia-debit-v1','hangzhou-debit-v1','psbc-debit-v1','jsb-debit-v1','ccb-debit-v1'].includes(e.schema)||!integer(e.incomeMinor)||!integer(e.expenseMinor)||!Number.isInteger(e.sequence)||e.sequence<1||!validDate(e.periodStart)||!validDate(e.periodEnd)||r.balanceMinor===null||BigInt(e.incomeMinor)-BigInt(e.expenseMinor)!==BigInt(r.amountMinor)*(r.direction==='credit'?1n:r.direction==='debit'?-1n:0n))throw fail('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');}
  return r;
}
const signed = o => o.direction==='neutral'?0n:BigInt(o.amountMinor)*(o.direction==='credit'?1n:-1n);
const liability = a => ['credit_card','loan'].includes(a?.type);
const mortgageReviewReason = split => split?.confidence==='statement_total_only'?'mortgage_prepayment_split_unknown':split?.confidence==='estimated_reference'?'mortgage_recent_reference_unverified':null;
function repaymentType(sources,accountMap){
  const related=sources.flatMap(s=>[accountMap.get(s.financialAccountId),s.automaticClassification?.method==='explicit_owned_counter_account'?accountMap.get(s.automaticClassification.financialAccountId):null,...(s.accountRelations||[]).filter(r=>r.activity==='repayment').map(r=>accountMap.get(r.financialAccountId))]).filter(Boolean);
  if(related.some(a=>a.type==='loan'))return 'loan';
  if(related.some(a=>a.type==='credit_card'))return 'credit';
  const purpose=sources.map(s=>[s.description,s.counterparty,s.category,s.rawFields?.['\u4ea4\u6613\u7c7b\u578b']].join(' ')).join(' ');
  if(/\u4fe1\u7528\u5361|\u82b1\u5457|\u4fe1\u7528\u8d2d/.test(purpose))return 'credit';
  return /\u8d37\u6b3e|\u623f\u8d37|\u501f\u5457|\u501f\u6b3e|\u672c\u606f|\u516c\u79ef\u91d1\u6263\u6b3e/.test(purpose)?'loan':'unknown';
}
const calibrationOnly = a => ['investment','insurance','receivable','property','precious_metal','retirement'].includes(a?.type)&&!['alipay_yulibao','alipay_yuebao'].includes(a?.sourceProduct);
const money = () => ({consumptionMinor:0n,incomeMinor:0n,cashInMinor:0n,cashOutMinor:0n,netCashFlowMinor:0n});
const dictionary = () => Object.create(null);
const serial = value => typeof value==='bigint'?value.toString():Array.isArray(value)?value.map(serial):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,serial(v)])):value;
// Remove only a bank statement's known operation/channel envelope. The remaining
// merchant must match in full; a legal-entity alias is not identity evidence.
const statementOperation=/^(?:\u6d88\u8d39\s+|\(\u6d88\u8d39\)|\u9000\u6b3e\s+|\(\u9000\u6b3e\)|\u9000\u8d27\s+|\(\u9000\u8d27\))/;
const statementMerchantText=value=>String(value||'').normalize('NFKC').replace(statementOperation,'');
function statementPaymentProvider(value){
  const text=statementMerchantText(value);
  return /^(?:\u652f\u4ed8\u5b9d\u5feb\u6377--|\u652f\u4ed8\u5b9d(?=[-\s:(]|$))/.test(text)?'alipay':/^(?:\u8d22\u4ed8\u901a\u5feb\u6377--|(?:\u5fae\u4fe1\u652f\u4ed8(?:\(\u8d22\u4ed8\u901a\))?|\u8d22\u4ed8\u901a)(?=[-\s:(]|$))/.test(text)?'wechat':null;
}
function bankPaymentProvider(record){
  const text=String(record.description||'').normalize('NFKC').replace(/^\u5feb\u6377\u652f\u4ed8(?:\u9000\u6b3e)?[-\s:]*/,'');
  // BOCOM retains the original purchase outside the billed installment total.
  // Its later principal rows are neutral/nonCash; this envelope names the
  // original purchase channel and must never turn principal into consumption.
  const originalInstallment=record.provider==='bocom'&&record.kind==='expense'&&record.direction==='debit'&&!record.bankStatement?.nonCash&&record.rawFields?.excludedFromBilledTotal===true;
  const values=[record.counterparty,text].map(v=>originalInstallment?String(v||'').normalize('NFKC').replace(/^\u6d88\u8d39\s+\u5546\u6237\u5206\u671f-/,''):v).map(v=>statementPaymentProvider(v)||(/^\u8d22\u4ed8\u901a(?:\u652f\u4ed8\u79d1\u6280)?\u6709\u9650\u516c\u53f8/.test(String(v||''))?'wechat':null)).filter(Boolean);
  const institution=String(record.rawFields?.['\u5bf9\u65b9\u5f00\u6237\u884c']||record.rawFields?.['\u5bf9\u65b9\u673a\u6784\u540d\u79f0']||'').normalize('NFKC').trim();
  if(/^\u652f\u4ed8\u5b9d(?:\(\u4e2d\u56fd\))?(?:\u7f51\u7edc\u6280\u672f\u6709\u9650\u516c\u53f8)?$/.test(institution))values.push('alipay');
  if(/^\u8d22\u4ed8\u901a(?:\u652f\u4ed8\u79d1\u6280)?\u6709\u9650\u516c\u53f8$/.test(institution))values.push('wechat');
  const channels=[...new Set(values)];return channels.length===1?channels[0]:channels.length>1?'conflict':null;
}
function projectedBankDirection(record){
  if(record.direction!=='neutral')return record.direction;
  // Alipay's "not income/expense" refund label is not the bank cash direction.
  // Use credit only to find an existing receipt; do not synthesize a cash leg.
  if(record.provider==='alipay'&&record.kind==='refund'&&record.status==='completed'&&BigInt(record.amountMinor)>0n)return 'credit';

  const target=(record.accountRelations||[]).find(r=>r.role==='target');
  if(['investment_deposit','repayment'].includes(target?.activity))return 'debit';
  if(['investment_withdrawal','loan_drawdown'].includes(target?.activity))return 'credit';
  if(record.kind==='debt_payment'&&/\u4fe1\u7528\u5361.*\u8fd8\u6b3e/.test([record.description,record.counterparty,record.rawFields?.['\u4ea4\u6613\u7c7b\u578b']].join(' ')))return 'debit';
  return record.direction;
}
function statementMerchant(value,provider){
  const text=statementMerchantText(value);
  const prefix=provider==='alipay'?/^(?:\u652f\u4ed8\u5b9d\u5feb\u6377--|\u652f\u4ed8\u5b9d[-\s:]+)/:/^(?:\u8d22\u4ed8\u901a\u5feb\u6377--|(?:\u5fae\u4fe1\u652f\u4ed8(?:\(\u8d22\u4ed8\u901a\))?|\u8d22\u4ed8\u901a)[-\s:]+)/;
  return prefix.test(text)?text.replace(prefix,'').replace(/[\s\p{P}]/gu,''):null;
}
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
  const identifiedConversions=new Set(originalObservations.some(o=>o.investmentTrade?.tradeType==='conversion')?buildAssetRegister(ledger).conversions.filter(c=>c.status==='products_matched').map(c=>c.id):[]);
  for(const a of ledger.annotations||[])if(!latestAnnotations.has(a.observationId)||BigInt(a.revision)>BigInt(latestAnnotations.get(a.observationId).revision))latestAnnotations.set(a.observationId,a);
  const classified=originalObservations.filter(o=>!o.balanceEvidence).map(o=>{
    if(latestAnnotations.has(o.id))return {...o,...latestAnnotations.get(o.id).patch};
    const value=statementClassification(o),counter=value.status==='completed'&&['debit','credit'].includes(value.direction)&&value.statementFlow&&value.kind==='unknown'?statementCounterAccount(value,accounts):null;
    return counter?{...value,kind:counter.type==='credit_card'&&value.direction==='debit'?'debt_payment':'transfer',automaticClassification:{method:'explicit_owned_counter_account',confidence:'explicit_statement_purpose',evidenceObservationIds:[o.id],financialAccountId:counter.id}}:value;
  });
  const mortgageModels=buildMortgageModels(accounts,classified),mortgageBySource=new Map(),mortgageSplit=new Map();
  for(const model of mortgageModels){for(const o of classified)if(matchesMortgage(o,accounts.find(a=>a.id===model.financialAccountId).mortgage)){if(!mortgageBySource.has(o.id))mortgageBySource.set(o.id,[]);mortgageBySource.get(o.id).push(model.financialAccountId);}for(const p of [...model.periods,...model.prepayments])for(const id of p.observationIds)mortgageSplit.set(id,{...p,financialAccountId:model.financialAccountId});}
  const observations=classified.map(o=>{const split=mortgageSplit.get(o.id);return split&&split.confidence.startsWith('user_confirmed')&&split.observationIds.length===1&&!latestAnnotations.has(o.id)?{...o,kind:'debt_payment',principalMinor:split.principalMinor,interestMinor:split.interestMinor,feeMinor:'0'}:o;}),links=(ledger.links||[]).filter(l=>l.status!=='deleted'&&l.observationIds.every(id=>!originalById.get(id)?.balanceEvidence)), accountMap=new Map(accounts.map(a=>[a.id,a]));
  const selected=new Set(options.accountIds||accounts.map(a=>a.id));
  const coveredByStatement=statementCoverage(observations);
  const parents=new Map(observations.map(o=>[o.id,o.id]));
  const root=id=>{while(parents.get(id)!==id) id=parents.get(id);return id;};
  const union=(a,b)=>{ if(parents.has(a)&&parents.has(b)) parents.set(root(b),root(a)); };
  const unresolvedAssociations=[],information=[];
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
  // User decisions address observations, but every source version of either
  // observation belongs to that decision. Do not bypass it through a new import.
  const statementBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort())));
  const merchant=v=>String(v||'').normalize('NFKC').replace(/^(?:\u652f\u4ed8\u5b9d|\u8d22\u4ed8\u901a|\u5fae\u4fe1\u652f\u4ed8|\u94f6\u8054\u626b\u7801)[-\s:]*/,'').replace(/[\s\p{P}]/gu,'');
  for(const s of observations){
    if(!['alipay','wechat'].includes(s.provider)||s.status!=='completed')continue;
    const fund=fundingAccount(s,accounts);if(!fund)continue;
    const possible=(moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,s.direction,fund.id]))||[]).filter(b=>b.bankStatement&&b.kind===s.kind&&!statementBlocked.has(JSON.stringify([root(s.id),root(b.id)].sort()))&&root(s.id)!==root(b.id));
    if(!possible.length)continue;
    statementOverlaps.set(s.id,possible);
    const name=merchant(s.counterparty),matches=possible.filter(b=>{
      const text=b.counterparty||b.description,channel=bankPaymentProvider(b);
      if(channel&&channel!==s.provider)return false;
      const other=merchant(text),operationName=statementOperation.test(String(text||'').normalize('NFKC'))?statementMerchantText(text).replace(/[\s\p{P}]/gu,''):null;
      return name&&other&&(name===other||Math.min(name.length,other.length)>=4&&(name.startsWith(other)||other.startsWith(name))||name===statementMerchant(text,s.provider)||name===operationName);
    });
    const sourceRoot=root(s.id);
    for(const bankRoot of new Set(matches.map(b=>root(b.id)))){
      if(!statementMatches.has(sourceRoot))statementMatches.set(sourceRoot,new Set());
      if(!statementReverse.has(bankRoot))statementReverse.set(bankRoot,new Set());
      statementMatches.get(sourceRoot).add(bankRoot);statementReverse.get(bankRoot).add(sourceRoot);
    }
  }
  for(const [s,bankRoots] of statementMatches)if(bankRoots.size===1){const b=[...bankRoots][0];if(statementReverse.get(b).size===1)union(s,b);}
  // Approved reversible inference: an explicit bank channel, known funding card,
  // date, amount, currency and direction identify a pair only when both source
  // roots have exactly one candidate. Merchant/legal-entity names may differ.
  const automaticByObservation=new Map(),channelMatches=new Map(),channelReverse=new Map(),channelEvidence=new Map();
  const bankStatementRoots=new Set(observations.filter(o=>o.bankStatement||o.statementFlow).map(o=>root(o.id)));
  const occupiedStatementRoots=new Set(observations.filter(o=>['alipay','wechat'].includes(o.provider)&&bankStatementRoots.has(root(o.id))).map(o=>root(o.id)));
  const channelBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort())));
  const channelAnnotatedRoots=new Set([...latestAnnotations.keys()].filter(id=>parents.has(id)).map(root));
  for(const s of observations){
    const sr=root(s.id);
    if(!['alipay','wechat'].includes(s.provider)||s.status!=='completed'||bankStatementRoots.has(sr)||channelAnnotatedRoots.has(sr))continue;
    const fund=fundingAccount(s,accounts);if(!fund)continue;
    const direction=projectedBankDirection(s);
    for(const b of moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,direction,fund.id]))||[]){
      const br=root(b.id);
      const compatibleKind=b.kind===s.kind||b.statementFlow&&b.kind==='unknown'&&!latestAnnotations.has(b.id)&&['expense','income','refund','transfer','debt_payment'].includes(s.kind);
      if(!(b.bankStatement||b.statementFlow)||!compatibleKind||occupiedStatementRoots.has(br)||channelAnnotatedRoots.has(br)||bankPaymentProvider(b)!==s.provider||channelBlocked.has(JSON.stringify([sr,br].sort())))continue;
      if(!channelMatches.has(sr))channelMatches.set(sr,new Set());if(!channelReverse.has(br))channelReverse.set(br,new Set());
      channelMatches.get(sr).add(br);channelReverse.get(br).add(sr);
      const key=JSON.stringify([sr,br]),previous=channelEvidence.get(key);
      if(!previous||(s.sourceVersionOrdinal||0)>(previous.s.sourceVersionOrdinal||0)||(b.sourceVersionOrdinal||0)>(previous.b.sourceVersionOrdinal||0))channelEvidence.set(key,{s,b,fund});
    }
  }
  for(const [sr,bankRoots] of channelMatches)if(bankRoots.size===1){
    const br=[...bankRoots][0];if(channelReverse.get(br).size!==1)continue;
    const {s,b,fund}=channelEvidence.get(JSON.stringify([sr,br]));
    const association={method:'unique_channel_funding',confidence:'inferred',observationIds:[s.id,b.id],evidence:{financialAccountId:fund.id,date:s.date,amountMinor:s.amountMinor,currency:s.currency,direction:projectedBankDirection(s),platform:s.provider,reciprocalUnique:true}};
    automaticByObservation.set(s.id,[association]);automaticByObservation.set(b.id,[association]);union(sr,br);
  }
  // A repayment receipt may say neutral (not income/expense), while its bank
  // statement records a credit. Require the named receiving bank plus payer
  // card/channel evidence and reciprocal uniqueness, including source versions.
  const repaymentReceipts=new Map(),repaymentMatches=new Map(),repaymentReverse=new Map();
  const repaymentBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort()))),repaymentAnnotatedRoots=new Set([...latestAnnotations.keys()].filter(id=>parents.has(id)).map(root));
  for(const b of observations)if(b.status==='completed'&&b.kind==='debt_payment'&&b.direction==='credit'&&b.bankStatement&&accountMap.get(b.financialAccountId)?.type==='credit_card')add(repaymentReceipts,JSON.stringify([b.date,b.amountMinor,b.currency]),b);
  for(const s of observations){
    if(!['alipay','wechat'].includes(s.provider)||s.kind!=='debt_payment'||s.status!=='completed'||!['neutral','debit'].includes(s.direction)||repaymentAnnotatedRoots.has(root(s.id)))continue;
    const bank=String(s.counterparty||'').normalize('NFKC').replace(/\s/g,''),fund=fundingAccount(s,accounts);
    if(!/\u94f6\u884c$/.test(bank))continue;
    const matches=(repaymentReceipts.get(JSON.stringify([s.date,s.amountMinor,s.currency]))||[]).filter(b=>{
      const a=accountMap.get(b.financialAccountId),text=[b.description,b.counterparty].join(' '),channel=s.provider==='alipay'?/\u652f\u4ed8\u5b9d/:/\u5fae\u4fe1|\u8d22\u4ed8\u901a/;
      return a.label.normalize('NFKC').replace(/\s/g,'').startsWith(bank)&&!repaymentAnnotatedRoots.has(root(b.id))&&!repaymentBlocked.has(JSON.stringify([root(s.id),root(b.id)].sort()))&&(channel.test(text)||fund?.maskedIdentifier&&text.includes(fund.maskedIdentifier));
    });
    const unique=[...new Set(matches.map(b=>root(b.id)))];
    for(const br of unique){if(br===root(s.id))continue;if(!repaymentMatches.has(root(s.id)))repaymentMatches.set(root(s.id),new Set());repaymentMatches.get(root(s.id)).add(br);if(!repaymentReverse.has(br))repaymentReverse.set(br,new Set());repaymentReverse.get(br).add(root(s.id));}
  }
  for(const [s,bs] of repaymentMatches)if(bs.size===1){const b=[...bs][0];if(repaymentReverse.get(b).size===1)union(s,b);}
  // A fund confirmation has its own source ID but repeats the platform order
  // number. Bind that receipt to the purchase so the proven fee gets its actual
  // funding account. Cash paid and gross subscription values remain distinct.
  const fundPayments=new Map(),fundMatches=new Map(),fundReverse=new Map(),fundEvidence=new Map();
  const fundBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort())));
  for(const p of observations)if(p.status==='completed'&&!p.investmentTrade&&p.kind==='transfer'&&p.sourceTransactionId&&(p.accountRelations||[]).some(r=>r.product==='alipay_funds'&&r.activity==='investment_deposit'&&r.role==='target'))add(fundPayments,JSON.stringify([p.financialAccountId,p.provider,p.currency,p.sourceTransactionId]),p);
  for(const c of observations){
    if(c.status!=='completed'||c.kind!=='transfer'||c.investmentTrade?.tradeType!=='buy')continue;
    const cr=root(c.id),trade=c.investmentTrade;
    for(const p of fundPayments.get(JSON.stringify([c.financialAccountId,c.provider,c.currency,trade.orderId]))||[]){
      const target=(c.accountRelations||[]).find(r=>r.product==='alipay_funds'&&r.role==='target')?.financialAccountId;
      const pr=root(p.id);if(cr===pr||!target||!(p.accountRelations||[]).some(r=>r.product==='alipay_funds'&&r.role==='target'&&r.financialAccountId===target)||p.date<c.date||p.date>trade.confirmedAt.slice(0,10)||fundBlocked.has(JSON.stringify([cr,pr].sort())))continue;
      if(!fundMatches.has(cr))fundMatches.set(cr,new Set());if(!fundReverse.has(pr))fundReverse.set(pr,new Set());
      fundMatches.get(cr).add(pr);fundReverse.get(pr).add(cr);fundEvidence.set(JSON.stringify([cr,pr]),{c,p});
    }
  }
  for(const [cr,paymentRoots] of fundMatches)if(paymentRoots.size===1){const pr=[...paymentRoots][0];if(fundReverse.get(pr).size!==1)continue;const {c,p}=fundEvidence.get(JSON.stringify([cr,pr]));const evidence={method:'fund_confirmation_order',confidence:'reference',observationIds:[c.id,p.id],evidence:{samePlatformOrder:true,currency:c.currency}};automaticByObservation.set(c.id,[...(automaticByObservation.get(c.id)||[]),evidence]);automaticByObservation.set(p.id,[...(automaticByObservation.get(p.id)||[]),evidence]);union(pr,cr);}
  const productReceiptByObservation=new Map(),productMatches=new Map(),productReverse=new Map(),productEvidence=new Map();
  const productBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort())));
  const productAnnotatedRoots=new Set([...latestAnnotations.keys()].filter(id=>parents.has(id)).map(root));
  for(const p of observations){
    if(p.provider!=='alipay'||p.status!=='completed'||p.kind!=='transfer'||productAnnotatedRoots.has(root(p.id)))continue;
    const target=(p.accountRelations||[]).find(r=>r.role==='target'&&r.product==='alipay_yulibao'&&['investment_deposit','investment_withdrawal'].includes(r.activity));if(!target)continue;
    const direction=target.activity==='investment_deposit'?'credit':'debit',pr=root(p.id);
    for(const b of moneySourceBuckets.get(JSON.stringify([p.date,p.amountMinor,p.currency,direction,target.financialAccountId]))||[]){
      const br=root(b.id),seconds=(Date.parse(b.occurredAt)-Date.parse(p.occurredAt))/1000;
      if(b.statementFlow?.schema!=='mybank-yulibao-v1'||b.kind!=='transfer'||pr===br||seconds<0||seconds>10||productAnnotatedRoots.has(br)||productBlocked.has(JSON.stringify([pr,br].sort())))continue;
      if(!productMatches.has(pr))productMatches.set(pr,new Set());if(!productReverse.has(br))productReverse.set(br,new Set());productMatches.get(pr).add(br);productReverse.get(br).add(pr);productEvidence.set(JSON.stringify([pr,br]),{p,b,seconds});
    }
  }
  for(const [pr,receipts] of productMatches)if(receipts.size===1){const br=[...receipts][0];if(productReverse.get(br).size!==1)continue;const match=productEvidence.get(JSON.stringify([pr,br])),{p,b,seconds}=match,fund=statementCounterAccount(b,accounts);match.fund=fund;
    const association={method:'product_statement_time',confidence:'inferred',observationIds:[p.id,b.id],evidence:{financialAccountId:b.financialAccountId,fundingAccountId:fund?.id||null,date:p.date,amountMinor:p.amountMinor,currency:p.currency,bankDirection:b.direction,secondsAfter:seconds,reciprocalUnique:true}};
    for(const source of [p,b]){productReceiptByObservation.set(source.id,match);automaticByObservation.set(source.id,[...(automaticByObservation.get(source.id)||[]),association]);}union(pr,br);
  }
  const productLegMatches=new Map(),productLegReverse=new Map(),productLegEvidence=new Map();
  const productLegBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort())));
  const productLegAnnotatedRoots=new Set([...latestAnnotations.keys()].filter(id=>parents.has(id)).map(root));
  for(const match of new Set(productReceiptByObservation.values())){
    const {b,fund}=match;if(!fund)continue;const br=root(b.id),direction=b.direction==='credit'?'debit':'credit';
    for(const leg of moneySourceBuckets.get(JSON.stringify([b.date,b.amountMinor,b.currency,direction,fund.id]))||[]){
      const lr=root(leg.id),seconds=Math.abs(Date.parse(leg.occurredAt)-Date.parse(b.occurredAt))/1000;
      if(!leg.statementFlow||leg.kind!=='transfer'||lr===br||seconds>10||!/\u57fa\u91d1|\u4f59\u5229\u5b9d/.test(leg.description+' '+leg.counterparty)||productLegAnnotatedRoots.has(lr)||productLegAnnotatedRoots.has(br)||productLegBlocked.has(JSON.stringify([br,lr].sort())))continue;
      if(!productLegMatches.has(br))productLegMatches.set(br,new Set());if(!productLegReverse.has(lr))productLegReverse.set(lr,new Set());productLegMatches.get(br).add(lr);productLegReverse.get(lr).add(br);productLegEvidence.set(JSON.stringify([br,lr]),{b,leg,seconds});
    }
  }
  for(const [br,legs] of productLegMatches)if(legs.size===1){const lr=[...legs][0];if(productLegReverse.get(lr).size!==1)continue;const {b,leg,seconds}=productLegEvidence.get(JSON.stringify([br,lr]));const association={method:'product_statement_time',confidence:'inferred',observationIds:[b.id,leg.id],evidence:{financialAccountId:b.financialAccountId,fundingAccountId:leg.financialAccountId,date:b.date,amountMinor:b.amountMinor,currency:b.currency,bankDirection:b.direction,secondsApart:seconds,reciprocalUnique:true}};for(const s of [b,leg])automaticByObservation.set(s.id,[...(automaticByObservation.get(s.id)||[]),association]);union(br,lr);}
  const payerBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort()))),payerAnnotatedRoots=new Set([...latestAnnotations.keys()].filter(id=>parents.has(id)).map(root));
  const payerIncompatibleRoots=new Set(observations.filter(o=>['expense','income','refund','interest','fee'].includes(o.kind)||(o.accountRelations||[]).some(r=>r.activity.startsWith('investment_'))).map(o=>root(o.id)));
  for(const {credit,debit} of findStatementRepayments(observations,accounts,{rootOf:root,isBlocked:(a,b)=>payerBlocked.has(JSON.stringify([root(a),root(b)].sort())),annotatedIds:new Set(observations.filter(o=>payerAnnotatedRoots.has(root(o.id))).map(o=>o.id))})){
    if(payerIncompatibleRoots.has(root(credit.id))||payerIncompatibleRoots.has(root(debit.id))||observations.some(o=>root(o.id)===root(credit.id)&&fundingAccount(o,accounts)&&fundingAccount(o,accounts).id!==debit.financialAccountId))continue;
    const association={method:'statement_payer_card',confidence:'inferred',observationIds:[credit.id,debit.id],evidence:{paymentAccountId:debit.financialAccountId,receivingAccountId:credit.financialAccountId,date:credit.date,amountMinor:credit.amountMinor,currency:credit.currency,reciprocalUnique:true}};
    for(const s of [credit,debit])automaticByObservation.set(s.id,[...(automaticByObservation.get(s.id)||[]),association]);union(credit.id,debit.id);
  }
  const withdrawalByObservation=new Map(),withdrawalBankRoots=new Set(observations.filter(o=>o.bankStatement||o.statementFlow).map(o=>root(o.id)));
  const withdrawalOccupied=new Set(observations.filter(o=>['alipay','wechat'].includes(o.provider)&&withdrawalBankRoots.has(root(o.id))).map(o=>root(o.id)));
  const withdrawalBlocked=new Set((ledger.links||[]).filter(l=>blocked.has(pair(l))&&l.observationIds.every(id=>parents.has(id))).map(l=>JSON.stringify(l.observationIds.map(root).sort())));
  const annotatedRoots=new Set([...latestAnnotations.keys()].filter(id=>parents.has(id)).map(root));
  const withdrawals=findWechatWithdrawalMatches(observations,accounts,{rootOf:root,isBlocked:(a,b)=>withdrawalBlocked.has(JSON.stringify([root(a),root(b)].sort())),occupiedBankRoots:withdrawalOccupied,annotatedIds:new Set(observations.filter(o=>annotatedRoots.has(root(o.id))).map(o=>o.id))});
  for(const match of withdrawals){
    const association={method:match.method,confidence:match.confidence,observationIds:[match.wallet.id,match.bank.id],evidence:{financialAccountId:match.targetAccountId,date:match.wallet.date,currency:match.wallet.currency,grossMinor:match.grossMinor,netMinor:match.netMinor,feeMinor:match.feeMinor,feeCapMinor:match.feeCapMinor,feeRuleSource:match.feeRuleSource,matchBasis:match.matchBasis,bankReceiptDelaySeconds:match.bankReceiptDelaySeconds,reciprocalUnique:true}};
    for(const source of [match.wallet,match.bank]){withdrawalByObservation.set(source.id,match);automaticByObservation.set(source.id,[...(automaticByObservation.get(source.id)||[]),association]);}
    union(match.wallet.id,match.bank.id);
  }
  const reconciliationGroups=findReconciliationGroups(observations,accounts,{rootOf:root,fundingAccount,bankPaymentProvider,annotatedIds:new Set(latestAnnotations.keys()),links:ledger.links||[]}),reconciliationByRoot=new Map();
  const settledBankRoots=new Set(observations.filter(o=>o.bankStatement||o.statementFlow).map(o=>root(o.id))),settledPlatformRoots=new Set(observations.filter(o=>['alipay','wechat'].includes(o.provider)&&settledBankRoots.has(root(o.id))).map(o=>root(o.id)));
  for(const group of reconciliationGroups)for(const id of [...group.platformRootIds,...group.bankRootIds])reconciliationByRoot.set(id,group);
  const sameReconciliation=(a,b)=>{const g=reconciliationByRoot.get(root(a));return Boolean(g&&(g===reconciliationByRoot.get(root(b))||settledPlatformRoots.has(root(b))));};
  const groups=new Map();for(const o of observations) {const id=root(o.id);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(o);}
  const all=[];
  for(const [id,sources] of groups) {
    const finalSources=sources.filter(s=>s.status==='completed'),eligible=finalSources.length?finalSources:sources;
    const ordered=[...eligible].sort((a,b)=>(b.sourceVersionOrdinal||0)-(a.sourceVersionOrdinal||0));
    const base=ordered.find(s=>(automaticByObservation.get(s.id)||[]).some(a=>['unique_channel_funding','wechat_withdrawal_net_receipt','statement_payer_card'].includes(a.method)&&a.observationIds[0]===s.id))||ordered.find(s=>s.paymentChannel)||ordered[0];
    const withdrawal=sources.map(s=>withdrawalByObservation.get(s.id)).find(Boolean);
    const groupAnnotations=sources.filter(s=>latestAnnotations.has(s.id)).map(s=>latestAnnotations.get(s.id)).sort((a,b)=>BigInt(a.revision)>BigInt(b.revision)?-1:1);
    const original=groupAnnotations[0]?{...base,...groupAnnotations[0].patch}:base;
    const transfer=links.find(l=>l.type==='transfer'&&l.observationIds.some(id=>sources.some(s=>s.id===id)));
    const o=transfer&&original.kind!=='debt_payment'?{...original,kind:'transfer'}:original, amount=BigInt(o.amountMinor);
    const repayment=o.kind==='debt_payment'?repaymentType(sources,accountMap):null;
    const reconciliation=reconciliationByRoot.get(id),reconciliationRole=reconciliation?.bankRootIds.includes(id)?'bank_evidence':reconciliation?'platform_order':null;
    let consumption=0n,income=0n;
    if(o.status==='completed') {
      if(['expense','interest','fee'].includes(o.kind)) consumption=amount;
      if(o.kind==='refund') consumption=-amount;
      if(o.kind==='income') income=o.direction==='debit'?-amount:amount;
      if(o.kind==='debt_payment') {
        if(['principalMinor','interestMinor','feeMinor'].every(k=>o[k]!==null)) consumption=BigInt(o.interestMinor)+BigInt(o.feeMinor);
        else if(repayment==='loan'&&mortgageReviewReason(mortgageSplit.get(o.id)))unresolvedAssociations.push({reason:mortgageReviewReason(mortgageSplit.get(o.id)),observationId:o.id});
        else if(repayment==='loan'&&!mortgageSplit.has(o.id))unresolvedAssociations.push({reason:mortgageBySource.get(o.id)?.length===1?'mortgage_history_model_gap':'unsplit_debt_payment',observationId:o.id});
        else if(repayment==='unknown')unresolvedAssociations.push({reason:'unresolved_debt_account',observationId:o.id});
      }
      if(o.kind==='unknown'&&!o.bankStatement?.nonCash&&!nonCashAuthorization(o)) unresolvedAssociations.push({reason:'unknown_kind',observationId:o.id});
    }
    if(reconciliationRole==='bank_evidence')consumption=0n;
    const investmentConfirmations=latestInvestmentConfirmations(sources);
    consumption+=investmentConfirmations.reduce((sum,source)=>sum+BigInt(source.investmentTrade.feeMinor),0n)+(withdrawal?BigInt(withdrawal.feeMinor):0n);
    for(const confirmation of investmentConfirmations)if(!confirmation.investmentTrade.fundCode&&!identifiedConversions.has(confirmation.id))unresolvedAssociations.push({reason:'unidentified_fund_conversion',observationId:confirmation.id});
    const effects=new Map(), flow=new Map(),effectTimes=new Map();
    const knownFundingAccounts=[...new Set(sources.filter(s=>s.status==='completed'&&accountMap.get(s.financialAccountId)?.type!=='wallet').map(s=>s.financialAccountId))].map(id=>accountMap.get(id)).filter(Boolean);
    const latestEffects=new Map();for(const s of sources)if(s.sourceIdentity&&s.status==='completed'){const key=JSON.stringify([s.financialAccountId,s.sourceIdentity]);if(!latestEffects.has(key)||(s.sourceVersionOrdinal||0)>(latestEffects.get(key).sourceVersionOrdinal||0))latestEffects.set(key,s);}
    const effectSources=sources.filter(s=>!s.sourceIdentity||s.status==='completed'&&latestEffects.get(JSON.stringify([s.financialAccountId,s.sourceIdentity]))===s);
    for(const s of effectSources) {
      if(s.status!=='completed')continue;
      const a=accountMap.get(s.financialAccountId);if(!a)continue;
      const withdrawalTarget=s.provider==='wechat'&&s.kind==='transfer'&&s.rawFields?.['\u4ea4\u6613\u7c7b\u578b']==='\u96f6\u94b1\u63d0\u73b0'&&['neutral','debit'].includes(s.direction)?fundingAccount(s,accounts):null;
      if(withdrawalTarget&&['bank','debit_card','savings'].includes(withdrawalTarget.type)){
        const delta=-BigInt(s.amountMinor);effects.set(a.id,delta);effectTimes.set(a.id,s.occurredAt);flow.set(a.id,delta);
        if(!withdrawal)unresolvedAssociations.push({reason:'withdrawal_net_fee_unknown',observationId:s.id,targetAccountId:withdrawalTarget.id,grossMinor:s.amountMinor});
        continue;
      }
      const mortgageIds=mortgageBySource.get(s.id)||[];
      if(mortgageIds.length===1){const loanId=mortgageIds[0],principal=s.principalMinor===null?0n:BigInt(s.principalMinor);effects.set(loanId,principal);effectTimes.set(loanId,s.occurredAt);}
      else if(mortgageIds.length>1)unresolvedAssociations.push({reason:'ambiguous_mortgage_account',observationId:s.id});
      const shanghai=s.provider==='alipay'&&s.paymentChannel.startsWith('\u4e0a\u6d77\u94f6\u884c\u4fe1\u7528\u8d2d')?accounts.filter(a=>a.sourceProduct==='alipay_shanghai_credit'&&a.currency===s.currency):[];
      const relations=(s.accountRelations||[]).map(r=>shanghai.length===1&&r.role==='funding'&&r.product==='alipay_huabei'?{...r,product:'alipay_shanghai_credit',financialAccountId:shanghai[0].id}:r);
      for(const relation of relations){const target=accountMap.get(relation.financialAccountId);if(!target||target.currency!==s.currency){unresolvedAssociations.push({reason:'unresolved_product_account',observationId:s.id,product:relation.product});continue;}const delta=relationDelta(relation,BigInt(s.amountMinor),s);if(delta===0n&&effects.has(target.id)&&['investment_confirmation','investment_exchange','investment_fee'].includes(relation.activity))continue;effects.set(target.id,delta);effectTimes.set(target.id,s.occurredAt);if(!liability(target))flow.set(target.id,delta);}
      if(relations.length){
        if(relations.some(r=>r.role==='funding'))continue;
        const target=relations.find(r=>r.role==='target');
        if(['investment_income','investment_exchange','investment_confirmation'].includes(target?.activity))continue;
        const incoming=['investment_withdrawal','loan_drawdown'].includes(target?.activity),delta=BigInt(s.amountMinor)*(incoming?1n:-1n);
        const productReceipt=productReceiptByObservation.get(s.id),fund=fundingAccount(s,accounts)||productReceipt?.fund;
        if(fund){
          const possible=(moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,incoming?'credit':'debit',fund.id]))||[]).filter(candidate=>!sources.some(source=>source.id===candidate.id));
          const distinct=possible.length&&possible.every(candidate=>links.some(l=>l.type==='distinct'&&l.observationIds.includes(s.id)&&l.observationIds.includes(candidate.id)));
          const represented=sources.some(source=>source.financialAccountId===fund.id);
          if(possible.length&&!distinct&&!represented)unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,candidateObservationIds:possible.slice(0,64).map(candidate=>candidate.id),candidateCount:possible.length});
          else if(!represented){effects.set(fund.id,delta);effectTimes.set(fund.id,s.occurredAt);if(!liability(fund))flow.set(fund.id,delta);}
        }
        else if(!s.paymentAccountHint&&/^(余额|账户余额|支付宝余额|零钱)$/.test((s.paymentChannel||'').trim())){effects.set(a.id,delta);effectTimes.set(a.id,s.occurredAt);flow.set(a.id,delta);}
        else unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,paymentAccountHint:s.paymentAccountHint});
        continue;
      }
      const repaymentCredit=s.kind==='debt_payment'&&repayment==='credit';
      const provenRepaymentFunding=repaymentCredit&&sources.some(x=>x.direction==='debit'&&x.financialAccountId===fundingAccount(s,accounts)?.id&&(x.bankStatement||x.statementFlow));
      if(s.direction==='neutral'&&['transfer','debt_payment'].includes(s.kind)&&!provenRepaymentFunding&&!(repaymentCredit&&sources.some(x=>x.direction==='credit'&&accountMap.get(x.financialAccountId)?.type==='credit_card')))unresolvedAssociations.push({reason:'unresolved_account_movement',observationId:s.id});

      const fund=fundingAccount(s,accounts)||(a.type==='wallet'&&knownFundingAccounts.length===1?knownFundingAccounts[0]:null);
      if(a.type==='wallet' && (s.paymentAccountHint||fund)) {
        if(!fund) unresolvedAssociations.push({reason:'unresolved_funding_account',observationId:s.id,paymentAccountHint:s.paymentAccountHint});
        const direction=repaymentCredit&&s.direction==='neutral'?'debit':s.direction,delta=direction==='debit'?-BigInt(s.amountMinor):signed(s);
        const possibleBankSources=fund?(moneySourceBuckets.get(JSON.stringify([s.date,s.amountMinor,s.currency,direction,fund.id]))||[]).filter(o=>!sources.some(source=>source.id===o.id)):[];
        const confirmedDistinct=possibleBankSources.length&&possibleBankSources.every(o=>links.some(l=>l.type==='distinct'&&l.observationIds.includes(s.id)&&l.observationIds.includes(o.id)));
        if(possibleBankSources.length&&!confirmedDistinct&&!sources.some(source=>source.financialAccountId===fund.id)&&!possibleBankSources.every(b=>(sameReconciliation(s.id,b.id)||reconciliation&&bankPaymentProvider(b)&&bankPaymentProvider(b)!==s.provider)))unresolvedAssociations.push({reason:'insufficient_reference',observationId:s.id,candidateObservationIds:possibleBankSources.slice(0,64).map(o=>o.id),candidateCount:possibleBankSources.length});
        if(fund && !sources.some(x=>x.financialAccountId===fund.id) && (!possibleBankSources.length||confirmedDistinct)) { effects.set(fund.id,delta);effectTimes.set(fund.id,s.occurredAt);if(!liability(fund))flow.set(fund.id,delta); }
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
    for(const s of sources){const overlap=statementOverlaps.get(s.id);if(overlap?.length&&!sources.some(b=>(b.bankStatement||b.statementFlow)&&b.financialAccountId===fundingAccount(s,accounts)?.id)&&!overlap.every(b=>(sameReconciliation(s.id,b.id)||reconciliation&&bankPaymentProvider(b)&&bankPaymentProvider(b)!==s.provider))){statisticsExclusions.push({observationId:s.id,candidateObservationIds:overlap.map(b=>b.id),reason:'card_statement_overlap_requires_review'});}}
    const pendingConsumption=statisticsExclusions.length?consumption:0n,pendingIncome=statisticsExclusions.length?income:0n;
    if(statisticsExclusions.length){consumption=0n;income=0n;unresolvedAssociations.push(...statisticsExclusions);}
    const reportingAccountIds=withdrawal?[withdrawal.wallet.financialAccountId]:incomeExpenseAccounts(effectSources,accounts,fundingAccount,effects);
    const reportSelected=reportingAccountIds.some(id=>selected.has(id))||accounts.every(a=>selected.has(a.id));
    if(!reportingAccountIds.length&&(consumption!==0n||income!==0n))unresolvedAssociations.push({reason:'unallocated_income_expense',observationId:o.id});
    const automaticAssociations=[...new Set(sources.flatMap(s=>automaticByObservation.get(s.id)||[])),...(reconciliation?[reconciliation]:[])];
    const associated=new Set([...sources.map(s=>s.financialAccountId),...sources.flatMap(s=>(s.accountRelations||[]).map(r=>r.financialAccountId).filter(Boolean)),...effects.keys(),...reportingAccountIds]);
    const selectedSources=sources.filter(s=>selected.has(s.financialAccountId));
    all.push({...o,id,automaticAssociations,reconciliationGroup:reconciliation?{id:reconciliation.id,role:reconciliationRole,count:reconciliation.evidence.count,individualIdentity:'undetermined'}:null,mortgageSplit:mortgageSplit.has(o.id)?{confidence:mortgageSplit.get(o.id).confidence,month:mortgageSplit.get(o.id).month,financialAccountId:mortgageSplit.get(o.id).financialAccountId}:null,repaymentType:repayment,reportingAccountIds,coveredEffects,statisticsExclusions,pendingConsumptionMinor:pendingConsumption,pendingIncomeMinor:pendingIncome,selectedConsumptionMinor:reportSelected?consumption:0n,selectedIncomeMinor:reportSelected?income:0n,investmentConfirmations:investmentConfirmations.map(source=>({id:source.id,date:source.date,...source.investmentTrade})),observationIds:sources.map(s=>s.id),financialAccountIds:[...associated],sources:sources.map(s=>originalById.get(s.id)),appliedAnnotations:sources.filter(s=>latestAnnotations.has(s.id)).map(s=>latestAnnotations.get(s.id)),consumptionMinor:consumption,incomeMinor:income,balanceEffects:Object.fromEntries(effects),balanceEffectTimes:Object.fromEntries(effectTimes),cashEffects:Object.fromEntries(flow),selectedObservationIds:selectedSources.map(s=>s.id),relatedTransactionId:null});
  }
  for(const t of all) {
    const manual=links.find(l=>l.type==='refund'&&l.observationIds.some(id=>t.observationIds.includes(id)));
    const ref=t.relatedReference;
    if(t.kind==='refund') { const original=all.filter(x=>x.id!==t.id && x.kind==='expense' && x.currency===t.currency && (manual?manual.observationIds.some(id=>x.observationIds.includes(id)):ref&&x.sources.some(o=>o.sourceTransactionId===ref))); if(original.length===1){t.relatedTransactionId=original[0].id;t.category=original[0].category;}else (original.length>1||manual?unresolvedAssociations:information).push({reason:original.length>1||manual?'unresolved_refund':'refund_original_unavailable',observationId:t.observationIds[0],candidateTransactionIds:original.map(o=>o.id)}); }
  }
  const summarize=transactions=>{
    const totals=dictionary(),categories=dictionary(),funding=dictionary(),breakdown=dictionary();
    for(const a of accounts)if(selected.has(a.id))totals[a.currency] ||= money();
    for(const t of transactions) {
      const bucket=totals[t.currency]||(totals[t.currency]=money());bucket.consumptionMinor+=t.selectedConsumptionMinor;bucket.incomeMinor+=t.selectedIncomeMinor;
      const details=breakdown[t.currency]||(breakdown[t.currency]={cashFundedConsumptionMinor:0n,creditFundedConsumptionMinor:0n,loanPrincipalPaidMinor:0n,interestPaidMinor:0n,feesPaidMinor:0n,unsplitDebtPaymentMinor:0n});
      if(t.status==='completed'&&t.kind==='debt_payment'&&t.reportingAccountIds.some(id=>selected.has(id))) { if(['principalMinor','interestMinor','feeMinor'].every(k=>t[k]!==null)){details.loanPrincipalPaidMinor+=BigInt(t.principalMinor);details.interestPaidMinor+=BigInt(t.interestMinor);details.feesPaidMinor+=BigInt(t.feeMinor);}else if(t.repaymentType==='loan'&&(!t.mortgageSplit||mortgageReviewReason(t.mortgageSplit)))details.unsplitDebtPaymentMinor+=BigInt(t.amountMinor); }
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
    const mortgage=mortgageModels.find(m=>m.financialAccountId===a.id);
    if(mortgage){const eligible=(mortgage.balanceEvents||mortgage.periods).filter(p=>!options.endDate||p.date<=options.endDate),last=eligible.at(-1);stats.estimatedBalanceMinor=last===undefined?null:String(-BigInt(last.balanceMinor));stats.estimateAsOf=last?.date||null;stats.estimateStatus=mortgage.status;}
    accountStats[a.id]=stats;
  }
  let comparison=null;
  if(validDate(options.startDate)&&validDate(options.endDate)&&options.startDate<=options.endDate) {const span=(Date.parse(options.endDate)-Date.parse(options.startDate))/86400000+1;const previousEnd=new Date(Date.parse(options.startDate)-86400000).toISOString().slice(0,10),previousStart=new Date(Date.parse(options.startDate)-span*86400000).toISOString().slice(0,10);comparison={current:{startDate:options.startDate,endDate:options.endDate,...summary},previous:{startDate:previousStart,endDate:previousEnd,...summarize(all.filter(t=>t.financialAccountIds.some(id=>selected.has(id))&&t.date>=previousStart&&t.date<=previousEnd))}};}
  const review=buildReviewSummary(unresolvedAssociations,transactions,accounts);
  return serial({transactions,reconciliationGroups,investmentTrades:transactions.flatMap(t=>t.investmentConfirmations),mortgages:mortgageModels.filter(m=>selected.has(m.financialAccountId)||selected.has(m.sourceAccountId)),accountStats,portfolioBalances:portfolioBalances(accountStats),...summary,comparison,unresolvedAssociations,information,review});
}
module.exports={buildFinanceView,validateRecord,validDate};
