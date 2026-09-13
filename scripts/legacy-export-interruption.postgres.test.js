'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../shared/vnext-pg17/disposableRuntime');
module.exports=(async()=>{
 const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();
 try{await withQuery(handle,'fixture-provisioner',async db=>{
  await db.query('CREATE SCHEMA business; CREATE TABLE business.paper_export_tasks(task_id text PRIMARY KEY,tenant_id text,account_id text,status text,phase text,error_code text,updated_at timestamptz,request_hash text,question_snapshot_json jsonb,claim_token uuid,lease_expires_at timestamptz,result_artifact_id text)');
  const id='paper_task_0fc7a87e-58f8-4e63-9326-0feed210c433';
  await db.query("INSERT INTO business.paper_export_tasks(task_id,tenant_id,account_id,status,phase,updated_at,request_hash,question_snapshot_json) VALUES ($1,'tenant','account','processing','rendering','2026-09-12T21:24:43.107667Z',repeat('a',64),'[]')",[id]);
  const plan={taskId:id,tenantId:'tenant',accountId:'account',updatedAt:'2026-09-12T21:24:43.107667+00:00',bootEpoch:1789262242,requestHash:'a'.repeat(64),snapshotMd5:(await db.query('SELECT md5(question_snapshot_json::text) AS hash FROM business.paper_export_tasks')).rows[0].hash};
  const sql=execFileSync('python',['-c','import sys,json; sys.path.insert(0,"scripts"); from legacy_export_interruption import interruption_sql; print(interruption_sql(json.load(sys.stdin)))'],{cwd:path.join(__dirname,'..'),input:JSON.stringify(plan),encoding:'utf8',windowsHide:true});
  const original=(await db.query('SELECT * FROM business.paper_export_tasks')).rows[0];
  for(const change of ["status='completed'","phase='storage_pending'","claim_token='11111111-1111-4111-8111-111111111111'","lease_expires_at=now()","result_artifact_id='artifact_existing'","updated_at=now()","request_hash=repeat('b',64)","question_snapshot_json='[1]'","account_id='another'"]){
   await db.query('BEGIN');
   await db.query('UPDATE business.paper_export_tasks SET '+change);
   assert.equal((await db.query(sql)).rows.length,0,'reject changed or owned task: '+change);
   await db.query('ROLLBACK');
  }
  await db.query("INSERT INTO business.paper_export_tasks SELECT 'paper_task_unrelated',tenant_id,account_id,status,phase,error_code,updated_at,request_hash,question_snapshot_json,claim_token,lease_expires_at,result_artifact_id FROM business.paper_export_tasks");
  assert.equal((await db.query(sql)).rows.length,1);
  assert.equal((await db.query(sql)).rows.length,0,'retry cannot change a terminal record');
  const after=(await db.query('SELECT * FROM business.paper_export_tasks WHERE task_id=$1',[id])).rows[0];
  assert.equal(after.status,'failed');assert.equal(after.error_code,'CLOUD_PAPER_EXPORT_INTERRUPTED');
  for(const key of Object.keys(original).filter(k=>!['status','phase','error_code','updated_at'].includes(k)))assert.deepEqual(after[key],original[key]);
  assert.equal((await db.query("SELECT status FROM business.paper_export_tasks WHERE task_id='paper_task_unrelated'")).rows[0].status,'processing');
  console.log('legacy export exact-CAS, ownership, immutable snapshot and unrelated-task PostgreSQL checks passed');
 });}finally{await runtime.disposeHandle(handle);await runtime.stop();}
})();
