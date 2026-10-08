'use strict';
const assert = require('node:assert/strict');
const { withScheduleCourseContextSql, applyScheduleCourseContext } = require('../src/scheduleCoursePresentation');
const { buildCourseColorMap } = require('../../shared/courseColors');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    const receipt = { appliedAt: '2026-10-08T00:00:00.000Z', appliedBy: 'calendar-color-projection' };
    await createVNextPg17CatalogBoundary(runtime).apply(handle, receipt);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, receipt);
    await withQuery(handle, 'fixture-provisioner', async db => {
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('own','Own',false,now(),now()),('foreign','Foreign',false,now(),now())");
      for (const [id, tenant, room, deleted] of [['private','own','A private',false],['visible','own','Z visible',false],['deleted','own','0 deleted',true],['foreign','foreign','0 foreign',false]]) {
        await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,legacy_active,legacy_deleted,room_name_snapshot,created_at,updated_at) VALUES ($1,$2,$1,$1,1,1,100,60,1,1,true,$4,$3,now(),now())", [id, tenant, room, deleted]);
      }
      // Exact production context SQL, with a deliberately restricted course projection.
      const sql = withScheduleCourseContextSql("SELECT jsonb_build_object('courses',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'room_name',room_name_snapshot)) FROM business.courses WHERE tenant_id=$1 AND legacy_deleted=false AND id=ANY($2::text[])),'[]'::jsonb),'schedules','[]'::jsonb) AS projection");
      const globalCourses = [{id:'private',room_name:'A private'}, {id:'visible',room_name:'Z visible'}];
      const desktop = buildCourseColorMap(globalCourses, []);
      for (const ids of [['visible'], ['private','visible'], []]) {
        const raw = (await db.query(sql, ['own', ids])).rows[0].projection;
        const visible = applyScheduleCourseContext(raw);
        assert.equal(visible.courses.length, ids.length);
        for (const course of visible.courses) assert.equal(course.calendar_color, desktop[course.id]);
        assert(!Object.hasOwn(visible, '_calendarColorBasis'));
        assert(!Object.hasOwn(visible, '_scheduleCourseContext'));
        assert(!JSON.stringify(visible).includes('foreign') && !JSON.stringify(visible).includes('deleted'));
        if (!ids.includes('private')) assert(!JSON.stringify(visible).includes('private'));
      }
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('production calendar color SQL: subset parity, tenant/tombstone boundaries and private basis removal passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
