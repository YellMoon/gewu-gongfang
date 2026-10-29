'use strict';
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const only=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k));
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const months=v=>Array.isArray(v)&&v.length>0&&v.length<=12&&v.every((n,i)=>Number.isInteger(n)&&n>=1&&n<=12&&(i===0||v[i-1]<n));
const invalid=()=>{throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_INPUT_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_INPUT_INVALID'});};
function validateMortgageRepricingTerms(v){
 if(!only(v,['schema','basis','initialMonths','cycleChanges','spreadChanges','confirmedAt'])||v.schema!=='mortgage-repricing-terms-v1'||v.basis!=='owner_confirmed_natural_year'||!months(v.initialMonths)||!Array.isArray(v.cycleChanges)||!Array.isArray(v.spreadChanges)||v.cycleChanges.length>20||v.spreadChanges.length>20||typeof v.confirmedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(v.confirmedAt)||!Number.isFinite(Date.parse(v.confirmedAt)))invalid();
 for(const [i,c]of v.cycleChanges.entries())if(!only(c,['effectiveDate','months'])||!date(c.effectiveDate)||!months(c.months)||i>0&&v.cycleChanges[i-1].effectiveDate>=c.effectiveDate)invalid();
 for(const [i,c]of v.spreadChanges.entries())if(!only(c,['effectiveDate','spreadBasisPoints'])||!date(c.effectiveDate)||!Number.isInteger(c.spreadBasisPoints)||c.spreadBasisPoints< -1000||c.spreadBasisPoints>1000||i>0&&v.spreadChanges[i-1].effectiveDate>=c.effectiveDate)invalid();
 return v;
}
function findMortgageRepricingConflicts(m,epochs){
 if(!m.repricingTerms)return [];
 const terms=validateMortgageRepricingTerms(m.repricingTerms),conflicts=[];
 for(const e of epochs.slice(1)){
  const due=e.month+'-'+m.firstPaymentDate.slice(8),before=new Date(Date.UTC(Number(e.month.slice(0,4)),Number(e.month.slice(5))-2,Number(m.firstPaymentDate.slice(8)))).toISOString().slice(0,10);
  const cycle=terms.cycleChanges.filter(c=>c.effectiveDate<=due).at(-1),allowedMonths=cycle?.months||terms.initialMonths;
  const spreadEffectiveWithinPeriod=terms.spreadChanges.some(c=>c.effectiveDate>before&&c.effectiveDate<=due);
  if(!allowedMonths.includes(Number(e.month.slice(5)))&&!spreadEffectiveWithinPeriod)conflicts.push({month:e.month,reason:'inferred_repricing_outside_owner_confirmed_natural_year_months',allowedMonths:[...allowedMonths],cycleEffectiveDate:cycle?.effectiveDate||null});
 }
 return conflicts;
}
module.exports={validateMortgageRepricingTerms,findMortgageRepricingConflicts};
