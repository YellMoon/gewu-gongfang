'use strict';
function balanceGroups(accounts,view,{endDate}={}){
 const registers=new Map((view.securities||[]).map(r=>[r.financialAccountId,r])),mortgages=new Set((view.mortgages||[]).map(m=>m.financialAccountId));
 const groups=new Map(['savings','credit','mortgage','securities','other'].map(key=>[key,{key,accountIds:[],currency:null,knownBalanceMinor:0n,knownCount:0,unknownCount:0,estimatedBalanceMinor:0n,estimatedCount:0,billedDebtMinor:0n,billedDebtCount:0,knownCashMinor:0n,knownCashCount:0,dates:[]}]));
 const currencyGroups=new Map();
 for(const account of accounts){const stats=view.accountStats?.[account.id];if(!stats||stats.balanceExcludedReason)continue;
  const key=registers.has(account.id)?'securities':mortgages.has(account.id)||account.mortgage?'mortgage':account.type==='credit_card'?'credit':['bank','savings','debit_card'].includes(account.type)?'savings':'other';
  const groupKey=JSON.stringify([key,account.currency]);if(!currencyGroups.has(groupKey))currencyGroups.set(groupKey,{...groups.get(key),currency:account.currency,accountIds:[],dates:[]});const group=currencyGroups.get(groupKey);group.accountIds.push(account.id);
  let known=stats.balanceMinor,date=stats.balanceAsOf||stats.balanceAnchor?.asOf?.slice(0,10);
  if(key==='securities'){const register=registers.get(account.id),eligible=!endDate||register.cashBalanceAsOf&&register.cashBalanceAsOf<=endDate;known=eligible?register.portfolioValueMinor:null;date=register.cashBalanceAsOf;if(eligible&&register.cashBalanceComplete&&register.cashBalanceMinor!==null){group.knownCashMinor+=BigInt(register.cashBalanceMinor);group.knownCashCount++;}}
  if(key==='credit'||key==='mortgage')known=known===null||known===undefined?null:-BigInt(known);
  if(known!==null&&known!==undefined){group.knownBalanceMinor+=BigInt(known);group.knownCount++;if(date)group.dates.push(date);}
  else if(key==='mortgage'&&stats.estimatedBalanceMinor!==null&&stats.estimatedBalanceMinor!==undefined){group.estimatedBalanceMinor-=BigInt(stats.estimatedBalanceMinor);group.estimatedCount++;if(stats.estimateAsOf)group.dates.push(stats.estimateAsOf);}
  else group.unknownCount++;
  const bill=account.verifiedBalance;if(key==='credit'&&bill?.balanceKind==='billed_debt'&&(!endDate||bill.asOf.slice(0,10)<=endDate)){group.billedDebtMinor-=BigInt(bill.balanceMinor);group.billedDebtCount++;}
 }
 return [...currencyGroups.values()].sort((a,b)=>[...groups.keys()].indexOf(a.key)-[...groups.keys()].indexOf(b.key)||a.currency.localeCompare(b.currency)).map(({dates,...group})=>({...Object.fromEntries(Object.entries(group).map(([key,value])=>[key,typeof value==='bigint'?String(value):value])),oldestAsOf:dates.sort()[0]||null,newestAsOf:dates.at(-1)||null}));
}
module.exports={balanceGroups};
