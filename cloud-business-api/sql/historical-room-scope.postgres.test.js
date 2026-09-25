'use strict';
// UTF-8: preserve proven historical use without inventing room creators or sharing unrelated addresses.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const { createBusinessCourseLifecycleMutations } = require('../src/businessCourseLifecycleMutationService');
const sql = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
(async () => {
  const runtime = createDisposablePg17Runtime(); await runtime.start(); const handle = await runtime.createIsolatedHandle();
  try {
    const admission = { appliedAt: '2026-09-08T00:00:00.000Z', appliedBy: 'historical-room-scope-test' };
    await createVNextPg17CatalogBoundary(runtime).apply(handle, admission);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, admission);
    await withQuery(handle, 'fixture-provisioner', async db => {
      await db.query('CREATE ROLE gewu_cloud_schedule_reader');
      for (const file of ['20260823-zzzz-room-lifecycle.sql','20260823-zzzzz-course-lifecycle.sql','20260827-course-lifecycle-qualified.sql',
        '20260907-teacher-course-write-scope.sql','20260907-z-teacher-student-write-scope.sql','20260908-course-address-confirmation.sql',
        '20260908-created-room-visibility.sql']) await db.query(sql(file));
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant','Tenant',false,now(),now())");
      await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('a','tenant','A',false,now(),now()),('b','tenant','B',false,now(),now())");
      await db.query("INSERT INTO business.rooms(id,tenant_id,name,legacy_deleted,created_at,updated_at) SELECT id,'tenant',id,false,now(),now() FROM (VALUES ('old'),('next'),('unrelated'),('unassigned')) AS x(id)");
      await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_room_id,room_name_snapshot,legacy_active,legacy_deleted,created_at,updated_at) SELECT id,'tenant',id,id,1,1,0,0,1,1,teacher,room,room,true,false,'2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z' FROM (VALUES ('legacy-course','a','old'),('other-course','b','unrelated')) AS x(id,teacher,room)");
      await db.query(sql('20260908-teacher-room-history.sql'));
    });
    const line = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8').split(/\r?\n/).find(line => line.includes("\"'rooms',COALESCE") && line.includes('scoped_courses'));
    const expression = new Function('return ' + line.trim().replace(/,$/, ''))().replace(/,$/, '');
    const read = (role = 'teacher', teacher = 'a') => withQuery(handle, 'fixture-provisioner', async db => (await db.query(
      `WITH scoped_courses AS (SELECT * FROM business.courses WHERE tenant_id=$1 AND teacher_id=$3 AND legacy_deleted=false)
       SELECT jsonb_build_object(${expression}) AS result`, ['tenant', role, teacher])).rows[0].result.rooms.map(r => r.id));
    assert.deepEqual(await read(), ['old']);
    const input = { actorScope: { role: 'teacher', teacherId: 'a' }, tenantId: 'tenant', courseId: 'legacy-course',
      expectedUpdatedAt: '2026-09-01T00:00:00Z', name: 'Physics', displayName: 'Physics', year: 2026, semester: 'autumn', type: 1, sourceType: 1,
      institutionId: null, priceTuition: 0, priceTeacher: 0, billingUnit: 1, teacherFeeMode: 1, roomId: 'next', roomName: 'ignored',
      teacherId: 'a', teacherName: 'ignored', active: true, defaultDurationMinutes: 90, notes: null, pricings: [] };
    await withQuery(handle, 'writer', async db => assert(await createBusinessCourseLifecycleMutations(db).update(input)));
    assert.deepEqual(await read(), ['next', 'old'], 'moving the last referencing course must not hide the historical address');
    assert.deepEqual(await read('teacher', 'b'), ['unrelated'], 'another teacher must not inherit the historical reference');
    await withQuery(handle, 'fixture-provisioner', async db => {
      assert.equal((await db.query('SELECT count(*)::int AS n FROM business.rooms WHERE created_by_teacher_id IS NOT NULL')).rows[0].n, 0,
        'a proven course relationship is not evidence that the teacher created the room');
    });
  } finally { await runtime.disposeHandle(handle).catch(() => {}); await runtime.stop().catch(() => {}); }
  console.log('historical room scope PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
