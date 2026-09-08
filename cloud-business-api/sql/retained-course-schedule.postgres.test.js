'use strict';
// UTF-8: original handlers -> current draft mapper -> real scoped SQL, disposable database only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCloudBusinessApp}=require('../src/app');
const {createBusinessScheduleUpdate}=require('../src/businessScheduleMutationService');
const {createBusinessScheduleLifecycleMutations}=require('../src/businessScheduleLifecycleMutationService');
const {createDesktopAuthorityRuntime}=require('../../public/desktopAuthorityRuntime');
const {verify}=require('../../src/pages/ScheduleCalendar.retained-course.test');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const sql=file=>fs.readFileSync(path.join(__dirname,file),'utf8');
const createSql='SELECT * FROM business.vnext_create_scoped_schedule($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16::jsonb)';
const updateSql='SELECT * FROM business.vnext_update_scoped_schedule($1,$2,$3::timestamptz,$4,$5::timestamptz,$6::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb)';
const deleteSql='SELECT * FROM business.vnext_delete_scoped_schedule($1,$2,$3::timestamptz,$4,$5)';
const denied=e=>e.code==='42501';
const readTables=['courses','students','schedules','course_student_pricings','schedule_student_overrides'];
const read=handle=>withQuery(handle,'fixture-provisioner',async db=>{const result={};for(const table of readTables)result[table]=(await db.query(`SELECT to_jsonb(t) AS value FROM business.${table} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.value);return result;});
(async()=>{
 const cases=verify().filter(c=>c.action!=='attendance');
 const {createAuthorityDraftFromLocalMutation}=await import('../../src/services/authorityDraftAdapter.mjs');
 const {createDesktopCloudBusinessDraftAdapter}=await import('../../src/services/desktopCloudBusinessDraft.mjs');
 const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();let server;
 try{
  const receipt={appliedAt:'2026-09-09T00:00:00.000Z',appliedBy:'retained-course-schedule'};
  await createVNextPg17CatalogBoundary(runtime).apply(handle,receipt);await createBusinessFoundationCatalogBoundary(runtime).apply(handle,receipt);
  await withQuery(handle,'fixture-provisioner',async db=>{
   for(const file of ['20260824-schedule-lifecycle.sql','20260822-business-schedule-student-override.sql','20260901-business-schedule-update-lifecycle.sql','20260907-teacher-schedule-write-scope.sql','20260907-z-teacher-student-write-scope.sql','20260907-zz-schedule-financial-snapshot.sql','20260908-schedule-confirmed-restore.sql'])await db.query(sql(file));
   const file='20260909-retained-course-schedule-write.sql';await db.query(sql(file));await db.query(sql(file));
   await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Tenant',false,now(),now()),('tenant-2','Other',false,now(),now())");
   await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher-1','tenant-1','Original teacher',false,now(),now()),('teacher-2','tenant-1','Other teacher',false,now(),now())");
   await db.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student-1','tenant-1','Student',false,false,now(),now()),('student-2','tenant-1','Unrelated',false,false,now(),now())");
   await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) VALUES ('course-1','tenant-1','Original course','Original course',1,1,999,888,2,2,'teacher-1',true,true,now(),now())");
   await db.query("INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES ('tenant-1','course-1','student-1',999,888)");
  });
  const query=(text,values)=>withQuery(handle,'writer',db=>db.query(text,values));
  let context;
  const app=createCloudBusinessApp({query:async()=>({rows:[]}),businessTenantId:'tenant-1',
   desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async()=>context},
   businessScheduleUpdate:createBusinessScheduleUpdate({query}),businessScheduleLifecycleMutations:createBusinessScheduleLifecycleMutations({query})});
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const token='eyJ2IjoxfQ.signature',base=`http://127.0.0.1:${server.address().port}`,out=fs.mkdtempSync(path.join(os.tmpdir(),'gewu-retained-course-'));
  const vault={status:()=>({state:'unlocked',unlocked:true,user:{id:'test-account'},deviceId:'test-device',authorizationId:'test-auth',credentialVersion:1,
   offlineLease:{userId:'test-account',deviceId:'test-device',authorizationId:'test-auth',credentialVersion:1,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()}})};
  const requests=[];
  const outbox=createDesktopAuthorityRuntime({filePath:path.join(out,'outbox.bin'),vault,cloudBusinessBaseUrl:base,
   safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s,'utf8'),decryptString:b=>b.toString('utf8')},
   fetchImpl:async(url,options)=>{requests.push({url,method:options.method});return fetch(url,options);}});
  let count=0,restorations=0,lockArgs;
  for(const relationship of ['enrolment','lesson'])for(const role of ['teacher','super_admin'])for(const item of cases){
   const id='lesson-'+count,copyId='copy-'+count,version='2026-09-01T00:00:00.000Z',teacher=role==='teacher'?'teacher-1':null;
   const record={...(item.result||item.schedule),id:item.action==='copy'?copyId:id,updated_at:version};
   await withQuery(handle,'fixture-provisioner',async db=>{
    if(relationship==='lesson')await db.query("DELETE FROM business.course_student_pricings WHERE course_id='course-1'");
    await db.query("INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,status,room_display_snapshot,service_type,calculated_tuition,calculated_teacher_fee,billing_unit,teacher_fee_mode,teacher_id,teacher_name,legacy_deleted,created_at,updated_at) VALUES ($1,'tenant-1','course-1','2026-09-14T01:00:00Z','2026-09-14T02:30:00Z',1,'Original room',1,270,180,$2,$3,'teacher-1','Original teacher',false,'2026-09-01T00:00:00Z',$4)",[id,item.schedule.billing_unit,item.schedule.teacher_fee_mode,version]);
    await db.query("INSERT INTO business.schedule_student_overrides(tenant_id,schedule_id,student_id,attendance_status,tuition,teacher_fee) VALUES ('tenant-1',$1,'student-1',$2,180,120)",[id,item.schedule.student_pricings[0].status]);
   });
   const before=await read(handle);
   let request;
   const adapter=createDesktopCloudBusinessDraftAdapter({baseUrl:'https://test.invalid',sha256:s=>s,cloudClient:{
    createCloudSchedule:async input=>{request=input;return {id:record.id};},updateCloudSchedule:async input=>{request=input;return {id:record.id};},deleteCloudSchedule:async input=>{request=input;return {id:record.id};}}});
   const draft=createAuthorityDraftFromLocalMutation({collection:'schedules',action:item.action==='copy'?'create':item.action==='delete'?'delete':'update',recordId:record.id,baseVersion:version,value:record});
   await adapter.submit(adapter.createCommand({...draft,id:'draft-'+count}),{sessionToken:'isolated-test'});
   const pricing=JSON.stringify((request.pricings||[]).map(p=>({student_id:p.studentId,attendance_status:p.attendanceStatus,tuition:p.tuition,teacher_fee:p.teacherFee})));
   const fields=[request.courseId,request.startAt,request.endAt,request.recurringRule??null,request.status,request.roomDisplay,request.serviceType,request.tuition,request.teacherFee,request.notes??null,pricing,role,teacher,JSON.stringify({billingUnit:request.billingUnit,teacherFeeMode:request.teacherFeeMode,teacherId:request.teacherId,teacherName:request.teacherName})];
   const query=item.action==='delete'?deleteSql:item.action==='copy'?createSql:updateSql;
   const args=item.action==='delete'?['tenant-1',id,request.expectedUpdatedAt,role,teacher]:item.action==='copy'?['tenant-1',copyId,...fields]:['tenant-1',id,request.expectedUpdatedAt,...fields];
   await withQuery(handle,'writer',async db=>{
    const roleIndex=args.length-(item.action==='delete'?2:3),teacherIndex=roleIndex+1;
    for(const [badRole,badTeacher] of [['teacher','teacher-2'],['student','teacher-1'],['visitor',null],['family_member',null]]){const bad=[...args];bad[roleIndex]=badRole;bad[teacherIndex]=badTeacher;await assert.rejects(()=>db.query(query,bad),denied);}
    const foreign=[...args];foreign[0]='tenant-2';foreign[roleIndex]='teacher';foreign[teacherIndex]='teacher-1';await assert.rejects(()=>db.query(query,foreign),denied);
    if(item.action!=='delete'&&role==='teacher'){
     const unrelated=[...args];unrelated[roleIndex-1]=JSON.stringify([{student_id:'student-2',attendance_status:1,tuition:180,teacher_fee:120}]);await assert.rejects(()=>db.query(query,unrelated),denied);
     const missing=[...args];missing[item.action==='copy'?2:3]='missing-course';await assert.rejects(()=>db.query(query,missing),denied);
    }
    if(item.action!=='copy'){const stale=[...args];stale[2]='2000-01-01T00:00:00Z';assert.equal((await db.query(query,stale)).rows.length,0);}
    assert.deepEqual(await read(handle),before,'rejected mutations must not change any field');
    await assert.rejects(()=>db.query("UPDATE business.schedules SET notes='bypass'"),denied);
   });
   context=role==='teacher'?{roles:[role],teacherId:'teacher-1'}:{roles:[role]};
   const queued=outbox.appendDraftSync(draft),requestCount=requests.length;
   assert.equal(queued.status,'awaiting_confirmation');assert.deepEqual(await read(handle),before);assert.equal(requests.length,requestCount);
   await outbox.confirmAndSubmit(queued.id,{sessionToken:token});
   const submitted=await outbox.get(queued.id);assert.equal(submitted.status,'completed',JSON.stringify(submitted.submitError));
   assert.equal(requests.length,requestCount+1);assert(requests.at(-1).url.startsWith(base+'/api/business/schedules'));
   assert.equal(requests.at(-1).method,item.action==='copy'?'POST':item.action==='delete'?'DELETE':'PUT');
   const after=await read(handle),row=after.schedules.find(s=>s.id===record.id);
   assert.deepEqual(after.courses,before.courses);assert.deepEqual(after.students,before.students);assert.deepEqual(after.course_student_pricings,before.course_student_pricings);
   assert.deepEqual(after.schedules.filter(s=>s.id!==record.id),before.schedules.filter(s=>s.id!==record.id));
   assert.deepEqual(after.schedule_student_overrides.filter(s=>s.schedule_id!==record.id),before.schedule_student_overrides.filter(s=>s.schedule_id!==record.id));
   if(item.action==='delete'){
    const expected=structuredClone(before.schedules.find(s=>s.id===id));expected.legacy_deleted=true;expected.updated_at=row.updated_at;assert.deepEqual(row,expected);assert.deepEqual(after.schedule_student_overrides,before.schedule_student_overrides);
    const original=before.schedules.find(s=>s.id===id);
    const restoredRecord={...item.schedule,id,start_time:new Date(original.start_at).toISOString(),end_time:new Date(original.end_at).toISOString()};
    const undo=outbox.appendDraftSync(createAuthorityDraftFromLocalMutation({collection:'schedules',action:'create',recordId:id,value:restoredRecord}));
    assert.equal(undo.payload.restoreDeleted,true);assert.equal(undo.status,'awaiting_confirmation');assert.deepEqual(await read(handle),after);
    await outbox.confirmAndSubmit(undo.id,{sessionToken:token});assert.equal((await outbox.get(undo.id)).status,'completed');
    const restored=await read(handle),restoredRow=restored.schedules.find(s=>s.id===id),expectedOriginal={...original,updated_at:restoredRow.updated_at};
    assert.deepEqual(restoredRow,expectedOriginal);assert.deepEqual(restored.schedule_student_overrides,before.schedule_student_overrides);assert.deepEqual(restored.courses,before.courses);restorations++;
   }else{
    assert.equal(new Date(row.start_at).toISOString(),record.start_time);assert.equal(new Date(row.end_at).toISOString(),record.end_time);
    assert.equal(Number(row.calculated_tuition),record.calculated_tuition);assert.equal(Number(row.calculated_teacher_fee),record.calculated_teacher_fee);
    assert.equal(row.billing_unit,record.billing_unit);assert.equal(row.teacher_fee_mode,record.teacher_fee_mode);assert.equal(row.teacher_name,'Original teacher');assert.equal(row.room_display_snapshot,'Original room');
    const roster=after.schedule_student_overrides.filter(s=>s.schedule_id===record.id);assert.equal(roster.length,1);assert.equal(roster[0].attendance_status,item.schedule.student_pricings[0].status);assert.equal(Number(roster[0].tuition),180);assert.equal(Number(roster[0].teacher_fee),120);
    if(item.action!=='copy')assert.equal(row.created_at,before.schedules.find(s=>s.id===id).created_at);
    if(relationship==='lesson'&&role==='teacher'&&item.action==='move')lockArgs=[...args.slice(0,2),new Date(row.updated_at).toISOString(),...args.slice(3)];
   }
   await withQuery(handle,'verifier',db=>assert.rejects(()=>db.query(query,args),denied));
   count++;
  }
  // Hold real locks while another connection attempts to revoke ownership/profile/roster.
  const beforeLocks=await read(handle);
  await withQuery(handle,'writer',async writer=>withQuery(handle,'fixture-provisioner',async admin=>{
   await writer.query('BEGIN');
   try{
    assert.equal((await writer.query(updateSql,lockArgs)).rows.length,1);await admin.query("SET lock_timeout='150ms'");
    for(const statement of ["UPDATE business.courses SET teacher_id='teacher-2' WHERE id='course-1'","UPDATE business.teachers SET legacy_deleted=true WHERE id='teacher-1'","UPDATE business.students SET legacy_deleted=true WHERE id='student-1'","DELETE FROM business.schedule_student_overrides WHERE student_id='student-1'"])
     await assert.rejects(()=>admin.query(statement),e=>e.code==='55P03');
   }finally{await writer.query('ROLLBACK');await admin.query('RESET lock_timeout');}
  }));
  assert.deepEqual(await read(handle),beforeLocks);
  console.log('retained-course original handlers/outbox/REST/scoped PostgreSQL passed: '+count+' teacher/admin mutations, '+restorations+' confirmed restorations, both roster paths and concurrent locks');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await runtime.disposeHandle(handle).catch(()=>{});await runtime.stop().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
