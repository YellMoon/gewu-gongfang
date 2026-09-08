'use strict';
// UTF-8: state-only drafts require confirmation and compose with earlier edits without losing fields.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDesktopAuthorityRuntime}=require('./desktopAuthorityRuntime');
const {describeAuthorityDraft}=require('../src/components/authorityDraftPresentation');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gewu-course-active-')),requests=[];
 const runtime=createDesktopAuthorityRuntime({filePath:path.join(dir,'outbox.bin'),cloudBusinessBaseUrl:'https://business.example',
  safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s,'utf8'),decryptString:b=>b.toString('utf8')},
  vault:{status:()=>({state:'unlocked',unlocked:true,user:{id:'test-user'},deviceId:'test-device',authorizationId:'test-auth',credentialVersion:1,
   offlineLease:{userId:'test-user',deviceId:'test-device',authorizationId:'test-auth',credentialVersion:1,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()}})},
  fetchImpl:async(url,options)=>{requests.push({url,method:options.method,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true,course:{id:url.split('/').pop(),updatedAt:'2026-09-09T01:00:00.000Z'}})};}});
 const version='2026-09-01T00:00:00.000Z',append=(id,changes)=>runtime.appendDraftSync({type:'course.update.v1',payload:{id,changes,expectedVersion:version}});
 const draft=append('course',{active:false});assert.equal(draft.status,'awaiting_confirmation');await runtime.list();assert.equal(requests.length,0);
 const presentation=describeAuthorityDraft(draft,{courses:[{id:'course',display_name:'原课程',active:true,year:null,room_id:null}]});
 assert(presentation.details.some(row=>row.label==='课程状态'&&row.value==='已结课'));assert.equal(requests.length,0);
 await assert.rejects(()=>runtime.confirmAndSubmit(draft.id),e=>/SESSION/.test(e.code));assert.equal(requests.length,0);
 await runtime.confirmAndSubmit(draft.id,{sessionToken:'test-session'});assert.equal((await runtime.get(draft.id)).status,'completed');
 assert.deepEqual(requests,[{url:'https://business.example/api/business/courses/course',method:'PUT',body:{expectedUpdatedAt:version,active:false}}]);
 const record={id:'new-course',name:'Original',active:true,student_pricings:[{student_id:'student',tuition:123,teacher_fee:87}]};
 const created=runtime.appendDraftSync({type:'course.create.v1',payload:{record}}),merged=append('new-course',{active:false});assert.equal(created.id,merged.id);assert.equal(merged.type,'course.create.v1');assert.deepEqual(merged.payload.record,{...record,active:false});
 for(const reverse of [false,true]){
  const id='pending-'+reverse,full={name:'Pending name',notes:'Pending notes',student_pricings:record.student_pricings,active:true};
  const initial=append(id,reverse?{active:false}:full),result=append(id,reverse?full:{active:false});
  assert.equal(result.id,initial.id);assert.deepEqual(result.payload.changes,{...full,active:reverse?true:false});assert.equal(result.payload.expectedVersion,version);
 }
 const repeated=append('toggle',{active:false}),reopened=append('toggle',{active:true});assert.equal(repeated.id,reopened.id);assert.deepEqual(reopened.payload.changes,{active:true});assert.equal(requests.length,1);
 console.log('course state-only outbox confirmation, presentation and merge checks passed (synthetic safeStorage, not encryption acceptance)');
})().catch(e=>{console.error(e);process.exitCode=1;});
