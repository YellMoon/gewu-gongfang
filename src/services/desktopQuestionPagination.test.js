const assert = require('node:assert/strict');
(async () => {
  const {createDesktopIdentityClient:factory} = await import('./desktopIdentityClient.mjs');
  const createDesktopIdentityClient=options=>factory({desktopIdentity:{status:async()=>({})},...options});
  const items = Array.from({length:426},(_,index)=>({id:`question-${String(index).padStart(4,'0')}`,version:1,content:`Question ${index}`}));
  const requests=[];
  const client=createDesktopIdentityClient({fetchImpl:async url=>{
    requests.push(url);
    const params=new URL(url).searchParams;
    const after=params.get('afterId');
    const start=after ? items.findIndex(item=>item.id===after)+1 : 0;
    const questions=items.slice(start,start+Number(params.get('limit')));
    return {ok:true,json:async()=>({ok:true,questions,nextCursor:start+questions.length<items.length ? questions.at(-1).id:null})};
  }});
  const input={baseUrl:'https://cloud.test',currentSession:{token:'session',offline:false}};
  const loaded=await client.listCloudQuestions(input);
  assert.equal(loaded.length,426,'all 426 records must be returned, not only the first 200');
  assert.deepEqual(loaded,items);
  assert.equal(requests.length,3);
  assert.equal(new URL(requests[1]).searchParams.get('afterId'),items[199].id);
  assert.equal(new URL(requests[2]).searchParams.get('afterId'),items[399].id);
  for(const response of [
    {questions:[items[0]]},
    {questions:[],nextCursor:'same'},
    {questions:[items[0]],nextCursor:'other'},
    {questions:[items[0],items[0]],nextCursor:null},
    {questions:[{...items[0],version:null}],nextCursor:null},
    {questions:[items[0]],nextCursor:0},
  ]) {
    const invalid=createDesktopIdentityClient({fetchImpl:async()=>({ok:true,json:async()=>({ok:true,...response})})});
    await assert.rejects(invalid.listCloudQuestions(input),error=>error.code==='DESKTOP_CLOUD_QUESTION_RESPONSE_INVALID');
  }
  let calls=0;
  const cyclic=createDesktopIdentityClient({fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({ok:true,questions:[items[0]],nextCursor:items[0].id})}}});
  await assert.rejects(cyclic.listCloudQuestions(input),error=>error.code==='DESKTOP_CLOUD_QUESTION_RESPONSE_INVALID');
  assert.equal(calls,2,'cyclic pages must fail instead of hanging or returning a partial cache');
  let failedCalls=0;
  const failure=createDesktopIdentityClient({fetchImpl:async()=>{
    if(++failedCalls===2) throw new Error('NETWORK_LOST');
    return {ok:true,json:async()=>({ok:true,questions:items.slice(0,200),nextCursor:items[199].id})};
  }});
  await assert.rejects(failure.listCloudQuestions(input),/NETWORK_LOST/,'a later page failure must not resolve the partial first page');
  console.log('desktop complete question pagination checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
