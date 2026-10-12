'use strict';
// UTF-8: execute shipped commands and triggers against disposable PostgreSQL.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createQuestionAuthorityService}=require('../src/questionAuthorityService');
const {createCloudBusinessApp}=require('../src/app'); // UTF-8
const {stableJson}=require('../../shared/authorityProtocol');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const HASH='a'.repeat(64);
const doc=text=>({type:'doc',content:[{type:'paragraph',content:text?[{type:'text',text}]:[]}]});
(async()=>{
 const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();
 try{
  const receipt={appliedAt:'2026-10-12T00:00:00.000Z',appliedBy:'deduplication-test'};
  await createVNextPg17CatalogBoundary(runtime).apply(handle,receipt);await createBusinessFoundationCatalogBoundary(runtime).apply(handle,receipt);
  await withQuery(handle,'fixture-provisioner',async db=>{
   await db.query('CREATE ROLE gewu_cloud_schedule_reader');
   for(const file of ['20260822-storage-agent-tasks.sql','20260823-cloud-question-import-tasks.sql','20260823-cloud-question-authority.sql','20260823-question-import-media-objects.sql','20260823-cloud-question-command-receipts.sql','20260824-question-taxonomy-authority.sql','20260824-foundation-lifecycle.sql','20260823-student-contact-directory.sql','20260825-business-student-contact-unbind.sql','20260823-zz-student-lifecycle.sql','20260901-student-contact-phone-required.sql','20260907-student-school-registration.sql','20261010-question-difficulty-coefficient.sql','20261012-question-deduplication-school-alliances.sql']){
    await db.query(fs.readFileSync(path.join(__dirname,file),'utf8').replace('BEGIN;','BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;'));
   }
   await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant','Tenant',false,now(),now()),('other','Other',false,now(),now())");
   await db.query("INSERT INTO business.schools(id,tenant_id,name,legacy_count,legacy_deleted,created_at,updated_at,kind) VALUES ('school','tenant','甲校',0,false,now(),now(),'school'),('alliance','tenant','乙联盟',0,false,now(),now(),'alliance'),('foreign','other','Foreign',0,false,now(),now(),'school')");
   const transaction=async work=>{await db.query('BEGIN');try{const result=await work((sql,args)=>db.query(sql,args));await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}};
   const service=createQuestionAuthorityService({query:(sql,args)=>db.query(sql,args),transaction});
   const context={tenantId:'tenant',actor:{accountId:'teacher',roles:['teacher']}};
   const send=async(suffix,changes={})=>{
    const task='question_import_task_'+suffix,item='question_import_item_'+suffix;
    await db.query(`INSERT INTO business.question_import_tasks(task_id,tenant_id,account_id,idempotency_key,source_type,source_file_name,source_mime_type,source_sha256,source_size_bytes,metadata_json,request_hash,status,phase) VALUES ($1,'tenant','teacher',$1,'exam','source.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',$2,10,'{}',$2,'drafts_prepared','drafts_prepared')`,[task,HASH]);
    await db.query(`INSERT INTO business.question_import_items(item_id,import_task_id,item_index,content_hash,candidate_json,validation_json,media_manifest_json,status) VALUES ($1,$2,0,$3,'{"assets":[]}','{}','[]','draft_prepared')`,[item,task,HASH]);
    const record={id:'question-'+suffix,subject:'physics',type:'解答题',difficulty:3,content:'物体质量为2kg，求重力。',answer:'20N',analysis:'',options:[],has_formula:false,source:'',knowledge_point_ids:['node-a'],taxonomy_ids:{physics:['node-a']},...changes,import_task_id:task,import_item_id:item,import_item_index:0,import_content_hash:HASH};
    record.rich_content={type:'question-document',version:1,sections:{stem:doc(record.content),options:[],subQuestions:[],answer:doc(record.answer),analysis:doc(record.analysis)}};
    const type='question.create.v1',payload={record},command={commandId:'command-'+suffix,type,payload,payloadHash:crypto.createHash('sha256').update(stableJson({type,payload}),'utf8').digest('hex')};
    const result=await service.submitDesktopDraft({...context,command});
    assert.deepEqual(await service.submitDesktopDraft({...context,command}),result,'exact replay returns original receipt');
    return result;
   };
   const first=await send('lecture');assert.equal(first.result.id,'question-lecture');
   const second=await send('topic',{analysis:'由G=mg得到20N',knowledge_point_ids:['node-b'],taxonomy_ids:{physics:['node-b']}});
   assert.equal(second.result.id,first.result.id);assert.equal(second.result.merged,true);assert.deepEqual(second.result.filled,['explanation']);
   await send('exam',{source:'联考卷',year:'2025—2026',grade:'高一',organization_type:'多市联考',region:'杭州市、宁波市',metadata_labels:{region:['杭州市','宁波市']},school_ids:['school','alliance']});
   await send('otherexam',{source:'模拟卷',year:'2026—2027',organization_type:'市级统考',region:'温州市',metadata_labels:{region:['温州市']},school_ids:['alliance']});
   let rows=(await service.list({...context,limit:20})).questions;assert.equal(rows.length,1);assert.equal(rows[0].analysis,'由G=mg得到20N');
   assert.deepEqual(rows[0].taxonomy_ids.physics,['node-a','node-b']);assert.deepEqual(rows[0].metadata_labels.source,['联考卷','模拟卷']);assert.deepEqual(rows[0].school_ids,['school','alliance']);
   assert.deepEqual(new Set(rows[0].metadata_labels.school),new Set(['甲校','乙联盟']));
   assert.deepEqual(rows[0].metadata_labels.region,['杭州市','宁波市','温州市']);assert.deepEqual(rows[0].metadata_labels.organization_type,['多市联考','市级统考']);
   const conflict=await send('conflict',{answer:'19.6N',analysis:'另一个解析'});assert.deepEqual(conflict.result.conflicts,['answer','explanation']);
   await db.query("UPDATE business.schools SET name='新甲校' WHERE id='school'");
   rows=(await service.list({...context,limit:20})).questions;assert(rows[0].school.includes('新甲校'));
   await assert.rejects(()=>db.query("INSERT INTO business.students(id,tenant_id,name,school_legacy,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ('student','tenant','Student','乙联盟',false,false,now(),now())"),/ALLIANCE_FORBIDDEN/);
   await assert.rejects(()=>db.query("UPDATE business.schools SET legacy_deleted=true WHERE id='alliance'"),/QUESTION_REFERENCED/);
   await assert.rejects(()=>send('cross',{school_ids:['foreign']}),/QUESTION_SCHOOL_NOT_FOUND/);
   await send('different',{content:'物体质量为3kg，求重力。'});assert.equal((await service.list({...context,limit:20})).questions.length,2);
   const audit=(await db.query("SELECT validation_json FROM business.question_import_items WHERE item_id='question_import_item_conflict'")).rows[0].validation_json;
   assert.deepEqual(audit.deduplication.conflicts,['answer','explanation']);
   let activeRole='student';
   const app=createCloudBusinessApp({query:(sql,args)=>db.query(sql,args),questionAuthority:service,businessTenantId:'tenant',
     miniappCloudAccount:{login:async()=>{},context:async()=>({accountId:'fixture-reader',status:'active',roles:[activeRole]})}});
   const server=require('node:http').createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   try{
    for(const role of ['student','super_admin']){
     activeRole=role;
     const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/business/miniapp-question-previews?subject=physics&examYear='+encodeURIComponent('2026—2027'),{headers:{authorization:'Bearer fixture.signature'}});
     const payload=await response.json();assert.equal(response.status,200,JSON.stringify(payload));assert.equal(payload.questions.length,1);
     assert(payload.questions[0].sourceLabel.includes('模拟卷'));assert(payload.questions[0].sourceLabel.includes('乙联盟'));assert(payload.questions[0].sourceLabel.includes('新甲校'));assert(payload.questions[0].sourceLabel.includes('多市联考'));assert(payload.questions[0].sourceLabel.includes('宁波市'));assert(payload.questions[0].sourceLabel.includes('市级统考'));
     assert.deepEqual(payload.filterOptions.examYears,['2025—2026','2026—2027']);assert(payload.filterOptions.sources.includes('模拟卷'));
    }
   }finally{await new Promise(resolve=>server.close(resolve));}
  });
  await withQuery(handle,'writer',async db=>{
   await db.query("SELECT * FROM business.vnext_create_school_v2('tenant','writer-alliance','写入联盟',0,'alliance')");
   const createStudent="SELECT * FROM business.vnext_create_student_record_v1($1,$2,$3,$4,NULL,NULL,NULL,NULL,NULL,1,NULL,NULL,$5::jsonb)";
   await assert.rejects(()=>db.query(createStudent,['tenant','denied-student','Student','写入联盟','[]']),/ALLIANCE_FORBIDDEN/);
   await db.query(createStudent,['tenant','writer-student','Student','自动登记学校','[]']);
   const foundation=require('../src/businessFoundationLifecycleMutationService').createBusinessFoundationLifecycleMutations({query:(sql,args)=>db.query(sql,args)});
   const app=createCloudBusinessApp({query:(sql,args)=>db.query(sql,args),businessFoundationLifecycleMutations:foundation,businessTenantId:'tenant',desktopRegistration:{begin:async()=>null,register:async()=>null,sessionContext:async()=>({roles:['super_admin']})}});
   const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
   try{
    const sendResource=async(id,members)=>fetch('http://127.0.0.1:'+server.address().port+'/api/business/schools',{method:'POST',headers:{authorization:'Bearer desktop.ticket','content-type':'application/json'},body:JSON.stringify({schoolId:id,data:{name:id,count:0,kind:'alliance',memberSchoolIds:members}})});
    const first=await sendResource('http-alliance',['school']);assert.equal(first.status,201,JSON.stringify(await first.json()));
    const second=await sendResource('second-alliance',['school']);assert.equal(second.status,201,'one school can join multiple alliances');
    assert.equal((await sendResource('foreign-alliance',['foreign'])).status,409);
    assert.equal((await sendResource('nested-alliance',['alliance'])).status,409);
   }finally{await new Promise(resolve=>server.close(resolve));}
  });
  await withQuery(handle,'fixture-provisioner',async db=>{
   assert.deepEqual((await db.query("SELECT member_school_ids FROM business.schools WHERE id='http-alliance'")).rows[0].member_school_ids,['school']);
   assert.equal((await db.query("SELECT id FROM business.schools WHERE id IN ('foreign-alliance','nested-alliance')")).rows.length,0,'failed member validation rolls back the whole resource create');
   await assert.rejects(()=>db.query("UPDATE business.schools SET legacy_deleted=true WHERE id='school'"),/ALLIANCE_REFERENCED/);
   assert.equal((await db.query("SELECT kind FROM business.schools WHERE tenant_id='tenant' AND name='自动登记学校'")).rows[0].kind,'school');
   await assert.rejects(()=>db.query("UPDATE business.schools SET kind='alliance' WHERE tenant_id='tenant' AND name='自动登记学校'"),/SCHOOL_REFERENCED/);
  });
  console.log('actual cloud import merges, replay, label unions, school links/rename, student restrictions and tenant guards passed');
 }finally{await runtime.disposeHandle(handle).catch(()=>{});await runtime.stop().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
