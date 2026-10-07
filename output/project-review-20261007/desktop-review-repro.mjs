// Read-only review reproduction: no real requests, credentials, or business changes.
// Run from project root: node output/project-review-20261007/desktop-review-repro.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createDesktopSyncController } from '../../src/services/desktopSyncController.mjs';
import { planDesktopAutoSync } from '../../src/services/desktopAutoSync.mjs';
import { buildAuthorityBackedBrowserCache } from '../../src/services/authorityProjectionCacheAdapter.mjs';
import { createDesktopCloudBusinessDraftAdapter } from '../../src/services/desktopCloudBusinessDraft.mjs';
import { createDesktopCommandOutbox } from '../../src/services/desktopCommandOutbox.mjs';
import { createDesktopAuthorityClient } from '../../src/services/desktopAuthorityClient.mjs';
import { createDesktopIdentityClient, desktopCloudTransportUnavailable, captureDesktopCloudDraftConnectivity, canStartBusinessRuntime } from '../../src/services/desktopIdentityClient.mjs';
import { saveDesktopAuthorizationSession, readDesktopAuthorizationSession, clearDesktopAuthorizationSession } from '../../src/services/desktopAuthorizationSession.mjs';
const require=createRequire(import.meta.url);
const {createDesktopAuthorityRuntime}=require('../../public/desktopAuthorityRuntime.js');
const {createNativeQuestionDraft}=require('../../src/services/nativeQuestionDraftCreate.js');
const logs=[];
function log(test,data){ const row={test,...data}; logs.push(row); console.log(JSON.stringify(row)); }
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'gewu-review-desktop-'));
const now=()=>new Date('2026-10-07T00:00:00Z');
const safeStorage={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()};
let userId='user-A', sequence=0;
const status=()=>({state:'unlocked',unlocked:true,user:{id:userId},activeRole:'super_admin',eligibleRoles:['super_admin'],deviceId:'device-1',authorizationId:'auth-1',credentialVersion:1,offlineLease:{userId,activeRole:'super_admin',eligibleRoles:['super_admin'],deviceId:'device-1',authorizationId:'auth-1',credentialVersion:1,issuedAt:'2026-10-06T00:00:00Z',expiresAt:'2026-10-08T00:00:00Z'}});
function runtime(name,fetchImpl){return createDesktopAuthorityRuntime({filePath:path.join(directory,name+'.bin'),safeStorage,vault:{status},cloudBusinessBaseUrl:'https://review.invalid',now,createId:()=>`draft-${++sequence}`,isOnline:()=>true,fetchImpl});}
try {
  const requests=[];
  const first=runtime('identity',async(url,opt)=>{requests.push({url,authorization:opt.headers.Authorization,body:JSON.parse(opt.body)});return {ok:true,status:200,json:async()=>({ok:true,student:{id:'student-A',updatedAt:'2026-10-07T00:00:01Z'}})};});
  const draft=first.appendDraftSync({type:'student.create.v1',payload:{record:{id:'student-A',name:'A confidential student',phone:'12345'}}});
  userId='user-B';
  const visible=await first.list();
  const cache=buildAuthorityBackedBrowserCache({projection:{protocol:'gewu.authority-projection.v1',sourceVersion:0,userId:'user-B',role:'teacher',payload:{students:[]}},outbox:visible});
  assert.equal(visible[0].draftScope.userId,'user-A');assert.equal(cache.students[0].name,'A confidential student');
  const controller=createDesktopSyncController({bridge:first,sessionToken:()=> 'user-B-token',isOnline:()=>true,refreshProjection:async()=>{}});
  await controller.tick(); assert.equal(requests[0].authorization,'Bearer user-B-token');assert.equal((await first.get(draft.id)).status,'completed');
  log('cross_identity_outbox',{currentUser:userId,visibleOwners:visible.map(v=>v.draftScope.userId),cacheStudentNames:cache.students.map(v=>v.name),requests,finalStatus:(await first.get(draft.id)).status});

  for(const operation of ['update','create']){
    let storage='',version='2026-10-06T00:00:00Z',calls=0,cloudRecord=null;
    const cloudClient=operation==='update'?{updateCloudRoom:async input=>{calls++;if(input.expectedUpdatedAt!==version)throw Object.assign(new Error('CLOUD_BUSINESS_ROOM_CONFLICT'),{code:'CLOUD_BUSINESS_ROOM_CONFLICT'});version='2026-10-07T00:00:01Z';cloudRecord={id:input.roomId,name:input.name};throw Object.assign(new Error('response lost after commit'),{code:'ECONNRESET'});}}:{createCloudRoom:async input=>{calls++;if(cloudRecord)throw Object.assign(new Error('CLOUD_BUSINESS_ROOM_NAME_EXISTS'),{code:'CLOUD_BUSINESS_ROOM_NAME_EXISTS'});cloudRecord={id:input.roomId,name:input.name};throw Object.assign(new Error('response lost after commit'),{code:'ECONNRESET'});}};
    const adapter=createDesktopCloudBusinessDraftAdapter({baseUrl:'https://review.invalid',sha256:v=>'hash:'+v,cloudClient});
    const outbox=createDesktopCommandOutbox({store:{read:async()=>storage,write:async v=>{storage=v;}},codec:{seal:async v=>JSON.stringify(v),open:async v=>JSON.parse(v)},createId:()=>`review-${operation}`});
    const client=createDesktopAuthorityClient({outbox,createCloudBusinessCommand:adapter.createCommand,submitCloudBusiness:adapter.submit});
    const draft=await client.appendDraft({type:`room.${operation}.v1`,payload:operation==='update'?{id:'room-A',expectedVersion:version,changes:{name:'Renamed'}}:{record:{id:'room-A',name:'Created'}}});
    let firstError;
    try{await client.confirmAndSubmit(draft.id,{sessionToken:'fake-token'});}catch(e){firstError=e.code;}
    assert.equal(firstError,'ECONNRESET');assert.equal((await client.get(draft.id)).status,'submitted');
    const retry=await client.submit(draft.id,{sessionToken:'fake-token'});
    assert.equal(retry.receipt.status,'rejected');assert.equal((await client.get(draft.id)).status,'conflict');
    log('business_response_lost_'+operation,{firstError,cloudRecord,requests:calls,retryReceipt:retry.receipt.status,localStatus:(await client.get(draft.id)).status,conflict:(await client.get(draft.id)).conflict.code,note:'Cloud already committed once; local retry creates a false conflict, not duplicate room records.'});
  }

  const outageClient=createDesktopIdentityClient({desktopIdentity:{status,resume:async()=>status()},now,fetchImpl:async()=>({ok:false,status:503,json:async()=>({ok:false})}),sessionStore:{save(){},clear(){}}});
  let outageError;
  try{await outageClient.resume({baseUrl:'https://review.invalid',online:true});}catch(e){outageError=e.code;}
  const offline=await outageClient.resume({baseUrl:'https://review.invalid',online:false});
  assert.equal(offline.gateState.kind,'offline-unlocked');assert.equal(canStartBusinessRuntime({gateState:offline.gateState}),true);
  const outageRequests=[];
  const second=runtime('outage',async(url,opt)=>{outageRequests.push({url,authorization:opt.headers.Authorization,body:JSON.parse(opt.body)});return {ok:true,status:200,json:async()=>({ok:true,room:{id:'offline-room',updatedAt:'2026-10-07T00:00:01Z'}})};});
  const outageDraft=second.appendDraftSync(captureDesktopCloudDraftConnectivity({type:'room.create.v1',payload:{record:{id:'offline-room',name:'Edited during 503 outage'}}}));
  const plan=planDesktopAutoSync(await second.list());
  assert.equal(outageDraft.createdOffline,false);assert.equal(plan.onlineIds.includes(outageDraft.id),true);assert.equal(plan.offlineIds.length,0);
  const recoveredController=createDesktopSyncController({bridge:second,sessionToken:()=> 'restored-online-session',isOnline:()=>true,refreshProjection:async()=>{}});
  await recoveredController.tick();
  assert.equal((await second.get(outageDraft.id)).status,'completed');assert.equal(recoveredController.getState().open,false);assert.equal(outageRequests.length,1);
  log('503_offline_draft_not_marked',{outageError,gateState:offline.gateState.kind,cloudTransportUnavailable:desktopCloudTransportUnavailable(),nativeNetworkOnline:true,createdOffline:outageDraft.createdOffline,plan,recoveredTickRequests:outageRequests,finalStatus:(await second.get(outageDraft.id)).status,confirmationDialogShown:recoveredController.getState().open,note:'No controller.confirm() called; recovered tick silently submitted the outage edit.'});

  const sessionStorageValues=new Map();let issueDraftCalls=0,createQuestionCalls=0;
  const storage={getItem:key=>sessionStorageValues.get(key)||null,setItem:(key,value)=>sessionStorageValues.set(key,value),removeItem:key=>sessionStorageValues.delete(key)};
  globalThis.questionDraftProvenance={issueDraft:async()=>{issueDraftCalls++;return {questionId:'native-question-id'};}};
  await saveDesktopAuthorizationSession({token:'active-memory-token',session:{id:'session-A',userId:'user-A',deviceId:'device-1',activeRole:'teacher',eligibleRoles:['teacher'],expiresAt:'2026-10-08T00:00:00Z'},profile:{userId:'user-A',activeRole:'teacher',eligibleRoles:['teacher']}},{storage});
  const memorySession=readDesktopAuthorizationSession(storage);
  assert.equal(memorySession.authorization,'Bearer active-memory-token');assert.equal(storage.getItem('gewu_desktop_authorization_session'),null);
  let createError;
  try{await createNativeQuestionDraft({createQuestion(){createQuestionCalls++;}},{content:'New question'},storage);}catch(e){createError=e.code;}
  assert.equal(createError,'DRAFT_PROVENANCE_UNAVAILABLE');assert.equal(issueDraftCalls,0);assert.equal(createQuestionCalls,0);
  log('native_question_memory_session_mismatch',{memorySessionAvailable:true,legacySessionStorageValue:storage.getItem('gewu_desktop_authorization_session'),createError,issueDraftCalls,createQuestionCalls});
  await clearDesktopAuthorizationSession({storage});delete globalThis.questionDraftProvenance;
} finally {
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith('gewu-review-desktop-'));
  fs.rmSync(directory,{recursive:true,force:true});
}
fs.writeFileSync(new URL('./desktop-review-repro.json',import.meta.url),JSON.stringify({executedAt:new Date().toISOString(),evidenceMode:'All requests simulated; no real cloud, database, deployment, or user credentials used.',results:logs},null,2)+'\n');
