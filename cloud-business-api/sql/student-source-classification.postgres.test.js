'use strict';
// UTF-8: ordinary institution pupils are not the institution's synthetic billing record.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery} = require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary} = require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary} = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const APPLY={appliedAt:'2026-09-08T00:00:00.000Z',appliedBy:'student-source-classification-test'};
(async()=>{
  const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();
  const admin=work=>withVNextPg17SyntheticQuery(handle,'fixture-provisioner',work);
  const writer=work=>withVNextPg17SyntheticQuery(handle,'writer',work);
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle,APPLY);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle,APPLY);
    await admin(async db=>{
      await db.query('CREATE ROLE gewu_cloud_schedule_reader');
      for(const name of ['20260823-student-contact-directory.sql','20260823-zz-student-lifecycle.sql','20260824-foundation-lifecycle.sql'])await db.query(fs.readFileSync(path.join(__dirname,name),'utf8'));
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant','Tenant',false,now(),now())");
      await db.query("INSERT INTO business.institutions(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('inst','tenant','Institution',false,now(),now())");
      await db.query("INSERT INTO business.students(id,tenant_id,name,institution_id,legacy_source_type,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('historical-managed','tenant','Historical billing','inst',2,true,false,now(),now())");
      const before=(await db.query('SELECT * FROM business.students ORDER BY id')).rows;
      const acl=async()=> (await db.query("SELECT proowner,proacl,prosecdef,proconfig FROM pg_proc WHERE oid='business.vnext_create_student_record_v1(text,text,text,text,integer,text,text,text,text,integer,text,text,jsonb)'::regprocedure")).rows;
      const privileges=await acl();
      await db.query(fs.readFileSync(path.join(__dirname,'20260908-student-source-classification.sql'),'utf8'));
      assert.deepEqual(await acl(),privileges,'CREATE OR REPLACE must not broaden the existing function privileges');
      assert.deepEqual((await db.query('SELECT * FROM business.students ORDER BY id')).rows,before,'migration must not infer or rewrite historical flags');
    });
    const create=(db,id,source,contacts=[])=>db.query('SELECT * FROM business.vnext_create_student_record_v1($1,$2,$3,NULL,NULL,NULL,$4,NULL,NULL,$5,NULL,NULL,$6::jsonb)',
      ['tenant',id,'Ordinary pupil',source===2?'inst':null,source,JSON.stringify(contacts)]);
    for(const source of [1,2]){
      await writer(db=>create(db,'pupil-'+source,source,[{slot:1,relationship:'student',phone:'13100000000',wechat:null}]));
      await admin(async db=>{
        const row=(await db.query('SELECT legacy_source_type,legacy_is_institution_student FROM business.students WHERE id=$1',['pupil-'+source])).rows[0];
        assert.equal(row.legacy_source_type,source);
        assert.equal(row.legacy_is_institution_student,false,'ordinary institution source must not grant managed-student classification');
        assert.equal((await db.query('SELECT phone_value FROM business.student_contact_directory WHERE student_id=$1',['pupil-'+source])).rows[0].phone_value,'13100000000');
      });
    }
    await writer(async db=>{
      await assert.rejects(()=>create(db,'invalid-contact',2,[{slot:9,relationship:'student',phone:'13100000000'}]));
      await db.query('BEGIN');await create(db,'rolled-back',2);await db.query('ROLLBACK');
    });
    await admin(async db=>{
      assert.equal((await db.query("SELECT id FROM business.students WHERE id IN ('invalid-contact','rolled-back')")).rows.length,0);
      assert.equal((await db.query("SELECT legacy_is_institution_student FROM business.students WHERE id='historical-managed'")).rows[0].legacy_is_institution_student,true,'do not rewrite historical managed records');
    });
    await withVNextPg17SyntheticQuery(handle,'verifier',async db=>assert.rejects(()=>create(db,'denied',2),e=>e.code==='42501'));
    await admin(async db=>{
      await db.query(fs.readFileSync(path.join(__dirname,'20260907-z-teacher-student-write-scope.sql'),'utf8'));
      await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher','tenant','Teacher',false,now(),now())");
    });
    await writer(async db=>{
      await db.query("SELECT * FROM business.vnext_create_scoped_student('tenant','scoped-pupil','Pupil',NULL,NULL,NULL,'inst',NULL,NULL,2,NULL,'[]'::jsonb,'teacher','teacher')");
      await assert.rejects(()=>db.query("SELECT * FROM business.vnext_create_scoped_student('tenant','denied-pupil','Pupil',NULL,NULL,NULL,'inst',NULL,NULL,2,NULL,'[]'::jsonb,'visitor','teacher')"),e=>e.code==='42501');
    });
    await admin(async db=>{
      assert.deepEqual((await db.query("SELECT legacy_source_type,legacy_is_institution_student,created_by_teacher_id FROM business.students WHERE id='scoped-pupil'")).rows,
        [{legacy_source_type:2,legacy_is_institution_student:false,created_by_teacher_id:'teacher'}]);
      assert.equal((await db.query("SELECT id FROM business.students WHERE id='denied-pupil'")).rows.length,0);
    });
  } finally {await runtime.disposeHandle(handle).catch(()=>{});await runtime.stop().catch(()=>{});}
  console.log('ordinary institution student classification, contacts and rollback checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
