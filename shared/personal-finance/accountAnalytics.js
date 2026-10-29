'use strict';

// An account's own complete statement owns its cash movements for the declared
// interval. Platform receipts remain separate evidence; amount/time alone never
// establish that two receipts are the same transaction.
function statementCoverage(observations) {
  const groups = new Map(), coverage = new Map();
  for (const o of observations) {
    if (!o.statementFlow || o.status !== 'completed' || !o.importId) continue;
    const key = JSON.stringify([o.financialAccountId, o.currency, o.importId]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  for (const rows of groups.values()) {
    rows.sort((a,b) => a.statementFlow.sequence-b.statementFlow.sequence);
    const first=rows[0], e=first.statementFlow;
    // A missing closing balance cannot prove complete native cash coverage.
    if(rows.some(o=>o.balanceMinor==null))continue;
    if (rows.some((o,i) => o.statementFlow.sequence!==i+1 || o.statementFlow.periodStart!==e.periodStart || o.statementFlow.periodEnd!==e.periodEnd || (i && BigInt(o.balanceMinor)-BigInt(rows[i-1].balanceMinor)!==BigInt(o.statementFlow.incomeMinor)-BigInt(o.statementFlow.expenseMinor)))) continue;
    const key=JSON.stringify([first.financialAccountId,first.currency]);
    if (!coverage.has(key)) coverage.set(key,[]);
    coverage.get(key).push({start:Date.parse(e.periodStart+'T00:00:00+08:00'),end:Date.parse(e.periodEnd+'T00:00:00+08:00'),importId:first.importId});
  }
  return (id,currency,time) => (coverage.get(JSON.stringify([id,currency]))||[]).find(v=>time>=v.start&&time<v.end);
}

function incomeExpenseAccounts(sources, accounts, fundingAccount, effects) {
  const ids=new Set();
  for(const s of sources) {
    const a=accounts.find(a=>a.id===s.financialAccountId);
    if (!a || s.status!=='completed') continue;
    const shanghai=s.provider==='alipay'&&s.paymentChannel?.startsWith('\u4e0a\u6d77\u94f6\u884c\u4fe1\u7528\u8d2d')?accounts.filter(a=>a.sourceProduct==='alipay_shanghai_credit'&&a.currency===s.currency):[];
    const relations=(s.accountRelations||[]).map(r=>shanghai.length===1&&r.role==='funding'&&r.product==='alipay_huabei'?{...r,financialAccountId:shanghai[0].id}:r);
    const funding=relations.filter(r=>r.role==='funding');
    if(funding.length){for(const r of funding)ids.add(r.financialAccountId);continue;}
    const target=relations.find(r=>r.role==='target');
    if(target?.activity==='investment_income'){ids.add(target.financialAccountId);continue;}
    const fund=fundingAccount(s,accounts);
    if(fund){ids.add(fund.id);continue;}
    if(a.type==='wallet' && (s.paymentAccountHint||s.provider==='jd'||['alipay','wechat'].includes(s.provider)&&/\u94f6\u884c/.test(s.paymentChannel)))continue;
    if(target?.activity==='repayment'&&s.kind==='debt_payment'&&a.type==='wallet'&&/^(?:\u4f59\u989d|\u8d26\u6237\u4f59\u989d|\u652f\u4ed8\u5b9d\u4f59\u989d|\u96f6\u94b1)$/.test(s.paymentChannel||'')&&(effects.get(a.id)||0n)<0n){ids.add(a.id);continue;}
    if(target && s.investmentTrade) {
      // Subscription fees come from the payment account; redemption/conversion
      // fees are deducted from the investment. Never allocate one fee twice.
      if(s.investmentTrade.tradeType==='buy')continue;
      ids.add(target.financialAccountId);continue;
    }
    if(!target)ids.add(a.id);
  }
  if(ids.size>1){const actual=[...ids].filter(id=>accounts.find(a=>a.id===id)?.type!=='wallet');if(actual.length===1)return actual;}
  if(ids.size>1&&sources.every(s=>s.kind==='debt_payment')){const paying=[...ids].filter(id=>!['credit_card','loan'].includes(accounts.find(a=>a.id===id)?.type)&&(effects.get(id)||0n)<0n);if(paying.length===1)return paying;}
  const resolved=[...ids].filter(Boolean);
  return resolved.length===1?resolved:[];
}

function portfolioBalances(accountStats) {
  const result=Object.create(null);
  for(const s of Object.values(accountStats)) {
    const b=result[s.currency]||(result[s.currency]={knownBalanceMinor:0n,knownCount:0,unknownCount:0,derivedCount:0});
    if(s.balanceExcludedReason==='superseded_provisional_identity'&&s.identityResolution?.allOriginalChannelTransactionsIndividuallyEvidenced){b.excludedSupersededCount=(b.excludedSupersededCount||0)+1;continue;}
    if(s.balanceMinor==null)b.unknownCount++;
    else {b.knownBalanceMinor+=BigInt(s.balanceMinor);b.knownCount++;if(s.balanceStatus==='derived')b.derivedCount++;}
  }
  return Object.fromEntries(Object.entries(result).map(([c,b])=>[c,{...b,knownBalanceMinor:b.knownBalanceMinor.toString(),complete:b.unknownCount===0}]));
}

function buildTrend(transactions,{startDate,endDate,granularity='month',currencies=[]}={}) {
  const dates=transactions.map(t=>t.date).sort();
  const start=startDate||dates[0],end=endDate||dates[dates.length-1];
  const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  if(!valid(start)||!valid(end)||start>end)return [];
  const bucket=date=>{
    if(granularity==='month')return date.slice(0,7)+'-01';
    if(granularity==='week'){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
    return date;
  };
  const byDate=new Map(), allCurrencies=[...new Set([...currencies,...transactions.map(t=>t.currency)])];
  const insert=date=>{if(!byDate.has(date))byDate.set(date,Object.fromEntries(allCurrencies.map(c=>[c,{incomeMinor:0n,consumptionMinor:0n}])));};
  // Bound pathological date ranges while keeping month/year histories useful.
  const step=granularity==='day'?1:7;
  for(let d=new Date(bucket(start)+'T00:00:00Z'),n=0;d.toISOString().slice(0,10)<=end&&n<5000;n++){
    insert(bucket(d.toISOString().slice(0,10)));
    if(granularity==='month')d.setUTCMonth(d.getUTCMonth()+1);else d.setUTCDate(d.getUTCDate()+step);
  }
  for(const t of transactions){if(t.date<start||t.date>end)continue;const key=bucket(t.date);insert(key);const b=byDate.get(key)[t.currency];b.incomeMinor+=BigInt(t.selectedIncomeMinor??t.incomeMinor);b.consumptionMinor+=BigInt(t.selectedConsumptionMinor??t.consumptionMinor);}
  return [...byDate].sort(([a],[b])=>a.localeCompare(b)).map(([date,values])=>({date,values:Object.fromEntries(Object.entries(values).map(([c,b])=>[c,{incomeMinor:b.incomeMinor.toString(),consumptionMinor:b.consumptionMinor.toString()}]))}));
}
module.exports={statementCoverage,incomeExpenseAccounts,portfolioBalances,buildTrend};
