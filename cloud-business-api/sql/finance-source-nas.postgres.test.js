'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createBillNasMetadataRepository}=require('../src/billNasMetadataRepository');
const {objectIdFor}=require('../../shared/financeSourceArchiveProtocol');
(async()=>{
 const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();
 try{await withVNextPg17SyntheticQuery(handle,'fixture-provisioner',async db=>{
  await db.query('CREATE SCHEMA IF NOT EXISTS business');await db.query('CREATE ROLE gewu_cloud_schedule_reader NOLOGIN');
  const sql=fs.readFileSync(path.join(__dirname,'20261027-finance-source-nas.sql'),'utf8');await db.query(sql);
  const id='a'.repeat(64)+'-'+'b'.repeat(64),descriptor={objectId:objectIdFor(id),version:1,sha256:'c'.repeat(64),bytes:100};
  const repo=createBillNasMetadataRepository({query:(s,v)=>db.query(s,v)});
  assert.equal(await repo.get(id),null);await repo.confirm(id,descriptor,'nas-test-agent');assert.deepEqual(await repo.get(id),descriptor);
  await repo.confirm(id,descriptor,'nas-test-agent');await assert.rejects(repo.confirm(id,{...descriptor,sha256:'d'.repeat(64)},'nas-test-agent'),/METADATA_INVALID/);
  const columns=(await db.query("SELECT data_type FROM information_schema.columns WHERE table_schema='business' AND table_name='personal_finance_source_objects'")).rows;assert.equal(columns.some(c=>['bytea','json','jsonb'].includes(c.data_type)),false,'the durable receipt cannot contain source bytes or a JSON payload');
  await db.query('GRANT USAGE ON SCHEMA business TO gewu_cloud_schedule_reader');await db.query('SET ROLE gewu_cloud_schedule_reader');
  assert.deepEqual(await repo.get(id),descriptor);
  await assert.rejects(db.query('DELETE FROM business.personal_finance_source_objects'),/permission denied/);
  await assert.rejects(db.query("UPDATE business.personal_finance_source_objects SET encrypted_sha256='tamper'"),/permission denied/);
  await db.query('RESET ROLE');
 });console.log('NAS finance metadata PostgreSQL constraints and least privilege passed');}
 finally{await runtime.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
