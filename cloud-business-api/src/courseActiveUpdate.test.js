'use strict';
// UTF-8: the existing course PUT permits only the version and active for a state-only change.
const assert=require('node:assert/strict');
const {createCloudBusinessApp}=require('./app');
(async()=>{
 let context={roles:['teacher'],teacherId:'teacher'},miniapp=false,conflict=false;const writes=[];
 const settings={query:async()=>({rows:[]}),businessTenantId:'tenant',
  desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async()=>{if(miniapp)throw Error('not desktop');return context;}},
  miniappCloudAccount:{login:async()=>{},context:async()=>context},
  businessCourseLifecycleMutations:{create:async()=>{},remove:async()=>{},update:async input=>{writes.push(input);return conflict?null:{id:'old-course',updatedAt:'2026-09-09T00:00:00Z'};}}};
 const app=createCloudBusinessApp(settings);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const body={expectedUpdatedAt:'2026-09-01T00:00:00.000Z',active:false};
 const send=async value=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/business/courses/old-course`,{method:'PUT',headers:{authorization:'Bearer desktop.test','content-type':'application/json'},body:JSON.stringify(value)});return {status:r.status,body:await r.json()};};
 try{
  // UTF-8: prove the pre-fix API rejects a correctly formatted original state-only intent.
  const Module=require('node:module'),filename=require.resolve('./app'),prior=new Module(filename,module);
  prior.filename=filename;prior.paths=module.paths;
  prior._compile(require('node:child_process').execFileSync('git',['show','800b4fdf:cloud-business-api/src/app.js'],{encoding:'utf8'}),filename);
  const oldServer=prior.exports.createCloudBusinessApp(settings).listen(0,'127.0.0.1');await new Promise(r=>oldServer.once('listening',r));
  try{const r=await fetch(`http://127.0.0.1:${oldServer.address().port}/api/business/courses/old-course`,{method:'PUT',headers:{authorization:'Bearer desktop.test','content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,400);assert.equal(writes.length,0);}finally{await new Promise(r=>oldServer.close(r));}
  for(const active of [false,true]){const r=await send({...body,active});assert.equal(r.status,200);assert.deepEqual(writes.at(-1),{tenantId:'tenant',courseId:'old-course',expectedUpdatedAt:body.expectedUpdatedAt,active,actorScope:{role:'teacher',teacherId:'teacher'}});}
  const count=writes.length;
  for(const extra of [{active:null},{active:'false'},{expectedUpdatedAt:null},{expectedUpdatedAt:'invalid'},{name:'overwrite'},{pricings:[]},{actorScope:{role:'super_admin'}}])assert.equal((await send({...body,...extra})).status,400);
  for(const roles of [['visitor'],['student'],['family'],['teacher']]){context={roles};assert.equal((await send(body)).status,403);}
  context={roles:['super_admin']};miniapp=true;assert.equal((await send(body)).status,403);assert.equal(writes.length,count);
  miniapp=false;assert.equal((await send(body)).status,200);assert.equal(writes.at(-1).actorScope.role,'super_admin');
  conflict=true;const r=await send(body);assert.equal(r.status,409);assert.equal(r.body.code,'CLOUD_BUSINESS_COURSE_CONFLICT');
  console.log('course active-only REST scope, validation and conflict checks passed');
 }finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
