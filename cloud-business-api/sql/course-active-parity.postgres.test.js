'use strict';
// UTF-8: missing historical fields and deleted enrolments must not prevent finish/reopen.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createCloudBusinessApp}=require('../src/app');
const {createBusinessCourseLifecycleMutations}=require('../src/businessCourseLifecycleMutationService');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const tables=['courses','students','course_student_pricings','schedules','schedule_student_overrides'];
const statement='SELECT * FROM business.vnext_set_scoped_course_active($1,$2,$3::timestamptz,$4,$5,$6)';
const denied=e=>e.code==='42501';
(async()=>{
 const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();let server;
 try{
  const receipt={appliedAt:'2026-09-09T00:00:00.000Z',appliedBy:'course-active-parity'};
  await createVNextPg17CatalogBoundary(runtime).apply(handle,receipt);await createBusinessFoundationCatalogBoundary(runtime).apply(handle,receipt);
  await withQuery(handle,'fixture-provisioner',async db=>{
   for(const file of ['20260823-zzzz-room-lifecycle.sql','20260823-zzzzz-course-lifecycle.sql','20260827-course-lifecycle-qualified.sql','20260907-teacher-course-write-scope.sql','20260907-z-teacher-student-write-scope.sql','20260822-business-schedule-student-override.sql'])await db.query(fs.readFileSync(path.join(__dirname,file),'utf8'));
   const migration=fs.readFileSync(path.join(__dirname,'20260909-course-active-original-behavior.sql'),'utf8');await db.query(migration);await db.query(migration);
   await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Tenant',false,now(),now()),('tenant-2','Other',false,now(),now())");
   await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher-1','tenant-1','Original',false,now(),now()),('teacher-2','tenant-1','Other',false,now(),now())");
   await db.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('deleted-student','tenant-1','Historical',false,true,now(),now())");
   await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) SELECT id,'tenant-1','Original','Original',1,1,100,60,1,1,teacher,true,deleted,'2026-09-01'::timestamptz,'2026-09-01'::timestamptz FROM (VALUES ('course-1','teacher-1',false),('course-2','teacher-2',false),('deleted-course','teacher-1',true)) x(id,teacher,deleted)");
   await db.query("INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES ('tenant-1','course-1','deleted-student',123,87)");
   await db.query("INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,status,calculated_tuition,calculated_teacher_fee,legacy_deleted,created_at,updated_at) VALUES ('lesson','tenant-1','course-1','2026-09-08T01:00Z','2026-09-08T02:00Z',1,0,0,false,now(),now())");
   await db.query("INSERT INTO business.schedule_student_overrides(tenant_id,schedule_id,student_id,attendance_status,tuition,teacher_fee) VALUES ('tenant-1','lesson','deleted-student',4,123,87)");
  });
  const read=()=>withQuery(handle,'fixture-provisioner',async db=>{const result={};for(const table of tables)result[table]=(await db.query(`SELECT to_jsonb(t) AS row FROM business.${table} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.row);return result;});
  let context={roles:['teacher'],teacherId:'teacher-1'};
  const query=(text,values)=>withQuery(handle,'writer',db=>db.query(text,values));
  const app=createCloudBusinessApp({query:async()=>({rows:[]}),businessTenantId:'tenant-1',desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async()=>context},businessCourseLifecycleMutations:createBusinessCourseLifecycleMutations({query})});
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const {createDesktopIdentityClient}=await import('../../src/services/desktopIdentityClient.mjs');
  const client=createDesktopIdentityClient({desktopIdentity:{status:async()=>({})},fetchImpl:fetch});
  const call=(id,version,active)=>client.updateCloudCourse({baseUrl:`http://127.0.0.1:${server.address().port}`,currentSession:{token:'desktop.test'},courseId:id,expectedUpdatedAt:new Date(version).toISOString(),active});
  let before=await read();
  for(const role of ['teacher','super_admin'])for(const active of [false,true]){
   context=role==='teacher'?{roles:[role],teacherId:'teacher-1'}:{roles:[role]};
   const version=before.courses.find(c=>c.id==='course-1').updated_at;await call('course-1',version,active);
   const after=await read(),expected=structuredClone(before),row=expected.courses.find(c=>c.id==='course-1');row.legacy_active=active;row.updated_at=after.courses.find(c=>c.id==='course-1').updated_at;
   assert.notEqual(row.updated_at,version);assert.deepEqual(after,expected,'state change cannot rewrite historical course fields, enrolments or lessons');
   await assert.rejects(()=>call('course-1',version,!active),e=>e.code==='CLOUD_BUSINESS_COURSE_CONFLICT');assert.deepEqual(await read(),after);before=after;
  }
  const version=before.courses.find(c=>c.id==='course-1').updated_at;
  for(const args of [['tenant-1','course-1',version,false,'teacher','teacher-2'],['tenant-2','course-1',version,false,'teacher','teacher-1'],['tenant-1','course-1',version,false,'teacher',null],['tenant-1','course-1',version,false,'student','deleted-student'],['tenant-1','deleted-course',version,false,'teacher','teacher-1']])await withQuery(handle,'writer',db=>assert.rejects(()=>db.query(statement,args),denied));
  await withQuery(handle,'writer',db=>assert.rejects(()=>db.query(statement,['tenant-1','course-1',version,null,'super_admin',null]),e=>e.code==='22023'));
  await withQuery(handle,'verifier',db=>assert.rejects(()=>db.query(statement,['tenant-1','course-1',version,false,'super_admin',null]),denied));
  await withQuery(handle,'writer',db=>assert.rejects(()=>db.query("UPDATE business.courses SET legacy_active=false"),denied));
  await withQuery(handle,'writer',async writer=>withQuery(handle,'fixture-provisioner',async admin=>{
   await writer.query('BEGIN');await writer.query(statement,['tenant-1','course-1',version,false,'teacher','teacher-1']);await admin.query("SET lock_timeout='100ms'");
   try{for(const sql of ["UPDATE business.courses SET teacher_id='teacher-2' WHERE id='course-1'","UPDATE business.teachers SET legacy_deleted=true WHERE id='teacher-1'"])await assert.rejects(()=>admin.query(sql),e=>e.code==='55P03');}finally{await writer.query('ROLLBACK');await admin.query('SET lock_timeout=0');}
  }));
  assert.deepEqual(await read(),before);console.log('course finish/reopen real HTTP/client/PostgreSQL parity, conflicts, scope, locks and unchanged history passed');
 }finally{if(server)await new Promise(r=>server.close(r));await runtime.disposeHandle(handle);await runtime.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
