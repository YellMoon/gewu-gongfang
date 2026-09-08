'use strict';
// UTF-8: execute the unchanged institution REST service's PostgreSQL functions.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const APPLY={appliedAt:'2026-09-08T00:00:00.000Z',appliedBy:'institution-billing-test'};
const marker='机构课程费用专用学生';
async function confirmedHttpRoundTrip(writer,admin){
 const {createCloudBusinessApp}=require('../src/app');
 const {createBusinessFoundationLifecycleMutations}=require('../src/businessFoundationLifecycleMutationService');
 const {createDesktopIdentityClient}=await import('../../src/services/desktopIdentityClient.mjs');
 const {createDesktopCloudBusinessDraftAdapter}=await import('../../src/services/desktopCloudBusinessDraft.mjs');
 const {createDesktopAuthorityClient}=await import('../../src/services/desktopAuthorityClient.mjs');
 const {createDesktopCommandOutbox}=await import('../../src/services/desktopCommandOutbox.mjs');
 const query=(sql,values)=>writer(db=>db.query(sql,values));
 let role='super_admin';
 const app=createCloudBusinessApp({query,businessTenantId:'tenant',businessFoundationLifecycleMutations:createBusinessFoundationLifecycleMutations({query}),
  desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async()=>({roles:[role]})}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  let storage='',sequence=0,requests=0;
  const outbox=createDesktopCommandOutbox({store:{read:async()=>storage,write:async x=>{storage=x;}},
   codec:{seal:async x=>JSON.stringify(x),open:async x=>JSON.parse(x)},createId:()=>`institution-draft-${++sequence}`,now:()=> '2026-09-08T00:00:00.000Z'});
  const cloudClient=createDesktopIdentityClient({desktopIdentity:{status:async()=>({})},fetchImpl:(...args)=>{requests++;return fetch(...args);}});
  const adapter=createDesktopCloudBusinessDraftAdapter({cloudClient,baseUrl:`http://127.0.0.1:${server.address().port}`,sha256:x=>require('node:crypto').createHash('sha256').update(x).digest('hex')});
  const client=createDesktopAuthorityClient({outbox,createCloudBusinessCommand:adapter.createCommand,submitCloudBusiness:adapter.submit});
  const read=()=>admin(async db=>(await db.query("SELECT i.updated_at,i.name,s.id AS student_id,s.name AS student_name FROM business.institutions i JOIN business.institution_billing_students b ON b.tenant_id=i.tenant_id AND b.institution_id=i.id JOIN business.students s ON s.tenant_id=b.tenant_id AND s.id=b.student_id WHERE i.id='http-inst'")).rows[0]);
  const draft=await client.appendDraft({type:'institution.create.v1',payload:{record:{id:'http-inst',name:'HTTP机构',revenue_share:30}}});
  const session={sessionToken:'eyJ2IjoxfQ.signature'};
  assert.equal(await client.submit(draft.id,session),undefined);assert.equal(requests,0);assert.equal(await read(),undefined);
  assert.equal((await client.confirmAndSubmit(draft.id,session)).transportUsed,'cloud-business-authority');assert.equal(requests,1);
  let row=await read();assert.equal(row.student_id,'institution-student-http-inst');assert.equal(row.student_name,'HTTP机构学生');
  const update=await client.appendDraft({type:'institution.update.v1',payload:{id:'http-inst',expectedVersion:row.updated_at.toISOString(),changes:{name:'HTTP改名',revenue_share:30}}});
  assert.equal(await client.submit(update.id,session),undefined);assert.equal(requests,1);assert.equal((await read()).student_name,row.student_name);
  await client.confirmAndSubmit(update.id,session);assert.equal(requests,2);row=await read();assert.equal(row.student_name,'HTTP改名学生');
  for(const id of [draft.id,update.id])assert.equal((await outbox.get(id)).status,'completed');
  for(const deniedRole of ['visitor','student']){
   role=deniedRole;const denied=await client.appendDraft({type:'institution.create.v1',payload:{record:{id:'denied-'+role,name:'Denied',revenue_share:30}}});
   assert.equal((await client.confirmAndSubmit(denied.id,session)).rejected,true);
   assert.equal((await outbox.get(denied.id)).status,'conflict');
  }
  await admin(async db=>assert.equal((await db.query("SELECT id FROM business.institutions WHERE id IN ('denied-visitor','denied-student')")).rows.length,0));
  assert(!storage.includes(session.sessionToken));
 }finally{await new Promise(resolve=>server.close(resolve));}
}
(async()=>{
 const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();
 const admin=work=>withVNextPg17SyntheticQuery(handle,'fixture-provisioner',work);
 const writer=work=>withVNextPg17SyntheticQuery(handle,'writer',work);
 const create=(db,id,name)=>db.query('SELECT * FROM business.vnext_create_institution_v1($1,$2,$3,NULL,NULL,30,NULL)',['tenant',id,name]);
 const rename=(db,id,version,name)=>db.query('SELECT * FROM business.vnext_update_institution_v1($1,$2,$3::timestamptz,$4,NULL,NULL,30,NULL)',['tenant',id,version,name]);
 const snapshot=()=>admin(async db=>({institutions:(await db.query('SELECT * FROM business.institutions ORDER BY id')).rows,students:(await db.query('SELECT * FROM business.students ORDER BY id')).rows}));
 try{
  await createVNextPg17CatalogBoundary(runtime).apply(handle,APPLY);await createBusinessFoundationCatalogBoundary(runtime).apply(handle,APPLY);
  await admin(async db=>{
   await db.query('CREATE ROLE gewu_cloud_schedule_reader');
   for(const file of ['20260823-student-contact-directory.sql','20260825-business-student-contact-unbind.sql','20260823-zz-student-lifecycle.sql','20260901-student-contact-phone-required.sql','20260907-student-school-registration.sql','20260907-z-teacher-student-write-scope.sql','20260908-student-source-classification.sql'])
    await db.query(fs.readFileSync(path.join(__dirname,file),'utf8'));
   await db.query(fs.readFileSync(path.join(__dirname,'20260824-foundation-lifecycle.sql'),'utf8'));
   await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant','Tenant',false,now(),now())");
   // UTF-8: match the existing REST timestamp's millisecond precision.
   await db.query("INSERT INTO business.institutions(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('legacy','tenant','旧机构',false,date_trunc('milliseconds',now()),date_trunc('milliseconds',now()))");
   await db.query("INSERT INTO business.students(id,tenant_id,name,institution_id,legacy_source_type,legacy_is_institution_student,notes,legacy_deleted,created_at,updated_at) VALUES ('legacy-managed','tenant','旧机构学生','legacy',2,true,$1,false,now(),now()),('ordinary','tenant','普通学生','legacy',2,true,'ordinary historical flag must not control renaming',false,now(),now())",[marker]);
  });
  const historical=await snapshot();
  const migration=path.join(__dirname,'20260908-z-institution-billing-student.sql');
  await admin(db=>db.query(fs.readFileSync(migration,'utf8')));
  await admin(db=>db.query(fs.readFileSync(path.join(__dirname,'20260908-zz-institution-billing-projection.sql'),'utf8')));
  assert.deepEqual(await snapshot(),historical,'install must not rewrite historical records');
  let version=(await writer(db=>create(db,'new','新机构'))).rows[0].updated_at.toISOString();
  let current=await snapshot();
  assert.equal(current.students.filter(s=>s.institution_id==='new').length,1,'institution creation must atomically create its billing student');
  const managed=current.students.find(s=>s.institution_id==='new');
  assert.equal(Number(managed.legacy_balance_hours),0);assert.equal(Number(managed.legacy_balance_money),0);
  assert.equal(managed.id,'institution-student-new');assert.equal(managed.name,'新机构学生');assert.equal(managed.legacy_is_institution_student,true);
  const renamed=await writer(db=>rename(db,'new',version,'新名称'));version=renamed.rows[0].updated_at.toISOString();
  current=await snapshot();assert.equal(current.students.find(s=>s.id===managed.id).name,'新名称学生');
  const unchanged=await snapshot();
  assert.equal((await writer(db=>rename(db,'new','2000-01-01T00:00:00Z','旧版本'))).rows.length,0);assert.deepEqual(await snapshot(),unchanged);
  const legacy=historical.institutions[0];
  assert.equal((await writer(db=>rename(db,'legacy',legacy.updated_at.toISOString(),'旧机构新名'))).rows.length,1);
  current=await snapshot();assert.equal(current.students.find(s=>s.id==='legacy-managed').name,'旧机构新名学生');
  assert.deepEqual(current.students.find(s=>s.id==='ordinary'),historical.students.find(s=>s.id==='ordinary'),'ordinary institution pupil must remain byte-for-byte unchanged');
  await admin(async db=>{
   await db.query("CREATE FUNCTION business.test_fail_billing() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name='失败学生' THEN RAISE EXCEPTION 'injected child failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail_billing BEFORE INSERT OR UPDATE ON business.students FOR EACH ROW EXECUTE FUNCTION business.test_fail_billing()");
  });
  const beforeFailure=await snapshot();
  await writer(async db=>{
   await assert.rejects(()=>create(db,'failed','失败'),e=>e.message.includes('injected child failure'));
   await assert.rejects(()=>rename(db,'new',version,'失败'),e=>e.message.includes('injected child failure'));
  });
  assert.deepEqual(await snapshot(),beforeFailure,'child failure must roll back parent and child');
  await writer(async db=>{await db.query('BEGIN');await create(db,'rolled-back','撤销机构');await db.query('ROLLBACK');});
  assert.deepEqual(await snapshot(),beforeFailure);
  const concurrent=await Promise.all(['并发一','并发二'].map(name=>writer(db=>rename(db,'new',version,name))));
  assert.deepEqual(concurrent.map(result=>result.rows.length).sort(),[0,1]);
  current=await snapshot();assert.equal(current.students.find(s=>s.id===managed.id).name,current.institutions.find(i=>i.id==='new').name+'学生');
  await admin(async db=>{
   const links=(await db.query('SELECT institution_id,student_id FROM business.institution_billing_students ORDER BY institution_id')).rows;
   assert.deepEqual(links,[{institution_id:'legacy',student_id:'legacy-managed'},{institution_id:'new',student_id:managed.id}]);
  });
  await withVNextPg17SyntheticQuery(handle,'verifier',async db=>assert.rejects(()=>create(db,'denied','Denied'),e=>e.code==='42501'));
  await writer(async db=>assert.rejects(()=>db.query("DELETE FROM business.institution_billing_students WHERE institution_id='new'"),e=>e.code==='42501'));
  // UTF-8: link insertion failing after student INSERT must roll back both.
  await admin(async db=>db.query("CREATE FUNCTION business.test_fail_billing_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.institution_id='link-failure' THEN RAISE EXCEPTION 'injected link failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail_billing_link BEFORE INSERT ON business.institution_billing_students FOR EACH ROW EXECUTE FUNCTION business.test_fail_billing_link()"));
  const beforeLinkFailure=await snapshot();
  await writer(db=>assert.rejects(()=>create(db,'link-failure','关联失败'),e=>e.message.includes('injected link failure')));
  assert.deepEqual(await snapshot(),beforeLinkFailure);
  await admin(async db=>{
   await db.query("UPDATE business.students SET notes='changed note, same canonical owner' WHERE id=$1",[managed.id]);
   await db.query("INSERT INTO business.institutions(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('ambiguous','tenant','Ambiguous',false,date_trunc('milliseconds',now()),date_trunc('milliseconds',now()))");
   await db.query("INSERT INTO business.students(id,tenant_id,name,institution_id,legacy_source_type,legacy_is_institution_student,notes,legacy_deleted,created_at,updated_at) VALUES ('candidate-a','tenant','A','ambiguous',2,true,$1,false,now(),now()),('candidate-b','tenant','B','ambiguous',2,true,$1,false,now(),now())",[marker]);
  });
  const ambiguousBefore=await snapshot(),ambiguousVersion=ambiguousBefore.institutions.find(i=>i.id==='ambiguous').updated_at.toISOString();
  await writer(db=>assert.rejects(()=>rename(db,'ambiguous',ambiguousVersion,'不应改名'),e=>e.message==='VNEXT_INSTITUTION_BILLING_AMBIGUOUS'));
  assert.deepEqual(await snapshot(),ambiguousBefore);
  const newVersion=ambiguousBefore.institutions.find(i=>i.id==='new').updated_at.toISOString();
  assert.equal((await writer(db=>rename(db,'new',newVersion,'关联保留'))).rows.length,1);
  assert.equal((await snapshot()).students.find(s=>s.id===managed.id).name,'关联保留学生');
  // UTF-8: stable IDs cannot overwrite an unrelated record.
  await admin(db=>db.query("INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('institution-student-collision','tenant','Unrelated student',false,false,now(),now())"));
  const beforeCollision=await snapshot();
  await writer(db=>assert.rejects(()=>create(db,'collision','Collision'),e=>e.message==='VNEXT_INSTITUTION_BILLING_LINK_INVALID'));
  assert.deepEqual(await snapshot(),beforeCollision,'stable generated ID must never overwrite an unrelated record');
  await confirmedHttpRoundTrip(writer,admin);
  // UTF-8: execute the actual desktop projection fragments as its read-only role.
  const appSource=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
  const fragment=entity=>{
   const line=appSource.split('\n').filter(x=>x.includes(`\"'${entity}',COALESCE((SELECT jsonb_agg`)).at(-1);
   assert(line);return new Function('return '+line.trim().replace(/,$/,''))().replace(/,$/,'');
  };
  await admin(async db=>{
   await db.query('GRANT USAGE ON SCHEMA business TO gewu_cloud_schedule_reader; GRANT SELECT ON business.students,business.institutions TO gewu_cloud_schedule_reader');
   await db.query('SET ROLE gewu_cloud_schedule_reader');
   try{
    const payload=(await db.query('SELECT jsonb_build_object('+fragment('students')+','+fragment('institutions')+') AS payload',['tenant'])).rows[0].payload;
    const institution=payload.institutions.find(i=>i.id==='http-inst');
    assert.equal(institution.billing_student_id,'institution-student-http-inst');
    assert.equal(payload.students.find(s=>s.id===institution.billing_student_id).is_institution_student,true);
    await assert.rejects(()=>db.query("UPDATE business.institution_billing_students SET student_id='ordinary' WHERE institution_id='http-inst'"),e=>e.code==='42501');
   }finally{await db.query('RESET ROLE');}
  });
 }finally{try{await runtime.disposeHandle(handle);}finally{await runtime.stop();}}
 console.log('institution billing student atomic create, rename, conflict, rollback and privilege checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
