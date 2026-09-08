'use strict';
// UTF-8: a course confirmation must not consume an unconfirmed lesson's version baseline.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const { createBusinessCourseLifecycleMutations } = require('../src/businessCourseLifecycleMutationService');
const { createBusinessScheduleUpdate } = require('../src/businessScheduleMutationService');
// UTF-8: all prior course validation, field updates, roster handling and version checks stay byte-equivalent after whitespace/comments.
const definition = file => fs.readFileSync(path.join(__dirname, file), 'utf8').match(/CREATE OR REPLACE FUNCTION business\.vnext_update_course_record_v1[\s\S]*?\$\$;/)[0];
const normalize = text => text.replace(/^\s*--.*$/gm, '').replace(/\s+/g, ' ').trim();
const oldDefinition = definition('20260827-course-lifecycle-qualified.sql');
const withoutImplicitLessonWrite = oldDefinition.replace(/  UPDATE business\.schedules AS schedule_record SET[^;]+;/, '');
assert.notEqual(withoutImplicitLessonWrite, oldDefinition);
assert.equal(normalize(definition('20260908-course-address-confirmation.sql')), normalize(withoutImplicitLessonWrite),
  'the forward migration must only remove the implicit lesson write, not redesign course behavior');
(async () => {
  const runtime = createDisposablePg17Runtime(); await runtime.start(); const handle = await runtime.createIsolatedHandle();
  try {
    const admission = { appliedAt: '2026-09-08T00:00:00.000Z', appliedBy: 'course-address-confirmation-test' };
    await createVNextPg17CatalogBoundary(runtime).apply(handle, admission);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, admission);
    await withQuery(handle, 'fixture-provisioner', async db => {
      for (const file of ['20260823-zzzz-room-lifecycle.sql', '20260823-zzzzz-course-lifecycle.sql', '20260827-course-lifecycle-qualified.sql',
        '20260824-schedule-lifecycle.sql', '20260822-business-schedule-student-override.sql', '20260901-business-schedule-update-lifecycle.sql',
        '20260907-teacher-course-write-scope.sql', '20260907-teacher-schedule-write-scope.sql', '20260907-z-teacher-student-write-scope.sql',
        '20260907-zz-schedule-financial-snapshot.sql', '20260908-course-address-confirmation.sql',
        '20260908-course-address-confirmation.sql', '20260908-created-room-visibility.sql']) await db.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant','Tenant',false,now(),now()),('foreign','Foreign',false,now(),now())");
      await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher','tenant','Teacher',false,now(),now()),('foreign-teacher','foreign','Foreign',false,now(),now())");
      await db.query("INSERT INTO business.students(id,tenant_id,name,created_by_teacher_id,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student','tenant','Student','teacher',false,false,now(),now())");
      await db.query("INSERT INTO business.rooms(id,tenant_id,name,created_by_teacher_id,legacy_deleted,created_at,updated_at) VALUES ('legacy','tenant','Legacy',NULL,false,now(),now()),('deleted','tenant','Deleted','teacher',true,now(),now()),('foreign-room','foreign','Foreign','foreign-teacher',false,now(),now())");
    });
    await withQuery(handle, 'writer', async db => {
      for (const [id, name] of [['old', 'Old address'], ['new', 'New address']]) {
        await db.query('SELECT * FROM business.vnext_create_scoped_room($1,$2,$3,NULL,$4,$5)', ['tenant', id, name, 'teacher', 'teacher']);
      }
      await assert.rejects(() => db.query("SELECT * FROM business.vnext_create_scoped_room('tenant','duplicate','Old address',NULL,'teacher','teacher')"), error => error.code === '23505');
      await assert.rejects(() => db.query("SELECT * FROM business.vnext_create_scoped_room('foreign','forged','Forged',NULL,'teacher','teacher')"), error => error.code === '42501');
    });
    // UTF-8: execute the actual runtime room projection with no referencing courses.
    const roomLine = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8').split(/\r?\n/).find(line => line.includes("\"'rooms',COALESCE") && line.includes('scoped_courses'));
    assert(roomLine);
    const roomExpression = new Function('return ' + roomLine.trim().replace(/,$/, ''))().replace(/,$/, '');
    const readRooms = (role, teacher) => withQuery(handle, 'fixture-provisioner', async db => (await db.query(
      `WITH scoped_courses AS (SELECT $3::text AS legacy_room_id WHERE false) SELECT jsonb_build_object(${roomExpression}) AS result`,
      ['tenant', role, teacher])).rows[0].result.rooms);
    assert.deepEqual((await readRooms('teacher', 'teacher')).map(r => r.id), ['new', 'old'], 'created addresses must remain selectable without a current course reference');
    assert.deepEqual(await readRooms('teacher', 'other-teacher'), [], 'unrelated teachers must not gain address access');
    assert.deepEqual(await readRooms('student', 'teacher'), [], 'creator scope must not leak to student role');
    assert.deepEqual((await readRooms('manager', null)).map(r => r.id), ['legacy', 'new', 'old'], 'tenant and deletion filters still apply to managers');
    await withQuery(handle, 'fixture-provisioner', async db => {
      const owners = (await db.query("SELECT id,created_by_teacher_id FROM business.rooms WHERE tenant_id='tenant' AND legacy_deleted=false ORDER BY id")).rows;
      assert.deepEqual(owners, [{id:'legacy',created_by_teacher_id:null},{id:'new',created_by_teacher_id:'teacher'},{id:'old',created_by_teacher_id:'teacher'}]);
    });
    const read = () => withQuery(handle, 'fixture-provisioner', async db => (await db.query('SELECT to_jsonb(s) AS record FROM business.schedules s ORDER BY id')).rows.map(r => r.record));
    for (const role of ['teacher', 'super_admin']) {
      const actorScope = { role, teacherId: role === 'teacher' ? 'teacher' : null };
      const courseId = 'course-' + role, scheduleId = 'schedule-' + role;
      const input = { actorScope, tenantId: 'tenant', courseId, name: 'Physics', displayName: 'Physics', year: 2026, semester: 'autumn',
        type: 1, sourceType: 1, institutionId: null, priceTuition: 180, priceTeacher: 120, billingUnit: 1, teacherFeeMode: 1,
        roomId: 'old', roomName: 'ignored', teacherId: 'teacher', teacherName: 'ignored', active: true, defaultDurationMinutes: 90,
        notes: 'Course notes', pricings: [{ studentId: 'student', tuition: 180, teacherFee: 120 }] };
      let course, scheduleVersion;
      await withQuery(handle, 'writer', async db => {
        course = await createBusinessCourseLifecycleMutations(db).create(input);
        scheduleVersion = (await db.query("SELECT updated_at FROM business.vnext_create_scoped_schedule($1,$2,$3,'2026-09-08T02:00:00Z','2026-09-08T03:30:00Z',NULL,1,'Old address',1,270,180,'Lesson notes',$4::jsonb,$5,$6,$7::jsonb)",
          ['tenant', scheduleId, courseId, JSON.stringify([{ student_id: 'student', attendance_status: 1, tuition: 180, teacher_fee: 120 }]), role, actorScope.teacherId,
            JSON.stringify({ billingUnit: 1, teacherFeeMode: 1, teacherId: 'teacher', teacherName: 'Teacher' })])).rows[0].updated_at.toISOString();
      });
      const before = await read();
      await withQuery(handle, 'writer', async db => {
        const service = createBusinessCourseLifecycleMutations(db);
        course = await service.update({ ...input, roomId: 'new', expectedUpdatedAt: course.updatedAt }); assert(course);
        assert.deepEqual(await read(), before, 'course update must not change linked lesson addresses, versions or any other snapshots');
        course = await service.update({ ...input, roomId: 'new', notes: 'Only course notes changed', expectedUpdatedAt: course.updatedAt }); assert(course);
        assert.deepEqual(await read(), before, 'even a same-address course save must not bump lesson versions');
        assert.equal(await service.update({ ...input, expectedUpdatedAt: '2000-01-01T00:00:00Z' }), null);
        assert.deepEqual(await read(), before);
        const updated = await createBusinessScheduleUpdate(db)({ actorScope, tenantId: 'tenant', scheduleId, expectedUpdatedAt: scheduleVersion,
          courseId, startAt: '2026-09-08T02:00:00Z', endAt: '2026-09-08T03:30:00Z', status: 1, roomDisplay: 'New address', serviceType: 1,
          tuition: 270, teacherFee: 180, notes: 'Lesson notes', pricings: null, financialSnapshot: null });
        assert(updated, 'the unchanged pre-course baseline must remain valid for explicit lesson confirmation');
        await assert.rejects(() => db.query("UPDATE business.schedules SET room_display_snapshot='bypass'"), error => error.code === '42501');
      });
      const after = await read();
      assert.deepEqual((await readRooms('teacher', 'teacher')).map(r => r.id), ['new', 'old'], 'moving a course away must not hide the original address');
      for (const original of before) {
        const actual = after.find(r => r.id === original.id);
        if (original.id === scheduleId) {
          assert.equal(actual.room_display_snapshot, 'New address');
          assert.deepEqual({ ...actual, room_display_snapshot: original.room_display_snapshot, updated_at: original.updated_at }, original);
        } else assert.deepEqual(actual, original, 'other lessons must remain untouched');
      }
    }
  } finally { await runtime.disposeHandle(handle).catch(() => {}); await runtime.stop().catch(() => {}); }
  console.log('course/schedule separate confirmation PostgreSQL checks passed for teacher and super admin');
})().catch(error => { console.error(error); process.exitCode = 1; });
