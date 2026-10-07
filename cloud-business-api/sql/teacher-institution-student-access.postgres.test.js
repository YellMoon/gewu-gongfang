'use strict';
const { createPgBusinessCommandFixture, canonicalFixtureContext } = require('./businessCommandFixture');
// Real PostgreSQL authorization and production projection SQL, using synthetic records only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCloudBusinessApp } = require('../src/app');
const { createBusinessCourseLifecycleMutations } = require('../src/businessCourseLifecycleMutationService');
const { createBusinessScheduleLifecycleMutations } = require('../src/businessScheduleLifecycleMutationService');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

(async () => {
  const pg = createDisposablePg17Runtime();
  await pg.start();
  const handle = await pg.createIsolatedHandle();
  const admin = action => withQuery(handle, 'fixture-provisioner', action);
  const writer = (sql, values) => withQuery(handle, 'writer', db => db.query(sql, values));
  const failures = [];
  const check = async (name, action) => {
    try { await action(); console.log('PASS ' + name); }
    catch (error) { failures.push(name + ': ' + error.message); console.error('FAIL ' + name + ': ' + error.message); }
  };
  let server;
  try {
    const receipt = { appliedAt: '2026-09-27T00:00:00.000Z', appliedBy: 'institution-student-access-test' };
    await createVNextPg17CatalogBoundary(pg).apply(handle, receipt);
    await createBusinessFoundationCatalogBoundary(pg).apply(handle, receipt);
    await admin(async db => {
      await db.query('CREATE ROLE gewu_cloud_schedule_reader NOLOGIN');
      for (const file of [
        '20260823-student-contact-directory.sql', '20260825-business-student-contact-unbind.sql',
        '20260823-zz-student-lifecycle.sql', '20260901-student-contact-phone-required.sql',
        '20260824-foundation-lifecycle.sql', '20260823-zzzz-room-lifecycle.sql',
        '20260823-zzzzz-course-lifecycle.sql', '20260827-course-lifecycle-qualified.sql',
        '20260824-schedule-lifecycle.sql', '20260822-business-schedule-student-override.sql', '20260901-business-schedule-update-lifecycle.sql', '20260907-teacher-course-write-scope.sql',
        '20260907-teacher-schedule-write-scope.sql', '20260907-z-teacher-student-write-scope.sql',
        '20260907-zz-schedule-financial-snapshot.sql', '20260908-z-institution-billing-student.sql',
        '20260909-retained-course-schedule-write.sql', '20260909-retained-student-schedule-write.sql',
      ]) await db.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      await require('./managedTeacherProfileFixture').applyManagedTeacherProfileFixture(db);
      for (const file of ['20260913-retained-teacher-profile.sql', '20260913-teacher-institution-scope.sql', '20260927-teacher-course-institution-student-scope.sql', '20260927-z-canonical-institution-student-scope.sql']) {
        await db.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      }
      await db.query('GRANT USAGE ON SCHEMA business TO gewu_cloud_schedule_reader; GRANT SELECT ON business.teachers,business.students,business.institutions,business.institution_billing_students,business.courses,business.schedules,business.course_student_pricings,business.schedule_student_overrides TO gewu_cloud_schedule_reader');
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('one','One',false,now(),now()),('two','Two',false,now(),now())");
      await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('owner','one','Owner',false,now(),now()),('other','one','Other',false,now(),now()),('managed','one','Managed',true,now(),now()),('foreign','two','Foreign',false,now(),now())");
      await db.query("UPDATE business.teachers SET created_by_teacher_id='owner',account_claimed=false WHERE id='managed'");
      await db.query("INSERT INTO business.rooms(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('room','one','Room',false,now(),now())");
      await db.query("INSERT INTO business.institutions(id,tenant_id,name,created_by_teacher_id,legacy_deleted,created_at,updated_at) VALUES ('related','one','Related',NULL,false,now(),now()),('owned','one','Owned','owner',false,now(),now()),('managed-inst','one','Managed institution',NULL,false,now(),now()),('unrelated','one','Unrelated',NULL,false,now(),now()),('deleted','one','Deleted',NULL,false,now(),now()),('foreign-inst','two','Foreign',NULL,false,now(),now())");
      await db.query("UPDATE business.institutions SET legacy_deleted=true WHERE id='deleted'");
      await db.query("INSERT INTO business.students(id,tenant_id,name,institution_id,legacy_is_institution_student,legacy_deleted,created_at,updated_at) SELECT 'institution-student-'||id,tenant_id,name||' billing',id,true,false,date_trunc('milliseconds',now()),date_trunc('milliseconds',now()) FROM business.institutions");
      await db.query("INSERT INTO business.institution_billing_students(tenant_id,institution_id,student_id) SELECT tenant_id,id,'institution-student-'||id FROM business.institutions");
      // Historical source=2 records can have a misleading flag. Only the durable mapping identifies billing students.
      await db.query("INSERT INTO business.students(id,tenant_id,name,institution_id,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('ordinary-flagged','one','Ordinary','related',true,false,now(),now()),('existing-enrolment','one','Existing','related',true,false,now(),now())");
      for (const [id, teacher, institution] of [['course','owner','related'], ['managed-course','managed','managed-inst'], ['deleted-course','owner','deleted']]) {
        await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,institution_id,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) VALUES ($1,'one',$1,$1,1,2,$3,100,60,1,1,$2,true,false,date_trunc('milliseconds',now()),date_trunc('milliseconds',now()))", [id, teacher, institution]);
      }
      await db.query("INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES ('one','course','existing-enrolment',100,60)");
    });
    let context = { roles: ['teacher'], profile: { type: 'teacher', id: 'owner' } };
    let projectionSql;
    const businessCommandWriter = await createPgBusinessCommandFixture(handle);
    const app = createCloudBusinessApp({businessCommandWriter, businessTenantId: 'one',
      query: async sql => { projectionSql = sql; return { rows: [{ projection: {
        students: [], studentContacts: [], teachers: [], courses: [], schedules: [], institutions: [],
        schools: [], rooms: [], assetRecords: [], assetCategories: [], payments: [], consumptions: [],
      } }] }; },
      desktopRegistration: { begin: async () => {}, register: async () => {}, sessionContext: async () => canonicalFixtureContext(context) },
      businessCourseLifecycleMutations: createBusinessCourseLifecycleMutations({ query: businessCommandWriter.query }),
      businessScheduleLifecycleMutations: createBusinessScheduleLifecycleMutations({ query: businessCommandWriter.query }),
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(baseUrl + '/api/business/desktop-projection', { headers: { authorization: 'Bearer desktop.test' } })).status, 200);
    const start = projectionSql.indexOf('WITH managed_teachers AS (');
    const end = projectionSql.indexOf('SELECT jsonb_build_object(', start);
    assert(start >= 0 && end > start);
    const readSql = projectionSql.slice(start, end) + 'SELECT id FROM scoped_students ORDER BY id';
    const read = (role = 'teacher', actor = 'owner', tenant = 'one') => admin(async db => {
      await db.query('BEGIN; SET LOCAL ROLE gewu_cloud_schedule_reader');
      try { return (await db.query(readSql, [tenant, role, actor])).rows.map(row => row.id); }
      finally { await db.query('ROLLBACK'); }
    });
    await check('projection uses only canonical billing identities and includes owned institutions before their first course', async () => {
      assert.deepEqual(await read(), ['existing-enrolment', 'institution-student-managed-inst', 'institution-student-owned', 'institution-student-related']);
    });
    await check('unrelated teachers, tenants and students cannot inherit institution-wide student access', async () => {
      assert.deepEqual(await read('teacher', 'other'), []);
      assert.deepEqual(await read('teacher', 'foreign'), []);
      assert.deepEqual(await read('student', 'existing-enrolment'), ['existing-enrolment']);
    });
    const studentGuard = async id => {
      const version = await admin(async db => (await db.query('SELECT updated_at FROM business.students WHERE id=$1', [id])).rows[0].updated_at);
      return withQuery(handle, 'writer', async db => {
        await db.query('BEGIN');
        try { return await db.query("SELECT * FROM business.vnext_delete_scoped_student('one',$1,$2,'teacher','owner')", [id, version]); }
        finally { await db.query('ROLLBACK'); }
      });
    };
    await check('course selection permission does not grant standalone student CRUD', async () => {
      await assert.rejects(() => studentGuard('institution-student-related'), e => e.code === '42501');
      await assert.rejects(() => studentGuard('ordinary-flagged'), e => e.code === '42501');
      await studentGuard('existing-enrolment');
    });
    const { createDesktopIdentityClient } = await import('../../src/services/desktopIdentityClient.mjs');
    const client = createDesktopIdentityClient({ desktopIdentity: { status: async () => ({}) }, fetchImpl: fetch });
    const courseInput = async studentId => ({ baseUrl, currentSession: { token: 'desktop.test' }, courseId: 'course',
      expectedUpdatedAt: await admin(async db => (await db.query("SELECT updated_at FROM business.courses WHERE id='course'")).rows[0].updated_at.toISOString()),
      name: 'Related course', year: 2026, semester: 'autumn', displayName: 'Related course', type: 1, sourceType: 2,
      institutionId: 'related', priceTuition: 100, priceTeacher: 60, billingUnit: 1, teacherFeeMode: 1,
      roomId: 'room', roomName: 'Room', teacherId: 'owner', teacherName: 'Owner', active: true, defaultDurationMinutes: 90,
      notes: null, pricings: [{ studentId, tuition: 100, teacherFee: 60 }],
    });
    await check('ordinary flagged, unrelated and cross-tenant students fail real course writes', async () => {
      for (const student of ['ordinary-flagged', 'institution-student-unrelated', 'institution-student-foreign-inst', 'institution-student-deleted']) {
        const input = await courseInput(student);
        await assert.rejects(() => client.updateCloudCourse(input), e => e.code === 'CLOUD_BUSINESS_ACCESS_DENIED');
      }
    });
    await check('schedule first attachment uses the same canonical scope', async () => {
      const input = { baseUrl, currentSession: { token: 'desktop.test' }, scheduleId: 'first-lesson', courseId: 'course',
        startAt: '2026-09-27T01:00:00.000Z', endAt: '2026-09-27T02:30:00.000Z', recurringRule: null,
        status: 1, roomDisplay: 'Room', serviceType: 1, tuition: 150, teacherFee: 90, notes: null,
        billingUnit: 1, teacherFeeMode: 1, teacherId: 'owner', teacherName: 'Owner',
        pricings: [{ studentId: 'ordinary-flagged', attendanceStatus: 1, tuition: 100, teacherFee: 60 }] };
      await assert.rejects(() => client.createCloudSchedule(input), e => e.code === 'CLOUD_BUSINESS_ACCESS_DENIED');
      input.pricings[0].studentId = 'institution-student-owned';
      assert.equal((await client.createCloudSchedule(input)).id, 'first-lesson');
    });
    await check('new access locks the managed profile, course and canonical link against concurrent changes', async () => {
      await withQuery(handle, 'writer', async db => {
        await db.query('BEGIN');
        try {
          await db.query("SELECT * FROM business.vnext_create_scoped_course('one','lock-probe','Probe',2026,'autumn','Probe',1,2,'managed-inst',100,60,1,1,'room','Room','owner','Owner',true,90,NULL,$1::jsonb,'teacher','owner')", [JSON.stringify([{ student_id: 'institution-student-managed-inst', tuition: 100, teacher_fee: 60 }])]);
          await admin(async other => {
            await other.query("SET lock_timeout='150ms'");
            try {
              for (const sql of ["UPDATE business.teachers SET account_claimed=true WHERE id='managed'", "UPDATE business.courses SET legacy_deleted=true WHERE id='managed-course'", "DELETE FROM business.institution_billing_students WHERE institution_id='managed-inst'"]) {
                await assert.rejects(() => other.query(sql), e => e.code === '55P03');
              }
            } finally { await other.query('RESET lock_timeout'); }
          });
        } finally { await db.query('ROLLBACK'); }
      });
      await admin(db => db.query("UPDATE business.teachers SET account_claimed=true WHERE id='managed'"));
      assert(!(await read()).includes('institution-student-managed-inst'));
      const deniedInput = await courseInput('institution-student-managed-inst');
      await assert.rejects(() => client.updateCloudCourse(deniedInput), e => e.code === 'CLOUD_BUSINESS_ACCESS_DENIED');
      await admin(db => db.query("UPDATE business.teachers SET account_claimed=false WHERE id='managed'"));
    });
    await check('canonical billing student can be attached for the first time through real HTTP and stale versions fail', async () => {
      const input = await courseInput('institution-student-related');
      assert.equal((await client.updateCloudCourse(input)).id, 'course');
      assert.deepEqual(await admin(async db => (await db.query("SELECT student_id FROM business.course_student_pricings WHERE course_id='course'")).rows), [{ student_id: 'institution-student-related' }]);
      await assert.rejects(() => client.updateCloudCourse(input), e => e.code === 'CLOUD_BUSINESS_COURSE_CONFLICT');
      context = { roles: ['teacher'], profile: { type: 'teacher', id: 'other' } };
      await assert.rejects(() => client.updateCloudCourse(input), e => e.code === 'CLOUD_BUSINESS_ACCESS_DENIED');
    });
    await check('first attachment and concurrent institution rename serialize without deadlock', async () => {
      await withQuery(handle, 'writer', async db => {
        await db.query("BEGIN; SET LOCAL statement_timeout='5s'");
        const pid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        let attachment;
        try {
          await admin(async other => {
            await other.query("BEGIN; SET LOCAL statement_timeout='5s'");
            try {
              const version = (await other.query("SELECT updated_at::text AS version FROM business.institutions WHERE id='managed-inst' FOR UPDATE")).rows[0].version;
              attachment = db.query("SELECT * FROM business.vnext_create_scoped_course('one','rename-probe','Probe',2026,'autumn','Probe',1,2,'managed-inst',100,60,1,1,'room','Room','owner','Owner',true,90,NULL,$1::jsonb,'teacher','owner')", [JSON.stringify([{ student_id: 'institution-student-managed-inst', tuition: 100, teacher_fee: 60 }])])
                .then(result => ({ result }), error => ({ error }));
              let blocked = false;
              for (let attempt = 0; attempt < 40 && !blocked; attempt++) {
                blocked = (await other.query('SELECT pg_backend_pid()=ANY(pg_blocking_pids($1)) AS blocked', [pid])).rows[0].blocked;
                if (!blocked) await other.query('SELECT pg_sleep(0.025)');
              }
              assert(blocked, 'attachment must actually wait for the institution lock');
              await other.query('SET SESSION AUTHORIZATION vnext_pg17_writer');
              const renamed = await other.query("SELECT * FROM business.vnext_update_scoped_institution('one','managed-inst',$1,'Concurrent rename',NULL,NULL,30,NULL,'super_admin',NULL)", [version]);
              assert.equal(renamed.rows.length, 1);
            } finally { await other.query('ROLLBACK; RESET SESSION AUTHORIZATION'); }
          });
          const outcome = await attachment;
          if (outcome.error) throw outcome.error;
          assert.equal(outcome.result.rows.length, 1);
        } finally {
          if (attachment) await attachment;
          await db.query('ROLLBACK');
        }
      });
    });
    await check('migration is repeatable, preserves business rows and keeps private helpers inaccessible to the writer', async () => {
      await admin(async db => {
        const snapshot = async () => {
          const result = {};
          for (const table of ['students', 'institutions', 'institution_billing_students', 'teachers', 'courses', 'course_student_pricings', 'schedules', 'schedule_student_overrides']) {
            result[table] = (await db.query(`SELECT to_jsonb(t) AS row FROM business.${table} t ORDER BY to_jsonb(t)::text`)).rows;
          }
          return result;
        };
        const before = await snapshot();
        const sql = fs.readFileSync(path.join(__dirname, '20260927-z-canonical-institution-student-scope.sql'), 'utf8');
        await db.query(sql); await db.query(sql);
        assert.deepEqual(await snapshot(), before);
        assert.equal((await db.query("SELECT has_function_privilege('vnext_pg17_writer','business.vnext_teacher_institution_billing_access(text,text,text)','EXECUTE') AS allowed")).rows[0].allowed, false);
      });
    });
    assert.deepEqual(failures, [], failures.join('\n'));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pg.disposeHandle(handle).catch(() => {});
    await pg.stop().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
