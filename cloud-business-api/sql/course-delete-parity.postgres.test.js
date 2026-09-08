'use strict';
// UTF-8: original course deletion, retained lessons and scoped readback in disposable PostgreSQL.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),ts=require('typescript');
const {createCloudBusinessApp}=require('../src/app');
const {withScheduleCourseContextSql,applyScheduleCourseContext}=require('../src/scheduleCoursePresentation');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const root=path.resolve(__dirname,'../..');
const oldSource=ts.createSourceFile('browserDatabase.ts',cp.execFileSync('git',['show','8118419f:src/services/browserDatabase.ts'],{cwd:root,encoding:'utf8'}),ts.ScriptTarget.Latest,true);
let method;
function visit(node){if(ts.isMethodDeclaration(node)&&node.name.getText(oldSource)==='deleteCourse')method=node;ts.forEachChild(node,visit);}
visit(oldSource);assert(method);
const oldDelete=new Function(ts.transpileModule(`return function(id: string) ${method.body.getText(oldSource)}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText)();
const denied=e=>e.code==='42501';
const removeSql='SELECT * FROM business.vnext_delete_scoped_course($1,$2,$3::timestamptz,$4,$5)';
(async()=>{
  let actualSql,listSql;
  const empty={students:[],studentContacts:[],teachers:[],courses:[],schedules:[],institutions:[],schools:[],rooms:[],assetRecords:[],assetCategories:[],payments:[],consumptions:[]};
  const app=createCloudBusinessApp({businessTenantId:'tenant-1',query:async sql=>{actualSql=sql;return {rows:[{projection:empty}]};},
    desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async()=>({roles:['teacher'],profile:{type:'teacher',id:'teacher-1'},accountId:'test-account'})}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base+'/api/business/desktop-projection',{headers:{authorization:'Bearer desktop.test'}})).status,200);
    const projectionSql=actualSql;
    assert.equal((await fetch(base+'/api/business/schedules',{headers:{authorization:'Bearer desktop.test'}})).status,200);
    listSql=actualSql;actualSql=projectionSql;
  }
  finally{await new Promise(resolve=>server.close(resolve));}
  // Exact runtime authorization CTEs. Unrelated assets/directory fields are outside this SQL test.
  const start=actualSql.indexOf('WITH scoped_schedules AS ('),end=actualSql.indexOf('SELECT jsonb_build_object(',start);
  assert(start>=0&&end>start);
  const readSql=actualSql.slice(start,end)+"SELECT jsonb_build_object('courses',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM scoped_courses c),'[]'::jsonb),'schedules',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM scoped_schedules s),'[]'::jsonb)) AS projection";
  const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();
  try{
    const receipt={appliedAt:'2026-09-09T00:00:00.000Z',appliedBy:'course-delete-parity'};
    await createVNextPg17CatalogBoundary(runtime).apply(handle,receipt);await createBusinessFoundationCatalogBoundary(runtime).apply(handle,receipt);
    const cases=['teacher','super_admin'].flatMap(role=>[false,true].map(archived=>({role,archived,id:`course-${role}-${archived}`})));
    await withQuery(handle,'fixture-provisioner',async db=>{
      await db.query('CREATE ROLE gewu_cloud_schedule_reader NOLOGIN');
      for(const file of ['20260823-zzzzz-course-lifecycle.sql','20260827-course-lifecycle-qualified.sql','20260907-teacher-course-write-scope.sql','20260907-z-teacher-student-write-scope.sql','20260822-business-schedule-student-override.sql','20260824-supplemental-business-authority.sql'])await db.query(fs.readFileSync(path.join(__dirname,file),'utf8'));
      const migration=fs.readFileSync(path.join(__dirname,'20260909-course-delete-original-behavior.sql'),'utf8');await db.query(migration);await db.query(migration);
      await db.query(fs.readFileSync(path.join(__dirname,'20260907-zz-schedule-financial-snapshot.sql'),'utf8'));
      await db.query('GRANT USAGE ON SCHEMA business TO gewu_cloud_schedule_reader; GRANT SELECT ON business.students,business.courses,business.schedules,business.course_student_pricings,business.schedule_student_overrides TO gewu_cloud_schedule_reader');
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Own',false,now(),now()),('tenant-2','Other',false,now(),now())");
      await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher-1','tenant-1','One',false,now(),now()),('teacher-2','tenant-1','Other',false,now(),now())");
      await db.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student-1','tenant-1','One',false,false,now(),now()),('student-2','tenant-1','Other',false,false,now(),now())");
      for(const c of cases){
        await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) VALUES ($1,'tenant-1','2026 秋季学期 物理','物理',1,1,180,120,1,1,'teacher-1',true,false,'2026-09-01','2026-09-01')",[c.id]);
        await db.query("INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES ('tenant-1',$1,'student-1',180,120)",[c.id]);
        await db.query("INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,status,calculated_tuition,calculated_teacher_fee,room_display_snapshot,legacy_deleted,created_at,updated_at) VALUES ($1,'tenant-1',$1,'2026-09-08T01:00:00Z','2026-09-08T02:30:00Z',1,270,180,'原上课地址',$2,'2026-09-01','2026-09-01')",[c.id,c.archived]);
        await db.query("INSERT INTO business.schedule_student_overrides(tenant_id,schedule_id,student_id,attendance_status,tuition,teacher_fee) VALUES ('tenant-1',$1,'student-1',1,180,120)",[c.id]);
        await db.query("INSERT INTO business.payments(id,tenant_id,student_id,amount,payment_type,payment_date) VALUES ($1,'tenant-1','student-1',1200,1,'2026-09-08')",[c.id]);
        await db.query("INSERT INTO business.consumptions(id,tenant_id,student_id,schedule_id,hours,amount,consumption_date) VALUES ($1,'tenant-1','student-1',$1,1.5,180,'2026-09-08')",[c.id]);
      }
    });
    const snapshot=()=>withQuery(handle,'fixture-provisioner',async db=>{
      const state={};for(const table of ['courses','students','schedules','course_student_pricings','schedule_student_overrides','payments','consumptions'])state[table]=(await db.query(`SELECT * FROM business.${table} ORDER BY 1,2`)).rows;return state;
    });
    const read=(role,id,tenant='tenant-1')=>withQuery(handle,'fixture-provisioner',async db=>{
      await db.query('BEGIN; SET LOCAL ROLE gewu_cloud_schedule_reader');
      try{return applyScheduleCourseContext((await db.query(withScheduleCourseContextSql(readSql),[tenant,role,id])).rows[0].projection);}finally{await db.query('ROLLBACK');}
    });
    const before=await snapshot(),expected=structuredClone(before);
    for(const c of cases){
      assert.equal(oldDelete.call({data:expected,saveData(){},recordSyncChange(){}},c.id),true);
      await withQuery(handle,'writer',async db=>{
        const args=['tenant-1',c.id,'2026-09-01',c.role,c.role==='teacher'?'teacher-1':null];
        for(const role of ['teacher','student','visitor','family_member'])await assert.rejects(()=>db.query(removeSql,['tenant-1',c.id,args[2],role,role==='teacher'?'teacher-2':null]),denied);
        assert.equal((await db.query(removeSql,['tenant-2',c.id,args[2],'super_admin',null])).rows.length,0);
        assert.equal((await db.query(removeSql,[args[0],args[1],'2000-01-01',...args.slice(3)])).rows.length,0);
        assert.equal((await db.query(removeSql,args)).rows.length,1,'original course deletion must succeed with retained lessons');
        await assert.rejects(()=>db.query("UPDATE business.courses SET legacy_deleted=true"),denied);
      });
    }
    const after=await snapshot();
    assert.deepEqual({...after,courses:after.courses.filter(c=>!c.legacy_deleted)},expected,'only the course leaves active data; every related field is preserved');
    for(const old of before.courses){const row=after.courses.find(c=>c.id===old.id);assert(row.legacy_deleted);assert.notDeepEqual(row.updated_at,old.updated_at);assert.deepEqual({...row,legacy_deleted:false,updated_at:old.updated_at},old);}
    for(const [role,id] of [['teacher','teacher-1'],['student','student-1'],['manager',null]]){
      const result=await read(role,id);assert.equal(result.courses.length,0,'deleted courses must not return to course selectors');
      assert.deepEqual(result.schedules.map(s=>s.id),cases.filter(c=>!c.archived).map(c=>c.id).sort(),'retained lessons must remain in the authorized timetable');
      assert(result.schedules.every(s=>s.course_name==='物理'&&s.room_display_snapshot==='原上课地址'&&s.calculated_tuition===270&&s.calculated_teacher_fee===180));
      assert(!Object.hasOwn(result,'_scheduleCourseContext'),'internal course context must not escape the response');
      await withQuery(handle,'fixture-provisioner',async db=>{
        await db.query('BEGIN; SET LOCAL ROLE gewu_cloud_schedule_reader');
        try{
          const rows=(await db.query(listSql,['tenant-1',role==='manager'?'super_admin':role,id])).rows;
          assert.deepEqual(rows.map(s=>s.id),cases.filter(c=>!c.archived).map(c=>c.id).sort(),'schedule-list REST query must preserve the same authorized lessons');
          if(role==='student')assert(rows.every(s=>s.teacherFee===null),'student reads must not disclose teacher fees');
        }finally{await db.query('ROLLBACK');}
      });
    }
    for(const args of [['teacher','teacher-2'],['student','student-2'],['manager',null,'tenant-2']])assert.equal((await read(...args)).schedules.length,0,'no unrelated or cross-tenant lesson disclosure');
    await withQuery(handle,'verifier',db=>assert.rejects(()=>db.query(removeSql,['tenant-1',cases[0].id,'2026-09-01','super_admin',null]),denied));
  }finally{await runtime.disposeHandle(handle).catch(()=>{});await runtime.stop().catch(()=>{});}
  console.log('original course deletion, retained history and authorized timetable PostgreSQL parity passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
