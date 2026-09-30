'use strict';
const assert = require('node:assert/strict');
const { createCloudBusinessApp } = require('./app');
const { createOperationAuditRepository,parseFilters,safeDetail,describeOperation } = require('./operationAudit');
(async () => {
  const events = []; let writes=0,beginFailure=false,finishFailure=false,mutation='success';
  let actor={accountId:'account-one',deviceId:'device-one',roles:['super_admin'],activeRole:'super_admin'};
  const repository=createOperationAuditRepository({query:async(sql,args)=>{
    if(sql.includes('vnext_begin')) { if(beginFailure) throw Error('unavailable'); events.push({kind:'begin',args}); }
    if(sql.includes('vnext_complete')) { if(finishFailure) throw Error('unavailable'); events.push({kind:'complete',args}); }
    if(sql.includes('vnext_list')) { events.push({kind:'list',args});return {rows:[{data:{items:[],total:0}}]}; }
    return {rows:[]};
  }});
  const app=createCloudBusinessApp({query:async()=>({rows:[]}),businessTenantId:'tenant',operationAudits:repository,
    desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async()=>actor},
    questionAuthority:{list:async()=>{},create:async()=>{},submitDesktopDraft:async()=>({status:'rejected',result:{id:'question-one',error:{code:'CLOUD_QUESTION_CONFLICT'}}})},
    businessCourseLifecycleMutations:{create:async()=>{},remove:async()=>{},update:async()=>{
      writes++;assert.equal(events.at(-1).kind,'begin','intent must be persisted before mutation');
      if(mutation==='error') throw Error('db error');
      return mutation==='conflict'?null:{id:'course-one',updatedAt:'2026-09-30T00:00:00.000Z'};
    }},
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,method='GET',body)=>{const response=await fetch(base+path,{method,headers:{authorization:'Bearer desktop.test','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
  const update=()=>request('/api/business/courses/course-one','PUT',{expectedUpdatedAt:'2026-09-29T00:00:00.000Z',active:false});
  try {
    let response=await update();assert.equal(response.status,200);assert.equal(response.body.audit.status,'success');assert.equal(events.at(-1).kind,'complete');assert.equal(events.at(-2).args[2],actor.accountId);assert.equal(events.at(-2).args[4],actor.deviceId);
    mutation='conflict';response=await update();assert.equal(response.status,409);assert.equal(response.body.audit.status,'conflict');
    mutation='error';response=await update();assert.equal(response.status,503);assert.equal(response.body.audit.status,'error');
    mutation='success';finishFailure=true;response=await update();assert.equal(response.status,200,'do not turn a committed mutation into a retryable failure');assert.equal(response.body.audit.status,'unknown');finishFailure=false;
    beginFailure=true;const count=writes;response=await update();assert.equal(response.status,503);assert.equal(writes,count);beginFailure=false;
    actor={...actor,roles:['student'],activeRole:'student'};response=await update();assert.equal(response.status,403);assert.equal(response.body.audit.status,'rejected');assert.equal(writes,count);assert.equal((await request('/api/desktop/operation-audits')).status,403);
    actor={...actor,roles:['super_admin','teacher'],activeRole:'teacher',teacherId:'teacher-one'};
    response=await request('/api/desktop/operation-audits?limit=7&offset=2&q=course&action=update&status=conflict&from=2026-09-01T00%3A00%3A00Z&to=2026-10-01T00%3A00%3A00Z');
    assert.equal(response.status,200);assert.equal(response.body.data.scope,'self');assert.deepEqual(events.at(-1).args.slice(0,8),['tenant','self','account-one',7,2,'course','update','conflict']);
    actor.activeRole='super_admin';assert.equal((await request('/api/desktop/operation-audits')).body.data.scope,'tenant');
    for(const query of ['limit=101','limit=-1','offset=1.2','status=fake','action=login','q[]=x','from=2026-09-01','from=2026-10-01T00:00:00Z&to=2026-09-01T00:00:00Z','tenantId=other'])assert.equal((await request('/api/desktop/operation-audits?'+query)).status,400,query);
    response=await request('/api/desktop/question-bank/commands','POST',{commandId:'cmd-one',payloadHash:'hash',type:'question.update.v1',payload:{id:'question-one',stem:'private question'}});assert.equal(response.body.audit.status,'conflict','200 rejected command receipts are not successful writes');
    const secret=safeDetail({password:'private',phone:'13800138000',data:{name:'private',notes:'private',active:false,amount:30},payload:{stem:'private',id:'question-one',token:'private'},pricings:[{studentId:'s1',tuition:5}]});
    assert(!JSON.stringify(secret).includes('private'));assert(!JSON.stringify(secret).includes('13800138000'));assert.equal(secret.data.active,false);assert.equal(secret.data.amount,30);
    assert.equal(describeOperation({path:'/api/desktop/question-bank/commands',method:'POST',body:{payload:{id:'q-one'}}}).resourceId,'q-one');
    assert.equal(describeOperation({path:'/api/desktop/question-bank/commands',method:'POST',body:{payload:{record:{id:'q-created'}}}}).resourceId,'q-created');
    assert.equal(describeOperation({path:'/api/business/schedules',method:'POST',body:{courseId:'foreign-key-only'}}).resourceId,null,'a related course ID is never recorded as a schedule ID');
    assert.equal(describeOperation({path:'/api/business/schedules',method:'POST',body:{courseId:'foreign-key',scheduleId:'actual-schedule'}}).resourceId,'actual-schedule');
    assert.equal(describeOperation({path:'/api/business/courses/course-one',method:'PUT',body:{}}).summary,'修改课程');
    assert.equal(parseFilters({}).limit,20);
    console.log('operation audit route permissions, filters, durable intent ordering, errors, conflicts and redaction passed');
  } finally { await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
