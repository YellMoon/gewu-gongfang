'use strict';
// Derive only an independently consistent final episode. Earlier borrowings,
// lifetime costs, and historical total account balances remain uncalibrated.
function buildInterestOnlyLoanTail(accounts,observations,{balanceSnapshots=[],annotatedIds=new Set(),links=[]}={}){
 const identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),byId=new Map(observations.map(o=>[o.id,o])),latest=new Map(),accountMap=new Map(accounts.map(a=>[a.id,a]));
 for(const o of observations){const k=identity(o);if(!latest.has(k)||(o.sourceVersionOrdinal||0)>(latest.get(k).sourceVersionOrdinal||0))latest.set(k,o);}
 const annotated=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity)),rows=[...latest.values()].filter(o=>o.status==='completed'),results=[];
 for(const a of accounts){
  if(a.status!=='active'||a.type!=='loan'||a.sourceProduct!=='alipay_jiebei'||a.currency!=='CNY'||a.mortgage||a.installmentLoan||a.settledLoanEpisodes)continue;
  const confirmed=balanceSnapshots.filter(s=>s.financialAccountId===a.id&&s.currency===a.currency&&s.source==='owner_confirmation').sort((x,y)=>Date.parse(y.asOf)-Date.parse(x.asOf))[0];if(!confirmed||confirmed.balanceMinor!=='0')continue;
  const events=rows.filter(o=>o.provider==='alipay'&&o.currency===a.currency&&(o.accountRelations||[]).some(r=>r.product===a.sourceProduct&&r.financialAccountId===a.id&&r.role==='target'&&['loan_drawdown','repayment'].includes(r.activity))).sort((x,y)=>x.occurredAt.localeCompare(y.occurredAt));
  const draw=events.findLast(o=>o.kind==='loan_drawdown');if(!draw)continue;const tail=events.slice(events.indexOf(draw)),pays=tail.slice(1),source=accountMap.get(draw.financialAccountId);
  if(tail.length<5||tail.length>15||source?.status!=='active'||source.type!=='wallet'||tail.some(o=>o.financialAccountId!==draw.financialAccountId||annotated.has(identity(o))||Date.parse(o.occurredAt)>Date.parse(confirmed.asOf))||pays.some(o=>o.kind!=='debt_payment'||o.paymentChannel.includes('&')||!(o.accountRelations||[]).some(r=>r.role==='funding'&&r.activity==='funding_outflow'&&accountMap.get(r.financialAccountId)?.status==='active'&&accountMap.get(r.financialAccountId)?.sourceProduct===r.product)))continue;
  const keys=new Set(tail.map(identity));if(links.some(l=>((l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type))||(l.status==='deleted'&&l.type==='duplicate'))&&l.observationIds.some(id=>byId.has(id)&&keys.has(identity(byId.get(id))))))continue;
  const principal=BigInt(draw.amountMinor);if(principal<=0n)continue;let previous=draw.date,rate=null,cost=0n,valid=true;const periods=[];
  for(let i=0;i<pays.length;i++){
   const p=pays[i],days=(Date.parse(p.date)-Date.parse(previous))/86400000,final=i===pays.length-1,paid=BigInt(p.amountMinor),fee=paid-(final?principal:0n);
   if(!Number.isInteger(days)||days<=0||days>40||fee<=0n||!final&&paid>=principal){valid=false;break;}
   if(rate===null){const numerator=fee*1000000n,denominator=principal*BigInt(days);if(numerator%denominator!==0n){valid=false;break;}rate=numerator/denominator;if(rate<=0n||rate>1000n){valid=false;break;}}
   const expected=(principal*BigInt(days)*rate+500000n)/1000000n;if(expected!==fee){valid=false;break;}
   periods.push({date:p.date,amountMinor:p.amountMinor,principalMinor:final?String(principal):'0',financingCostMinor:String(fee),observationIds:[p.id],drawdownObservationId:draw.id,days,platformFunding:true,purposeConfidence:'inferred_constant_daily_cost'});cost+=fee;previous=p.date;
  }
  if(!valid)continue;
  results.push({financialAccountId:a.id,sourceAccountId:draw.financialAccountId,loanType:'inferred_interest_only_final_episode',status:'reconciled_settled',historyComplete:false,coverage:{startDate:draw.date,endDate:pays.at(-1).date,basis:'last_borrowing_and_all_subsequent_repayments',accountBalanceCoverage:'not_inferred'},confidence:'inferred_source_history',periods,drawdowns:[{observationId:draw.id,principalMinor:String(principal),date:draw.date}],balanceEvents:[],originalPrincipalMinor:String(principal),financingCostMinor:String(cost),remainingPrincipalMinor:'0',balanceMinor:'0',totalPaidMinor:String(principal+cost),derivedDailyRate:{numerator:String(rate),denominator:'1000000',basis:'observed_total_financing_cost_not_bank_interest_field'},ownerConfirmedSettledAt:confirmed.asOf,sourceObservationIds:tail.map(o=>o.id),asOf:pays.at(-1).date,costClassification:'interest_or_financing_fee',userConfirmedFacts:['settled']});
 }
 return results;
}
module.exports={buildInterestOnlyLoanTail};
