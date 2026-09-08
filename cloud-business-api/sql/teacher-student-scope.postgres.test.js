'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const receipt = { appliedAt: '2026-09-07T00:00:00.000Z', appliedBy: 'teacher-student-scope-test' };
const createSql = 'SELECT * FROM business.vnext_create_scoped_student($1,$2,$3,$4,NULL,NULL,NULL,NULL,NULL,1,NULL,$5::jsonb,$6,$7)';
const input = (id, teacher = 'teacher-1') => ['tenant-1', id, 'Student', 'School', '[]', 'teacher', teacher];
const denied = error => error.code === '42501';
(async () => {
  const runtime = createDisposablePg17Runtime(); await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, receipt);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, receipt);
    await withQuery(handle, 'fixture-provisioner', async db => {
      await db.query('CREATE ROLE gewu_cloud_schedule_reader');
      for (const file of ['20260823-student-contact-directory.sql', '20260823-business-student-update-source-fields.sql', '20260825-business-student-contact-unbind.sql', '20260823-zz-student-lifecycle.sql', '20260901-student-contact-phone-required.sql', '20260907-student-school-registration.sql', '20260823-zzzzz-course-lifecycle.sql', '20260827-course-lifecycle-qualified.sql', '20260824-schedule-lifecycle.sql', '20260822-business-schedule-student-override.sql', '20260901-business-schedule-update-lifecycle.sql', '20260907-teacher-schedule-write-scope.sql', '20260907-teacher-course-write-scope.sql']) {
        await db.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      }
      const migration = path.join(__dirname, '20260907-z-teacher-student-write-scope.sql');
      await db.query(fs.readFileSync(migration, 'utf8'));
      const activeReferences = fs.readFileSync(path.join(__dirname,'20260908-student-delete-active-references.sql'),'utf8');
      await db.query(activeReferences); await db.query(activeReferences);
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','One',false,now(),now()),('tenant-2','Two',false,now(),now())");
      await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher-1','tenant-1','One',false,now(),now()),('teacher-2','tenant-1','Two',false,now(),now()),('foreign','tenant-2','Foreign',false,now(),now()),('archived','tenant-1','Archived',true,now(),now())");
      await db.query("INSERT INTO business.rooms(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('room-1','tenant-1','Classroom',false,now(),now())");
    });
    let version;
    await withQuery(handle, 'writer', async db => {
      version = (await db.query(createSql, input('student-new'))).rows[0].updated_at.toISOString();
      for (const teacher of [null, '', 'foreign', 'archived']) await assert.rejects(() => db.query(createSql, input(`invalid-${teacher}`, teacher)), denied);
      const spoof = input('spoof'); spoof[5] = 'super_admin'; await assert.rejects(() => db.query(createSql, spoof), denied);
      const contactFailure = input('failed-contact'); contactFailure[4] = JSON.stringify([{ slot: 1, relationship: 'student', phone: null, wechat: 'invalid' }]);
      await assert.rejects(() => db.query(createSql, contactFailure), e => e.code === '23514');
      const update = (teacher, expected = version) => ['tenant-1', 'student-new', expected, 'Changed', 'Changed school', null, null, null, null, null, 1, null, '[]', 'teacher', teacher];
      const updateSql = 'SELECT * FROM business.vnext_update_scoped_student_record($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)';
      await assert.rejects(() => db.query(updateSql, update('teacher-2')), denied);
      assert.equal((await db.query(updateSql, update('teacher-1', '2000-01-01T00:00:00Z'))).rows.length, 0);
      version = (await db.query(updateSql, update('teacher-1'))).rows[0].updated_at.toISOString();
      const courseArgs = ['tenant-1','course-new','Physics',2026,'autumn','Physics',1,1,null,100,60,1,1,'room-1','Classroom','teacher-1','One',true,90,null,JSON.stringify([{student_id:'student-new',tuition:100,teacher_fee:60}]),'teacher','teacher-1'];
      const courseSql = 'SELECT * FROM business.vnext_create_scoped_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23)';
      await db.query(courseSql, courseArgs);
      const another = [...courseArgs]; another[1] = 'foreign-course'; another[15] = 'teacher-2'; another[22] = 'teacher-2';
      await assert.rejects(() => db.query(courseSql, another), denied);
      await db.query(createSql, input('trial-student'));
      await db.query("SELECT * FROM business.vnext_create_scoped_schedule('tenant-1','trial-schedule','course-new','2026-09-08T01:00:00Z','2026-09-08T02:00:00Z',NULL,1,'Classroom',1,100,60,NULL,$1::jsonb,'teacher','teacher-1')", [JSON.stringify([{student_id:'trial-student',attendance_status:1,tuition:100,teacher_fee:60}])]);
      const remove = "SELECT * FROM business.vnext_delete_scoped_student('tenant-1',$1,$2::timestamptz,'teacher',$3)";
      await assert.rejects(() => db.query(remove, ['student-new', version, 'teacher-2']), denied);
      await assert.rejects(() => db.query(remove, ['student-new', version, 'teacher-1']), e => e.message === 'VNEXT_BUSINESS_STUDENT_REFERENCED');
      const disposable = (await db.query(createSql, input('delete-student'))).rows[0];
      assert.equal((await db.query(remove, ['delete-student', disposable.updated_at, 'teacher-1'])).rows.length, 1);
      await assert.rejects(() => db.query("UPDATE business.students SET created_by_teacher_id='teacher-2' WHERE id='student-new'"), denied);
    });
    await withQuery(handle, 'fixture-provisioner', async db => {
      await db.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('shared-legacy','tenant-1','Legacy shared student',false,false,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')");
      await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) SELECT 'course-other',tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,'teacher-2',true,false,now(),now() FROM business.courses WHERE id='course-new'");
      await db.query("INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES ('tenant-1','course-new','shared-legacy',100,60),('tenant-1','course-other','shared-legacy',100,60)");
    });
    await withQuery(handle, 'writer', async db => {
      let expected = '2026-09-01T00:00:00Z';
      for (const teacher of ['teacher-1', 'teacher-2']) {
        const changed = await db.query("SELECT * FROM business.vnext_update_scoped_student('tenant-1','shared-legacy',$1::timestamptz,'Legacy shared student',NULL,NULL,NULL,NULL,NULL,NULL,1,NULL,'teacher',$2)", [expected, teacher]);
        expected = changed.rows[0].updated_at.toISOString();
      }
    });
    await withQuery(handle, 'fixture-provisioner', async db => {
      assert.deepEqual((await db.query("SELECT created_by_teacher_id FROM business.students WHERE id='student-new'")).rows, [{created_by_teacher_id:'teacher-1'}]);
      assert.equal((await db.query("SELECT id FROM business.students WHERE id='failed-contact'")).rows.length, 0);
      // Execute the application's actual scoped-student predicate, not a test-only policy.
      const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
      const line = source.split(/\r?\n/).find(x => x.includes("$2='manager' OR ($2='student' AND s.id=$3)"));
      const predicate = JSON.parse(line.trim().replace(/,$/, ''));
      const projection = `WITH scoped_courses AS (SELECT * FROM business.courses WHERE tenant_id=$1 AND teacher_id=$3 AND legacy_deleted=false), scoped_schedules AS (SELECT x.* FROM business.schedules x JOIN scoped_courses c ON c.id=x.course_id WHERE x.legacy_deleted=false) SELECT s.id FROM business.students s WHERE s.tenant_id=$1 AND s.legacy_deleted=false AND (${predicate}) ORDER BY s.id`;
      assert.deepEqual((await db.query(projection, ['tenant-1','teacher','teacher-1'])).rows.map(x=>x.id), ['shared-legacy','student-new','trial-student']);
      assert.deepEqual((await db.query(projection, ['tenant-1','teacher','teacher-2'])).rows, [{id:'shared-legacy'}]);
      assert.deepEqual((await db.query(projection, ['tenant-1','student','trial-student'])).rows, [{id:'trial-student'}]);
      assert.equal((await db.query("SELECT created_by_teacher_id FROM business.students WHERE id='shared-legacy'")).rows[0].created_by_teacher_id, null, 'existing shared students must not be claimed by the last editing teacher');
    });
    await withQuery(handle, 'verifier', async db => await assert.rejects(() => db.query(createSql, input('forbidden')), denied));
    await withQuery(handle, 'writer', async writer => withQuery(handle, 'fixture-provisioner', async admin => {
      await writer.query('BEGIN');
      try {
        await writer.query("SELECT * FROM business.vnext_update_scoped_student('tenant-1','student-new',$1::timestamptz,'Student','School',NULL,NULL,NULL,NULL,NULL,1,NULL,'teacher','teacher-1')", [version]);
        await admin.query("SET lock_timeout='150ms'");
        for (const query of ["UPDATE business.teachers SET legacy_deleted=true WHERE id='teacher-1'", "UPDATE business.students SET created_by_teacher_id='teacher-2' WHERE id='student-new'"]) {
          await assert.rejects(() => admin.query(query), e => e.code === '55P03');
        }
      } finally { await writer.query('ROLLBACK'); }
      await assert.rejects(() => admin.query("UPDATE business.students SET created_by_teacher_id='foreign' WHERE id='student-new'"), e => e.code === '23503');
    }));
    // The pre-scope cloud lifecycle already ignored tombstoned parents, but not merely completed courses.
    const referenceCases = ['teacher', 'super_admin'].flatMap(role => [
      {name:'old-course',courseDeleted:true,pricing:true,allowed:true},
      {name:'old-schedule',scheduleDeleted:true,allowed:true},
      {name:'inactive-course',pricing:true,inactive:true,allowed:false},
      {name:'active-schedule',scheduleDeleted:false,allowed:false},
      {name:'mixed',courseDeleted:true,pricing:true,scheduleDeleted:false,allowed:false},
    ].map(value => ({...value,role,id:'ref-'+role+'-'+value.name})));
    await withQuery(handle, 'fixture-provisioner', async db => {
      for (const c of referenceCases) {
        await db.query("INSERT INTO business.students(id,tenant_id,name,created_by_teacher_id,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ($1,'tenant-1',$1,'teacher-1',false,false,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')",[c.id]);
        await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) VALUES ($1,'tenant-1',$1,$1,1,1,100,60,1,1,'teacher-1',$2,$3,now(),now())",[c.id,!c.inactive,Boolean(c.courseDeleted)]);
        if(c.pricing) await db.query("INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES ('tenant-1',$1,$1,100,60)",[c.id]);
        if(c.scheduleDeleted!==undefined) {
          await db.query("INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,status,calculated_tuition,calculated_teacher_fee,legacy_deleted,created_at,updated_at) VALUES ($1,'tenant-1',$1,'2026-09-08T01:00:00Z','2026-09-08T02:00:00Z',1,100,60,$2,now(),now())",[c.id,c.scheduleDeleted]);
          await db.query("INSERT INTO business.schedule_student_overrides(tenant_id,schedule_id,student_id,attendance_status,tuition,teacher_fee) VALUES ('tenant-1',$1,$1,1,100,60)",[c.id]);
        }
      }
    });
    const referenceSnapshot=()=>withQuery(handle,'fixture-provisioner',async db=>{
      const snapshot={};
      for(const table of ['courses','schedules','course_student_pricings','schedule_student_overrides']) {
        snapshot[table]=(await db.query(`SELECT * FROM business.${table} ORDER BY 1,2,3`)).rows;
      }
      return snapshot;
    });
    const referencesBefore=await referenceSnapshot();
    const removeScoped='SELECT * FROM business.vnext_delete_scoped_student($1,$2,$3::timestamptz,$4,$5)';
    await withQuery(handle,'verifier',async db=>await assert.rejects(()=>db.query(removeScoped,['tenant-1',referenceCases[0].id,'2026-09-01T00:00:00Z','super_admin',null]),denied));
    await withQuery(handle,'writer',async db=>{
      for(const c of referenceCases) {
        const args=['tenant-1',c.id,'2026-09-01T00:00:00Z',c.role,c.role==='teacher'?'teacher-1':null];
        await assert.rejects(()=>db.query(removeScoped,['tenant-1',c.id,args[2],'teacher','teacher-2']),denied);
        assert.equal((await db.query(removeScoped,['tenant-2',c.id,args[2],'super_admin',null])).rows.length,0);
        assert.equal((await db.query(removeScoped,[...args.slice(0,2),'2000-01-01T00:00:00Z',...args.slice(3)])).rows.length,0);
        if(c.allowed) assert.equal((await db.query(removeScoped,args)).rows.length,1,`${c.role}/${c.name}: historical references must not block deletion`);
        else await assert.rejects(()=>db.query(removeScoped,args),e=>e.message==='VNEXT_BUSINESS_STUDENT_REFERENCED');
      }
    });
    assert.deepEqual(await referenceSnapshot(),referencesBefore,'student soft deletion must not remove or rewrite historical courses, schedules, rates or attendance');
    assert.deepEqual(require('../../config/release-compatibility.json').contracts.studentDeletionReferences.participants,['desktop','cloud_business']);
    await withQuery(handle,'fixture-provisioner',async db=>{
      for(const c of referenceCases) {
        const row=(await db.query('SELECT legacy_deleted,created_by_teacher_id,name,created_at,updated_at FROM business.students WHERE id=$1',[c.id])).rows[0];
        assert.equal(row.legacy_deleted,c.allowed); assert.equal(row.created_by_teacher_id,'teacher-1'); assert.equal(row.name,c.id);
        assert.equal(row.created_at.toISOString(),'2026-09-01T00:00:00.000Z');
        if(!c.allowed) assert.equal(row.updated_at.toISOString(),'2026-09-01T00:00:00.000Z');
      }
    });
  } finally { await runtime.disposeHandle(handle).catch(()=>{}); await runtime.stop().catch(()=>{}); }
  console.log('teacher student creation, visibility, course selection, mutation and privilege PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode=1; });
