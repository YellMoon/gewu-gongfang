'use strict';
const {brokerageSecurityIdentity}=require('./securityIdentities');
const {validateInvestmentIncomePolicy,historicalFundRecognition}=require('./investmentIncomePolicy');
const UNSIGNED=/^(0|[1-9]\d{0,19})$/,SIGNED=/^-?(0|[1-9]\d{0,19})$/,DECIMAL=/^(0|[1-9]\d{0,23})(\.\d{1,12})?$/;
const ACTIVITIES=new Set(['buy','sell','deposit','withdrawal','interest','dividend','tax','registration','corporate_action','subscription','subscription_return','allocation','allocation_payment','allocation_confirmation','share_listing','repo_open','repo_close','fund_buy','fund_redeem','fund_reinvest','share_reduction']);
const FIELDS=['schema','activity','operation','securityCode','securityName','units','displayPrice','grossMinor','reportedGrossMinor','cashDeltaMinor','cashBalanceMinor','holdingUnits','feeMinor','fees','accountTail','sequence','sourcePage','periodStart','periodEnd','format','disclosedComponents'];
const FEE_FIELDS=['commissionMinor','netCommissionMinor','stampDutyMinor','transferMinor','otherMinor'];
const invalid=()=>{throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_BROKERAGE_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_BROKERAGE_INVALID'});};
function validateBrokerageAccount(account,records,provider){
 if(!records.some(r=>r.brokerage))return;
 if(records.some(r=>!r.brokerage)||account?.type!=='investment'||account.currency!=='CNY'||account.sourceProduct||provider==='guotai'&&!/^(?:guotai|\u56fd\u6cf0\u541b\u5b89(?:\u8bc1\u5238)?|\u56fd\u6cf0\u6d77\u901a(?:\u8bc1\u5238)?)$/.test(account.provider||''))throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_BROKERAGE_ACCOUNT_MISMATCH'),{code:'CLOUD_PERSONAL_FINANCE_BROKERAGE_ACCOUNT_MISMATCH'});
}
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
function validateSecuritiesHistory(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['schema','periodStart','periodEnd','importIds','basis','closedFunds'].includes(k))||v.schema!=='brokerage-history-coverage-v1'||!date(v.periodStart)||!date(v.periodEnd)||v.periodStart>v.periodEnd||v.basis!=='owner_confirmed_full_export'||!Array.isArray(v.importIds)||!v.importIds.length||v.importIds.length>32||new Set(v.importIds).size!==v.importIds.length||v.importIds.some(id=>typeof id!=='string'||!id||id.length>512))invalid();
 if(v.closedFunds!==undefined&&(!Array.isArray(v.closedFunds)||v.closedFunds.length>32||new Set(v.closedFunds.map(c=>c?.securityCode)).size!==v.closedFunds.length||v.closedFunds.some(c=>!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['securityCode','asOf','confirmedAt','basis'].includes(k))||!/^\d{6}$/.test(c.securityCode)||!date(c.asOf)||c.asOf<v.periodEnd||typeof c.confirmedAt!=='string'||!Number.isFinite(Date.parse(c.confirmedAt))||c.basis!=='owner_confirmed_fully_redeemed')))invalid();
 return v;
}
function sourceCoverage(account,imports,rows){
 if(!account?.securitiesHistory)return null;const c=validateSecuritiesHistory(account.securitiesHistory),matched=imports.filter(i=>c.importIds.includes(i.id)),byId=new Map(rows.map(o=>[o.id,o])),members=new Set();if(matched.length!==c.importIds.length)return null;
 for(const i of matched){if(i.financialAccountId!==account.id||i.templateId!=='brokerage-csv-v1'||i.provider!=='brokerage'||!/^[a-f0-9]{64}$/.test(i.fileHash)||!Array.isArray(i.observationIds)||new Set(i.observationIds).size!==i.observationIds.length||i.recordCount!==i.observationIds.length)return null;for(const id of i.observationIds){const o=byId.get(id);if(!o||o.brokerage.format!=='csv'||o.date<c.periodStart||o.date>c.periodEnd)return null;members.add(id);}}
 return rows.filter(o=>o.brokerage.format==='csv').every(o=>members.has(o.id))?c:null;
}
function validateBrokerage(value,record){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!FIELDS.includes(k))||FIELDS.filter(k=>k!=='disclosedComponents').some(k=>!Object.hasOwn(value,k))||value.schema!=='brokerage-trade-v1'||!ACTIVITIES.has(value.activity)||typeof value.operation!=='string'||!value.operation||value.operation.length>128||!/^\d{4}$/.test(value.accountTail)||!['pdf','csv'].includes(value.format)||!Number.isInteger(value.sequence)||value.sequence<1||value.sequence>10000)invalid();
 if(['units','displayPrice','grossMinor','reportedGrossMinor','cashDeltaMinor','feeMinor'].some(k=>typeof value[k]!=='string')||value.holdingUnits!==null&&typeof value.holdingUnits!=='string'||value.cashBalanceMinor!==null&&typeof value.cashBalanceMinor!=='string')invalid();
 if(value.securityCode!==null&&(typeof value.securityCode!=='string'||!/^\d{6}$/.test(value.securityCode))||value.securityName!==null&&(typeof value.securityName!=='string'||value.securityName.length>256)||!DECIMAL.test(value.units)||!DECIMAL.test(value.displayPrice)||value.holdingUnits!==null&&!DECIMAL.test(value.holdingUnits)||!UNSIGNED.test(value.grossMinor)||!SIGNED.test(value.reportedGrossMinor)||!SIGNED.test(value.cashDeltaMinor)||value.cashBalanceMinor!==null&&!SIGNED.test(value.cashBalanceMinor)||!UNSIGNED.test(value.feeMinor))invalid();
 if(value.sourcePage!==null&&(!Number.isInteger(value.sourcePage)||value.sourcePage<1||value.sourcePage>100)||value.periodStart!==null&&!date(value.periodStart)||value.periodEnd!==null&&!date(value.periodEnd)||value.periodStart>value.periodEnd)invalid();
 if(!value.fees||typeof value.fees!=='object'||Array.isArray(value.fees)||Object.keys(value.fees).length!==FEE_FIELDS.length||FEE_FIELDS.some(k=>value.fees[k]===null?k!=='netCommissionMinor':typeof value.fees[k]!=='string'||!UNSIGNED.test(value.fees[k])))invalid();
 if(value.disclosedComponents!==undefined&&(!value.disclosedComponents||typeof value.disclosedComponents!=='object'||Array.isArray(value.disclosedComponents)||Object.entries(value.disclosedComponents).some(([k,v])=>!k||k.length>128||typeof v!=='string'||!UNSIGNED.test(v))))invalid();
 const delta=BigInt(value.cashDeltaMinor),gross=BigInt(value.grossMinor),fee=BigInt(value.feeMinor),activity=value.activity;
 if(['buy','repo_open','fund_buy'].includes(activity)&&(-delta!==gross+fee||delta>=0n)||['sell','fund_redeem'].includes(activity)&&(delta!==gross-fee||delta<=0n)||activity==='repo_close'&&delta<gross||activity==='tax'&&-delta!==fee||['fund_reinvest','share_reduction'].includes(activity)&&(delta!==0n||gross!==0n||fee!==0n))invalid();
 if(record&&(record.balanceMinor!==null||record.amountMinor!==String(delta<0n?-delta:delta)||record.direction!==(delta<0n?'debit':delta>0n?'credit':'neutral')||record.feeMinor!==value.feeMinor||record.currency!=='CNY'||record.status!=='completed'||record.kind!==(['interest','dividend'].includes(activity)?'income':activity==='tax'?'fee':'transfer')||record.interestMinor!==(activity==='repo_close'?String(delta-gross):null)))invalid();
 return value;
}
const units=v=>{const [a,b='']=v.split('.');return BigInt(a)*1000000000000n+BigInt(b.padEnd(12,'0'));};
const displayUnits=v=>{const sign=v<0n?'-':'';if(v<0n)v=-v;const whole=v/1000000000000n,fraction=String(v%1000000000000n).padStart(12,'0').replace(/0+$/,'');return sign+String(whole)+(fraction?'.'+fraction:'');};
function buildSecuritiesRegister(observations,{accounts:accountData=[],imports=[]}={}){
 for(const a of accountData)if(a.investmentIncomePolicy){validateInvestmentIncomePolicy(a.investmentIncomePolicy);if(a.type!=='investment')throw new Error('CLOUD_PERSONAL_FINANCE_INVESTMENT_INCOME_POLICY_INVALID');}
 const latest=new Map();for(const o of observations){if(!o.brokerage||o.status!=='completed')continue;validateBrokerage(o.brokerage,o);const key=JSON.stringify([o.financialAccountId,o.sourceIdentity||o.id]);if(!latest.has(key)||(o.sourceVersionOrdinal||0)>(latest.get(key).sourceVersionOrdinal||0))latest.set(key,o);}
 const accounts=new Map();for(const o of latest.values()){if(!accounts.has(o.financialAccountId))accounts.set(o.financialAccountId,[]);accounts.get(o.financialAccountId).push(o);}
 return [...accounts].map(([financialAccountId,rows])=>{
  rows.sort((a,b)=>a.date.localeCompare(b.date)||(a.importId===b.importId?(a.brokerage.sequence-b.brokerage.sequence)*(a.brokerage.format==='csv'?-1:1):String(a.importId).localeCompare(String(b.importId))));
  const coverage=sourceCoverage(accountData.find(a=>a.id===financialAccountId),imports,rows);
  let cash=null,lastReportedCash=null,lastCashDate=null,lastStatementDate=null,fee=0n,interest=0n,dividend=0n,realized=0n,grossRealized=0n,openingKnown=false,csvStarted=false;const issues=[],positions=new Map(),realizations=[],dayCash=new Map();
  for(const o of rows){const b=o.brokerage,delta=BigInt(b.cashDeltaMinor),quantity=units(b.units),closing=b.holdingUnits===null?null:units(b.holdingUnits);fee+=BigInt(b.feeMinor);if(b.activity==='interest')interest+=delta;if(b.activity==='dividend')dividend+=delta;if(b.activity==='repo_close')interest+=BigInt(o.interestMinor);
   if(b.format==='csv'&&!csvStarted){csvStarted=true;openingKnown=Boolean(coverage&&cash!==null&&lastStatementDate&&Date.parse(lastStatementDate)+86400000>=Date.parse(coverage.periodStart)&&lastStatementDate<o.date&&[...positions.values()].every(p=>p.unitsKnown&&p.quantity===0n));}
   if(b.cashBalanceMinor!==null){const reported=BigInt(b.cashBalanceMinor);if(cash!==null&&cash+delta!==reported)issues.push({reason:'brokerage_cash_gap',observationId:o.id,expectedMinor:String(cash+delta),reportedMinor:String(reported)});cash=reported;lastReportedCash=reported;lastCashDate=o.date;const covered=b.periodEnd||o.date;if(lastStatementDate===null||covered>lastStatementDate)lastStatementDate=covered;}else if(cash!==null)cash+=delta;
   if(cash!==null)dayCash.set(o.date,cash);
   if(b.securityCode&&['fund_buy','fund_redeem','fund_reinvest'].includes(b.activity)){
    if(!positions.has(b.securityCode)){positions.set(b.securityCode,{code:b.securityCode,name:b.securityName,quantity:0n,unitsKnown:false,cost:null,grossCost:null,realized:0n,pendingAllocation:false,fundSubscriptions:0n,fundRedemptions:0n});issues.push({reason:'brokerage_fund_units_precision_unknown',observationId:o.id,securityCode:b.securityCode});}
    const p=positions.get(b.securityCode);p.unitsKnown=false;p.cost=null;p.grossCost=null;p.fundSubscriptions??=0n;p.fundRedemptions??=0n;p.quantity+=b.activity==='fund_redeem'?-quantity:quantity;if(b.activity==='fund_buy')p.fundSubscriptions-=delta;if(b.activity==='fund_redeem')p.fundRedemptions+=delta;continue;
   }
   if(!b.securityCode||!['buy','sell','corporate_action','allocation','allocation_payment','allocation_confirmation','share_listing','share_reduction'].includes(b.activity))continue;
   const security=brokerageSecurityIdentity(b,o.date),code=security.code;
   if(!positions.has(code)){let opening=0n;if(closing!==null){opening=['buy','corporate_action'].includes(b.activity)?closing-quantity:b.activity==='sell'?closing+quantity:0n;}const known=closing!==null&&opening===0n||openingKnown;positions.set(code,{code,name:security.name,quantity:opening,unitsKnown:closing!==null||openingKnown,cost:known?0n:null,grossCost:known?0n:null,realized:0n,pendingAllocation:false,aliases:[]});}
   const p=positions.get(code);p.aliases??=[];if(security.name&&security.name!=='\u65b0\u4ee3\u7801')p.name=security.name;if(security.subscriptionCode&&!p.aliases.some(a=>a.subscriptionCode===security.subscriptionCode))p.aliases.push({subscriptionCode:security.subscriptionCode,source:security.source});
   if(b.activity==='buy'){p.quantity+=quantity;if(p.cost!==null)p.cost-=delta;if(p.grossCost!==null)p.grossCost+=BigInt(b.grossMinor);}
   else if(b.activity==='sell'){
    if(p.quantity<quantity||p.cost===null){issues.push({reason:'brokerage_opening_position_unknown',observationId:o.id,securityCode:b.securityCode});p.cost=null;}
    else {const released=p.quantity===quantity?p.cost:(p.cost*quantity+p.quantity/2n)/p.quantity,releasedGross=p.quantity===quantity?p.grossCost:(p.grossCost*quantity+p.quantity/2n)/p.quantity;const gain=delta-released,grossGain=BigInt(b.grossMinor)-releasedGross;p.cost-=released;p.grossCost-=releasedGross;p.realized+=gain;realized+=gain;grossRealized+=grossGain;realizations.push({observationId:o.id,securityCode:code,netGainMinor:String(gain),priceGainBeforeFeesMinor:String(grossGain)});}
    p.quantity-=quantity;
   }else if(b.activity==='corporate_action')p.quantity+=quantity;
   else if(b.activity==='share_reduction'){p.quantity-=quantity;if(p.quantity<0n){issues.push({reason:'brokerage_position_gap',observationId:o.id,securityCode:b.securityCode});p.unitsKnown=false;p.cost=null;p.grossCost=null;}}
   else if(b.activity==='allocation'){p.quantity=closing??quantity;p.pendingAllocation=true;p.cost=null;p.grossCost=null;}
   else if(b.activity==='allocation_payment'){if(closing!==null)p.quantity=closing;else if(!p.quantity)p.quantity=quantity;p.cost=p.cost===null?-delta:p.cost-delta;p.grossCost=p.grossCost===null?BigInt(b.grossMinor):p.grossCost+BigInt(b.grossMinor);p.pendingAllocation=true;}
   else if(b.activity==='share_listing'){if(closing!==null)p.quantity=closing;else if(p.quantity===0n)p.quantity=quantity;p.pendingAllocation=false;}
   if(closing!==null&&p.quantity!==closing){issues.push({reason:'brokerage_position_gap',observationId:o.id,securityCode:b.securityCode,expectedUnits:displayUnits(p.quantity),reportedUnits:b.holdingUnits});p.quantity=closing;p.cost=null;p.grossCost=null;}
   if(p.quantity===0n&&p.unitsKnown){p.cost=0n;p.grossCost=0n;}
  }
  const closedFundCashRealizations=[];let undatedRealized=0n;
  for(const confirmation of coverage?.closedFunds||[]){
   const p=positions.get(confirmation.securityCode),fundRows=rows.filter(o=>o.brokerage.securityCode===confirmation.securityCode),lastCapital=fundRows.filter(o=>['fund_buy','fund_redeem'].includes(o.brokerage.activity)).at(-1);
   if(!openingKnown||!p||!fundRows.length||fundRows.some(o=>o.brokerage.format!=='csv'||!['fund_buy','fund_redeem','fund_reinvest','dividend'].includes(o.brokerage.activity))||fundRows[0].brokerage.activity!=='fund_buy'||lastCapital?.brokerage.activity!=='fund_redeem'||fundRows.at(-1).date>confirmation.asOf||!p.fundSubscriptions)continue;
   const recognition=historicalFundRecognition(accountData.find(a=>a.id===financialAccountId),fundRows);
   const gain=p.fundRedemptions-p.fundSubscriptions,fundFees=fundRows.reduce((n,o)=>n+BigInt(o.brokerage.feeMinor),0n);
   closedFundCashRealizations.push({securityCode:p.code,securityName:p.name,units:'0',unitsBasis:confirmation.basis,confirmedAsOf:confirmation.asOf,sourceDisplayedNetUnits:displayUnits(p.quantity),subscriptionCashMinor:String(p.fundSubscriptions),redemptionCashMinor:String(p.fundRedemptions),netGainMinor:String(gain),cashDividendMinor:String(fundRows.filter(o=>o.brokerage.activity==='dividend').reduce((n,o)=>n+BigInt(o.brokerage.cashDeltaMinor),0n)),gainDateBasis:recognition?'owner_policy_final_liquidation':'aggregate_only',...(recognition?{recognition,dailyAccrualKnown:false}:{}),sourceObservationIds:fundRows.map(o=>o.id),sourceLastTransactionDate:fundRows.at(-1).date});
   p.quantity=0n;p.unitsKnown=true;p.cost=0n;p.grossCost=0n;p.realized=gain;realized+=gain;grossRealized+=gain+fundFees;if(recognition)realizations.push({observationId:recognition.observationId,securityCode:p.code,netGainMinor:String(gain),priceGainBeforeFeesMinor:String(gain+fundFees),recognition});else undatedRealized+=gain;
   for(let i=issues.length-1;i>=0;i--)if(issues[i].reason==='brokerage_fund_units_precision_unknown'&&issues[i].securityCode===p.code)issues.splice(i,1);
   if(gain!==0n&&!recognition)issues.push({reason:'brokerage_closed_fund_gain_timing_unknown',observationId:fundRows.at(-1).id,securityCode:p.code,netGainMinor:String(gain),sourceDisplayedUnitsRemainUnchanged:true});
  }
  if(openingKnown)for(const [date,cash]of dayCash)if(cash<0n)issues.push({reason:'brokerage_negative_cash_day',date,cashMinor:String(cash)});
  const derived=openingKnown&&Boolean(coverage),complete=!issues.some(i=>['brokerage_cash_gap','brokerage_negative_cash_day'].includes(i.reason))&&(derived||rows.every(r=>r.brokerage.cashBalanceMinor!==null));
  return {
   financialAccountId,recordCount:rows.length,currency:'CNY',cashBalanceMinor:complete&&cash!==null?String(cash):null,
   projectedCashMinor:cash===null?null:String(cash),lastReportedCashMinor:lastReportedCash===null?null:String(lastReportedCash),
   cashLastTransactionDate:lastCashDate,cashLastStatementDate:lastStatementDate,cashBalanceAsOf:complete?(derived?coverage.periodEnd:lastStatementDate):null,
   cashBalanceSource:complete?(derived?'derived_complete_cash_history':'reported_statement_balances'):null,historyCoverage:coverage,
   cashBalanceComplete:complete,feeMinor:String(fee),interestMinor:String(interest),dividendMinor:String(dividend),
   realizedGainMinor:String(realized),realizedPriceGainBeforeFeesMinor:String(grossRealized),realizations,closedFundCashRealizations,undatedRealizedGainMinor:String(undatedRealized),
   realizedGainComplete:!issues.some(i=>i.reason!=='brokerage_cash_gap')&&[...positions.values()].every(p=>p.unitsKnown),
   marketValueMinor:null,portfolioValueMinor:null,securityIdentities:[...positions.values()].flatMap(p=>(p.aliases||[]).map(a=>({...a,securityCode:p.code,securityName:p.name}))),
   positions:[...positions.values()].filter(p=>p.quantity!==0n||!p.unitsKnown).map(p=>({securityCode:p.code,securityName:p.name,units:p.unitsKnown?displayUnits(p.quantity):null,netRecordedUnits:displayUnits(p.quantity),costMinor:p.cost===null?null:String(p.cost),realizedGainMinor:String(p.realized),pendingAllocation:p.pendingAllocation,...(p.fundSubscriptions!==undefined?{subscriptionCashMinor:String(p.fundSubscriptions),redemptionCashMinor:String(p.fundRedemptions),unitsPrecision:'source_display_only'}:{})})),issues
  };
 });
}
module.exports={validateBrokerage,validateBrokerageAccount,validateSecuritiesHistory,buildSecuritiesRegister};
