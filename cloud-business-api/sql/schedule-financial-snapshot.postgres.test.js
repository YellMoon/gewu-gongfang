// UTF-8: real isolated PostgreSQL, original snapshot persistence and rollback.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const sql=file=>fs.readFileSync(path.join(__dirname,file),'utf8');
const snapshot={billingUnit:2,teacherFeeMode:2,teacherId:'teacher-1',teacherName:'Original teacher'};
const createSql='SELECT * FROM business.vnext_create_scoped_schedule($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16::jsonb)';
const args=id=>['tenant-1',id,'course-1','2026-09-08T01:00:00Z','2026-09-08T02:30:00Z',null,1,'Room',1,180,120,null,JSON.stringify([{student_id:'student-1',attendance_status:1,tuition:180,teacher_fee:120}]),'teacher','teacher-1',JSON.stringify(snapshot)];
(async()=>{
 const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();
 try {
  const receipt={appliedAt:'2026-09-07T00:00:00.000Z',appliedBy:'schedule-snapshot-test'};
  await createVNextPg17CatalogBoundary(runtime).apply(handle,receipt);
  await createBusinessFoundationCatalogBoundary(runtime).apply(handle,receipt);
  await withQuery(handle,'fixture-provisioner',async db=>{
   for(const file of ['20260824-schedule-lifecycle.sql','20260822-business-schedule-student-override.sql','20260901-business-schedule-update-lifecycle.sql','20260907-teacher-schedule-write-scope.sql']) await db.query(sql(file));
   await db.query(sql('20260907-z-teacher-student-write-scope.sql'));
   await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Tenant',false,now(),now()),('tenant-2','Other',false,now(),now())");
   await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher-1','tenant-1','Original teacher',false,now(),now()),('teacher-2','tenant-1','Other teacher',false,now(),now()),('foreign','tenant-2','Foreign',false,now(),now())");
   await db.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student-1','tenant-1','Student',false,false,now(),now())");
   await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) VALUES ('course-1','tenant-1','Course','Course',1,1,180,120,2,2,'teacher-1',true,false,now(),now())");
   await db.query("INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES ('tenant-1','course-1','student-1',180,120)");
   await db.query("INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,status,calculated_tuition,calculated_teacher_fee,legacy_deleted,created_at,updated_at) VALUES ('legacy','tenant-1','course-1','2026-09-07T01:00:00Z','2026-09-07T02:30:00Z',1,270,180,false,now(),now())");
   await db.query(sql('20260907-zz-schedule-financial-snapshot.sql'));await db.query(sql('20260907-zz-schedule-financial-snapshot.sql'));
   await db.query(sql('20260909-retained-course-schedule-write.sql'));
   assert.deepEqual((await db.query("SELECT billing_unit,teacher_fee_mode,teacher_id,teacher_name FROM business.schedules WHERE id='legacy'")).rows[0],{billing_unit:null,teacher_fee_mode:null,teacher_id:null,teacher_name:null},'migration must not invent missing historical snapshots');
  });
  let version;
  await withQuery(handle,'writer',async db=>{
   version=(await db.query(createSql,args('schedule-1'))).rows[0].updated_at.toISOString();
   for(const [id,value,code] of [['invalid',{...snapshot,billingUnit:9},'22023'],['spoof',{...snapshot,unexpected:true},'22023']]) {
    const input=args(id);input[15]=JSON.stringify(value);await assert.rejects(()=>db.query(createSql,input),e=>e.code===code);
   }
   const foreign=args('foreign-snapshot');foreign[13]='super_admin';foreign[14]=null;foreign[15]=JSON.stringify({...snapshot,teacherId:'foreign'});
   await assert.rejects(()=>db.query(createSql,foreign),e=>e.code==='23503');
   await assert.rejects(()=>db.query("SELECT business.vnext_apply_schedule_financial_snapshot('tenant-1','schedule-1',NULL,'super_admin',NULL)"),e=>e.code==='42501');
  });
  const read=()=>withQuery(handle,'fixture-provisioner',async db=>(await db.query("SELECT billing_unit,teacher_fee_mode,teacher_id,teacher_name FROM business.schedules WHERE id='schedule-1'")).rows[0]);
  const expected={billing_unit:2,teacher_fee_mode:2,teacher_id:'teacher-1',teacher_name:'Original teacher'};
  assert.deepEqual(await read(),expected);
  await withQuery(handle,'fixture-provisioner',async db=>{
   await db.query("UPDATE business.courses SET billing_unit=1,teacher_fee_mode=1,price_tuition=999,price_teacher=999 WHERE id='course-1'");
   assert.equal((await db.query("SELECT count(*)::int AS count FROM business.schedules WHERE id IN ('invalid','spoof','foreign-snapshot')")).rows[0].count,0,'invalid snapshots roll back lesson and roster together');
  });
  assert.deepEqual(await read(),expected,'course changes cannot overwrite old lesson snapshot');
  // Execute the actual application projection expression, not a second hand-written mapping.
  const appSource=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
  const expressionLine=appSource.split(/\r?\n/).find(line=>line.includes("\"'schedules',COALESCE")&&line.includes('FROM scoped_schedules'));
  assert(expressionLine);
  const expression=new Function('STUDENT_SCHEDULE_TUITION_SQL',`return ${expressionLine.trim().replace(/,$/,'')};`)(require('../src/studentScheduleTuitionSql').STUDENT_SCHEDULE_TUITION_SQL).replace(/,$/,'');
  await withQuery(handle,'fixture-provisioner',async db=>{
   for(const role of ['teacher','student']) {
    const projected=(await db.query(`WITH scoped_schedules AS (SELECT * FROM business.schedules WHERE tenant_id=$1 AND id='schedule-1') SELECT jsonb_build_object(${expression}) AS result`,['tenant-1',role,'student-1'])).rows[0].result.schedules[0];
    assert.equal(projected.billing_unit,2);assert.equal(projected.teacher_id,'teacher-1');assert.equal(projected.teacher_name,'Original teacher');
    assert.equal(projected.teacher_fee_mode,role==='teacher'?2:null);
    if(role==='student') assert.equal(projected.calculated_teacher_fee,null);
   }
  });
  const updateSql='SELECT * FROM business.vnext_update_scoped_schedule($1,$2,$3::timestamptz,$4,$5::timestamptz,$6::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb)';
  const updateArgs=()=>['tenant-1','schedule-1',version,'course-1','2026-09-08T03:00:00Z','2026-09-08T04:30:00Z',null,1,'Room',1,180,120,'moved',null,'teacher','teacher-1',null];
  await withQuery(handle,'writer',async db=>{
   const stale=updateArgs();stale[2]='2000-01-01T00:00:00Z';stale[16]=JSON.stringify({...snapshot,billingUnit:1});
   assert.deepEqual((await db.query(updateSql,stale)).rows,[]);
   version=(await db.query(updateSql,updateArgs())).rows[0].updated_at.toISOString();
  });
  assert.deepEqual(await read(),expected,'old update without snapshot preserves all four fields');
  await withQuery(handle,'writer',async db=>{
   const refreshed=updateArgs();refreshed[16]=JSON.stringify({...snapshot,billingUnit:1,teacherFeeMode:1,teacherName:'Explicit refresh'});
   assert.equal((await db.query(updateSql,refreshed)).rows.length,1);
   await assert.rejects(()=>db.query("UPDATE business.schedules SET billing_unit=2"),e=>e.code==='42501');
  });
  assert.deepEqual(await read(),{...expected,billing_unit:1,teacher_fee_mode:1,teacher_name:'Explicit refresh'});
  await withQuery(handle,'fixture-provisioner',db=>db.query("UPDATE business.courses SET teacher_id='teacher-2' WHERE id='course-1'"));
  await withQuery(handle,'writer',async db=>{
   await assert.rejects(()=>db.query(createSql,args('old-owner')),e=>e.code==='42501');
   const copied=args('history-copy');copied[14]='teacher-2';
   assert.equal((await db.query(createSql,copied)).rows.length,1,'new course owner can copy an old lesson without rewriting its historical teacher');
  });
  await withQuery(handle,'fixture-provisioner',async db=>assert.equal((await db.query("SELECT teacher_id FROM business.schedules WHERE id='history-copy'")).rows[0].teacher_id,'teacher-1'));
 } finally {await runtime.disposeHandle(handle).catch(()=>{});await runtime.stop().catch(()=>{});}
 console.log('schedule financial snapshot PostgreSQL persistence, scope and rollback checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
