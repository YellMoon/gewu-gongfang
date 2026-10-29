'use strict';
const {buildInterestOnlyLoanTail}=require('./interestOnlyLoanTail');
function buildJiebeiCashflowPairs(accounts,observations,{annotatedIds=new Set(),links=[],balanceSnapshots=[]}={}){
 const byId=new Map(observations.map(o=>[o.id,o])),identity=o=>JSON.stringify([o.financialAccountId,o.provider,o.sourceIdentity||o.id]),latest=new Map(),map=new Map(accounts.map(a=>[a.id,a])),blocked=new Set([...annotatedIds].map(id=>byId.get(id)).filter(Boolean).map(identity)),out=[];
 for(const o of observations){const key=identity(o);if(!latest.has(key)||(o.sourceVersionOrdinal||0)>(latest.get(key).sourceVersionOrdinal||0))latest.set(key,o);}
 const ratesFor=(d,p,rates)=>{const days=Math.max(1,(Date.parse(p.date)-Date.parse(d.date))/86400000),principal=BigInt(d.amountMinor),cost=BigInt(p.amountMinor)-principal;if(d.occurredAt>=p.occurredAt||!Number.isInteger(days)||days>366||cost<0n)return [];return rates.filter(r=>{const expected=(principal*BigInt(days)*r.rate+500000n)/1000000n;return expected>=cost-1n&&expected<=cost+1n;});};
 for(const a of accounts){
  const config=a.settledLoanEpisodes;if(!config||a.status!=='active'||a.type!=='loan'||a.sourceProduct!=='alipay_jiebei'||a.currency!=='CNY'||a.mortgage||a.installmentLoan)continue;
  const source=map.get(config.sourceAccountId),anchor=balanceSnapshots.filter(s=>s.financialAccountId===a.id&&s.currency===a.currency&&s.source==='owner_confirmation').sort((x,y)=>Date.parse(y.asOf)-Date.parse(x.asOf))[0];
  if(source?.status!=='active'||source.type!=='wallet'||source.provider!=='alipay'||source.currency!==a.currency||anchor?.balanceMinor!=='0'||Date.parse(anchor.asOf)<Date.parse(config.ownerConfirmedSettledAt))continue;
  // The independently calibrated final episode remains separate. It does not
  // establish an earlier zero opening balance for the whole borrowing account.
  const calibrationAccounts=accounts.map(x=>x.id===a.id?{...x,settledLoanEpisodes:undefined}:x),tails=buildInterestOnlyLoanTail(calibrationAccounts,observations,{annotatedIds,links,balanceSnapshots}).filter(m=>m.financialAccountId===a.id);out.push(...tails);
  const events=[...latest.values()].filter(o=>o.provider==='alipay'&&o.financialAccountId===source.id&&o.status==='completed'&&o.currency===a.currency&&(o.accountRelations||[]).some(r=>r.role==='target'&&r.financialAccountId===a.id&&['loan_drawdown','repayment'].includes(r.activity))).sort((x,y)=>x.occurredAt.localeCompare(y.occurredAt)),draws=events.filter(o=>o.kind==='loan_drawdown'),pays=events.filter(o=>o.kind==='debt_payment'),rates=[];
  for(const tail of tails)rates.push({rate:BigInt(tail.derivedDailyRate.numerator),evidenceObservationIds:tail.sourceObservationIds,basis:'independently_reconciled_interest_periods'});
  for(let i=1;i<events.length;i++){
   const p=events[i],d=events[i-1];if(p.kind!=='debt_payment'||d.kind!=='loan_drawdown'||![p.principalMinor,p.interestMinor,p.feeMinor].every(v=>typeof v==='string')||p.principalMinor!==d.amountMinor||BigInt(p.principalMinor)+BigInt(p.interestMinor)+BigInt(p.feeMinor)!==BigInt(p.amountMinor)||p.paymentChannel.includes('&'))continue;
   const days=Math.max(1,(Date.parse(p.date)-Date.parse(d.date))/86400000),cost=BigInt(p.interestMinor)+BigInt(p.feeMinor),denominator=BigInt(d.amountMinor)*BigInt(days);if(!Number.isInteger(days)||days>366||denominator<=0n||cost<=0n||cost*1000000n%denominator!==0n)continue;
   const rate=cost*1000000n/denominator;if(rate>0n&&rate<=1000n)rates.push({rate,evidenceObservationIds:[d.id,p.id],basis:'existing_actual_principal_and_cost_split'});
  }
  if(!rates.length)continue;const periods=[],drawdowns=[],issues=[],used=new Set();
  for(const e of config.episodes){
   const od=byId.get(e.drawdownObservationId),op=byId.get(e.repaymentObservationId),d=od&&latest.get(identity(od)),p=op&&latest.get(identity(op));if(!d||!p)continue;
   // Later actual detail or an owner decision supersedes this estimate.
   if(blocked.has(identity(d))||blocked.has(identity(p))||[p.principalMinor,p.interestMinor,p.feeMinor].every(v=>v!==null&&v!==undefined))continue;
   const i=events.indexOf(p),keys=new Set([identity(d),identity(p)]),veto=links.some(l=>((l.status!=='deleted'&&['distinct','group_distinct'].includes(l.type))||(l.status==='deleted'&&l.type==='duplicate'))&&l.observationIds.map(id=>byId.get(id)).filter(Boolean).some(o=>keys.has(identity(o))));
   const accepted=ratesFor(d,p,rates),alternativeDraws=draws.filter(x=>ratesFor(x,p,rates).length),alternativePays=pays.filter(x=>ratesFor(d,x,rates).length);
   if(i<1||events[i-1]!==d||d.financialAccountId!==source.id||p.financialAccountId!==source.id||d.kind!=='loan_drawdown'||p.kind!=='debt_payment'||veto||p.paymentChannel.includes('&')||!['余额','账户余额','支付宝余额','余额宝'].includes(p.paymentChannel)||Date.parse(p.occurredAt)>Date.parse(config.ownerConfirmedSettledAt)||!accepted.length||alternativeDraws.length!==1||alternativePays.length!==1||used.has(identity(d))||used.has(identity(p))){issues.push({drawdownObservationId:d.id,repaymentObservationId:p.id,reason:'conflict_or_ambiguous_cashflow'});continue;}
   const calibration=accepted[0],days=Math.max(1,(Date.parse(p.date)-Date.parse(d.date))/86400000),cost=BigInt(p.amountMinor)-BigInt(d.amountMinor),expected=(BigInt(d.amountMinor)*BigInt(days)*calibration.rate+500000n)/1000000n;
   periods.push({date:p.date,amountMinor:p.amountMinor,principalMinor:d.amountMinor,financingCostMinor:String(cost),observationIds:[p.id],drawdownObservationId:d.id,days,platformFunding:true,confidence:'inferred_source_history',purposeConfidence:'inferred_principal_and_financing_cost',derivedDailyRatePpm:String(calibration.rate),roundingVarianceMinor:String(cost-expected),calibrationEvidenceObservationIds:calibration.evidenceObservationIds,basis:'consecutive_borrowing_and_repayment_with_unique_calibrated_full_principal_match',actualDetailPrecedence:true});
   drawdowns.push({observationId:d.id,principalMinor:d.amountMinor,date:d.date});used.add(identity(d));used.add(identity(p));
  }
  if(!periods.length)continue;const principal=drawdowns.reduce((s,d)=>s+BigInt(d.principalMinor),0n),cost=periods.reduce((s,p)=>s+BigInt(p.financingCostMinor),0n);
  out.push({financialAccountId:a.id,sourceAccountId:source.id,loanType:'inferred_jiebei_cashflow_pairs',status:'reconciled_settled',historyComplete:false,coverage:{basis:'selected_independently_inferred_pairs',accountBalanceCoverage:'not_inferred'},confidence:'inferred_source_history',periods,drawdowns,balanceEvents:[],originalPrincipalMinor:String(principal),financingCostMinor:String(cost),remainingPrincipalMinor:'0',balanceMinor:'0',totalPaidMinor:String(principal+cost),ownerConfirmedSettledAt:config.ownerConfirmedSettledAt,sourceObservationIds:[...drawdowns.map(d=>d.observationId),...periods.flatMap(p=>p.observationIds)],asOf:periods.map(p=>p.date).sort().at(-1),costClassification:'interest_or_financing_fee',userConfirmedFacts:['settled','accept_evidence_based_inference'],unresolvedEpisodes:issues});
 }
 return out;
}
module.exports={buildJiebeiCashflowPairs};
