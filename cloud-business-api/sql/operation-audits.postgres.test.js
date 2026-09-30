'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const {createOperationAuditRepository,parseFilters}=require('../src/operationAudit');
(async()=>{
 const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();
 const admin=work=>withQuery(handle,'fixture-provisioner',work),writer=(sql,args)=>withQuery(handle,'writer',db=>db.query(sql,args));
 try {
  const receipt={appliedAt:'2026-09-30T00:00:00.000Z',appliedBy:'operation-audit-test'};
  await createVNextPg17CatalogBoundary(runtime).apply(handle,receipt);await createBusinessFoundationCatalogBoundary(runtime).apply(handle,receipt);
  await admin(async db=>{const sql=fs.readFileSync(path.join(__dirname,'20260930-operation-audits.sql'),'utf8');await db.query(sql);await db.query(sql);});
  const repository=createOperationAuditRepository({query:writer});
  const actor={accountId:'actor-one',deviceId:'device-one',displayName:'测试教师',roles:['teacher']};
  const operation={action:'update',resourceType:'courses',resourceId:'course-one',summary:'修改课程',detail:{request:{active:false},changeCapture:'submitted-fields-only'}};
  const id=await repository.begin({tenantId:'tenant-one',actor,operation});
  const list=(who=actor,tenantId='tenant-one',filters={})=>repository.list({tenantId,actor:who,filters:parseFilters(filters)});
  assert.equal((await list()).items[0].status,'unknown','durable intent survives without an outcome');
  await repository.complete({id,status:'success',httpStatus:200,code:null,result:{id:'course-one',updatedAt:'2026-09-30T00:00:00.000Z'}});
  const otherId=await repository.begin({tenantId:'tenant-one',actor:{...actor,accountId:'actor-two'},operation:{...operation,action:'delete',summary:'courses.delete'}});
  await repository.complete({id:otherId,status:'conflict',httpStatus:409,code:'COURSE_CONFLICT',result:{}});
  await repository.begin({tenantId:'tenant-two',actor,operation});
  const own=await list();assert.equal(own.total,1);assert.equal(own.items[0].status,'success');assert.equal(own.items[0].actorId,'actor-one');assert.equal(own.items[0].actorName,'测试教师');assert.equal(own.items[0].deviceId,'device-one');assert.equal(own.items[0].detail.request.active,false);
  const superadmin={...actor,roles:['super_admin']};assert.equal((await list(superadmin)).total,2);assert.equal((await list(superadmin,'tenant-one',{status:'conflict'})).total,1);assert.equal((await list(superadmin,'tenant-one',{q:'actor-two'})).total,1);
  assert.equal((await list(superadmin,'tenant-one',{limit:'1',offset:'1'})).items[0].id,id);assert.equal((await list(superadmin,'tenant-one',{offset:'99'})).total,2);
  assert.equal((await list(superadmin,'tenant-one',{from:'2099-01-01T00:00:00Z'})).total,0);
  assert.equal((await list(superadmin,'tenant-one',{q:'修改课程'})).total,1,'Chinese summary search matches persisted labels');
  assert.equal((await list(superadmin,'tenant-two')).total,1);assert.equal((await list({...actor,accountId:'nobody'})).total,0);
  await assert.rejects(()=>list({...actor,roles:['student']}),error=>error.code==='CLOUD_BUSINESS_ACCESS_DENIED');
  await assert.rejects(()=>repository.complete({id,status:'error',httpStatus:500,result:{}}),error=>error.code==='23505');
  for(const sql of ['UPDATE business.operation_audit_intents SET actor_id=\'forged\'','DELETE FROM business.operation_audit_intents','UPDATE business.operation_audit_results SET status=\'error\'','DELETE FROM business.operation_audit_results','SELECT * FROM business.operation_audit_intents'])await assert.rejects(()=>writer(sql),error=>error.code==='42501');
  await assert.rejects(()=>writer("INSERT INTO business.operation_audit_results(id,status,http_status,result) VALUES($1,'error',500,'{}')",[id]),error=>error.code==='42501');
  const reconnected=createOperationAuditRepository({query:writer});assert.equal((await reconnected.list({tenantId:'tenant-one',actor,filters:parseFilters({})})).items[0].id,id,'new repository/connection reads persisted audit');
  console.log('PostgreSQL operation audit persistence, tenant/actor filters, pending outcomes and append-only writer boundary passed');
 } finally {await runtime.disposeHandle(handle).catch(()=>{});await runtime.stop().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
