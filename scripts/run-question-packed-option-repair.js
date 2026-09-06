'use strict';
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const {hash,stableJson}=require('./repair-question-formula-identities');
const {validateProposal,applyPlan}=require('./repair-question-packed-options');
const {postgresConfig,requireCloudHealth}=require('./repair-production-question-duplicates');
const EXPECTED_PLAN='2a8868cef1cdadfa2fb06cdc57e233dcdfa06c56203817a09264d2dd6f02046c';
const REVIEWED_PLANS={
  packed:{hash:EXPECTED_PLAN,count:168,kind:undefined},
  inline:{hash:'ecef0a0bcf3767df94f54f8c98d14f6edf7fea24f841333ac3c67759d4c9c4d9',count:4,kind:'restore-inline-first-option'},
};

async function loadRows(query,tenantId,ids){
  return (await query(`SELECT json_build_object(
    'id',q.id,'status',q.status,'version',c.version,'updatedAt',c.updated_at,'contentHash',c.content_hash,
    'richContent',c.rich_content_json,'questionSource',q.source,'subject',q.subject,'type',q.question_type,
    'difficulty',q.difficulty,'taxonomy',q.taxonomy_json,'hasFormula',q.has_formula,
    'stem',c.stem,'options',c.options_json,'answer',c.answer,'explanation',c.explanation,
    'itemId',i.item_id,'taskId',i.import_task_id,'itemHash',i.content_hash,'originalCandidate',i.candidate_json,
    'sourceHash',t.source_sha256,'sourceFile',t.source_file_name,'parserSha256',t.metadata_json->>'parserSha256'
    ) AS row
    FROM business.questions q JOIN business.question_contents c ON c.question_id=q.id AND c.tenant_id=q.tenant_id
    JOIN business.question_import_items i ON q.id='question-import-'||left(i.content_hash,40)
    JOIN business.question_import_tasks t ON t.task_id=i.import_task_id AND t.tenant_id=q.tenant_id
    WHERE q.tenant_id=$1 AND q.id=ANY($2::text[]) AND q.deleted=false AND c.deleted=false
    ORDER BY q.id FOR UPDATE OF q,c,i,t`,[tenantId,ids])).rows.map(record=>record.row);
}
async function run(env=process.env,mode='dry-run'){
  if(!['dry-run','apply'].includes(mode))throw new Error('OPTION_REPAIR_MODE_INVALID');
  const reviewed=REVIEWED_PLANS[env.GEWU_OPTION_REPAIR_KIND||'packed'];
  if(!reviewed)throw new Error('OPTION_REPAIR_PLAN_KIND_INVALID');
  const proposal=JSON.parse(fs.readFileSync(path.join(__dirname,'reviewed-proposals.json'),'utf8'));
  const entries=proposal.entries;
  if(proposal.mode!=='offline-proposal-only'||entries.length!==reviewed.count||hash(entries)!==reviewed.hash||proposal.planHash!==reviewed.hash
      ||entries.some(entry=>entry.kind!==reviewed.kind))
    throw new Error('OPTION_REPAIR_PLAN_CHANGED');
  const backup=mode==='apply'?JSON.parse(fs.readFileSync(path.join(__dirname,'verified-backup.json'),'utf8')):null;
  if(mode==='apply'&&(!backup?.restoreVerified||!/^[a-f0-9]{64}$/.test(backup.sha256)||!/^\/root\/scheduling-backups\/postgres\/\d{8}-\d{6}$/.test(backup.root)))
    throw new Error('OPTION_REPAIR_BACKUP_INVALID');
  const helper=require('./real-cloud-business-acceptance');
  const runtime=helper.resolveRuntimeModules(path.dirname(__dirname));
  const root=path.dirname(runtime.packagePath);
  const authorityHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src/questionAuthorityService.js'))).digest('hex');
  if(authorityHash!==env.EXPECTED_QUESTION_AUTHORITY_SHA256)throw new Error('OPTION_REPAIR_BUILD_CHANGED');
  const {Pool}=require(runtime.pgPath);
  const {resolveRuntimeDatabaseUser}=require(path.join(root,'src/runtimeDatabaseRole'));
  const pool=new Pool(postgresConfig(env,resolveRuntimeDatabaseUser(env.POSTGRES_USER),env.POSTGRES_PASSWORD));
  const writer=new Pool(postgresConfig(env,'vnext_pg17_writer',env.COMMAND_WRITER_POSTGRES_PASSWORD));
  let client;
  try{
    await requireCloudHealth(fetch,env.EXPECTED_CLOUD_VERSION,helper.PUBLIC_BASE_URL);
    const loaded=await helper.loadActiveSuperAdminSession(pool,writer,env.CLOUD_OPERATOR_PHONE_HMACS);
    await helper.verifyBusinessSuperAdmin(pool,loaded.identity);
    client=await pool.connect();const query=(...args)=>client.query(...args);
    await query('BEGIN');await query("SET LOCAL lock_timeout='5s'");await query("SET LOCAL statement_timeout='30s'");
    await query("SELECT pg_advisory_xact_lock(hashtextextended('gewu-packed-option-repair-v1',0))");
    const role=(await query("SELECT current_user AS name,pg_has_role(current_user,'vnext_pg17_business_owner','MEMBER') AS owns,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser")).rows[0];
    if(role.owns||role.superuser)throw new Error('OPTION_REPAIR_PRIVILEGE_INVALID');
    const tenantId=String(env.CLOUD_BUSINESS_TENANT_ID||'default').trim();
    const ids=entries.map(entry=>entry.id),before=await loadRows(query,tenantId,ids);
    if(before.length!==reviewed.count||new Set(before.map(row=>row.id)).size!==reviewed.count)throw new Error('OPTION_REPAIR_SCOPE_CHANGED');
    for(const entry of entries)validateProposal(before.find(row=>row.id===entry.id),entry);
    const receipts=mode==='apply'?await applyPlan(query,before,entries,{tenantId,accountId:loaded.identity.accountId,roles:['super_admin']}):[];
    const after=await loadRows(query,tenantId,ids);
    for(const old of before){
      const actual=after.find(row=>row.id===old.id);
      const expected=mode==='apply'?{...validateProposal(old,entries.find(entry=>entry.id===old.id)),version:old.version+1,updatedAt:actual?.updatedAt}:old;
      if(stableJson(actual)!==stableJson(expected))throw new Error('OPTION_REPAIR_AFTER_MISMATCH');
    }
    if(mode==='apply'){
      const saved=(await query(`SELECT command_id AS "commandId",result_json AS result,result_hash AS "resultHash",actor_account_id AS actor
        FROM business.desktop_question_command_receipts WHERE tenant_id=$1 AND command_id=ANY($2::text[])`,[tenantId,receipts.map(r=>r.commandId)])).rows;
      if(saved.length!==reviewed.count||saved.some(row=>row.actor!==loaded.identity.accountId||row.resultHash!==hash(row.result)||!receipts.some(receipt=>receipt.commandId===row.commandId&&receipt.resultHash===row.resultHash)))
        throw new Error('OPTION_REPAIR_RECEIPT_MISMATCH');
    }
    await query(mode==='apply'?'COMMIT':'ROLLBACK');
    return {ok:true,mode,planHash:reviewed.hash,questionCount:reviewed.count,receiptCount:receipts.length,unchangedFieldsVerified:true,runtimeRole:role.name,backup};
  }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client?.release();await Promise.allSettled([pool.end(),writer.end()]);}
}
module.exports={loadRows,run};
if(require.main===module)run(process.env,process.argv.includes('--apply')?'apply':'dry-run')
  .then(value=>console.log(JSON.stringify(value)))
  .catch(error=>{console.error(JSON.stringify({ok:false,code:error.code||error.message}));process.exitCode=1;});
