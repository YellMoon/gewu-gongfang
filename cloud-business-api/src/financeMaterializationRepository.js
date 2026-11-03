'use strict';
const crypto=require('node:crypto');
const denied=()=>Object.assign(Error('CLOUD_PERSONAL_FINANCE_ACCESS_DENIED'),{code:'CLOUD_PERSONAL_FINANCE_ACCESS_DENIED'});
function ownerScope(owner){
 if(!owner||typeof owner.tenantId!=='string'||!owner.tenantId||typeof owner.actor?.accountId!=='string'||!owner.actor.accountId||!owner.actor.roles?.some(r=>['teacher','super_admin'].includes(r)))throw denied();
 return[owner.tenantId,owner.actor.accountId];
}
function createFinanceMaterializationRepository({query,rulesVersion,day=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10)}={}){
 if(typeof query!=='function'||!/^[a-zA-Z0-9._:-]{1,128}$/.test(rulesVersion||''))throw Error('FINANCE_MATERIALIZATION_CONFIGURATION');
 const keys=(owner,revision)=>[...ownerScope(owner),String(revision),rulesVersion,day()];
 return{
  async read(owner,revision,{payload=false,summary=false}={}){
   const result=await query(`SELECT revision::text,rules_version,valuation_day::text,state,completed_at,error_code${payload?',payload':''}${summary?',summary':''} FROM business.personal_finance_materializations WHERE tenant_id=$1 AND account_id=$2 AND revision=$3 AND rules_version=$4 AND valuation_day=$5`,keys(owner,revision));return result.rows[0]||null;
  },
  async enqueue(owner,revision){
   const values=keys(owner,revision);
   if(String(revision)==='0')await query('INSERT INTO business.personal_finance_owners(tenant_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING',values.slice(0,2));
   await query(`INSERT INTO business.personal_finance_materializations(tenant_id,account_id,revision,rules_version,valuation_day) SELECT tenant_id,account_id,revision,$4,$5 FROM business.personal_finance_owners WHERE tenant_id=$1 AND account_id=$2 AND revision=$3 ON CONFLICT DO NOTHING`,values);
  },
  async retry(owner,revision){await query(`UPDATE business.personal_finance_materializations SET state='pending',attempts=0,error_code=NULL WHERE tenant_id=$1 AND account_id=$2 AND revision=$3 AND rules_version=$4 AND valuation_day=$5 AND state='failed'`,keys(owner,revision));},
  async enqueueDirty(){
   await query(`DELETE FROM business.personal_finance_materializations m WHERE m.state<>'building' AND m.created_at<clock_timestamp()-interval '2 days' AND (m.rules_version<>$1 OR m.valuation_day<>$2 OR EXISTS(SELECT 1 FROM business.personal_finance_owners o WHERE o.tenant_id=m.tenant_id AND o.account_id=m.account_id AND o.revision<>m.revision))`,[rulesVersion,day()]);
   await query(`INSERT INTO business.personal_finance_materializations(tenant_id,account_id,revision,rules_version,valuation_day) SELECT o.tenant_id,o.account_id,o.revision,$1,$2 FROM business.personal_finance_owners o WHERE NOT EXISTS(SELECT 1 FROM business.personal_finance_materializations m WHERE m.tenant_id=o.tenant_id AND m.account_id=o.account_id AND m.revision=o.revision AND m.rules_version=$1 AND m.valuation_day=$2) ORDER BY o.tenant_id,o.account_id LIMIT 16 ON CONFLICT DO NOTHING`,[rulesVersion,day()]);
  },
  async claim(){
   await query(`UPDATE business.personal_finance_materializations SET state='failed',error_code='FINANCE_MATERIALIZATION_FAILED',lease_token=NULL,lease_expires_at=NULL WHERE state='building' AND attempts>=3 AND lease_expires_at<clock_timestamp()`);
   const token=crypto.randomBytes(24).toString('hex');
   const result=await query(`UPDATE business.personal_finance_materializations m SET state='building',attempts=m.attempts+1,lease_token=$3,lease_expires_at=clock_timestamp()+interval '30 minutes',error_code=NULL WHERE (m.tenant_id,m.account_id,m.revision,m.rules_version,m.valuation_day)=(SELECT j.tenant_id,j.account_id,j.revision,j.rules_version,j.valuation_day FROM business.personal_finance_materializations j JOIN business.personal_finance_owners o USING(tenant_id,account_id) WHERE j.rules_version=$1 AND j.valuation_day=$2 AND j.revision=o.revision AND j.attempts<3 AND (j.state='pending' OR j.state='building' AND j.lease_expires_at<clock_timestamp()) ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED) RETURNING m.tenant_id,m.account_id,m.revision::text,m.rules_version,m.valuation_day::text,m.lease_token`,[rulesVersion,day(),token]);return result.rows[0]||null;
  },
  async complete(job,payload,summary){
   const result=await query(`UPDATE business.personal_finance_materializations m SET state='ready',payload=$7,summary=$8::jsonb,completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL WHERE m.tenant_id=$1 AND m.account_id=$2 AND m.revision=$3 AND m.rules_version=$4 AND m.valuation_day=$5 AND m.lease_token=$6 AND m.state='building' AND m.lease_expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM business.personal_finance_owners o WHERE o.tenant_id=m.tenant_id AND o.account_id=m.account_id AND o.revision=m.revision) RETURNING m.revision`,[job.tenant_id,job.account_id,job.revision,job.rules_version,job.valuation_day,job.lease_token,payload,JSON.stringify(summary)]);
   if(result.rows.length===1)await query(`DELETE FROM business.personal_finance_materializations WHERE tenant_id=$1 AND account_id=$2 AND state='ready' AND (revision,rules_version,valuation_day)<>($3::bigint,$4,$5::date)`,[job.tenant_id,job.account_id,job.revision,job.rules_version,job.valuation_day]);
   return result.rows.length===1;
  },
  async fail(job,code='FINANCE_MATERIALIZATION_FAILED'){
   await query(`UPDATE business.personal_finance_materializations SET state=CASE WHEN $7='FINANCE_MATERIALIZATION_OBSOLETE' THEN 'obsolete' WHEN attempts<3 THEN 'pending' ELSE 'failed' END,error_code=$7,lease_token=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND account_id=$2 AND revision=$3 AND rules_version=$4 AND valuation_day=$5 AND lease_token=$6 AND state='building'`,[job.tenant_id,job.account_id,job.revision,job.rules_version,job.valuation_day,job.lease_token,code]);
  },
 };
}
module.exports={createFinanceMaterializationRepository,ownerScope};
