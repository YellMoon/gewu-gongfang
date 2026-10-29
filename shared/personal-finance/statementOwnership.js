'use strict';
function validateStatementOwner(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['schema','fullName'].includes(k))||value.schema!=='bank-statement-owner-v1'||typeof value.fullName!=='string'||value.fullName.length<2||value.fullName.length>80||value.fullName!==value.fullName.normalize('NFKC').trim()||/[\x00-\x1f\x7f:*]/.test(value.fullName))throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_STATEMENT_OWNER_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_STATEMENT_OWNER_INVALID'});
 return value;
}
function statementOwners(imports,observations){
 const byId=new Map(observations.map(o=>[o.id,o])),owners=new Map(),conflicts=new Set();
 for(const item of imports){
  if(!item.statementOwner||!['ccb','huaxia','hangzhou','spdb'].includes(item.provider)||!/^[a-f0-9]{64}$/.test(item.fileHash||'')||!Array.isArray(item.observationIds))continue;
  let name;try{name=validateStatementOwner(item.statementOwner).fullName;}catch{continue;}
  for(const id of item.observationIds){const o=byId.get(id);if(!o||o.financialAccountId!==item.financialAccountId||o.provider!==item.provider||o.statementFlow?.schema!==item.provider+'-debit-v1')continue;if(owners.has(id)&&owners.get(id)!==name)conflicts.add(id);owners.set(id,name);}
 }
 for(const id of conflicts)owners.delete(id);return owners;
}
module.exports={validateStatementOwner,statementOwners};
