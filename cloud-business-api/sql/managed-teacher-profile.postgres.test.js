'use strict';
// UTF-8: no account is provisioned by creating a teaching-only profile.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const migration=path.join(__dirname,'20260912-managed-teacher-profile.sql');
(async()=>{
 const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();
 try{
  const apply={appliedAt:'2026-09-12T00:00:00.000Z',appliedBy:'managed-teacher-test'};
  await createVNextPg17CatalogBoundary(runtime).apply(handle,apply);await createBusinessFoundationCatalogBoundary(runtime).apply(handle,apply);
  await withQuery(handle,'fixture-provisioner',async db=>{
   await db.query(fs.readFileSync(path.join(__dirname,'20260823-zzz-teacher-lifecycle.sql'),'utf8'));
   await db.query(fs.readFileSync(path.join(__dirname,'20260908-teacher-update-qualified.sql'),'utf8'));
   for(const file of ['20260823-zzzz-room-lifecycle.sql','20260823-zzzzz-course-lifecycle.sql','20260827-course-lifecycle-qualified.sql','20260824-schedule-lifecycle.sql','20260907-teacher-course-write-scope.sql','20260907-teacher-schedule-write-scope.sql','20260907-z-teacher-student-write-scope.sql','20260907-zz-schedule-financial-snapshot.sql','20260909-retained-student-schedule-write.sql','20260909-course-active-original-behavior.sql','20260909-course-delete-original-behavior.sql'])
    await db.query(fs.readFileSync(path.join(__dirname,file),'utf8'));
   // Minimal role-grant relation: production already owns this table; this fixture holds no login secrets.
   await db.query("CREATE TABLE business.miniapp_cloud_role_grants(account_id text,role text,status text,profile_type text,profile_id text); ALTER TABLE business.miniapp_cloud_role_grants OWNER TO vnext_pg17_business_owner");
   await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('one','One',false,now(),now()),('two','Two',false,now(),now())");
   await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('owner','one','Owner',false,now(),now()),('other','one','Other',false,now(),now()),('foreign','two','Foreign',false,now(),now())");
   await db.query("INSERT INTO business.students(id,tenant_id,name,created_by_teacher_id,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student','one','Student','owner',false,false,now(),now())");
   await db.query("INSERT INTO business.rooms(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('room','one','Room',false,now(),now())");
   await db.query(fs.readFileSync(migration,'utf8'));await db.query(fs.readFileSync(migration,'utf8'));
   await db.query('CREATE ROLE gewu_cloud_schedule_reader NOLOGIN; GRANT USAGE ON SCHEMA business TO gewu_cloud_schedule_reader; GRANT SELECT ON business.teachers,business.students,business.courses,business.schedules,business.course_student_pricings,business.schedule_student_overrides TO gewu_cloud_schedule_reader');
  });
  const create="SELECT * FROM business.vnext_create_scoped_teacher($1,$2,$3,NULL,'Physics',120,NULL,$4,$5)";
  const update="SELECT * FROM business.vnext_update_scoped_teacher($1,$2,$3::timestamptz,$4,NULL,'Physics',130,NULL,$5,$6)";
  const remove="SELECT * FROM business.vnext_delete_scoped_teacher($1,$2,$3::timestamptz,$4,$5)";
  const denied=e=>e?.code==='42501';let version,courseVersion,lessonVersion;
  // Capture the actual HTTP reader queries; execute their business fields below, not a copied scope predicate.
  let source,listSql;
  const empty={students:[],studentContacts:[],teachers:[],courses:[],schedules:[],institutions:[],schools:[],rooms:[],assetRecords:[],assetCategories:[],payments:[],consumptions:[]};
  const {createCloudBusinessApp}=require('../src/app');
  const app=createCloudBusinessApp({businessTenantId:'one',query:async sql=>{source=sql;return {rows:[{projection:empty}]};},desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async()=>({roles:['teacher'],profile:{type:'teacher',id:'owner'},accountId:'owner-account'})}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
   const url=`http://127.0.0.1:${server.address().port}`,headers={authorization:'Bearer desktop.test'};
   assert.equal((await fetch(url+'/api/business/schedules',{headers})).status,200);listSql=source;
   assert.equal((await fetch(url+'/api/business/desktop-projection',{headers})).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
  const start=source.indexOf('WITH managed_teachers AS ('),end=source.indexOf('SELECT jsonb_build_object(',start);
  assert(start>=0&&end>start);
  const field=key=>{const a=source.indexOf(`'${key}',`,end),b=source.indexOf(", '",a+key.length+3);assert(a>end&&b>a);return source.slice(a,b);};
  const projectionSql=source.slice(start,end)+'SELECT jsonb_build_object('+['teachers','courses','schedules'].map(field).join(', ')+') AS projection';
  const asReader=action=>withQuery(handle,'fixture-provisioner',async db=>{await db.query('BEGIN; SET LOCAL ROLE gewu_cloud_schedule_reader');try{return await action(db);}finally{await db.query('ROLLBACK');}});
  const read=actor=>asReader(async db=>(await db.query(projectionSql,['one','teacher',actor])).rows[0].projection);
  const checkLists=async(actor,ids)=>{
   const projection=await read(actor);assert.deepEqual(projection.schedules.map(row=>row.id),ids);
   await asReader(async db=>assert.deepEqual((await db.query(listSql,['one','teacher',actor])).rows.map(row=>row.id),ids));
   return projection;
  };
  const withTeacherClient=async(actor,action)=>{
   const {createBusinessTeacherLifecycleMutations}=require('../src/businessTeacherLifecycleMutationService');
   const httpApp=createCloudBusinessApp({businessTenantId:'one',query:async()=>{throw new Error('profile edits must not provision accounts');},
    desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async()=>({roles:['teacher'],profile:{type:'teacher',id:actor}})},
    businessTeacherLifecycleMutations:createBusinessTeacherLifecycleMutations({query:(sql,values)=>withQuery(handle,'writer',db=>db.query(sql,values))})});
   const http=httpApp.listen(0,'127.0.0.1');await new Promise(resolve=>http.once('listening',resolve));
   try{
    const {createDesktopIdentityClient}=await import('../../src/services/desktopIdentityClient.mjs');
    const client=createDesktopIdentityClient({desktopIdentity:{status:async()=>({})},fetchImpl:fetch});
    return await action(client,{baseUrl:`http://127.0.0.1:${http.address().port}`,currentSession:{token:'desktop.test'}});
   }finally{await new Promise(resolve=>http.close(resolve));}
  };
  await withQuery(handle,'writer',async db=>{
   await withTeacherClient('owner',async(client,session)=>{
    const fields={...session,teacherId:'managed',name:'Teaching only',phone:null,subject:'Physics',hourlyRate:120,notes:null};
    const created=await client.createCloudTeacher(fields);
    const changed=await client.updateCloudTeacher({...fields,expectedUpdatedAt:created.updatedAt,name:'Teaching only updated',hourlyRate:130});
    assert(changed);version=changed.updatedAt;
    await assert.rejects(()=>client.updateCloudTeacher({...fields,expectedUpdatedAt:created.updatedAt}),e=>e.code==='CLOUD_BUSINESS_TEACHER_CONFLICT');
   });
   assert.deepEqual((await read('owner')).teachers.map(row=>row.id),['managed','owner'],'new teaching profile must be selectable before creating a course');
   // The acceptance target is a usable course/lesson, not merely a successful profile insert.
   const {createBusinessCourseLifecycleMutations}=require('../src/businessCourseLifecycleMutationService');
   const {createBusinessScheduleLifecycleMutations}=require('../src/businessScheduleLifecycleMutationService');
   const actorScope={role:'teacher',teacherId:'owner'};
   const course=await createBusinessCourseLifecycleMutations({query:db.query.bind(db)}).create({tenantId:'one',courseId:'managed-course',name:'Physics',year:2026,semester:'autumn',displayName:'Physics',type:1,sourceType:1,institutionId:null,priceTuition:180,priceTeacher:120,billingUnit:1,teacherFeeMode:1,roomId:'room',roomName:'Room',teacherId:'managed',teacherName:'Teaching only updated',active:true,defaultDurationMinutes:90,notes:null,pricings:[{studentId:'student',tuition:180,teacherFee:120}],actorScope});
   assert(course);courseVersion=course.updatedAt;
   const lesson=await createBusinessScheduleLifecycleMutations({query:db.query.bind(db)}).create({tenantId:'one',scheduleId:'managed-lesson',courseId:course.id,startAt:'2026-09-13T01:00:00.000Z',endAt:'2026-09-13T02:30:00.000Z',recurringRule:null,status:1,roomDisplay:'Room',serviceType:1,tuition:270,teacherFee:180,notes:null,pricings:[{studentId:'student',attendanceStatus:1,tuition:180,teacherFee:120}],actorScope,financialSnapshot:{billingUnit:1,teacherFeeMode:1,teacherId:'managed',teacherName:'Teaching only updated'}});
   assert(lesson);lessonVersion=lesson.updatedAt;
   await assert.rejects(()=>db.query(remove,['one','managed',version,'teacher','owner']),e=>e.code==='P0001'&&e.message==='VNEXT_BUSINESS_TEACHER_REFERENCED');
   const projection=await checkLists('owner',['managed-lesson']);
   assert.equal(projection.courses[0].teacher_id,'managed');
   assert.equal(projection.schedules[0].teacher_id,'managed');
   assert.equal(projection.schedules[0].calculated_tuition,270);
   assert.equal(projection.schedules[0].calculated_teacher_fee,180);
   assert.deepEqual(projection.schedules[0].student_pricings,[{student_id:'student',attendance_status:1,tuition:180,teacher_fee:120}]);
   await checkLists('other',[]);await checkLists('foreign',[]);
   for(const actor of ['other','foreign']){
    await assert.rejects(()=>createBusinessCourseLifecycleMutations({query:db.query.bind(db)}).update({tenantId:'one',courseId:course.id,expectedUpdatedAt:courseVersion,active:false,actorScope:{role:'teacher',teacherId:actor}}),denied);
    await assert.rejects(()=>createBusinessScheduleLifecycleMutations({query:db.query.bind(db)}).remove({tenantId:'one',scheduleId:lesson.id,expectedUpdatedAt:lessonVersion,actorScope:{role:'teacher',teacherId:actor}}),denied);
   }
   const finished=await createBusinessCourseLifecycleMutations({query:db.query.bind(db)}).update({tenantId:'one',courseId:course.id,expectedUpdatedAt:courseVersion,active:false,actorScope});
   const reopened=await createBusinessCourseLifecycleMutations({query:db.query.bind(db)}).update({tenantId:'one',courseId:course.id,expectedUpdatedAt:finished.updatedAt,active:true,actorScope});courseVersion=reopened.updatedAt;
   await withQuery(handle,'fixture-provisioner',async admin=>{
    await admin.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('enrolled','one','Enrolled',false,false,now(),now())");
    await admin.query("INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES ('one','managed-course','enrolled',180,120)");
   });
   // A roster entered by the administrator must remain usable by the profile's authorized creator.
   const linked=await createBusinessCourseLifecycleMutations({query:db.query.bind(db)}).create({tenantId:'one',courseId:'linked-course',name:'Physics',year:2026,semester:'autumn',displayName:'Physics',type:1,sourceType:1,institutionId:null,priceTuition:180,priceTeacher:120,billingUnit:1,teacherFeeMode:1,roomId:'room',roomName:'Room',teacherId:'managed',teacherName:'Teaching only updated',active:true,defaultDurationMinutes:90,notes:null,pricings:[{studentId:'enrolled',tuition:180,teacherFee:120}],actorScope});
   assert(linked);
   for(const [role,actor,tenant] of [['teacher','other','one'],['teacher','foreign','one'],['teacher','owner','two'],['teacher',null,'one'],['student','owner','one']]){
    await assert.rejects(()=>db.query(update,[tenant,'managed',version,'Stolen',role,actor]),denied);
    await assert.rejects(()=>db.query(remove,[tenant,'managed',version,role,actor]),denied);
   }
   assert.equal((await db.query(update,['one','managed','2000-01-01T00:00:00Z','Stale','teacher','owner'])).rows.length,0);
   await assert.rejects(()=>db.query("UPDATE business.teachers SET name='bypass'"),denied);
   await assert.rejects(()=>db.query(remove,['one','owner',version,'teacher','owner']),denied);
   const disposable=(await db.query(create,['one','deletable','Deletable','teacher','owner'])).rows[0];
   assert.equal((await db.query(remove,['one','deletable',disposable.updated_at,'teacher','owner'])).rows.length,1);
  });
  await withQuery(handle,'fixture-provisioner',async db=>{
   assert.equal((await db.query('SELECT count(*)::int AS n FROM business.miniapp_cloud_role_grants')).rows[0].n,0);
   assert.equal((await db.query("SELECT created_by_teacher_id FROM business.teachers WHERE id='managed'")).rows[0].created_by_teacher_id,'owner');
   await db.query("INSERT INTO business.miniapp_cloud_role_grants VALUES ('claimed-account','teacher','active','teacher','managed')");
  });
  await withQuery(handle,'writer',async db=>{
   await assert.rejects(()=>db.query(update,['one','managed',version,'Creator overwrite','teacher','owner']),denied);
   await assert.rejects(()=>db.query(remove,['one','managed',version,'teacher','owner']),denied);
   assert((await db.query(update,['one','managed',version,'Own profile','teacher','managed'])).rows[0]);
   await assert.rejects(()=>db.query('SELECT * FROM business.vnext_set_scoped_course_active($1,$2,$3::timestamptz,false,$4,$5)',['one','managed-course',courseVersion,'teacher','owner']),denied);
   await assert.rejects(()=>db.query('SELECT * FROM business.vnext_delete_scoped_schedule($1,$2,$3::timestamptz,$4,$5)',['one','managed-lesson',lessonVersion,'teacher','owner']),denied);
  });
  assert.deepEqual((await checkLists('owner',[])).teachers.map(row=>row.id),['owner']);
  await checkLists('managed',['managed-lesson']);
  await withTeacherClient('owner',async(client,session)=>{
   await assert.rejects(()=>client.deleteCloudTeacher({...session,teacherId:'managed',expectedUpdatedAt:version}),e=>e.code==='CLOUD_BUSINESS_ACCESS_DENIED');
  });
  await withQuery(handle,'fixture-provisioner',async db=>{
   await db.query("DELETE FROM business.miniapp_cloud_role_grants WHERE profile_id='managed'");
   assert.equal((await db.query("SELECT account_claimed FROM business.teachers WHERE id='managed'")).rows[0].account_claimed,true);
   await db.query(fs.readFileSync(migration,'utf8'));
  });
  assert.deepEqual((await checkLists('owner',[])).teachers.map(row=>row.id),['owner'],'deleting/revoking a grant must not restore creator access');
  await withQuery(handle,'writer',db=>assert.rejects(()=>db.query(update,['one','managed',version,'Reclaimed','teacher','owner']),denied));
  await withQuery(handle,'writer',async writer=>withQuery(handle,'fixture-provisioner',async admin=>{
   const locked=(await writer.query(create,['one','claim-race','Claim race','teacher','owner'])).rows[0];
   await writer.query('BEGIN');
   try{
    await writer.query(update,['one','claim-race',locked.updated_at,'Held for edit','teacher','owner']);
    await admin.query("SET lock_timeout='150ms'");
    await assert.rejects(()=>admin.query("INSERT INTO business.miniapp_cloud_role_grants VALUES ('racing-account','teacher','active','teacher','claim-race')"),e=>e.code==='55P03');
    const row=(await writer.query(create,['one','concurrent','Concurrent','teacher','owner'])).rows[0];
    await admin.query("SET lock_timeout='150ms'");
    await assert.rejects(()=>admin.query("UPDATE business.teachers SET legacy_deleted=true WHERE id='owner'"),e=>e.code==='55P03');
    await writer.query('ROLLBACK');assert(row);
   }finally{await writer.query('ROLLBACK');}
   assert.equal((await admin.query("SELECT account_claimed FROM business.teachers WHERE id='claim-race'")).rows[0].account_claimed,false,'failed claim and rollback leave no claim marker');
   await admin.query('BEGIN');
   try{
    await admin.query("INSERT INTO business.miniapp_cloud_role_grants VALUES ('claim-first','teacher','active','teacher','claim-race')");
    await writer.query("SET lock_timeout='150ms'");
    await assert.rejects(()=>writer.query(update,['one','claim-race',locked.updated_at,'Claim race overwrite','teacher','owner']),e=>e.code==='55P03');
    await admin.query('COMMIT');
    await assert.rejects(()=>writer.query(update,['one','claim-race',locked.updated_at,'Claimed overwrite','teacher','owner']),denied);
   }finally{await admin.query('ROLLBACK');}
  }));
  await asReader(db=>assert.rejects(()=>db.query('SELECT * FROM business.miniapp_cloud_role_grants'),denied));
  console.log('managed profile real REST/writer, course/lesson, actual restricted-reader queries, account-claim revocation, versions and concurrent rollback checks passed');
 }finally{await runtime.disposeHandle(handle).catch(()=>{});await runtime.stop().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
