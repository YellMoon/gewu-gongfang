'use strict';
// UTF-8: actual outbox -> REST -> restricted PostgreSQL writer; authentication and OS encryption are test doubles.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const {createCloudBusinessApp}=require('../src/app');
const {createBusinessScheduleUpdate}=require('../src/businessScheduleMutationService');
const {createBusinessScheduleLifecycleMutations}=require('../src/businessScheduleLifecycleMutationService');
const {createDesktopAuthorityRuntime}=require('../../public/desktopAuthorityRuntime');
const sql=file=>fs.readFileSync(path.join(__dirname,file),'utf8');
const token='eyJ2IjoxfQ.signature',session={sessionToken:token};
const data={courseId:'course-1',startAt:'2026-09-08T01:00:00.000Z',endAt:'2026-09-08T02:30:00.000Z',recurringRule:null,status:1,roomDisplay:'Original room',serviceType:1,tuition:180,teacherFee:120,notes:'Original notes',pricings:[{studentId:'student-1',attendanceStatus:4,tuition:180,teacherFee:120}],billingUnit:2,teacherFeeMode:2,teacherId:'teacher-1',teacherName:'Original teacher'};
(async()=>{
 const pg=createDisposablePg17Runtime();await pg.start();const handle=await pg.createIsolatedHandle();
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'gewu-confirmed-undo-'));
 let server;
 try {
  const receipt={appliedAt:'2026-09-08T00:00:00.000Z',appliedBy:'confirmed-undo-test'};
  await createVNextPg17CatalogBoundary(pg).apply(handle,receipt);await createBusinessFoundationCatalogBoundary(pg).apply(handle,receipt);
  await withQuery(handle,'fixture-provisioner',async db=>{
   for(const file of ['20260824-schedule-lifecycle.sql','20260822-business-schedule-student-override.sql','20260901-business-schedule-update-lifecycle.sql','20260907-teacher-schedule-write-scope.sql','20260907-z-teacher-student-write-scope.sql','20260907-zz-schedule-financial-snapshot.sql'])await db.query(sql(file));
   const restore='20260908-schedule-confirmed-restore.sql';await db.query(sql(restore));await db.query(sql(restore));
   await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','One',false,now(),now()),('tenant-2','Two',false,now(),now())");
   await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher-1','tenant-1','One',false,now(),now()),('teacher-2','tenant-1','Two',false,now(),now())");
   await db.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student-1','tenant-1','One',false,false,now(),now()),('student-2','tenant-1','Other',false,false,now(),now())");
   await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) SELECT id,'tenant-1',id,id,1,1,180,120,2,2,teacher,true,false,now(),now() FROM (VALUES ('course-1','teacher-1'),('course-2','teacher-2')) AS x(id,teacher)");
   await db.query("INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES ('tenant-1','course-1','student-1',180,120),('tenant-1','course-2','student-2',180,120)");
  });
  const query=(text,values)=>withQuery(handle,'writer',db=>db.query(text,values));
  let context={roles:['teacher'],teacherId:'teacher-1'},account='account-1',miniappOnly=false;
  const app=createCloudBusinessApp({query:async()=>({rows:[]}),businessTenantId:'tenant-1',
   desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async()=>{if(miniappOnly)throw Error('not desktop');return context;}},
   miniappCloudAccount:{login:async()=>{},context:async()=>context},
   businessScheduleUpdate:createBusinessScheduleUpdate({query}),businessScheduleLifecycleMutations:createBusinessScheduleLifecycleMutations({query})});
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,requests=[];
  const request=async(method,body)=>{const response=await fetch(base+'/api/business/schedules/schedule-1',{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
  const vault={status:()=>({state:'unlocked',unlocked:true,user:{id:account},deviceId:'test-device',authorizationId:'test-auth',credentialVersion:1,offlineLease:{userId:account,deviceId:'test-device',authorizationId:'test-auth',credentialVersion:1,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()}})};
  const config={filePath:path.join(out,'outbox.bin'),safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s,'utf8'),decryptString:b=>b.toString('utf8')},vault,cloudBusinessBaseUrl:base,
   fetchImpl:async(url,options)=>{requests.push({url,method:options.method,body:JSON.parse(options.body)});return fetch(url,options);}};
  const runtime=createDesktopAuthorityRuntime(config);
  const {createAuthorityDraftFromLocalMutation:mutation}=await import('../../src/services/authorityDraftAdapter.mjs');
  const record={id:'schedule-1',course_id:data.courseId,start_time:data.startAt,end_time:data.endAt,recurring_rule:null,status:1,room:data.roomDisplay,service_type:1,calculated_tuition:180,calculated_teacher_fee:120,notes:data.notes,billing_unit:2,teacher_fee_mode:2,teacher_id:'teacher-1',teacher_name:data.teacherName,student_ids:['student-1'],student_pricings:[{student_id:'student-1',attendance_status:4,tuition:180,teacher_fee:120}]};
  const appendCreate=()=>runtime.appendDraftSync(mutation({collection:'schedules',action:'create',recordId:record.id,value:record}));
  const created=appendCreate();await runtime.confirmAndSubmit(created.id,session);
  assert.equal((await runtime.get(created.id)).status,'completed');assert.equal(requests.at(-1).method,'POST');
  const read=()=>withQuery(handle,'fixture-provisioner',async db=>({lesson:(await db.query("SELECT * FROM business.schedules WHERE id='schedule-1'")).rows[0],students:(await db.query("SELECT * FROM business.schedule_student_overrides WHERE schedule_id='schedule-1' ORDER BY student_id")).rows}));
  const original=await read(),version=original.lesson.updated_at.toISOString();
  const removed=runtime.appendDraftSync(mutation({collection:'schedules',action:'delete',recordId:record.id,value:record,baseVersion:version}));
  await runtime.confirmAndSubmit(removed.id,session);const deletion=await runtime.get(removed.id);
  assert.equal(deletion.status,'completed');const deletedVersion=deletion.receipt.result.updatedAt;
  const tombstone=await read();assert.equal(tombstone.lesson.legacy_deleted,true);
  // Same-account completed deletion is the only source of a restoration baseline.
  account='account-2';const other=createDesktopAuthorityRuntime({...config,filePath:config.filePath});
  const unrelated=other.appendDraftSync(mutation({collection:'schedules',action:'create',recordId:record.id,value:record}));
  assert.equal(unrelated.payload.restoreDeleted,undefined);other.appendDraftSync(mutation({collection:'schedules',action:'delete',recordId:record.id,value:record,baseVersion:version}));account='account-1';
  const foreignAuthority=createDesktopAuthorityRuntime({...config,cloudBusinessBaseUrl:base+'/other-cloud'});
  assert.equal(foreignAuthority.appendDraftSync(mutation({collection:'schedules',action:'create',recordId:record.id,value:record})).payload.restoreDeleted,undefined);
  foreignAuthority.appendDraftSync(mutation({collection:'schedules',action:'delete',recordId:record.id,value:record,baseVersion:version}));
  const restored=appendCreate();
  assert.equal(restored.payload.restoreDeleted,true,'confirmed deletion undo must be a versioned restoration, not a duplicate POST');
  assert.equal(restored.payload.expectedVersion,deletedVersion);
  assert.equal(restored.status,'awaiting_confirmation');assert.deepEqual(await read(),tombstone);
  const merged=runtime.appendDraftSync(mutation({collection:'schedules',action:'update',recordId:record.id,value:record,baseVersion:version}));
  assert.equal(merged.id,restored.id);assert.equal(merged.payload.expectedVersion,deletedVersion);assert.equal(merged.payload.restoreDeleted,true);
  // Redo before confirmation cancels restoration locally; it cannot delete the tombstone again.
  runtime.appendDraftSync(mutation({collection:'schedules',action:'delete',recordId:record.id,value:record,baseVersion:version}));
  assert.equal((await runtime.list()).filter(d=>d.status==='awaiting_confirmation').length,0);assert.deepEqual(await read(),tombstone);
  const body={expectedUpdatedAt:deletedVersion,...data,restoreDeleted:true};
  for(const invalid of ['true',1,false])assert.equal((await request('PUT',{...body,restoreDeleted:invalid})).status,400);
  const {pricings,...partial}=body;assert.equal((await request('PUT',partial)).status,400);
  for(const actor of [{roles:['student'],studentId:'student-1'},{roles:['teacher'],teacherId:'teacher-2'}]){context=actor;assert.equal((await request('PUT',body)).status,403);assert.deepEqual(await read(),tombstone);}context={roles:['teacher'],teacherId:'teacher-1'};
  miniappOnly=true;context={roles:['super_admin']};assert.equal((await request('PUT',body)).status,403);miniappOnly=false;context={roles:['teacher'],teacherId:'teacher-1'};
  assert.equal((await request('PUT',{...body,expectedUpdatedAt:version})).status,409);
  const {restoreDeleted,...ordinary}=body;assert.notEqual((await request('PUT',ordinary)).status,200,'ordinary updates must never restore tombstones');
  for(const changed of [{courseId:'course-2'},{pricings:[{studentId:'student-2',attendanceStatus:1,tuition:1,teacherFee:1}]},{teacherId:'missing-teacher'}]){assert.notEqual((await request('PUT',{...body,...changed})).status,200);assert.deepEqual(await read(),tombstone,'failed restoration must roll back record, roster and fees');}
  const confirmation=appendCreate();const count=requests.length;assert.deepEqual(await read(),tombstone);assert.equal(requests.length,count);
  await runtime.confirmAndSubmit(confirmation.id,session);
  assert.equal(requests.at(-1).method,'PUT');assert.equal(requests.at(-1).body.restoreDeleted,true);assert.equal(requests.at(-1).body.expectedUpdatedAt,deletedVersion);
  assert.equal((await runtime.get(confirmation.id)).status,'completed');
  const after=await read();const withoutVersion=x=>{const {updated_at,...rest}=x;return rest;};
  assert.deepEqual(withoutVersion(after.lesson),withoutVersion(original.lesson));assert.deepEqual(after.students,original.students);assert.notEqual(after.lesson.updated_at.toISOString(),deletedVersion);
  assert.equal((await request('PUT',body)).status,409,'replaying restoration cannot overwrite an already restored lesson');
  assert.deepEqual(await read(),after);
  // A previous completed deletion cannot be reused after a newer successful restoration.
  assert.equal(appendCreate().payload.restoreDeleted,undefined);
  runtime.appendDraftSync(mutation({collection:'schedules',action:'delete',recordId:record.id,value:record,baseVersion:version}));
  const again=await request('DELETE',{expectedUpdatedAt:after.lesson.updated_at.toISOString()});assert.equal(again.status,200);
  const concurrentBody={...body,expectedUpdatedAt:again.body.schedule.updatedAt};
  const concurrent=await Promise.all([request('PUT',concurrentBody),request('PUT',concurrentBody)]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409],'only one concurrent restoration can consume the deletion version');
  assert.deepEqual(withoutVersion((await read()).lesson),withoutVersion(original.lesson));
  const restoreSql='SELECT * FROM business.vnext_restore_scoped_schedule($1,$2,$3::timestamptz,$4,$5::timestamptz,$6::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb)';
  const crossTenant=['tenant-2','schedule-1',concurrentBody.expectedUpdatedAt,'course-1',data.startAt,data.endAt,null,1,data.roomDisplay,1,180,120,null,'[]','super_admin',null,null];
  assert.deepEqual((await query(restoreSql,crossTenant)).rows,[]);
  await withQuery(handle,'verifier',db=>assert.rejects(()=>db.query(restoreSql,crossTenant),e=>e.code==='42501'));
  await withQuery(handle,'writer',db=>assert.rejects(()=>db.query("UPDATE business.schedules SET legacy_deleted=false"),e=>e.code==='42501'));
  const compatibility=JSON.parse(fs.readFileSync(path.join(__dirname,'../../config/release-compatibility.json'),'utf8'));
  assert.deepEqual(compatibility.contracts.desktopScheduleRestoration.participants,['desktop','cloud_business']);
  console.log('confirmed deletion undo: actual outbox/REST/PostgreSQL restoration, explicit confirmation, original metadata and denial rollback passed');
 } finally {if(server)await new Promise(resolve=>server.close(resolve));await pg.disposeHandle(handle).catch(()=>{});await pg.stop().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
