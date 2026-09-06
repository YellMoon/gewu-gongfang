'use strict';
const assert=require('node:assert/strict');
const {createQuestionAuthorityService}=require('./questionAuthorityService');
const base={subject:'physics',type:'single_choice',difficulty:3,status:'draft',content:'Cloud text',options:[],answer:null,analysis:null,rich_content:null,source:null,knowledgeLabels:[],taxonomy:{},has_formula:false,version:1};
(async()=>{
  const rows=Array.from({length:426},(_,i)=>({...base,id:`question-${String(i).padStart(4,'0')}`}));
  const calls=[];
  const service=createQuestionAuthorityService({transaction:async fn=>fn(),query:async(sql,params)=>{
    calls.push({sql,params});
    return {rows:rows.filter(row=>params[2]===null||row.id>params[2]).slice(0,params[1])};
  }});
  const input={tenantId:'default',actor:{accountId:'teacher-1',roles:['teacher']},limit:200};
  const first=await service.list(input);
  assert.equal(first.questions.length,200);
  assert.equal(first.nextCursor,rows[199].id);
  const second=await service.list({...input,afterId:first.nextCursor});
  const third=await service.list({...input,afterId:second.nextCursor});
  assert.equal(second.questions.length,200);
  assert.equal(third.questions.length,26);
  assert.equal(third.nextCursor,null);
  assert.deepEqual([...first.questions,...second.questions,...third.questions].map(q=>q.id),rows.map(q=>q.id));
  assert.deepEqual(calls[0].params,['default',201,null]);
  assert.match(calls[0].sql,/q\.id COLLATE "C" > \$3::text COLLATE "C"/u);
  assert.match(calls[0].sql,/ORDER BY q\.id COLLATE "C" ASC/u,'editing updated_at must not move an unread record behind the cursor');
  for(const afterId of ['',[],{},'x'.repeat(129)]) await assert.rejects(service.list({...input,afterId}),error=>error.code==='CLOUD_QUESTION_INPUT_INVALID');
  const empty=await service.list({...input,afterId:rows.at(-1).id});
  assert.deepEqual(empty,{questions:[],nextCursor:null});
  console.log('cloud question keyset pagination checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
