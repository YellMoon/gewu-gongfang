'use strict';
const invalid=()=>{throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_INVESTMENT_INCOME_POLICY_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_INVESTMENT_INCOME_POLICY_INVALID'});};
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
function validateInvestmentIncomePolicy(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['schema','historicalMethod','historicalTiming','dailyAcquisitionsFrom','confirmedAt'].includes(k))||v.schema!=='investment-income-policy-v1'||v.historicalMethod!=='closed_position_cash_difference'||v.historicalTiming!=='final_liquidation'||!date(v.dailyAcquisitionsFrom)||typeof v.confirmedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(v.confirmedAt)||!Number.isFinite(Date.parse(v.confirmedAt)))invalid();
 return v;
}
function historicalFundRecognition(account,fundRows){
 if(!account?.investmentIncomePolicy)return null;
 const p=validateInvestmentIncomePolicy(account.investmentIncomePolicy);
 if(account.type!=='investment')invalid();
 const purchases=fundRows.filter(o=>o.brokerage.activity==='fund_buy'),redemptions=fundRows.filter(o=>o.brokerage.activity==='fund_redeem');
 // Do not let a later acquisition of the same code inherit an old closure.
 // A fully closed fund is established independently by source coverage and
 // the owner's zero-position confirmation before this recognition choice.
 if(!purchases.length||purchases.some(o=>o.date>=p.dailyAcquisitionsFrom)||!redemptions.length)return null;
 const last=redemptions.at(-1);
 return{observationId:last.id,date:last.date,occurredAt:last.occurredAt,basis:'owner_selected_final_liquidation',periodStart:purchases[0].date,periodEnd:last.date,dailyAccrualKnown:false,dailyAcquisitionsFrom:p.dailyAcquisitionsFrom};
}
module.exports={validateInvestmentIncomePolicy,historicalFundRecognition};
