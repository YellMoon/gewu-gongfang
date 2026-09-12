'use strict';
// UTF-8: original room edits/deletion must preserve course and lesson snapshots.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createCloudBusinessApp}=require('../src/app');
const {createBusinessRoomLifecycleMutations}=require('../src/businessRoomLifecycleMutationService');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
function original(method){
 const ts=require('typescript'),{execFileSync}=require('node:child_process');
 const source=execFileSync('git',['show','8118419f:src/services/browserDatabase.ts'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8',maxBuffer:8*1024*1024});
 const ast=ts.createSourceFile('original.ts',source,ts.ScriptTarget.Latest,true);let found;
 const visit=node=>{if(ts.isMethodDeclaration(node)&&node.name?.getText(ast)===method)found=node;ts.forEachChild(node,visit);};visit(ast);assert(found);
 return require('node:vm').runInNewContext(ts.transpileModule('('+found.getText(ast).replace(method,'function')+')',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText);
}
(async()=>{
 const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();let server;
 const admin=action=>withQuery(handle,'fixture-provisioner',action),writer=(sql,values)=>withQuery(handle,'writer',db=>db.query(sql,values));
 try{
  const receipt={appliedAt:'2026-09-13T00:00:00.000Z',appliedBy:'room-maintenance'};
  await createVNextPg17CatalogBoundary(runtime).apply(handle,receipt);await createBusinessFoundationCatalogBoundary(runtime).apply(handle,receipt);
  await admin(async db=>{
   for(const name of ['20260823-zzzz-room-lifecycle.sql','20260823-zzzzz-course-lifecycle.sql','20260827-course-lifecycle-qualified.sql','20260824-schedule-lifecycle.sql','20260907-teacher-course-write-scope.sql','20260907-teacher-schedule-write-scope.sql','20260907-z-teacher-student-write-scope.sql','20260907-zz-schedule-financial-snapshot.sql','20260908-created-room-visibility.sql'])await db.query(fs.readFileSync(path.join(__dirname,name),'utf8'));
   await require('./managedTeacherProfileFixture').applyManagedTeacherProfileFixture(db);
   const migration=path.join(__dirname,'20260913-teacher-room-maintenance.sql');
   await db.query(fs.readFileSync(migration,'utf8'));await db.query(fs.readFileSync(migration,'utf8'));
   await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('one','One',false,now(),now()),('two','Two',false,now(),now())");
   await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('owner','one','Owner',false,now(),now()),('other','one','Other',false,now(),now()),('foreign','two','Foreign',false,now(),now())");
   await db.query("INSERT INTO business.students(id,tenant_id,name,created_by_teacher_id,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student','one','学生','owner',false,false,now(),now())");
  });
  let context={roles:['teacher'],profile:{type:'teacher',id:'owner'}},requests=0;
  const app=createCloudBusinessApp({businessTenantId:'one',query:async()=>({rows:[]}),desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async()=>context},
   businessRoomLifecycleMutations:createBusinessRoomLifecycleMutations({query:writer}),
   businessCourseLifecycleMutations:require('../src/businessCourseLifecycleMutationService').createBusinessCourseLifecycleMutations({query:writer}),
   businessScheduleLifecycleMutations:require('../src/businessScheduleLifecycleMutationService').createBusinessScheduleLifecycleMutations({query:writer})});
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const {createDesktopIdentityClient}=await import('../../src/services/desktopIdentityClient.mjs');
  const client=createDesktopIdentityClient({desktopIdentity:{status:async()=>({})},fetchImpl:(...args)=>{requests++;return fetch(...args);}});
  const session={baseUrl:`http://127.0.0.1:${server.address().port}`,currentSession:{token:'desktop.test'}};
  const input={...session,roomId:'created',name:'东湖上课点',address:'东湖路一号'};
  const created=await client.createCloudRoom(input);
  await assert.rejects(()=>client.createCloudRoom({...input,roomId:'duplicate'}),e=>e.code==='CLOUD_BUSINESS_ROOM_NAME_EXISTS');
  const changed=await client.updateCloudRoom({...input,expectedUpdatedAt:created.updatedAt,name:'东湖二楼',address:'东湖路二号'});
  assert.equal(changed.id,'created');
  const {createDesktopCloudBusinessDraftAdapter}=await import('../../src/services/desktopCloudBusinessDraft.mjs');
  const {createDesktopAuthorityClient}=await import('../../src/services/desktopAuthorityClient.mjs');
  const {createDesktopCommandOutbox}=await import('../../src/services/desktopCommandOutbox.mjs');
  let storage='',sequence=0;
  const outbox=createDesktopCommandOutbox({store:{read:async()=>storage,write:async value=>{storage=value;}},codec:{seal:async value=>JSON.stringify(value),open:async value=>JSON.parse(value)},createId:()=>`room-${++sequence}`,now:()=> '2026-09-13T00:00:00.000Z'});
  const adapter=createDesktopCloudBusinessDraftAdapter({cloudClient:client,baseUrl:session.baseUrl,sha256:x=>require('node:crypto').createHash('sha256').update(x).digest('hex')});
  const authority=createDesktopAuthorityClient({outbox,createCloudBusinessCommand:adapter.createCommand,submitCloudBusiness:adapter.submit});
  const confirmed=async(type,payload)=>{
   const draft=await authority.appendDraft({type,payload}),before=requests,auth={sessionToken:'eyJ2IjoxfQ.signature'};
   assert.equal(await authority.submit(draft.id,auth),undefined);assert.equal(requests,before);
   const result=await authority.confirmAndSubmit(draft.id,auth);assert.equal(result.transportUsed,'cloud-business-authority');assert.equal((await outbox.get(draft.id)).status,'completed');assert(!storage.includes(auth.sessionToken));
  };
  const course=await client.createCloudCourse({...session,courseId:'course',name:'物理',year:2026,semester:'秋季',displayName:'初二物理',type:1,sourceType:1,institutionId:null,priceTuition:180,priceTeacher:120,billingUnit:1,teacherFeeMode:1,roomId:'created',roomName:'东湖二楼',teacherId:'owner',teacherName:'Owner',active:true,defaultDurationMinutes:90,notes:null,pricings:[{studentId:'student',tuition:180,teacherFee:120}]});
  await client.createCloudSchedule({...session,scheduleId:'lesson',courseId:course.id,startAt:'2026-09-13T01:00:00.000Z',endAt:'2026-09-13T02:30:00.000Z',recurringRule:null,status:1,roomDisplay:'东湖二楼',serviceType:1,tuition:270,teacherFee:180,notes:null,pricings:[{studentId:'student',attendanceStatus:1,tuition:180,teacherFee:120}],billingUnit:1,teacherFeeMode:1,teacherId:'owner',teacherName:'Owner'});
  const snapshot=()=>admin(async db=>{const rows={};for(const table of ['students','courses','schedules','course_student_pricings','schedule_student_overrides'])rows[table]=(await db.query(`SELECT * FROM business.${table} ORDER BY 1,2`)).rows;return rows;});
  const before=await snapshot(),dbOriginal={data:{...structuredClone(before),rooms:[{id:'created',name:'东湖二楼',address:'东湖路二号'}]},saveData(){},recordSyncChange(){}};
  assert.equal(Number(before.schedules[0].calculated_tuition),270);assert.equal(Number(before.schedules[0].calculated_teacher_fee),180);
  assert.equal(before.schedule_student_overrides[0].attendance_status,1);
  original('updateRoom').call(dbOriginal,'created',{name:'东湖三楼',address:'东湖路三号'});
  await confirmed('room.update.v1',{id:'created',expectedVersion:changed.updatedAt,changes:{name:'东湖三楼',address:'东湖路三号'}});
  assert.deepEqual(await snapshot(),before,'address edit must not silently rewrite existing course/lesson snapshots');
  const readRoom=()=>admin(async db=>(await db.query("SELECT name,address_legacy,updated_at,legacy_deleted,created_by_teacher_id FROM business.rooms WHERE id='created'")).rows[0]);
  const saved=await readRoom();assert.equal(saved.name,dbOriginal.data.rooms[0].name);assert.equal(saved.address_legacy,dbOriginal.data.rooms[0].address);assert.equal(saved.created_by_teacher_id,'owner');
  const denied=e=>e.code==='CLOUD_BUSINESS_ACCESS_DENIED';
  for(const actor of ['other','foreign']){
   context={roles:['teacher'],profile:{type:'teacher',id:actor}};
   await assert.rejects(()=>client.updateCloudRoom({...input,expectedUpdatedAt:saved.updated_at.toISOString()}),denied);
   await assert.rejects(()=>client.deleteCloudRoom({...session,roomId:'created',expectedUpdatedAt:saved.updated_at.toISOString()}),denied);
  }
  for(const roles of [['visitor'],['student'],['family_member'],['teacher']]){context={roles};await assert.rejects(()=>client.createCloudRoom({...input,roomId:'denied'}),denied);}
  context={roles:['teacher'],profile:{type:'teacher',id:'owner'}};
  await admin(db=>db.query("UPDATE business.teachers SET legacy_deleted=true WHERE id='owner'"));
  await assert.rejects(()=>client.updateCloudRoom({...input,expectedUpdatedAt:saved.updated_at.toISOString()}),denied);
  await admin(db=>db.query("UPDATE business.teachers SET legacy_deleted=false WHERE id='owner'"));
  for(const action of ['updateCloudRoom','deleteCloudRoom'])await assert.rejects(()=>client[action]({...input,expectedUpdatedAt:created.updatedAt}),e=>e.code==='CLOUD_BUSINESS_ROOM_CONFLICT');
  assert.equal(original('deleteRoom').call(dbOriginal,'created'),true);delete dbOriginal.data.rooms;assert.deepEqual(dbOriginal.data,before);
  await confirmed('room.delete.v1',{id:'created',expectedVersion:saved.updated_at.toISOString()});
  assert.equal((await readRoom()).legacy_deleted,true);assert.deepEqual(await snapshot(),before);
  context={roles:['super_admin']};const shared=await client.createCloudRoom({...input,roomId:'shared',name:'历史共享地址'});
  context={roles:['teacher'],profile:{type:'teacher',id:'owner'}};
  await assert.rejects(()=>client.updateCloudRoom({...input,roomId:shared.id,expectedUpdatedAt:shared.updatedAt}),denied);
  context={roles:['super_admin']};await client.deleteCloudRoom({...session,roomId:shared.id,expectedUpdatedAt:shared.updatedAt});
  await withQuery(handle,'writer',db=>assert.rejects(()=>db.query("UPDATE business.rooms SET name='bypass'"),e=>e.code==='42501'));
  // UTF-8: distinct writer sessions verify same-name serialization without orphan rows.
  await withQuery(handle,'writer',async first=>{
   await first.query('BEGIN');
   try{
    await first.query("SELECT * FROM business.vnext_create_scoped_room('one','concurrent','并发地址',NULL,'teacher','owner')");
    await admin(async second=>{
     await second.query("SET SESSION AUTHORIZATION vnext_pg17_writer; BEGIN; SET LOCAL lock_timeout='150ms'");
     try{await assert.rejects(()=>second.query("SELECT * FROM business.vnext_create_scoped_room('one','contender','并发地址',NULL,'teacher','other')"),e=>e.code==='55P03');}finally{await second.query('ROLLBACK; RESET SESSION AUTHORIZATION');}
    });
   }finally{await first.query('ROLLBACK');}
  });
  await admin(async db=>assert.equal((await db.query("SELECT count(*)::int AS count FROM business.rooms WHERE id IN ('concurrent','contender')")).rows[0].count,0));
  console.log('original address online/confirmed edits and deletion retain courses/lessons, prices and attendance; teacher scope and versions passed');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await runtime.disposeHandle(handle).catch(()=>{});await runtime.stop().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
