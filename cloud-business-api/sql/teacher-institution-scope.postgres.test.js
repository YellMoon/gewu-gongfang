'use strict';
// UTF-8: real desktop REST and restricted writer; original deletion retains every related record.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createCloudBusinessApp}=require('../src/app');
const {createBusinessFoundationLifecycleMutations}=require('../src/businessFoundationLifecycleMutationService');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
function assertOriginalDeleteRetainsRelatedRows(rows){
 const ts=require('typescript'),{execFileSync}=require('node:child_process');
 const source=execFileSync('git',['show','8118419f:src/services/browserDatabase.ts'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8',maxBuffer:8*1024*1024});
 const ast=ts.createSourceFile('original.ts',source,ts.ScriptTarget.Latest,true);let method;
 const visit=node=>{if(ts.isMethodDeclaration(node)&&node.name?.getText(ast)==='deleteInstitution')method=node;ts.forEachChild(node,visit);};visit(ast);assert(method);
 const js=ts.transpileModule('('+method.getText(ast).replace(/^deleteInstitution/,'function')+')',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const original=require('node:vm').runInNewContext(js),related=structuredClone(rows);
 const db={data:{...related,institutions:[{id:'created'}]},saveData(){},recordSyncChange(){}};
 assert.equal(original.call(db,'created'),true);assert.deepEqual(db.data.institutions,[]);
 delete db.data.institutions;assert.deepEqual(db.data,rows,'execute original method, not a reimplementation of its deletion policy');
}
(async()=>{
 const pg=createDisposablePg17Runtime();await pg.start();const handle=await pg.createIsolatedHandle();let server;
 const admin=action=>withQuery(handle,'fixture-provisioner',action),writer=(sql,values)=>withQuery(handle,'writer',db=>db.query(sql,values));
 try{
  const receipt={appliedAt:'2026-09-13T00:00:00.000Z',appliedBy:'teacher-institution-scope'};
  await createVNextPg17CatalogBoundary(pg).apply(handle,receipt);await createBusinessFoundationCatalogBoundary(pg).apply(handle,receipt);
  await admin(async db=>{
   for(const name of ['20260824-foundation-lifecycle.sql','20260823-zzzz-room-lifecycle.sql','20260823-zzzzz-course-lifecycle.sql','20260827-course-lifecycle-qualified.sql','20260824-schedule-lifecycle.sql','20260907-teacher-course-write-scope.sql','20260907-teacher-schedule-write-scope.sql','20260907-z-teacher-student-write-scope.sql','20260907-zz-schedule-financial-snapshot.sql','20260908-z-institution-billing-student.sql'])await db.query(fs.readFileSync(path.join(__dirname,name),'utf8'));
   await require('./managedTeacherProfileFixture').applyManagedTeacherProfileFixture(db);
   const migration=path.join(__dirname,'20260913-teacher-institution-scope.sql');
   await db.query(fs.readFileSync(migration,'utf8'));await db.query(fs.readFileSync(migration,'utf8'));
   await db.query('CREATE ROLE gewu_cloud_schedule_reader NOLOGIN; GRANT USAGE ON SCHEMA business TO gewu_cloud_schedule_reader; GRANT SELECT ON business.teachers,business.students,business.courses,business.schedules,business.course_student_pricings,business.schedule_student_overrides,business.institutions,business.institution_billing_students TO gewu_cloud_schedule_reader');
   await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('one','One',false,now(),now()),('two','Two',false,now(),now())");
   await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('owner','one','Owner',false,now(),now()),('other','one','Other',false,now(),now()),('foreign','two','Foreign',false,now(),now())");
   await db.query("INSERT INTO business.rooms(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('room','one','东湖上课点',false,now(),now())");
  });
  let context={roles:['teacher'],profile:{type:'teacher',id:'owner'}},source;
  const empty={students:[],studentContacts:[],teachers:[],courses:[],schedules:[],institutions:[],schools:[],rooms:[],assetRecords:[],assetCategories:[],payments:[],consumptions:[]};
  const app=createCloudBusinessApp({businessTenantId:'one',query:async sql=>{source=sql;return {rows:[{projection:empty}]};},
   desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async()=>context},
   businessFoundationLifecycleMutations:createBusinessFoundationLifecycleMutations({query:writer}),
   businessCourseLifecycleMutations:require('../src/businessCourseLifecycleMutationService').createBusinessCourseLifecycleMutations({query:writer}),
   businessScheduleLifecycleMutations:require('../src/businessScheduleLifecycleMutationService').createBusinessScheduleLifecycleMutations({query:writer})});
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const {createDesktopIdentityClient}=await import('../../src/services/desktopIdentityClient.mjs');
  let requests=0;
  const client=createDesktopIdentityClient({desktopIdentity:{status:async()=>({})},fetchImpl:(...args)=>{requests++;return fetch(...args);}});
  const session={baseUrl:`http://127.0.0.1:${server.address().port}`,currentSession:{token:'desktop.test'}};
  const input={...session,institutionId:'created',name:'春禾机构',contactPerson:'王老师',contactPhone:'13100000000',revenueShare:30,notes:'原机构表单'};
  const {createDesktopCloudBusinessDraftAdapter}=await import('../../src/services/desktopCloudBusinessDraft.mjs');
  const {createDesktopAuthorityClient}=await import('../../src/services/desktopAuthorityClient.mjs');
  const {createDesktopCommandOutbox}=await import('../../src/services/desktopCommandOutbox.mjs');
  let storage='',sequence=0;
  const outbox=createDesktopCommandOutbox({store:{read:async()=>storage,write:async value=>{storage=value;}},codec:{seal:async value=>JSON.stringify(value),open:async value=>JSON.parse(value)},createId:()=>`institution-${++sequence}`,now:()=> '2026-09-13T00:00:00.000Z'});
  const adapter=createDesktopCloudBusinessDraftAdapter({cloudClient:client,baseUrl:session.baseUrl,sha256:x=>require('node:crypto').createHash('sha256').update(x).digest('hex')});
  const authority=createDesktopAuthorityClient({outbox,createCloudBusinessCommand:adapter.createCommand,submitCloudBusiness:adapter.submit});
  const draftSession={sessionToken:'eyJ2IjoxfQ.signature'};
  const confirmed=async(type,payload)=>{
   const draft=await authority.appendDraft({type,payload}),beforeRequests=requests;
   assert.equal(await authority.submit(draft.id,draftSession),undefined);assert.equal(requests,beforeRequests,'unconfirmed drafts must never be sent');
   const result=await authority.confirmAndSubmit(draft.id,draftSession);
   assert.equal(result.transportUsed,'cloud-business-authority');assert.equal((await outbox.get(draft.id)).status,'completed');
   assert(!storage.includes(draftSession.sessionToken));
  };
  await confirmed('institution.create.v1',{record:{id:'created',name:input.name,contact_person:input.contactPerson,contact_phone:input.contactPhone,revenue_share:30,notes:input.notes}});
  const currentInstitution=()=>admin(async db=>{const row=(await db.query("SELECT id,updated_at FROM business.institutions WHERE id='created'")).rows[0];return {id:row.id,updatedAt:row.updated_at.toISOString()};});
  let created=await currentInstitution();assert.equal(created.id,'created');
  assert.equal((await fetch(session.baseUrl+'/api/business/desktop-projection',{headers:{authorization:'Bearer desktop.test'}})).status,200);
  const a=source.indexOf('WITH managed_teachers AS ('),b=source.indexOf('SELECT jsonb_build_object(',a),c=source.indexOf("'institutions',",b),d=source.indexOf(", 'schools',",c);
  assert(a>=0&&b>a&&c>b&&d>c);
  const readSql=source.slice(a,b)+"SELECT jsonb_build_object("+source.slice(c,d)+",'students',COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM scoped_students),'[]'::jsonb)) AS projection";
  const read=actor=>admin(async db=>{await db.query('BEGIN; SET LOCAL ROLE gewu_cloud_schedule_reader');try{return(await db.query(readSql,['one','teacher',actor])).rows[0].projection;}finally{await db.query('ROLLBACK');}});
  let projection=await read('owner');assert.equal(projection.institutions[0]?.id,'created');assert.deepEqual(projection.students,['institution-student-created']);
  assert.equal(projection.institutions[0].contact_person,input.contactPerson);assert.equal(projection.institutions[0].contact_phone,input.contactPhone);
  assert.equal(projection.institutions[0].revenue_share,30);assert.equal(projection.institutions[0].notes,input.notes);
  assert.equal((await read('other')).institutions.length,0);
  assert.equal((await read('foreign')).institutions.length,0);
  await assert.rejects(()=>client.createCloudInstitution({...input,institutionId:'duplicate'}),e=>e.code==='CLOUD_BUSINESS_INSTITUTION_NAME_EXISTS');
  const denied=e=>e.code==='CLOUD_BUSINESS_ACCESS_DENIED';
  for(const actor of ['other','foreign']){
   context={roles:['teacher'],profile:{type:'teacher',id:actor}};
   await assert.rejects(()=>client.updateCloudInstitution({...input,expectedUpdatedAt:created.updatedAt,name:'越权'}),denied);
   await assert.rejects(()=>client.deleteCloudInstitution({...session,institutionId:'created',expectedUpdatedAt:created.updatedAt}),denied);
  }
  for(const roles of [['student'],['family_member'],[],['teacher']]){
   context={roles};await assert.rejects(()=>client.createCloudInstitution({...input,institutionId:'denied'}),denied);
  }
  context={roles:['teacher'],profile:{type:'teacher',id:'owner'}};
  await assert.rejects(()=>client.createCloudSchool({...session,schoolId:'school',name:'越权学校',count:0}),denied);
  const old=created.updatedAt;
  await confirmed('institution.update.v1',{id:'created',expectedVersion:old,changes:{name:'春禾机构改名',contact_person:input.contactPerson,contact_phone:input.contactPhone,revenue_share:30,notes:input.notes}});
  created=await currentInstitution();
  await assert.rejects(()=>client.updateCloudInstitution({...input,expectedUpdatedAt:old}),e=>e.code==='CLOUD_BUSINESS_INSTITUTION_CONFLICT');
  await admin(async db=>{
   assert.equal((await db.query("SELECT name FROM business.students WHERE id='institution-student-created'")).rows[0].name,'春禾机构改名学生');
  });
  const course=await client.createCloudCourse({...session,courseId:'course',name:'物理',year:2026,semester:'秋季',displayName:'初二物理',type:1,sourceType:2,institutionId:'created',priceTuition:180,priceTeacher:120,billingUnit:1,teacherFeeMode:1,roomId:'room',roomName:'东湖上课点',teacherId:'owner',teacherName:'Owner',active:true,defaultDurationMinutes:90,notes:null,pricings:[{studentId:'institution-student-created',tuition:180,teacherFee:120}]});
  assert.equal(course.id,'course');
  const lesson=await client.createCloudSchedule({...session,scheduleId:'lesson',courseId:course.id,startAt:'2026-09-13T01:00:00.000Z',endAt:'2026-09-13T02:30:00.000Z',recurringRule:null,status:1,roomDisplay:'东湖上课点',serviceType:1,tuition:270,teacherFee:180,notes:null,pricings:[{studentId:'institution-student-created',attendanceStatus:1,tuition:180,teacherFee:120}],billingUnit:1,teacherFeeMode:1,teacherId:'owner',teacherName:'Owner'});
  assert.equal(lesson.id,'lesson');
  const snapshot=()=>admin(async db=>{
   const result={};for(const table of ['students','courses','schedules','course_student_pricings','schedule_student_overrides','institution_billing_students'])result[table]=(await db.query(`SELECT * FROM business.${table} ORDER BY 1,2`)).rows;
   return result;
  });
  const before=await snapshot();
  assert.equal(Number(before.schedules[0].calculated_tuition),270);assert.equal(Number(before.schedules[0].calculated_teacher_fee),180);
  assert.equal(before.schedules[0].teacher_id,'owner');assert.equal(before.schedules[0].room_display_snapshot,'东湖上课点');
  assert.equal(before.schedule_student_overrides[0].attendance_status,1);
  assert.equal(Number(before.schedule_student_overrides[0].tuition),180);assert.equal(Number(before.schedule_student_overrides[0].teacher_fee),120);
  assertOriginalDeleteRetainsRelatedRows(before);
  await assert.rejects(()=>client.deleteCloudInstitution({...session,institutionId:'created',expectedUpdatedAt:old}),e=>e.code==='CLOUD_BUSINESS_INSTITUTION_CONFLICT');
  await confirmed('institution.delete.v1',{id:'created',expectedVersion:created.updatedAt});
  assert.deepEqual(await snapshot(),before,'original institution deletion removes only the institution, not students, courses or billing links');
  assert.equal((await read('owner')).institutions.length,0);assert.deepEqual((await read('owner')).students,['institution-student-created']);
  await withQuery(handle,'writer',db=>assert.rejects(()=>db.query("UPDATE business.institutions SET name='bypass'"),e=>e.code==='42501'));
  // Legacy institutions acquire no guessed creator; the authenticated administrator remains able to maintain them.
  context={roles:['super_admin']};
  const legacy=await client.createCloudInstitution({...input,institutionId:'admin-created',name:'历史共享机构'});
  context={roles:['teacher'],profile:{type:'teacher',id:'owner'}};
  await assert.rejects(()=>client.updateCloudInstitution({...input,institutionId:legacy.id,name:'抢占历史机构',expectedUpdatedAt:legacy.updatedAt}),denied);
  await admin(async db=>{
   await db.query(fs.readFileSync(path.join(__dirname,'20260913-teacher-institution-scope.sql'),'utf8'));
   assert.equal((await db.query("SELECT created_by_teacher_id FROM business.institutions WHERE id='admin-created'")).rows[0].created_by_teacher_id,null);
  });
  context={roles:['super_admin']};
  await client.deleteCloudInstitution({...session,institutionId:legacy.id,expectedUpdatedAt:legacy.updatedAt});
  // Serialize same-name creates without broad table locks; a rolled-back contender leaves no orphan billing student.
  await withQuery(handle,'writer',async first=>{
   await first.query('BEGIN');
   try{
    const sql="SELECT * FROM business.vnext_create_scoped_institution('one',$1,'并发机构',NULL,NULL,30,NULL,'teacher',$2)";
    await first.query(sql,['race-first','owner']);
    await admin(async second=>{
     await second.query("SET SESSION AUTHORIZATION vnext_pg17_writer; BEGIN; SET LOCAL lock_timeout='150ms'");
     try{await assert.rejects(()=>second.query(sql,['race-second','other']),e=>e.code==='55P03');}finally{await second.query('ROLLBACK; RESET SESSION AUTHORIZATION');}
    });
   }finally{await first.query('ROLLBACK');}
  });
  await admin(async db=>assert.equal((await db.query("SELECT count(*)::int AS count FROM business.students WHERE id IN ('institution-student-race-first','institution-student-race-second')")).rows[0].count,0));
  await admin(async db=>assert.equal((await db.query('SELECT count(*)::int AS count FROM business.miniapp_cloud_role_grants')).rows[0].count,0));
  console.log('teacher institution confirmed offline CRUD -> billing student -> course -> lesson; restricted read, scope, versions and unchanged retained history passed');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pg.disposeHandle(handle).catch(()=>{});await pg.stop().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
