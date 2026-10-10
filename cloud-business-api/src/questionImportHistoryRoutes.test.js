'use strict';
const assert=require('node:assert/strict');
const {createCloudBusinessApp}=require('./app');
const {createQuestionImportTaskRepository}=require('./questionImportTaskRepository');
(async()=>{
  const calls=[];
  const imports=createQuestionImportTaskRepository({query:async(sql,values)=>{
    calls.push({sql,values});return {rows:[]};
  }});
  const app=createCloudBusinessApp({query:async()=>({rows:[]}),businessTenantId:'tenant-owner',questionImportTasks:imports,
    desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async({sessionToken})=>{
      if(sessionToken==='teacher.signature')return {accountId:'owner',roles:['teacher'],activeRole:'teacher'};
      if(sessionToken==='student.signature')return {accountId:'student',roles:['student'],activeRole:'student'};
      throw Error('invalid desktop session');
    }},
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const request=async(token,suffix='')=>fetch('http://127.0.0.1:'+server.address().port+'/api/desktop/question-imports'+suffix,{headers:token?{authorization:'Bearer '+token+'.signature'}:{}});
    assert.equal((await request()).status,403);
    assert.equal((await request('invalid')).status,403);
    assert.equal((await request('student')).status,403);
    assert.equal((await request('teacher','?limit=101')).status,400);
    assert.equal((await request('teacher','?limit=2.5')).status,400);
    const result=await request('teacher');assert.equal(result.status,200);assert.deepEqual(await result.json(),{ok:true,tasks:[]});
    assert.equal(calls.length,1);assert.deepEqual(calls[0].values,['tenant-owner','owner',50]);
    assert.ok(calls[0].sql.includes('task.tenant_id=$1 AND task.account_id=$2'));
    console.log('actual import history REST authentication, role, limit and owner scope checks passed');
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
