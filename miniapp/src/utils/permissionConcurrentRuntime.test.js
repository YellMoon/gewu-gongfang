'use strict';
// UTF-8: App startup and page did-show must await one verified request per session.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {cloudSessionUser}=require('./cloudSessionIdentityRuntime');
const {canOpenMiniappRoute}=require('./miniappRouteAccess');
const remote=role=>({accountId:'account-'+role,roles:[role],status:'active',profile:role==='teacher'?{type:'teacher',id:'teacher'}:{type:'student',id:'student',relationship:'student'}});
const values=new Map([['user_info',cloudSessionUser(remote('teacher'))],['auth_token','first-token']]);
const pending=[];
const { createAuthSessionRuntime, AUTH_SESSION_GENERATION_KEY, AUTH_SESSION_STATE_KEY }=require('./miniappApiSessionRuntime');
values.set(AUTH_SESSION_GENERATION_KEY,1);values.set(AUTH_SESSION_STATE_KEY,{version:1,generation:1,invalidated:false});
const authSessionRuntime=createAuthSessionRuntime({readToken:()=>values.get('auth_token'),readIdentity:()=>values.get('user_info'),readGeneration:()=>values.get(AUTH_SESSION_GENERATION_KEY),writeGeneration:value=>values.set(AUTH_SESSION_GENERATION_KEY,value),readSessionState:()=>values.get(AUTH_SESSION_STATE_KEY),writeSessionState:value=>values.set(AUTH_SESSION_STATE_KEY,value)});
const deps={
 '@tarojs/taro':{default:{getStorageSync:key=>values.get(key),setStorageSync:(key,value)=>values.set(key,value),removeStorageSync:key=>values.delete(key)}},
 './api':{miniappCloudBusinessApi:{readAuthorization:token=>new Promise(resolve=>pending.push({token,resolve}))}},
 './authSession':{authSessionRuntime},'./miniappApiSessionRuntime':require('./miniappApiSessionRuntime'),
 './cloudSessionIdentityRuntime':require('./cloudSessionIdentityRuntime'),'./miniappAuthorizationRuntime':require('./miniappAuthorizationRuntime'),
 './miniappAuthorizationSession':require('./miniappAuthorizationSession'),'./miniappPermissionFetchRuntime':require('./miniappPermissionFetchRuntime'),
 './storage':{clearBusinessCache:()=>{},setBusinessCacheIdentity:()=>{}},'./accountExperience':require('./accountExperience'),
};
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'permission.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const moduleResult={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},moduleResult,moduleResult.exports);
const api=moduleResult.exports;
const resolve=(request,role)=>request.resolve({success:true,data:{ok:true,identity:remote(role),capabilities:role==='teacher'?['business:teacher-scope','question-bank:view']:['question-bank:view']}});
(async()=>{
 const startup=api.fetchPermissions(),page=api.fetchPermissions();
 assert.equal(pending.length,1,'app startup and schedule did-show must not supersede one another with two permission requests');
 assert.equal(api.getPermissionState().status,'idle','persistent hints never grant permissions before a server reply');
 resolve(pending[0],'teacher');await Promise.all([startup,page]);
 assert.equal(api.getPermissionState().status,'loaded');
 assert.equal(canOpenMiniappRoute('/pages/schedule/index',api.getEffectiveMiniappAccess()),true,'both callers must finish with verified schedule access');
 const old=api.fetchPermissions();assert.equal(pending.length,2,'later deliberate refresh still queries authority');
 authSessionRuntime.invalidateAndAdvance();values.set('auth_token','second-token');values.set('user_info',cloudSessionUser(remote('student')));authSessionRuntime.activate();
 const next=api.fetchPermissions();assert.equal(pending.length,3,'replacement session must issue its own request instead of joining the old token');
 resolve(pending[1],'teacher');await old;
 const joined=api.fetchPermissions();assert.equal(pending.length,3,'old finally must not clear the replacement-session request lock');
 resolve(pending[2],'student');await Promise.all([next,joined]);
 assert.equal(values.get('user_info').id,'account-student');assert.equal(api.getEffectiveMiniappAccess().role,'student');
 assert.equal(canOpenMiniappRoute('/pages/assets/index',api.getEffectiveMiniappAccess()),false,'sharing verified requests must never expand student permissions');
 console.log('actual permission startup/page concurrent refresh, authority wait, replacement session and stale-finally fences passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
