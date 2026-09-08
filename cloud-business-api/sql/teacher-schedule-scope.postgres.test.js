'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const migration=fs.readFileSync(path.join(__dirname,'20260907-teacher-schedule-write-scope.sql'),'utf8');
const apply={appliedAt:'2026-09-07T00:00:00.000Z',appliedBy:'teacher-schedule-scope-test'};
const createSql='SELECT * FROM business.vnext_create_scoped_schedule($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)';
const createArgs=(id,course='course-1',student='student-1',role='teacher',teacher='teacher-1')=>['tenant-1',id,course,'2026-09-08T01:00:00Z','2026-09-08T02:00:00Z',null,1,'Room',1,100,50,null,JSON.stringify([{student_id:student,attendance_status:1,tuition:100,teacher_fee:50}]),role,teacher];
const denied=error=>error?.code==='42501';
(async()=>{
  const runtime=createDisposablePg17Runtime();
  await runtime.start();
  const handle=await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle,apply);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle,apply);
    await withQuery(handle,'fixture-provisioner',async db=>{
      for(const file of ['20260824-schedule-lifecycle.sql','20260822-business-schedule-student-override.sql','20260901-business-schedule-update-lifecycle.sql']) await db.query(fs.readFileSync(path.join(__dirname,file),'utf8'));
      await db.query(migration);
      await db.query(fs.readFileSync(path.join(__dirname,'20260907-z-teacher-student-write-scope.sql'),'utf8'));
      await db.query(fs.readFileSync(path.join(__dirname,'20260909-retained-course-schedule-write.sql'),'utf8'));
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Tenant',false,now(),now()),('tenant-2','Other tenant',false,now(),now())");
      await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher-1','tenant-1','One',false,now(),now()),('teacher-2','tenant-1','Two',false,now(),now())");
      await db.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student-1','tenant-1','One',false,false,now(),now()),('student-2','tenant-1','Two',false,false,now(),now()),('student-trial','tenant-1','Trial',false,false,now(),now())");
      await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) SELECT id,'tenant-1',id,id,1,1,100,50,1,1,teacher,true,false,now(),now() FROM (VALUES ('course-1','teacher-1'),('course-1b','teacher-1'),('course-2','teacher-2')) AS x(id,teacher)");
      await db.query("INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES ('tenant-1','course-1','student-1',100,50),('tenant-1','course-2','student-2',100,50)");
    });
    let version;
    await withQuery(handle,'writer',async db=>{
      for(const args of [createArgs('foreign-course','course-2'),createArgs('foreign-student','course-1','student-2'),createArgs('no-profile','course-1','student-1','teacher',null),createArgs('bad-role','course-1','student-1','student','teacher-1')]) await assert.rejects(()=>db.query(createSql,args),denied);
      const crossTenant=createArgs('cross-tenant');crossTenant[0]='tenant-2';
      await assert.rejects(()=>db.query(createSql,crossTenant),denied);
      const created=await db.query(createSql,createArgs('schedule-own'));
      assert.equal(created.rows.length,1);version=created.rows[0].updated_at.toISOString();
      // The administrator can admit a trial student to an existing schedule;
      // that student then belongs to the teacher's real read/write scope.
      await db.query(createSql,createArgs('trial-schedule','course-1','student-trial','super_admin',null));
      await db.query(createSql,createArgs('trial-followup','course-1b','student-trial'));
      const updateSql='SELECT * FROM business.vnext_update_scoped_schedule($1,$2,$3::timestamptz,$4,$5::timestamptz,$6::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)';
      const updateArgs=['tenant-1','schedule-own',version,'course-2','2026-09-08T03:00:00Z','2026-09-08T04:00:00Z',null,1,'Room',1,110,55,'changed','[]','teacher','teacher-1'];
      await assert.rejects(()=>db.query(updateSql,updateArgs),denied);
      updateArgs[3]='course-1b';
      const updated=await db.query(updateSql,updateArgs);
      assert.equal(updated.rows.length,1);version=updated.rows[0].updated_at.toISOString();
      const overrideSql='SELECT * FROM business.vnext_upsert_scoped_schedule_student($1,$2,$3,$4::timestamptz,$5,$6,$7,$8,$9)';
      await assert.rejects(()=>db.query(overrideSql,['tenant-1','schedule-own','student-2',version,1,100,50,'teacher','teacher-1']),denied);
      const override=await db.query(overrideSql,['tenant-1','schedule-own','student-1',version,4,100,50,'teacher','teacher-1']);
      assert.equal(override.rows.length,1);version=override.rows[0].updated_at.toISOString();
      const removeSql='SELECT * FROM business.vnext_delete_scoped_schedule($1,$2,$3::timestamptz,$4,$5)';
      await assert.rejects(()=>db.query(removeSql,['tenant-1','schedule-own',version,'teacher','teacher-2']),denied);
      assert.deepEqual((await db.query(removeSql,['tenant-1','schedule-own','2000-01-01T00:00:00Z','teacher','teacher-1'])).rows,[]);
      assert.equal((await db.query(removeSql,['tenant-1','schedule-own',version,'teacher','teacher-1'])).rows.length,1);
      await assert.rejects(()=>db.query("UPDATE business.schedules SET notes='bypass'"),denied);
    });
    await withQuery(handle,'fixture-provisioner',async db=>{
      assert.equal((await db.query("SELECT count(*)::int AS count FROM business.schedules WHERE id IN ('foreign-course','foreign-student','cross-tenant','no-profile','bad-role')")).rows[0].count,0);
      const row=(await db.query("SELECT legacy_deleted,course_id FROM business.schedules WHERE id='schedule-own'")).rows[0];
      assert.deepEqual(row,{legacy_deleted:true,course_id:'course-1b'});
    });
    await withQuery(handle,'verifier',db=>assert.rejects(()=>db.query(createSql,createArgs('verifier-bypass')),denied));
    // Actual concurrent connections: ownership, profile and enrolment cannot be
    // revoked between authorization and COMMIT. This is not a mock lock assertion.
    await withQuery(handle,'writer',async writer=>withQuery(handle,'fixture-provisioner',async admin=>{
      await writer.query('BEGIN');
      try {
        await writer.query(createSql,createArgs('concurrent-own'));
        await admin.query("SET lock_timeout='150ms'");
        for(const sql of [
          "UPDATE business.courses SET teacher_id='teacher-2' WHERE id='course-1'",
          "DELETE FROM business.course_student_pricings WHERE course_id='course-1' AND student_id='student-1'",
          "UPDATE business.students SET legacy_deleted=true WHERE id='student-1'",
          "UPDATE business.teachers SET legacy_deleted=true WHERE id='teacher-1'",
        ]) await assert.rejects(()=>admin.query(sql),error=>error?.code==='55P03');
        await writer.query('COMMIT');
        await admin.query("UPDATE business.courses SET teacher_id='teacher-2' WHERE id='course-1'");
        await assert.rejects(()=>writer.query(createSql,createArgs('revoked-course')),denied);
      } finally {await writer.query('ROLLBACK');await admin.query('RESET lock_timeout');}
    }));
  } finally {await runtime.disposeHandle(handle).catch(()=>{});await runtime.stop().catch(()=>{});}
  console.log('teacher schedule scope PostgreSQL checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
