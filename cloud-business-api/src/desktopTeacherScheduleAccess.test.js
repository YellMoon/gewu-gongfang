'use strict';
const assert = require('node:assert/strict');
const { createCloudBusinessApp } = require('./app');

const baseline = '2026-09-07T01:00:00.000Z';
const data = { courseId:'course-own',startAt:'2026-09-08T01:00:00.000Z',endAt:'2026-09-08T02:00:00.000Z',recurringRule:null,status:1,roomDisplay:'Room',serviceType:1,tuition:100,teacherFee:50,notes:null,pricings:[] };
const operations = [
  ['POST','/api/business/schedules',{scheduleId:'schedule-own',data},201],
  ['PUT','/api/business/schedules/schedule-own',{expectedUpdatedAt:baseline,...data},200],
  ['DELETE','/api/business/schedules/schedule-own',{expectedUpdatedAt:baseline},200],
  ['PUT','/api/business/schedules/schedule-own/students/student-own',{expectedUpdatedAt:baseline,attendanceStatus:1,tuition:100,teacherFee:50},200],
];
async function exercise(context,{miniappOnly=false,deniedByDatabase=false}={}) {
  const writes=[];
  const mutate=async input=>{
    writes.push(input);
    if(deniedByDatabase) throw Object.assign(new Error('VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED'),{code:'42501'});
    return {id:'schedule-own',updatedAt:'2026-09-07T02:00:00.000Z'};
  };
  const app=createCloudBusinessApp({
    query:async()=>({rows:[]}),businessTenantId:'tenant-1',
    desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async()=>{if(miniappOnly) throw Error('not a desktop ticket');return context;}},
    miniappCloudAccount:{login:async()=>{},context:async()=>context},
    businessScheduleUpdate:mutate,businessScheduleStudentOverride:mutate,
    businessScheduleLifecycleMutations:{create:mutate,remove:mutate},
  });
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try {
    const responses=[];
    for(const [method,path,body] of operations) {
      const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{authorization:'Bearer eyJ2IjoxfQ.signature','content-type':'application/json'},body:JSON.stringify(body)});
      responses.push({status:response.status,body:await response.json()});
    }
    return {writes,responses};
  } finally { await new Promise(resolve=>server.close(resolve)); }
}
(async()=>{
  for(const context of [
    {roles:['teacher'],teacherId:'teacher-own'},
    {roles:['teacher'],profile:{type:'teacher',id:'teacher-own'}},
    {roles:['super_admin','teacher'],activeRole:'teacher',teacherId:'teacher-own'},
  ]) {
    const {writes,responses}=await exercise(context);
    assert.deepEqual(responses.map(x=>x.status),operations.map(x=>x[3]),'bound desktop teacher may submit schedule changes');
    assert.equal(writes.length,4);
    for(const write of writes) assert.deepEqual(write.actorScope,{role:'teacher',teacherId:'teacher-own'});
  }
  for(const context of [{roles:['teacher']},{roles:['teacher'],teacherId:' other '},{roles:['student'],studentId:'student-own'},{roles:[]},{roles:['teacher'],profile:{type:'student',id:'teacher-own'}}]) {
    const result=await exercise(context);
    assert.ok(result.responses.every(x=>x.status===403));
    assert.equal(result.writes.length,0);
  }
  const miniapp=await exercise({roles:['super_admin']},{miniappOnly:true});
  assert.ok(miniapp.responses.every(x=>x.status===403));
  assert.equal(miniapp.writes.length,0,'miniapp admin tickets still cannot mutate teaching records');
  const admin=await exercise({roles:['super_admin']});
  assert.ok(admin.writes.every(x=>x.actorScope.role==='super_admin'&&x.actorScope.teacherId===null));
  const foreign=await exercise({roles:['teacher'],teacherId:'teacher-own'},{deniedByDatabase:true});
  assert.ok(foreign.responses.every(x=>x.status===403&&x.body.code==='CLOUD_BUSINESS_ACCESS_DENIED'));
  console.log('desktop teacher schedule access checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
