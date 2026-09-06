'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery}=require('../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../shared/vnext-pg17/businessFoundationCatalogAssertion');
const {applyPlan}=require('./repair-question-packed-options');
const {hash,contentHash,stableJson}=require('./repair-question-formula-identities');
(async()=>{
  const runtime=createDisposablePg17Runtime();await runtime.start();
  const handle=await runtime.createIsolatedHandle();
  const rows=['a','b'].map(letter=>{
    const row={id:'question-import-'+letter.repeat(40),status:'draft',version:1,stem:'unaltered',answer:null,explanation:null,
      options:[{label:'A',content:'1B.2C.3D.4'}],richContent:{sections:{stem:{type:'doc',content:[]},options:[{label:'A'}]}}};
    row.contentHash=contentHash(row,row.richContent);return row;
  });
  const entries=rows.map(row=>({id:row.id,baselineHash:hash(row),after:{options:[...'ABCD'].map((label,i)=>({label,content:String(i+1)})),
    richContent:{sections:{...row.richContent.sections,options:[...'ABCD'].map(label=>({label}))}}}}));
  try {
    const audit={appliedAt:'2026-09-06T00:00:00.000Z',appliedBy:'packed-option-repair-test'};
    await createVNextPg17CatalogBoundary(runtime).apply(handle,audit);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle,audit);
    await withVNextPg17SyntheticQuery(handle,'fixture-provisioner',async db=>{
      await db.query('CREATE ROLE gewu_cloud_schedule_reader');
      for(const file of ['20260823-cloud-question-authority.sql','20260823-cloud-question-command-receipts.sql'])
        await db.query(fs.readFileSync(path.join(__dirname,'../cloud-business-api/sql',file),'utf8').replace('BEGIN;','BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;'));
      await db.query('GRANT gewu_cloud_schedule_reader TO vnext_pg17_writer');
      await db.query('GRANT USAGE ON SCHEMA business TO gewu_cloud_schedule_reader');
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Fixture',false,now(),now())");
      for(const row of rows){
        await db.query("INSERT INTO business.questions(id,tenant_id,subject,question_type,difficulty) VALUES ($1,'tenant-1','physics','single_choice',3)",[row.id]);
        await db.query("INSERT INTO business.question_contents(question_id,tenant_id,stem,options_json,rich_content_json,content_hash) VALUES ($1,'tenant-1',$2,$3::jsonb,$4::jsonb,$5)",[row.id,row.stem,stableJson(row.options),stableJson(row.richContent),row.contentHash]);
      }
    });
    await withVNextPg17SyntheticQuery(handle,'writer',async db=>{
      await db.query('SET ROLE gewu_cloud_schedule_reader');
      assert.equal((await db.query("SELECT pg_has_role(current_user,'vnext_pg17_business_owner','MEMBER') AS owns")).rows[0].owns,false);
      const actor={tenantId:'tenant-1',accountId:'test-super-admin',roles:['super_admin']};
      await db.query('BEGIN');
      await db.query('UPDATE business.question_contents SET version=2 WHERE question_id=$1',[rows[1].id]);
      await assert.rejects(applyPlan((...args)=>db.query(...args),rows,entries,actor),/STATE_CHANGED/);
      await db.query('ROLLBACK');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM business.desktop_question_command_receipts')).rows[0].n,0);
      assert((await db.query('SELECT version,options_json FROM business.question_contents')).rows.every(r=>r.version===1&&r.options_json.length===1));
      await db.query('BEGIN');
      assert.equal((await applyPlan((...args)=>db.query(...args),rows,entries,actor)).length,2);
      await db.query('COMMIT');
      assert((await db.query('SELECT version,stem,options_json,rich_content_json FROM business.question_contents')).rows.every(r=>r.version===2&&r.stem==='unaltered'&&r.options_json.length===4&&r.rich_content_json.sections.options.length===4));
      assert.equal((await db.query('SELECT count(*)::int AS n FROM business.desktop_question_command_receipts')).rows[0].n,2);
    });
    console.log('packed-option PostgreSQL checks passed: limited role, conflict rollback, four options and receipts');
  } finally {await runtime.disposeHandle(handle).catch(()=>{});await runtime.stop().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
