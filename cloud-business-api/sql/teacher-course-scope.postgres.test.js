'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const apply = { appliedAt: '2026-09-07T00:00:00.000Z', appliedBy: 'teacher-course-scope-test' };
const createSql = 'SELECT * FROM business.vnext_create_scoped_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23)';
const args = (id, teacher = 'teacher-1', student = 'student-1') => ['tenant-1', id, 'Physics', 2026, 'autumn', 'Physics', 1, 1, null, 100, 60, 1, 1, 'room-new', 'ignored', teacher, 'ignored', true, 90, null, JSON.stringify(student ? [{ student_id: student, tuition: 100, teacher_fee: 60 }] : []), 'teacher', 'teacher-1'];
const denied = error => error?.code === '42501';
(async () => {
  const runtime = createDisposablePg17Runtime(); await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, apply);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, apply);
    await withQuery(handle, 'fixture-provisioner', async db => {
      for (const file of ['20260823-zzzz-room-lifecycle.sql', '20260823-zzzzz-course-lifecycle.sql', '20260827-course-lifecycle-qualified.sql', '20260907-teacher-course-write-scope.sql']) await db.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      await db.query(fs.readFileSync(path.join(__dirname, '20260907-z-teacher-student-write-scope.sql'), 'utf8'));
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Tenant',false,now(),now()),('tenant-2','Other',false,now(),now())");
      await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher-1','tenant-1','Teacher one',false,now(),now()),('teacher-2','tenant-1','Teacher two',false,now(),now())");
      await db.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student-1','tenant-1','One',false,false,now(),now()),('student-2','tenant-1','Two',false,false,now(),now())");
      await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) SELECT id,'tenant-1',id,id,1,1,100,60,1,1,teacher,true,false,now(),now() FROM (VALUES ('course-1','teacher-1'),('course-2','teacher-2')) x(id,teacher)");
      await db.query("INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES ('tenant-1','course-1','student-1',100,60),('tenant-1','course-2','student-2',100,60)");
    });
    await withQuery(handle, 'writer', async db => {
      await db.query("SELECT * FROM business.vnext_create_scoped_room('tenant-1','room-new','New classroom',NULL,'teacher','teacher-1')");
      for (const input of [args('foreign-teacher', 'teacher-2'), args('foreign-student', 'teacher-1', 'student-2')]) await assert.rejects(() => db.query(createSql, input), denied);
      const cross = args('cross-tenant'); cross[0] = 'tenant-2'; await assert.rejects(() => db.query(createSql, cross), denied);
      const noProfile = args('no-profile'); noProfile[22] = null; await assert.rejects(() => db.query(createSql, noProfile), denied);
      const created = (await db.query(createSql, args('course-new'))).rows[0]; assert(created);
      const updateSql = 'SELECT * FROM business.vnext_update_scoped_course($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23,$24)';
      const values = args('course-new'); values.splice(2, 0, created.updated_at.toISOString());
      const updated = (await db.query(updateSql, values)).rows[0]; assert(updated);
      const stale = [...values]; stale[2] = '2000-01-01T00:00:00Z';
      assert.equal((await db.query(updateSql, stale)).rows.length, 0, 'a stale course version must not overwrite the record');
      values[1] = 'course-2'; await assert.rejects(() => db.query(updateSql, values), denied);
      const removeSql = 'SELECT * FROM business.vnext_delete_scoped_course($1,$2,$3::timestamptz,$4,$5)';
      await assert.rejects(() => db.query(removeSql, ['tenant-1','course-2',updated.updated_at,'teacher','teacher-1']), denied);
      assert.equal((await db.query(removeSql, ['tenant-1','course-new','2000-01-01T00:00:00Z','teacher','teacher-1'])).rows.length, 0);
      assert.equal((await db.query(removeSql, ['tenant-1','course-new',updated.updated_at,'teacher','teacher-1'])).rows.length, 1);
      await assert.rejects(() => db.query("UPDATE business.courses SET name='bypass'"), denied);
    });
    await withQuery(handle, 'writer', async writer => withQuery(handle, 'fixture-provisioner', async admin => {
      await writer.query('BEGIN');
      try {
        await writer.query(createSql, args('course-concurrent'));
        await admin.query("SET lock_timeout='150ms'");
        for (const sql of [
          "UPDATE business.teachers SET legacy_deleted=true WHERE id='teacher-1'",
          "UPDATE business.courses SET teacher_id='teacher-2' WHERE id='course-1'",
          "DELETE FROM business.course_student_pricings WHERE course_id='course-1' AND student_id='student-1'",
          "UPDATE business.students SET legacy_deleted=true WHERE id='student-1'",
        ]) await assert.rejects(() => admin.query(sql), error => error.code === '55P03');
        await writer.query('COMMIT');
        await admin.query("INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,status,calculated_tuition,calculated_teacher_fee,legacy_deleted,created_at,updated_at) VALUES ('reference-lesson','tenant-1','course-concurrent','2026-09-08T01:00:00Z','2026-09-08T02:00:00Z',1,100,60,false,now(),now())");
        await assert.rejects(() => writer.query("SELECT * FROM business.vnext_delete_scoped_course('tenant-1','course-concurrent',now(),'teacher','teacher-1')"), error => error.code === 'P0001' && error.message === 'VNEXT_BUSINESS_COURSE_REFERENCED');
        await admin.query("UPDATE business.teachers SET legacy_deleted=true WHERE id='teacher-1'");
        await assert.rejects(() => writer.query(createSql, args('revoked-teacher')), denied);
      } finally { await writer.query('ROLLBACK'); await admin.query('RESET lock_timeout'); }
    }));
    await withQuery(handle, 'verifier', db => assert.rejects(() => db.query(createSql, args('verifier-bypass')), denied));
    await withQuery(handle, 'fixture-provisioner', async db => {
      const result = (await db.query("SELECT name,room_name_snapshot,teacher_name_snapshot,legacy_deleted FROM business.courses WHERE id='course-new'")).rows[0];
      assert.deepEqual(result, { name: 'Physics', room_name_snapshot: 'New classroom', teacher_name_snapshot: 'Teacher one', legacy_deleted: true });
      assert.equal((await db.query("SELECT count(*)::int AS count FROM business.courses WHERE id IN ('foreign-teacher','foreign-student','cross-tenant','no-profile')")).rows[0].count, 0);
    });
  } finally { await runtime.disposeHandle(handle).catch(() => {}); await runtime.stop().catch(() => {}); }
  console.log('teacher course scope PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
