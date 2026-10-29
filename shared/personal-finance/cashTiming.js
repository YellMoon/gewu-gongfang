'use strict';
const within=(date,{startDate,endDate}={})=>(!startDate||date>=startDate)&&(!endDate||date<=endDate);
// Economic payment periods can contain debits on different days or at different
// times within one day. Preserve every original posting for balance checks.
function sourceCashTiming(sources,cashEffects,balanceEffects){
 const cashEffectEvents={},balanceEffectEvents={};
 const observedDates=new Set(sources.filter(s=>s.status==='completed').map(s=>s.date));
 for(const [accountId,total]of cashEffects){
  const rows=sources.filter(s=>s.financialAccountId===accountId&&s.status==='completed'&&s.statementFlow&&['credit','debit'].includes(s.direction));
  if(!rows.length||observedDates.size<2&&new Set(rows.map(s=>s.occurredAt)).size<2)continue;
  const events=rows.map(s=>({date:s.date,occurredAt:s.occurredAt,deltaMinor:BigInt(s.amountMinor)*(s.direction==='credit'?1n:-1n),observationId:s.id}));
  if(events.reduce((n,e)=>n+e.deltaMinor,0n)!==total||balanceEffects.get(accountId)!==total)continue;
  balanceEffectEvents[accountId]=events;
  const days=new Map();for(const e of events)days.set(e.date,(days.get(e.date)||0n)+e.deltaMinor);
  cashEffectEvents[accountId]=[...days].map(([date,deltaMinor])=>({date,deltaMinor}));
 }
 return Object.keys(cashEffectEvents).length?{cashEffectEvents,balanceEffectEvents}:{};
}
function cashEntries(transaction,range={}){
 const entries=[];for(const [id,total]of Object.entries(transaction.cashEffects)){
  const events=transaction.cashEffectEvents?.[id];if(events)for(const e of events){if(within(e.date,range))entries.push([id,BigInt(e.deltaMinor)]);}
  else if(within(transaction.date,range))entries.push([id,BigInt(total)]);
 }return entries;
}
function transactionsInRange(transactions,selected,range={}){
 const eventDay=e=>e.date||new Date(Date.parse(e.occurredAt)+8*3600000).toISOString().slice(0,10);
 return transactions.filter(t=>t.financialAccountIds.some(id=>selected.has(id))&&(within(t.date,range)||Object.entries(t.cashEffectEvents||{}).some(([id,events])=>selected.has(id)&&events.some(e=>within(e.date,range)))||Object.entries(t.balanceEffectEvents||{}).some(([id,events])=>selected.has(id)&&events.some(e=>within(eventDay(e),range)))||Object.entries(t.balanceEffectTimes||{}).some(([id,time])=>selected.has(id)&&within(eventDay({occurredAt:time}),range))));
}
module.exports={within,sourceCashTiming,cashEntries,transactionsInRange};
