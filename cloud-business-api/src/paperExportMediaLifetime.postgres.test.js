'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createQuestionAssetDeliveryRepository}=require('./questionAssetDeliveryRepository');
module.exports=(async()=>{
 const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();
 try{await withQuery(handle,'fixture-provisioner',async db=>{
  await db.query(`CREATE SCHEMA business;
   CREATE TABLE business.questions(id text,tenant_id text,deleted boolean);
   CREATE TABLE business.question_assets(id text,tenant_id text,question_id text,storage_object_id text,storage_object_version int,content_hash text,size_bytes bigint,file_name text,mime_type text,state text,deleted boolean,created_at timestamptz DEFAULT now());
   CREATE TABLE business.paper_export_tasks(task_id text,tenant_id text,account_id text,status text,question_snapshot_json jsonb,created_at timestamptz DEFAULT now());
   CREATE TABLE business.question_asset_deliveries(delivery_id text,asset_id text,tenant_id text,account_id text,object_id text,object_version int,expected_sha256 text,expected_bytes bigint,file_name text,mime_type text,status text,asset_bytes bytea,lease_token_sha256 text,created_at timestamptz DEFAULT now(),expires_at timestamptz);
   INSERT INTO business.questions VALUES('question-1','tenant-1',false);
   INSERT INTO business.question_assets VALUES('question_asset_test1234','tenant-1','question-1','obj_media',1,repeat('a',64),4,'image.png','image/png','verified',false,now());
   INSERT INTO business.paper_export_tasks VALUES('paper_task_test','tenant-1','teacher-1','processing',jsonb_build_array(jsonb_build_object('id','question-1','assets',jsonb_build_array(jsonb_build_object('assetKey',repeat('a',64))))),now()-interval '20 minutes');
   INSERT INTO business.question_asset_deliveries VALUES('question_asset_delivery_test1234','question_asset_test1234','tenant-1','teacher-1','obj_media',1,repeat('a',64),4,'image.png','image/png','ready',decode('12345678','hex'),'existing-lease',now()-interval '14 minutes',now()+interval '1 minute');`);
  const repository=createQuestionAssetDeliveryRepository({query:(sql,values)=>db.query(sql,values),randomId:()=>crypto.randomUUID()});
  const input={tenantId:'tenant-1',accountId:'teacher-1',taskId:'paper_task_test',questionId:'question-1',assetKey:'a'.repeat(64)};
  for(const status of ['ready','queued','leased']){
   await db.query("UPDATE business.question_asset_deliveries SET status=$1,expires_at=now()+interval '1 minute'",[status]);
   const row=await repository.requestForPaperExport(input);
   assert.equal(row.deliveryId,'question_asset_delivery_test1234');assert.equal(row.status,status);
   assert.ok(new Date(row.expiresAt).getTime()>Date.now()+14*60000,'active export renews its temporary media instead of re-uploading all images');
   const saved=(await db.query('SELECT * FROM business.question_asset_deliveries')).rows[0];
   assert.equal(saved.lease_token_sha256,'existing-lease');assert.equal(saved.asset_bytes.toString('hex'),'12345678');
  }
  for(const mutation of ["UPDATE business.paper_export_tasks SET status='completed'","UPDATE business.paper_export_tasks SET account_id='another'","UPDATE business.paper_export_tasks SET question_snapshot_json='[]'","UPDATE business.paper_export_tasks SET created_at=now()-interval '61 minutes'","UPDATE business.question_assets SET deleted=true"]){
   await db.query('BEGIN');await db.query(mutation);
   await assert.rejects(()=>repository.requestForPaperExport(input),e=>e.code==='QUESTION_ASSET_DELIVERY_NOT_FOUND','cached media must not bypass current task/snapshot/asset ownership');
   await db.query('ROLLBACK');
  }
  await db.query("UPDATE business.paper_export_tasks SET created_at=now()-interval '55 minutes'");
  await db.query("UPDATE business.question_asset_deliveries SET expires_at=now()+interval '1 minute'");
  const bounded=await repository.requestForPaperExport(input);
  assert.ok(new Date(bounded.expiresAt).getTime()<Date.now()+6*60000,'renewal is bounded to one hour after task creation');
  console.log('export media renewal, one-hour cap, lease preservation and cached-asset authorization PostgreSQL checks passed');
 });}finally{await runtime.disposeHandle(handle);await runtime.stop();}
})();
