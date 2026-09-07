'use strict';
const assert = require('node:assert/strict');
const { STUDENT_SCHEDULE_TUITION_SQL } = require('../src/studentScheduleTuitionSql');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    const receipt = { appliedAt:'2026-09-07T00:00:00.000Z', appliedBy:'student-tuition-test' };
    await createVNextPg17CatalogBoundary(runtime).apply(handle,receipt);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle,receipt);
    await withVNextPg17SyntheticQuery(handle,'fixture-provisioner',async facade => {
      for (const file of ['20260824-schedule-lifecycle.sql','20260822-business-schedule-student-override.sql','20260901-business-schedule-update-lifecycle.sql','20260907-teacher-schedule-write-scope.sql','20260907-zz-schedule-financial-snapshot.sql']) {
        await facade.query(require('fs').readFileSync(require('path').join(__dirname,file),'utf8'));
      }
      await facade.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tuition-tenant','Test',false,now(),now())");
      await facade.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher','tuition-tenant','Teacher',false,now(),now())");
      await facade.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('self','tuition-tenant','Self',false,false,now(),now()),('other','tuition-tenant','Other',false,false,now(),now())");
      const cases = [
        {id:'hour',unit:1,minutes:90,total:270,rates:[180],expected:[270,null]},
        {id:'session',unit:2,minutes:90,total:180,rates:[180],expected:[180,null]},
        {id:'class',unit:1,minutes:90,total:720,rates:[180,300],expected:[270,450]},
        {id:'rounded',unit:1,minutes:91,total:0,rates:[180],expected:[273.6,null]},
        {id:'snapshot',unit:1,minutes:90,total:480,rates:[180,300],expected:[180,300]},
        {id:'equal-snapshot',unit:1,minutes:90,total:120,rates:[0,0],expected:[60,60]},
        {id:'leave',unit:1,minutes:90,total:450,rates:[180,300],status:4,expected:[0,450]},
        {id:'cancelled',unit:1,minutes:90,total:450,rates:[180,300],status:3,expected:[0,450]},
        {id:'override',unit:1,minutes:90,total:300,rates:[180,300],onlySelf:true,expected:[300,null]},
        {id:'zero',unit:1,minutes:90,total:0,rates:[0],expected:[0,null]},
        {id:'historical-unit',unit:1,snapshotUnit:2,minutes:90,total:0,rates:[180],expected:[180,null]},
      ];
      for(const c of cases){
        await facade.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,legacy_active,legacy_deleted,created_at,updated_at) VALUES ($1,'tuition-tenant','Test','Test',1,1,180,120,$2,1,'teacher',true,false,now(),now())",[c.id,c.unit]);
        for(let i=0;i<c.rates.length;i++) await facade.query("INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES ('tuition-tenant',$1,$2,$3,120)",[c.id,i?'other':'self',c.rates[i]]);
        await facade.query("INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,status,calculated_tuition,calculated_teacher_fee,legacy_deleted,created_at,updated_at) VALUES ($1,'tuition-tenant',$1,'2026-09-07T06:00:00Z'::timestamptz,'2026-09-07T06:00:00Z'::timestamptz+$2*interval '1 minute',1,$3,180,false,now(),now())",[c.id,c.minutes,c.total]);
        if(c.snapshotUnit) await facade.query("UPDATE business.schedules SET billing_unit=$2 WHERE id=$1",[c.id,c.snapshotUnit]);
        if(c.status || c.onlySelf){
          await facade.query("INSERT INTO business.schedule_student_overrides(tenant_id,schedule_id,student_id,attendance_status,tuition,teacher_fee) VALUES ('tuition-tenant',$1,'self',$2,$3,120)",[c.id,c.status||1,c.onlySelf?200:180]);
          if(!c.onlySelf) await facade.query("INSERT INTO business.schedule_student_overrides(tenant_id,schedule_id,student_id,attendance_status,tuition,teacher_fee) VALUES ('tuition-tenant',$1,'other',1,300,120)",[c.id]);
        }
        for(const [index,student] of ['self','other'].entries()){
          const result=await facade.query(`SELECT ${STUDENT_SCHEDULE_TUITION_SQL} AS tuition FROM business.schedules s WHERE s.tenant_id=$1 AND s.id=$2`,['tuition-tenant',c.id,student]);
          const actual=result.rows[0].tuition;
          assert.equal(actual===null?null:Number(actual),c.expected[index],`${c.id}/${student}`);
        }
      }
    });
  } finally {
    await runtime.disposeHandle(handle).catch(()=>{});
    await runtime.stop().catch(()=>{});
  }
  console.log('student-scoped schedule tuition PostgreSQL checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
