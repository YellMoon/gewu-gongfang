'use strict';
const BASE=12000000n,YEAR=360000000n,abs=n=>n<0n?-n:n,round=(n,d)=>(n+d/2n)/d;
const BATCH_DATE='2024-10-25',POLICY='https://wap.hxb.com.cn/wap/zxgg/121596.shtml';
const index=d=>Number(d.slice(0,4))*12+Number(d.slice(5,7)),days=(a,b)=>BigInt((Date.parse(b)-Date.parse(a))/86400000);
function annuity(p,r,n,mode='floor'){const a=(BASE+r)**BigInt(n),b=BASE**BigInt(n),numerator=p*r*a,denominator=BASE*(a-b);return mode==='floor'?numerator/denominator:round(numerator,denominator);}
function rateFor(p,amount,n){
 const matches=[];for(let rate=10000n;rate<=100000n;rate+=500n){const predicted=annuity(p,rate,n);if(abs(predicted-amount)<=1n)matches.push(rate);}return matches.length===1?matches[0]:null;
}
function commercialHistoryModel(m,rows,prepayments,{protectedIds=new Set()}={}){
 if(!m.termMonths||!m.firstPaymentDate||!m.recentSplit||m.recentSplit.monthBasis==='bank_confirmed'||rows.length<24||rows[0].month!==m.firstPaymentDate.slice(0,7)||rows[0].sources.some(o=>o.provider!=='huaxia')||prepayments.length!==1||prepayments[0].amountBasis!=='total_payment')return null;
 const fullTerms=m.termMonths-1,normal=rows[1].amount;if(fullTerms<rows.length||rows[2].amount!==normal)return null;
 if(rows.some(r=>r.sources.some(o=>protectedIds.has(o.id)||o.principalMinor!==null||o.interestMinor!==null||o.feeMinor!==null))||prepayments.some(p=>p.observationIds.some(id=>protectedIds.has(id))))return null;
 let p=BigInt(m.originalPrincipalMinor),rate=rateFor(p,normal,fullTerms);if(rate===null)return null;
 const firstPrincipal=normal-round(p*rate,BASE),firstInterest=rows[0].amount-firstPrincipal;if(firstPrincipal<=0n||firstInterest<=0n)return null;
 const firstDays=[];for(let d=1n;d<=62n;d++)if(round(p*rate*d,YEAR)===firstInterest)firstDays.push(d);if(firstDays.length!==1)return null;
 const inferredDrawdownDate=new Date(Date.parse(m.firstPaymentDate)-Number(firstDays[0])*86400000).toISOString().slice(0,10),dueDay=m.firstPaymentDate.slice(8),periods=[],balanceEvents=[],paidPrepayments=[],rateEpochs=[{month:rows[0].month,annualRatePpm:String(rate),basis:'inferred_from_original_principal_and_regular_payment'}],checks=[];
 let previousDue=null,lastPayment=null,batchApplied=false;
 for(let i=0;i<rows.length;i++){
  const row=rows[i],due=row.month+'-'+dueDay,n=fullTerms-i;if(index(row.month)!==index(rows[0].month)+i||n<1||new Date(due).toISOString().slice(0,10)!==due)return null;
  let interest=i===0?firstInterest:round(p*rate,BASE),principal=i===0?firstPrincipal:null,changed=false;
  const inPeriod=prepayments.filter(x=>previousDue&&x.date>previousDue&&x.date<=due);
  if(inPeriod.length>1)return null;
  if(inPeriod.length){
   const pre=inPeriod[0],elapsed=days(previousDue,pre.date),remaining=days(pre.date,due);if(elapsed<=0n||remaining<0n)return null;
   const cost=round(p*rate*elapsed,YEAR),repaid=BigInt(pre.amountMinor)-cost;if(repaid<=0n||repaid>=p)return null;p-=repaid;
   paidPrepayments.push({...pre,principalMinor:String(repaid),interestMinor:String(cost),feeMinor:'0',balanceMinor:String(p),annualRatePpm:String(rate),confidence:'inferred_reconciled_history',elapsedDays:Number(elapsed),yearDays:360});balanceEvents.push({date:pre.date,balanceMinor:String(p)});interest=round(p*rate*remaining,YEAR);changed=true;
  }else if(i>1&&row.amount!==lastPayment){
   const next=rateFor(p,row.amount,n);if(next===null||next>=rate)return null;const before=rate;rate=next;changed=true;interest=round(p*rate,BASE);
   if(row.month==='2024-11'){
    if(previousDue>=BATCH_DATE||due<=BATCH_DATE||before-rate!==3000n)return null;
    interest=round(p*rate*30n+p*(before-rate)*days(previousDue,BATCH_DATE),YEAR);batchApplied=true;
   }
   rateEpochs.push({month:row.month,annualRatePpm:String(rate),basis:row.month==='2024-11'?'published_batch_adjustment_and_statement_payment':'inferred_from_statement_payment'});
  }
  if(i>0){const expected=annuity(p,rate,n),difference=row.amount-expected;if((changed||i===1)&&abs(difference)>1n)return null;if(changed||i===1)checks.push({month:row.month,expectedMinor:String(expected),observedMinor:String(row.amount),differenceMinor:String(difference)});principal=row.amount-interest;}
  if(principal<=0n||principal>p||interest<0n||principal+interest!==row.amount)return null;p-=principal;
  periods.push({month:row.month,date:row.date,scheduledDate:due,amountMinor:String(row.amount),principalMinor:String(principal),interestMinor:String(interest),feeMinor:'0',extraMinor:'0',balanceMinor:String(p),annualRatePpm:String(rate),confidence:'inferred_reconciled_history',observationIds:row.sources.map(o=>o.id)});balanceEvents.push({date:row.date,balanceMinor:String(p)});lastPayment=row.amount;previousDue=due;
 }
 if(!batchApplied||paidPrepayments.length!==prepayments.length||rateEpochs.length<4)return null;
 // Contract constraints are independent of an undated reference. Reject a
 // conflicting history before matching a future forecast to that reference.
 const minimumRateConflict=m.minimumAnnualRatePpm!==undefined&&rateEpochs.some(e=>BigInt(e.annualRatePpm)<BigInt(m.minimumAnnualRatePpm)),currentRateConflict=m.annualRatePpm!==null&&BigInt(m.annualRatePpm)!==rate,repricingConflicts=require('./mortgageRepricingTerms').findMortgageRepricingConflicts(m,rateEpochs);
 if(currentRateConflict||minimumRateConflict||repricingConflicts.length)return{status:'rate_constraint_conflict',balanceMinor:null,asOf:rows.at(-1).date,periods:[],balanceEvents:[],prepayments:[],statedAnnualRatePpm:m.annualRatePpm,minimumAnnualRatePpm:m.minimumAnnualRatePpm||null,...(m.repricingTerms?{repricingTerms:m.repricingTerms}:{}),calibrationVerification:{status:'requires_review',rateConflict:currentRateConflict||minimumRateConflict,currentRateConflict,minimumRateConflict,repricingConflict:repricingConflicts.length>0,repricingConflicts,statedAnnualRatePpm:m.annualRatePpm,rejectedHistoricalRateEstimate:true},nextPayment:null,forecast:[],unallocatedRepaymentMinor:String(rows.reduce((n,r)=>n+r.amount,0n)+prepayments.reduce((n,p)=>n+BigInt(p.amountMinor),0n)),interestStatisticsIncomplete:true,affectedObservationIds:[...rows.flatMap(r=>r.sources.map(o=>o.id)),...prepayments.flatMap(p=>p.observationIds)],policySources:[POLICY],assumptions:[],warnings:[{reason:'historical_rate_fit_rejected_by_owner_confirmed_rate_constraints',statedAnnualRatePpm:m.annualRatePpm,minimumAnnualRatePpm:m.minimumAnnualRatePpm||null,principalAndInterestNotApplied:true,...(repricingConflicts.length?{repricingConflicts}: {})}]};
 const forecast=[];let future=p;for(let i=1;i<=12;i++){const month=new Date(Date.UTC(Number(previousDue.slice(0,4)),Number(previousDue.slice(5,7))-1+i,Number(dueDay))).toISOString().slice(0,7),interest=round(future*rate,BASE),principal=lastPayment-interest;if(principal<=0n||principal>future)break;future-=principal;forecast.push({month,principalMinor:String(principal),interestMinor:String(interest),amountMinor:String(lastPayment),balanceMinor:String(future),status:'forecast_only'});}
 const referenceMatches=[...periods.map(p=>({...p,basis:'paid_statement_period'})),...forecast.map(p=>({...p,basis:'numerically_matches_forecast'}))].filter(p=>p.principalMinor===m.recentSplit.principalMinor&&p.interestMinor===m.recentSplit.interestMinor);if(referenceMatches.length!==1)return null;
 const ref=referenceMatches[0],rateConflict=m.annualRatePpm!==null&&BigInt(m.annualRatePpm)!==rate,calibrationConflict=rateConflict||ref.basis==='numerically_matches_forecast';return {status:'inferred_reconciled_history',balanceMinor:String(p),asOf:rows.at(-1).date,periods,balanceEvents,prepayments:paidPrepayments,rateEpochs,observedAnnualRatePpm:String(rate),statedAnnualRatePpm:m.annualRatePpm,calibrationVerification:{status:calibrationConflict?'requires_review':'history_inferred',rateConflict,referenceDateUnverified:ref.basis==='numerically_matches_forecast',statedAnnualRatePpm:m.annualRatePpm,inferredHistoryAnnualRatePpm:String(rate)},referenceMatch:{month:ref.month,basis:ref.basis,principalMinor:ref.principalMinor,interestMinor:ref.interestMinor,bankConfirmedDate:false},nextPayment:calibrationConflict?null:forecast[0],forecast:calibrationConflict?[]:forecast,inferredDrawdownDate,fullAnnuityPeriods:fullTerms,historyVerification:{cashTotals:true,annuityToleranceMinor:'1',independentReferenceMatch:true,matchedMonths:rows.length,checks},policySources:[POLICY],assumptions:['regular_period_interest_annual_divided_by_12','batch_adjustment_old_rate_difference_uses_actual_days_over_360','prepayment_total_includes_all_accrued_interest','normal_annuity_full_period_count_inferred_from_statement','monthly_payment_rounding_tolerance_one_minor_unit','partial_debits_grouped_by_contract_payment_month'],warnings:[{reason:'reference_not_used_as_dated_calibration',matchedMonth:ref.month,basis:ref.basis},...(rateConflict?[{reason:'stated_rate_differs_from_inferred_history',statedAnnualRatePpm:m.annualRatePpm,inferredHistoryAnnualRatePpm:String(rate)}]:[])]};
}
module.exports={commercialHistoryModel};
