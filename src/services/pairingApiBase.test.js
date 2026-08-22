const assert=require('assert');
(async()=>{const{resolveOnlineSyncActor,resolvePairingApiBase,resolveRenewableOnlineSyncActor}=await import('./pairingApiBase.mjs');
assert.strictEqual(resolvePairingApiBase({cloudBaseUrl:'https://cloud.example.com/api'}, {protocol:'file:',origin:'null'}),'https://cloud.example.com');
assert.strictEqual(resolvePairingApiBase({cloudBaseUrl:'https://identity.example.com/scheduling'}, {protocol:'file:',origin:'null'}),'https://identity.example.com/scheduling');
assert.strictEqual(resolvePairingApiBase({}, {protocol:'https:',origin:'https://app.example.com'}),'https://app.example.com');
assert.throws(()=>resolvePairingApiBase({hostBaseUrl:'http://192.168.1.2:3001'}, {protocol:'file:',origin:'null'}),e=>e.code==='PAIRING_API_BASE_REQUIRED');
assert.throws(()=>resolvePairingApiBase({}, {protocol:'file:',origin:'null'}),e=>e.code==='PAIRING_API_BASE_REQUIRED');
const online={authorization:'Bearer desktop-v2',expiresAt:'2026-07-17T18:00:00.000Z',authContext:{
  userId:'canonical-human',deviceId:'device-2',activeRole:'teacher',teacherId:'teacher-self',studentId:null,
  sessionId:'session-2',authVersion:7,credentialVersion:3,
}};
assert.deepStrictEqual(resolveOnlineSyncActor(online,{now:'2026-07-17T10:00:00.000Z'}),online);
assert.throws(()=>resolveOnlineSyncActor({...online,offline:true},{now:'2026-07-17T10:00:00.000Z'}),e=>e.code==='ONLINE_DESKTOP_SESSION_REQUIRED');
assert.throws(()=>resolveOnlineSyncActor({...online,expiresAt:'2026-07-17T09:59:59.000Z'},{now:'2026-07-17T10:00:00.000Z'}),e=>e.code==='ONLINE_DESKTOP_SESSION_REQUIRED');
assert.throws(()=>resolveOnlineSyncActor({...online,authContext:{...online.authContext,sessionId:null}},{now:'2026-07-17T10:00:00.000Z'}),e=>e.code==='ONLINE_DESKTOP_SESSION_REQUIRED');
assert.throws(()=>resolveOnlineSyncActor({...online,authContext:{...online.authContext,teacherId:null}},{now:'2026-07-17T10:00:00.000Z'}),e=>e.code==='ONLINE_DESKTOP_SESSION_REQUIRED');
let renewableSession=null;let renewalCalls=0;
const renewed=await resolveRenewableOnlineSyncActor({
  readSession:()=>{if(!renewableSession){const e=new Error('ONLINE_DESKTOP_SESSION_REQUIRED');e.code='ONLINE_DESKTOP_SESSION_REQUIRED';throw e;}return renewableSession;},
  ensureOnline:async()=>{renewalCalls+=1;renewableSession=online;},
  now:'2026-07-17T10:00:00.000Z',
});
assert.deepStrictEqual(renewed,online);
assert.strictEqual(renewalCalls,1);
let missingContextSession=null;let missingContextRenewals=0;
const renewedFromMissingContext=await resolveRenewableOnlineSyncActor({
  readSession:()=>{if(!missingContextSession){const e=new Error('AUTHORIZATION_CONTEXT_REQUIRED');e.code='AUTHORIZATION_CONTEXT_REQUIRED';throw e;}return missingContextSession;},
  ensureOnline:async()=>{missingContextRenewals+=1;missingContextSession=online;},
  now:'2026-07-17T10:00:00.000Z',
});
assert.deepStrictEqual(renewedFromMissingContext,online);
assert.strictEqual(missingContextRenewals,1,'a fresh desktop process must renew an absent in-memory authorization context');
console.log('pairing API base tests passed');})().catch(e=>{console.error(e);process.exit(1);});
