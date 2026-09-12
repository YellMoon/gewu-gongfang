'use strict';
// UTF-8: original teacher deletion removes a teaching record, not its business history.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const {createCloudBusinessApp}=require('../src/app');
function originalDelete(){
 const ts=require('typescript');const source=require('node:child_process').execFileSync('git',['show','8118419f:src/services/browserDatabase.ts'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8',maxBuffer:8*1024*1024});
 const ast=ts.createSourceFile('original.ts',source,ts.ScriptTarget.Latest,true);let method;
 const visit=n=>{if(ts.isMethodDeclaration(n)&&n.name?.getText(ast)==='deleteTeacher')method=n;ts.forEachChild(n,visit);};visit(ast);assert(method);
 return require('node:vm').runInNewContext(ts.transpileModule('('+method.getText(ast).replace('deleteTeacher','function')+')',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText);
}
(async()=>{
 const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();let server;
 const admin=fn=>withQuery(handle,'fixture-provisioner',fn),writer=(sql,values)=>withQuery(handle,'writer',db=>db.query(sql,values));
 try{
  const receipt={appliedAt:'2026-09-13T00:00:00.000Z',appliedBy:'retained-teacher-test'};
  await createVNextPg17CatalogBoundary(runtime).apply(handle,receipt);await createBusinessFoundationCatalogBoundary(runtime).apply(handle,receipt);
  await admin(async db=>{
   for(const file of ['20260823-zzz-teacher-lifecycle.sql','20260823-zzzz-room-lifecycle.sql','20260823-zzzzz-course-lifecycle.sql','20260827-course-lifecycle-qualified.sql','20260824-schedule-lifecycle.sql','20260822-business-schedule-student-override.sql','20260901-business-schedule-update-lifecycle.sql','20260907-teacher-course-write-scope.sql','20260907-teacher-schedule-write-scope.sql','20260907-z-teacher-student-write-scope.sql','20260907-zz-schedule-financial-snapshot.sql','20260908-course-address-confirmation.sql','20260908-schedule-confirmed-restore.sql','20260909-retained-course-schedule-write.sql','20260909-retained-student-schedule-write.sql','20260909-course-active-original-behavior.sql','20260909-course-delete-original-behavior.sql'])await db.query(fs.readFileSync(path.join(__dirname,file),'utf8'));
   await require('./managedTeacherProfileFixture').applyManagedTeacherProfileFixture(db);
   const migration=fs.readFileSync(path.join(__dirname,'20260913-retained-teacher-profile.sql'),'utf8');await db.query(migration);await db.query(migration);
   await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('one','One',false,now(),now()),('two','Two',false,now(),now())");
   await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('owner','one','Owner',false,now(),now()),('other','one','Other',false,now(),now()),('foreign','two','Foreign',false,now(),now())");
   await db.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('enrolled','one','Enrolled',false,false,now(),now())");
   await db.query("INSERT INTO business.rooms(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('room','one','Room',false,now(),now())");
   await db.query('CREATE ROLE gewu_cloud_schedule_reader NOLOGIN; GRANT USAGE ON SCHEMA business TO gewu_cloud_schedule_reader; GRANT SELECT ON business.teachers,business.students,business.courses,business.schedules,business.course_student_pricings,business.schedule_student_overrides TO gewu_cloud_schedule_reader');
  });
  let context={roles:['teacher'],profile:{type:'teacher',id:'owner'}},requests=0,source;
  const app=createCloudBusinessApp({businessTenantId:'one',query:async sql=>{source=sql;return {rows:[]};},desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async()=>context},
   businessTeacherLifecycleMutations:require('../src/businessTeacherLifecycleMutationService').createBusinessTeacherLifecycleMutations({query:writer}),
   businessCourseLifecycleMutations:require('../src/businessCourseLifecycleMutationService').createBusinessCourseLifecycleMutations({query:writer}),
   businessScheduleLifecycleMutations:require('../src/businessScheduleLifecycleMutationService').createBusinessScheduleLifecycleMutations({query:writer}),
   businessScheduleUpdate:require('../src/businessScheduleMutationService').createBusinessScheduleUpdate({query:writer})});
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const {createDesktopIdentityClient}=await import('../../src/services/desktopIdentityClient.mjs');
  const client=createDesktopIdentityClient({desktopIdentity:{status:async()=>({})},fetchImpl:(...args)=>{requests++;return fetch(...args);}});
  const session={baseUrl:`http://127.0.0.1:${server.address().port}`,currentSession:{token:'desktop.test'}},headers={authorization:'Bearer desktop.test'};
  await fetch(session.baseUrl+'/api/business/schedules',{headers});const listSql=source;
  await fetch(session.baseUrl+'/api/business/desktop-projection',{headers});
  const start=source.indexOf('WITH managed_teachers AS ('),end=source.indexOf('SELECT jsonb_build_object(',start);assert(start>=0&&end>start);
  const field=key=>{const a=source.indexOf(`'${key}',`,end),b=source.indexOf(", '",a+key.length+3);assert(a>end&&b>a);return source.slice(a,b);};
  const projectionSql=source.slice(start,end)+'SELECT jsonb_build_object('+['students','teachers','courses','schedules'].map(field).join(', ')+') AS projection';
  const read=actor=>admin(async db=>{await db.query('BEGIN; SET LOCAL ROLE gewu_cloud_schedule_reader');try{
   const projection=(await db.query(projectionSql,['one','teacher',actor])).rows[0].projection;
   assert.deepEqual((await db.query(listSql,['one','teacher',actor])).rows.map(r=>r.id),projection.schedules.map(r=>r.id));return projection;
  }finally{await db.query('ROLLBACK');}});
  const teacherInput={...session,teacherId:'managed',name:'Teaching only',phone:null,subject:'Physics',hourlyRate:120,notes:null};
  const teacher=await client.createCloudTeacher(teacherInput);
  const courseInput={...session,courseId:'course',name:'Physics',year:2026,semester:'autumn',displayName:'Physics',type:1,sourceType:1,institutionId:null,priceTuition:180,priceTeacher:120,billingUnit:1,teacherFeeMode:1,roomId:'room',roomName:'Room',teacherId:'managed',teacherName:'Teaching only',active:true,defaultDurationMinutes:90,notes:null,pricings:[{studentId:'enrolled',tuition:180,teacherFee:120}]};
  // Original administrator-created enrolment: no creator shortcut in student access.
  context={roles:['super_admin']};let course=await client.createCloudCourse(courseInput),transfer=await client.createCloudCourse({...courseInput,courseId:'transfer'});context={roles:['teacher'],profile:{type:'teacher',id:'owner'}};
  const lessonInput={...session,scheduleId:'lesson',courseId:course.id,startAt:'2026-09-13T01:00:00.000Z',endAt:'2026-09-13T02:30:00.000Z',recurringRule:null,status:1,roomDisplay:'Room',serviceType:1,tuition:270,teacherFee:180,notes:null,pricings:[{studentId:'enrolled',attendanceStatus:1,tuition:180,teacherFee:120}],billingUnit:1,teacherFeeMode:1,teacherId:'managed',teacherName:'Teaching only'};
  let lesson=await client.createCloudSchedule(lessonInput);
  const snapshot=()=>admin(async db=>{const result={};for(const table of ['students','courses','schedules','course_student_pricings','schedule_student_overrides'])result[table]=(await db.query(`SELECT * FROM business.${table} ORDER BY 1,2`)).rows;return result;});
  const before=await snapshot(),original={data:{...structuredClone(before),teachers:[{id:'managed',name:'Teaching only'}]},saveData(){},recordSyncChange(){}};
  originalDelete().call(original,'managed');assert.equal(original.data.teachers.length,0);delete original.data.teachers;assert.deepEqual(original.data,before);
  const {createDesktopCommandOutbox}=await import('../../src/services/desktopCommandOutbox.mjs');
  const {createDesktopCloudBusinessDraftAdapter}=await import('../../src/services/desktopCloudBusinessDraft.mjs');
  const {createDesktopAuthorityClient}=await import('../../src/services/desktopAuthorityClient.mjs');let storage='';
  const outbox=createDesktopCommandOutbox({store:{read:async()=>storage,write:async v=>{storage=v;}},codec:{seal:async v=>JSON.stringify(v),open:async v=>JSON.parse(v)},createId:()=> 'teacher-delete',now:()=> '2026-09-13T00:00:00.000Z'});
  const adapter=createDesktopCloudBusinessDraftAdapter({cloudClient:client,baseUrl:session.baseUrl,sha256:v=>require('node:crypto').createHash('sha256').update(v).digest('hex')});
  const authority=createDesktopAuthorityClient({outbox,createCloudBusinessCommand:adapter.createCommand,submitCloudBusiness:adapter.submit});
  const draft=await authority.appendDraft({type:'teacher.delete.v1',payload:{id:'managed',expectedVersion:teacher.updatedAt}}),auth={sessionToken:'eyJ2IjoxfQ.signature'},requestCount=requests;
  assert.equal(await authority.submit(draft.id,auth),undefined);assert.equal(requests,requestCount);assert.deepEqual(await snapshot(),before);
  await assert.rejects(()=>client.deleteCloudTeacher({...session,teacherId:'managed',expectedUpdatedAt:'2000-01-01T00:00:00.000Z'}),e=>e.code==='CLOUD_BUSINESS_TEACHER_CONFLICT');
  await assert.rejects(()=>client.deleteCloudTeacher({...session,teacherId:'owner',expectedUpdatedAt:teacher.updatedAt}),e=>e.code==='CLOUD_BUSINESS_ACCESS_DENIED');
  const result=await authority.confirmAndSubmit(draft.id,auth);assert.equal(result.transportUsed,'cloud-business-authority');assert.equal((await outbox.get(draft.id)).status,'completed');assert(!storage.includes(auth.sessionToken));
  assert.deepEqual(await snapshot(),before);
  const projection=await read('owner');assert.deepEqual(projection.teachers.map(r=>r.id),['owner']);assert.deepEqual(projection.courses.map(r=>r.id),['course','transfer']);assert.deepEqual(projection.students.map(r=>r.id),['enrolled']);assert.equal(projection.schedules[0].calculated_tuition,270);assert.equal(projection.schedules[0].calculated_teacher_fee,180);
  for(const actor of ['other','foreign']){const p=await read(actor);assert.deepEqual(p.courses,[]);assert.deepEqual(p.schedules,[]);}
  const denied=e=>e.code==='CLOUD_BUSINESS_ACCESS_DENIED';
  await assert.rejects(()=>client.createCloudCourse({...courseInput,courseId:'must-not-create'}),denied);
  await assert.rejects(()=>client.updateCloudTeacher({...teacherInput,expectedUpdatedAt:teacher.updatedAt}),denied);
  course=await client.updateCloudCourse({...courseInput,expectedUpdatedAt:course.updatedAt,notes:'Existing course edit'});
  course=await client.updateCloudCourse({...session,courseId:course.id,expectedUpdatedAt:course.updatedAt,active:false});
  course=await client.updateCloudCourse({...session,courseId:course.id,expectedUpdatedAt:course.updatedAt,active:true});
  lesson=await client.updateCloudSchedule({...lessonInput,expectedUpdatedAt:lesson.updatedAt,notes:'Existing lesson edit'});
  const deleted=await client.deleteCloudSchedule({...session,scheduleId:'lesson',expectedUpdatedAt:lesson.updatedAt});
  lesson=await client.updateCloudSchedule({...lessonInput,expectedUpdatedAt:deleted.updatedAt,restoreDeleted:true});
  // An existing course can move away from a deleted teaching profile, but never into one.
  context={roles:['super_admin']};
  await assert.rejects(()=>client.createCloudCourse({...courseInput,courseId:'admin-invalid'}),e=>e.code==='CLOUD_BUSINESS_COURSE_RELATION_INVALID');
  context={roles:['teacher'],profile:{type:'teacher',id:'owner'}};
  transfer=await client.updateCloudCourse({...courseInput,courseId:transfer.id,expectedUpdatedAt:transfer.updatedAt,teacherId:'owner',teacherName:'Owner'});
  await client.deleteCloudCourse({...session,courseId:transfer.id,expectedUpdatedAt:transfer.updatedAt});
  let otherCourse=await client.createCloudCourse({...courseInput,courseId:'other-course',teacherId:'owner',teacherName:'Owner'});
  await assert.rejects(()=>client.updateCloudCourse({...courseInput,courseId:otherCourse.id,expectedUpdatedAt:otherCourse.updatedAt}),denied);
  await client.deleteCloudCourse({...session,courseId:otherCourse.id,expectedUpdatedAt:otherCourse.updatedAt});
  assert.equal((await snapshot()).schedules[0].teacher_name,'Teaching only');
  for(const actor of ['other','foreign']){context={roles:['teacher'],profile:{type:'teacher',id:actor}};await assert.rejects(()=>client.updateCloudCourse({...session,courseId:course.id,expectedUpdatedAt:course.updatedAt,active:false}),denied);await assert.rejects(()=>client.deleteCloudSchedule({...session,scheduleId:lesson.id,expectedUpdatedAt:lesson.updatedAt}),denied);}
  for(const roles of [['visitor'],['student'],['family_member'],['teacher']]){context={roles};await assert.rejects(()=>client.deleteCloudTeacher({...session,teacherId:'managed',expectedUpdatedAt:teacher.updatedAt}),denied);}
  context={roles:['teacher'],profile:{type:'teacher',id:'owner'}};
  await assert.rejects(()=>writer("UPDATE business.teachers SET legacy_deleted=false"),e=>e.code==='42501');
  await assert.rejects(()=>writer("SELECT business.vnext_check_retained_course_teacher('one','course','teacher','owner')"),e=>e.code==='42501');
  // Retained-course authorization locks both the profile claim and the live actor.
  await withQuery(handle,'writer',async first=>{
   await first.query('BEGIN');
   try{
    await first.query("SELECT * FROM business.vnext_set_scoped_course_active('one','course',$1,false,'teacher','owner')",[course.updatedAt]);
    await admin(async second=>{
     await second.query("SET lock_timeout='150ms'");
     await assert.rejects(()=>second.query("INSERT INTO business.miniapp_cloud_role_grants VALUES ('racing','teacher','active','teacher','managed')"),e=>e.code==='55P03');
     await assert.rejects(()=>second.query("UPDATE business.teachers SET legacy_deleted=true WHERE id='owner'"),e=>e.code==='55P03');
    });
   }finally{await first.query('ROLLBACK');}
  });
  // Disabled owners cannot operate retained profiles, even with a stale session.
  await admin(db=>db.query("UPDATE business.teachers SET legacy_deleted=true WHERE id='owner'"));
  assert.deepEqual((await read('owner')).courses,[]);
  await assert.rejects(()=>client.updateCloudCourse({...session,courseId:course.id,expectedUpdatedAt:course.updatedAt,active:false}),denied);
  await admin(db=>db.query("UPDATE business.teachers SET legacy_deleted=false WHERE id='owner'"));
  // Claim/revoke remains monotonic even for a retained profile.
  await admin(async first=>{
   await first.query('BEGIN');
   try{
    await first.query("INSERT INTO business.miniapp_cloud_role_grants VALUES ('claimed','teacher','active','teacher','managed')");
    await withQuery(handle,'writer',async second=>{
     await second.query("SET lock_timeout='150ms'");
     await assert.rejects(()=>second.query("SELECT * FROM business.vnext_set_scoped_course_active('one','course',$1,false,'teacher','owner')",[course.updatedAt]),e=>e.code==='55P03');
    });
    await first.query('COMMIT');
   }finally{await first.query('ROLLBACK');}
  });
  assert.deepEqual((await read('owner')).courses,[]);
  await assert.rejects(()=>client.deleteCloudSchedule({...session,scheduleId:lesson.id,expectedUpdatedAt:lesson.updatedAt}),denied);
  await admin(db=>db.query("DELETE FROM business.miniapp_cloud_role_grants WHERE profile_id='managed'"));
  assert.deepEqual((await read('owner')).courses,[]);
  await assert.rejects(()=>client.updateCloudCourse({...session,courseId:course.id,expectedUpdatedAt:course.updatedAt,active:false}),denied);
  console.log('original teacher deletion confirmed over HTTP; retained reader/course/lesson operations and account/tenant/role boundaries passed');
 }finally{if(server)await new Promise(r=>server.close(r));await runtime.disposeHandle(handle).catch(()=>{});await runtime.stop().catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
