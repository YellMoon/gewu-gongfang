'use strict';
const invalid=()=>{throw Object.assign(new Error('OBSERVED_DAY_BALANCE_INVALID'),{code:'OBSERVED_DAY_BALANCE_INVALID'});};
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const validScope=(v,a)=>v.scope===undefined&&v.scopeBasis===undefined&&v.scopeConfirmedAt===undefined||v.scope==='alipay_balance_and_yuebao'&&a.provider==='alipay'&&a.type==='investment'&&a.sourceProduct==='alipay_yuebao'&&a.currency==='CNY'&&v.scopeBasis==='owner_confirmed'&&typeof v.scopeConfirmedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v.scopeConfirmedAt)&&Number.isFinite(Date.parse(v.scopeConfirmedAt));
function validateObservedDayBalances(values,account){
 if(!Array.isArray(values)||!values.length||values.length>512)invalid();
 const ids=new Set(),cells=new Set();
 for(const v of values){
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['id','date','balanceMinor','currency','source','sourceFileSha256','sourceFilename','sheet','cell','timePrecision','timezone','balanceConvention','scope','scopeBasis','scopeConfirmedAt'].includes(k))||typeof v.id!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(v.id)||ids.has(v.id)||!validDate(v.date)||typeof v.balanceMinor!=='string'||!/^(-?[1-9]\d{0,25}|0)$/.test(v.balanceMinor)||v.currency!==account.currency||v.source!=='manual_workbook'||!(/^[a-f0-9]{64}$/).test(v.sourceFileSha256||'')||typeof v.sourceFilename!=='string'||!v.sourceFilename.trim()||v.sourceFilename.length>128||/[\\/]/.test(v.sourceFilename)||typeof v.sheet!=='string'||!v.sheet.trim()||v.sheet.length>64||typeof v.cell!=='string'||!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(v.cell)||v.timePrecision!=='day'||v.timezone!=='Asia/Shanghai'||v.balanceConvention!=='signed')invalid();
  if(!validScope(v,account))invalid();const source=JSON.stringify([v.sourceFileSha256,v.sheet,v.cell]);if(cells.has(source))invalid();ids.add(v.id);cells.add(source);
 }
 return values;
}
const lower=(rows,time)=>{let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].time<time)lo=mid+1;else hi=mid;}return lo;};
const upper=(rows,time)=>{let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].time<=time)lo=mid+1;else hi=mid;}return lo;};
// A date-only observation is never assigned an invented midnight timestamp.
// Compare it to a conservative range across the entire observed local day.
// Being inside that range is compatibility, not proof of the chosen cash payer.
function compareObservedDayBalances(account,anchors,events,context={}){
 if(account.observedDayBalances===undefined)return[];
 const observed=validateObservedDayBalances(account.observedDayBalances,account),usable=anchors.filter(a=>!a.conflict&&a.balanceMinor!==null),prefix=[0n];for(const e of events)prefix.push(prefix.at(-1)+e.delta);
 return observed.map(day=>{
  const start=Date.parse(day.date+'T00:00:00+08:00'),end=start+86400000,base={evidenceId:day.id,date:day.date,observedBalanceMinor:day.balanceMinor,source:day.source,sourceFileSha256:day.sourceFileSha256,sourceFilename:day.sourceFilename,sheet:day.sheet,cell:day.cell,timePrecision:'day',noObservedTimeInvented:true,compatibilityDoesNotVerifyPurposeOrCompleteness:true};
  if(day.scope)return compareCombinedDay(day,base,account,start,end,context);
  const anchor=[...usable].sort((a,b)=>Math.max(start-a.time,a.time-end,0)-Math.max(start-b.time,b.time-end,0)||a.time-b.time)[0];
  if(!anchor)return{...base,status:'insufficient_independent_anchor'};
  const lo=lower(events,start),hi=lower(events,end),anchorEnd=upper(events,anchor.time),opening=BigInt(anchor.balanceMinor)+(anchor.time>=start?-(prefix[anchorEnd]-prefix[lo]):prefix[lo]-prefix[anchorEnd]);
  let value=opening,min=opening,max=opening;
  for(let i=lo;i<hi;){let j=i,positive=0n,negative=0n;while(j<hi&&events[j].time===events[i].time){if(events[j].delta>0n)positive+=events[j].delta;else negative+=events[j].delta;j++;}
   if(value+negative<min)min=value+negative;if(value+positive>max)max=value+positive;value+=negative+positive;i=j;
  }
  const balance=BigInt(day.balanceMinor),outside=balance<min||balance>max;
  return{...base,status:outside?'outside_observed_day_range':'compatible_day_range_not_verified',computedOpeningBeforeDayMinor:String(opening),computedEndOfDayMinor:String(value),computedMinimumMinor:String(min),computedMaximumMinor:String(max),differenceToRangeMinor:String(balance<min?balance-min:balance>max?balance-max:0n),anchorAsOf:anchor.asOf,anchorBalanceMinor:anchor.balanceMinor,anchorIds:anchor.anchorIds,dayEventCount:hi-lo,dayTransactionIds:[...new Set(events.slice(lo,hi).map(e=>e.transactionId))],sameTimestampOrderConservative:true};
 });
}
function compareCombinedDay(day,base,account,start,end,{accounts=[],anchorsByAccount=new Map(),eventsByAccount=new Map()}={}){
 const wallets=accounts.filter(a=>a.status==='active'&&a.type==='wallet'&&a.provider==='alipay'&&!a.sourceProduct&&a.currency===account.currency),products=accounts.filter(a=>a.status==='active'&&a.provider==='alipay'&&a.sourceProduct==='alipay_yuebao'&&a.currency===account.currency);
 const scoped={...base,scope:day.scope,scopeBasis:day.scopeBasis,scopeConfirmedAt:day.scopeConfirmedAt,noSyntheticCombinedAnchor:true};
 if(wallets.length!==1||products.length!==1||products[0].id!==account.id)return{...scoped,status:'ambiguous_or_missing_scope_account'};
 const members=[account,wallets[0]],clean={...day};delete clean.scope;delete clean.scopeBasis;delete clean.scopeConfirmedAt;
 const parts=members.map(a=>compareObservedDayBalances({...a,observedDayBalances:[clean]},anchorsByAccount.get(a.id)||[],eventsByAccount.get(a.id)||[])[0]);
 const result={...scoped,financialAccountIds:members.map(a=>a.id)};
 if(parts.some(p=>p.status==='insufficient_independent_anchor'))return{...result,status:'insufficient_independent_anchor',missingAnchorAccountIds:members.filter((a,i)=>parts[i].status==='insufficient_independent_anchor').map(a=>a.id)};
 const grouped=new Map();for(const a of members)for(const event of eventsByAccount.get(a.id)||[])if(event.time>=start&&event.time<end){const key=JSON.stringify([event.time,event.transactionId]);if(!grouped.has(key))grouped.set(key,{...event,delta:0n});grouped.get(key).delta+=event.delta;}
 const es=[...grouped.values()].filter(e=>e.delta!==0n).sort((a,b)=>a.time-b.time),opening=parts.reduce((sum,p)=>sum+BigInt(p.computedOpeningBeforeDayMinor),0n);let value=opening,min=opening,max=opening;
 for(let i=0;i<es.length;){let j=i,positive=0n,negative=0n;while(j<es.length&&es[j].time===es[i].time){if(es[j].delta>0n)positive+=es[j].delta;else negative+=es[j].delta;j++;}if(value+negative<min)min=value+negative;if(value+positive>max)max=value+positive;value+=negative+positive;i=j;}
 const balance=BigInt(day.balanceMinor),outside=balance<min||balance>max;
 return{...result,status:outside?'outside_observed_day_range':'compatible_day_range_not_verified',computedOpeningBeforeDayMinor:String(opening),computedEndOfDayMinor:String(value),computedMinimumMinor:String(min),computedMaximumMinor:String(max),differenceToRangeMinor:String(balance<min?balance-min:balance>max?balance-max:0n),anchorEvidence:parts.map((p,i)=>({financialAccountId:members[i].id,asOf:p.anchorAsOf,balanceMinor:p.anchorBalanceMinor,anchorIds:p.anchorIds})),dayEventCount:es.length,dayTransactionIds:[...new Set(es.map(e=>e.transactionId))],sameTimestampOrderConservative:true,internalSameTransactionLegsNetBeforeRange:true};
}
module.exports={validateObservedDayBalances,compareObservedDayBalances};
