'use strict';
const BASE=12000000n;
const POLICY_SOURCES=[
 'https://gjj.beijing.gov.cn/web/zwfw5/gjjsydkll/1736802/',
 'https://jst.zj.gov.cn/module/download/downfile.jsp?classid=0&filename=0ed57db774bc4f2aa30a2469f8884351.pdf',
 'https://www.hzzx.gov.cn/cshz/content/2025-12/31/content_9154221.htm',
];
const PROVIDENT_RATES=[['2015-08-26','32500'],['2023-01-01','31000'],['2025-01-01','28500'],['2026-01-01','26000']];
const amount=v=>typeof v==='string'&&/^(0|[1-9]\d{0,29})$/.test(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const only=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k));
const invalid=()=>{throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_INPUT_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_INPUT_INVALID'});};
function validateMortgage(m){
 if(!only(m,['schema','loanType','originalPrincipalMinor','sourceAccountId','statementReference','annualRatePpm','recentSplit','prepayments'])||m.schema!=='mortgage-v1'||!['commercial','provident'].includes(m.loanType)||!amount(m.originalPrincipalMinor)||BigInt(m.originalPrincipalMinor)<=0n||typeof m.sourceAccountId!=='string'||!m.sourceAccountId.trim()||m.sourceAccountId.length>512||!/^\d{4}$/.test(m.statementReference))invalid();
 if(m.annualRatePpm!==null&&(!amount(m.annualRatePpm)||BigInt(m.annualRatePpm)<=0n||BigInt(m.annualRatePpm)>1000000n))invalid();
 if(m.recentSplit!==null&&(!only(m.recentSplit,['principalMinor','interestMinor','month'])||!amount(m.recentSplit.principalMinor)||!amount(m.recentSplit.interestMinor)||BigInt(m.recentSplit.interestMinor)<=0n||m.recentSplit.month!==null&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(m.recentSplit.month)))invalid();
 if(!Array.isArray(m.prepayments)||m.prepayments.length>100||m.prepayments.some(p=>!only(p,['date','amountMinor','mode'])||!date(p.date)||!amount(p.amountMinor)||BigInt(p.amountMinor)<=0n||p.mode!=='reduce_payment_keep_term')||new Set(m.prepayments.map(p=>p.date+':'+p.amountMinor)).size!==m.prepayments.length)invalid();
 if(m.recentSplit&&!m.annualRatePpm)invalid();
 return m;
}
function matchesMortgage(o,m){
 if(o.financialAccountId!==m.sourceAccountId||o.currency!=='CNY'||o.status!=='completed'||o.direction!=='debit'||!['debt_payment','unknown'].includes(o.kind))return false;
 if(m.loanType==='commercial')return /\u8d37\u6b3e\u672c\u606f|\u8d37\u6b3e\u8fd8\u6b3e/.test(o.description)&&/\u4e2a\u4eba\u8d37\u6b3e\u6237/.test(o.counterparty)&&String(o.rawFields?.['\u5bf9\u65b9\u5361/\u8d26\u53f7']||'').trim().endsWith(m.statementReference);
 return /\u516c\u79ef\u91d1\u6263\u6b3e/.test(o.description)&&/\u4f4f\u623f\u516c\u79ef\u91d1\u7ba1\u7406\u4e2d\u5fc3/.test(o.counterparty)&&String(o.rawFields?.['\u9644\u8a00']||'').trim().endsWith(m.statementReference);
}
function uniqueSources(observations){
 const versions=new Map();for(const o of observations){const key=JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.sourceTransactionId||o.id]);if(!versions.has(key)||(o.sourceVersionOrdinal||0)>(versions.get(key).sourceVersionOrdinal||0))versions.set(key,o);}return [...versions.values()];
}
function paymentRows(observations,m){
 const monthly=new Map(),prepayments=[];
 const eligible=uniqueSources(observations).filter(o=>matchesMortgage(o,m));
 for(const o of eligible){
  const prepay=m.prepayments.find(p=>p.date===o.date&&p.amountMinor===o.amountMinor);
  if(prepay&&eligible.filter(s=>s.date===o.date&&s.amountMinor===o.amountMinor).length===1){prepayments.push({date:o.date,amountMinor:o.amountMinor,principalMinor:o.amountMinor,interestMinor:'0',confidence:'user_confirmed_prepayment',observationIds:[o.id],mode:prepay.mode});continue;}
  const month=o.date.slice(0,7);if(!monthly.has(month))monthly.set(month,{month,date:o.date,amount:0n,sources:[]});const row=monthly.get(month);row.amount+=BigInt(o.amountMinor);row.sources.push(o);if(row.date<o.date)row.date=o.date;
 }
 return {monthly:[...monthly.values()].sort((a,b)=>a.month.localeCompare(b.month)),prepayments};
}
function bindMortgageCalibration(m,observations){
 validateMortgage(m);if(!m.recentSplit||m.recentSplit.month!==null)return m;
 const total=BigInt(m.recentSplit.principalMinor)+BigInt(m.recentSplit.interestMinor),rows=paymentRows(observations,m).monthly.filter(r=>r.amount===total);
 if(!rows.length)throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_MORTGAGE_CALIBRATION_NOT_FOUND'),{code:'CLOUD_PERSONAL_FINANCE_MORTGAGE_CALIBRATION_NOT_FOUND'});
 return {...m,recentSplit:{...m.recentSplit,month:rows.at(-1).month}};
}
const round=(n,d)=>(n+d/2n)/d;
function monthlyPayment(principal,rate,months){
 const p=BigInt(principal),r=BigInt(rate);if(!Number.isInteger(months)||months<1||months>600||p<0n||r<0n)invalid();if(r===0n)return round(p,BigInt(months));const a=(BASE+r)**BigInt(months),b=BASE**BigInt(months);return round(p*r*a,BASE*(a-b));
}
const monthlyInterest=(p,r)=>round(p*BigInt(r),BASE);
const providentRate=d=>PROVIDENT_RATES.filter(([from])=>from<=d).at(-1)?.[1]||null;
function serial(v){return typeof v==='bigint'?String(v):Array.isArray(v)?v.map(serial):object(v)?Object.fromEntries(Object.entries(v).map(([k,v])=>[k,serial(v)])):v;}
function commercialModel(m,rows,prepayments){
 const result={status:'missing_calibration',balanceMinor:null,asOf:null,periods:[],balanceEvents:[],assumptions:['monthly_interest_rate_equals_annual_divided_by_12'],warnings:[]};
 if(!m.recentSplit?.month||!m.annualRatePpm)return result;
 const anchor=rows.find(r=>r.month===m.recentSplit.month),split=m.recentSplit;
 if(!anchor||anchor.amount!==BigInt(split.principalMinor)+BigInt(split.interestMinor)){result.status='calibration_conflict';return result;}
 let balance=round(BigInt(split.interestMinor)*BASE,BigInt(m.annualRatePpm))-BigInt(split.principalMinor);
 if(balance<0n||balance+BigInt(split.principalMinor)>BigInt(m.originalPrincipalMinor)){result.status='calibration_conflict';return result;}
 result.status='estimated';result.calibrationMonth=anchor.month;result.calibrationBeforeMinor=balance+BigInt(split.principalMinor);result.calibrationAfterMinor=balance;
 if(rows.some(r=>r.sources.some(s=>s.provider==='huaxia')))result.lprAnalysis={status:'policy_candidate',spreadBasisPoints:-30,impliedReferenceLprPpm:String(BigInt(m.annualRatePpm)+3000n),source:'https://wap.hxb.com.cn/wap/zxgg/121596.shtml',requiresRepricingDateMatch:true};
 result.calibrationRoundingToleranceMinor=round(BASE,2n*BigInt(m.annualRatePpm));
 result.assumptions.push('recent_user_split_bound_to_latest_matching_month_at_save');
 let previousDate=anchor.date,previousAmount=anchor.amount,transitionPending=false;
 for(const row of rows){if(row.month<anchor.month)continue;const changes=prepayments.filter(p=>p.date>previousDate&&p.date<=row.date);if(row.month>anchor.month&&row.amount!==previousAmount&&!changes.length){result.warnings.push({month:row.month,reason:'rate_or_payment_changed'});result.status='partial_estimate';break;}for(const p of changes){balance-=BigInt(p.principalMinor);result.balanceEvents.push({date:p.date,balanceMinor:balance});result.asOf=p.date;previousDate=p.date;}if(changes.length){result.warnings.push({month:row.month,reason:'prepayment_transition_interest_pending'});result.status='partial_estimate';transitionPending=true;break;}const confirmed=row.month===anchor.month,interest=confirmed?BigInt(split.interestMinor):monthlyInterest(balance,m.annualRatePpm),principal=confirmed?BigInt(split.principalMinor):row.amount-interest;
  if(principal<0n||principal>balance){result.warnings.push({month:row.month,reason:'payment_inconsistent_with_model'});break;}
  if(!confirmed)balance-=principal;
  result.periods.push({month:row.month,date:row.date,amountMinor:row.amount,principalMinor:principal,interestMinor:interest,extraMinor:0n,balanceMinor:balance,annualRatePpm:m.annualRatePpm,confidence:confirmed?'user_confirmed_split':'estimated',observationIds:row.sources.map(o=>o.id)});result.balanceEvents.push({date:row.date,balanceMinor:balance});result.asOf=row.date;previousDate=row.date;previousAmount=row.amount;
 }
 if(!transitionPending)for(const p of prepayments.filter(p=>p.date>previousDate)){balance-=BigInt(p.principalMinor);result.asOf=p.date;result.balanceEvents.push({date:p.date,balanceMinor:balance});}
 if(balance<0n){result.status='calibration_conflict';result.balanceEvents=[];result.periods=[];return result;}
 result.balanceMinor=balance;
 const interest=monthlyInterest(balance,m.annualRatePpm),last=rows.at(-1);if(last&&last.date===result.asOf&&last.amount>interest)result.nextPayment={amountMinor:last.amount,interestMinor:interest,principalMinor:last.amount-interest,status:'forecast_only'};
 return result;
}
function providentModel(m,rows){
 const result={status:'insufficient_history',balanceMinor:null,asOf:null,periods:[],warnings:[],policySources:POLICY_SOURCES,assumptions:['first_home_more_than_five_years','first_observed_payment_is_first_installment','first_payment_extra_is_initial_interest','january_rate_difference_uses_11_old_rate_days']};
 if(rows.length<3||m.prepayments.length)return result;
 const first=rows[0],rate=providentRate(first.date);if(!rate)return result;
 const counts=new Map();for(const r of rows.slice(1,4))counts.set(String(r.amount),(counts.get(String(r.amount))||0)+1);
 const normal=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0],candidates=[];
 if(!normal||counts.get(normal)<2)return result;
 for(let n=12;n<=360;n++){const expected=monthlyPayment(m.originalPrincipalMinor,rate,n),delta=expected-BigInt(normal);if(delta>=-1n&&delta<=1n)candidates.push(n);}
 if(candidates.length!==1){result.termCandidates=candidates;return result;}
 const term=candidates[0];result.inferredTermMonths=term;let balance=BigInt(m.originalPrincipalMinor),previousRate=rate,lastMonth=null;
 for(let i=0;i<rows.length;i++){
  const row=rows[i],r=providentRate(row.date);if(!r||i>=term)break;
  const index=Number(row.month.slice(0,4))*12+Number(row.month.slice(5)),lastIndex=lastMonth&&Number(lastMonth.slice(0,4))*12+Number(lastMonth.slice(5));
  if(lastIndex&&index!==lastIndex+1){result.warnings.push({month:row.month,reason:'missing_payment_month'});break;}
  const planned=monthlyPayment(balance,r,term-i);let interest=monthlyInterest(balance,r),expected=planned;
  if(i===0){const extra=row.amount-planned;if(extra<0n||extra>interest){result.warnings.push({month:row.month,reason:'initial_payment_not_explained'});break;}interest+=extra;expected=row.amount;}
  else if(r!==previousRate){if(row.month.slice(5)!=='01'){result.warnings.push({month:row.month,reason:'unsupported_rate_transition'});break;}const adjustment=round(balance*(BigInt(previousRate)-BigInt(r))*11n,360000000n);interest+=adjustment;expected+=adjustment;}
  let extra=row.amount-expected;if(extra< -1n||extra>100n){result.warnings.push({month:row.month,reason:'payment_inconsistent_with_model',expectedMinor:expected,actualMinor:row.amount});break;}
  if(extra>=-1n&&extra<=1n)extra=0n;
  const principal=row.amount-interest-extra;if(principal<0n||principal>balance)break;balance-=principal;
  result.periods.push({month:row.month,date:row.date,amountMinor:row.amount,principalMinor:principal,interestMinor:interest,extraMinor:extra,balanceMinor:balance,annualRatePpm:r,confidence:'estimated',observationIds:row.sources.map(o=>o.id)});
  if(extra>0n)result.warnings.push({month:row.month,reason:'extra_amount_not_assumed_principal',amountMinor:extra});
  previousRate=r;lastMonth=row.month;result.asOf=row.date;
 }
 if(result.periods.length){result.balanceMinor=balance;result.status=result.periods.length===rows.length?'estimated':'partial_estimate';const interest=monthlyInterest(balance,previousRate),last=rows[result.periods.length-1];result.nextPayment={amountMinor:last.amount,interestMinor:interest,principalMinor:last.amount-interest,status:'forecast_only'};}
 return result;
}
function buildMortgageModels(accounts,observations){
 const result=[];
 for(const a of accounts.filter(a=>a.type==='loan'&&a.mortgage)){
  const m=a.mortgage;validateMortgage(m);const {monthly,prepayments}=paymentRows(observations,m),model=m.loanType==='commercial'?commercialModel(m,monthly,prepayments):providentModel(m,monthly);
  result.push(serial({...model,financialAccountId:a.id,label:a.label,loanType:m.loanType,sourceAccountId:m.sourceAccountId,originalPrincipalMinor:m.originalPrincipalMinor,repaymentMethod:'equal_payment',prepayments,paymentCount:monthly.length,sourceObservationIds:[...monthly.flatMap(r=>r.sources.map(o=>o.id)),...prepayments.flatMap(r=>r.observationIds)],estimatedBalanceMinor:model.balanceMinor===null?null:-model.balanceMinor}));
 }
 return result;
}
module.exports={validateMortgage,bindMortgageCalibration,matchesMortgage,buildMortgageModels,monthlyPayment,monthlyInterest,PROVIDENT_RATES};
