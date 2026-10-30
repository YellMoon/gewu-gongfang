'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {registerPersonalFinanceRoutes}=require('./personalFinanceRoutes');
const {createTuitionBillReview}=require('./tuitionBillReview');
test('tuition routes are desktop-only, owner-scoped and reject unconfirmed writes or nested command wrappers',async()=>{
 const app=express();app.use(express.json());let reads=0,submits=0,received;
 const deniedService=createTuitionBillReview({writer:{query:async()=>{throw Error('must not read');}}});
 registerPersonalFinanceRoutes({app,finance:{},tenantId:'tenant',desktopContext:async req=>({accountId:'alice',roles:[req.get('x-test-role')||'super_admin']}),miniappContext:async()=>({}),tuitionReview:{state:async owner=>{if(!owner.actor.roles.includes('super_admin'))return deniedService.state(owner);reads++;received=owner;return {revision:'7',students:[],payments:[],links:[]};},submit:async(owner,input,key)=>{submits++;received={owner,input,key};return {created:1,linked:0};}}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const root='http://127.0.0.1:'+server.address().port;
 try{
  const get=await fetch(root+'/api/business/personal-finance/tuition-review');assert.equal(get.status,200);assert.equal(reads,1);assert.equal(submits,0);assert.equal(received.actor.accountId,'alice');
  const denied=await fetch(root+'/api/business/personal-finance/tuition-review',{headers:{'x-test-role':'teacher'}});assert.equal(denied.status,403);assert.equal(reads,1);
  assert.equal((await fetch(root+'/api/business/miniapp-personal-finance/tuition-review')).status,404);
  for(const headers of [{'x-gewu-command-id':'nested'},{},{}]){const body=Object.keys(headers).length?{expectedRevision:'7',confirmed:true,rows:[]}:{accountId:'mallory',confirmed:true};const r=await fetch(root+'/api/business/personal-finance/tuition-review/submit',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});assert.equal(r.status,400);}
  assert.equal(submits,0);
  const input={expectedRevision:'7',confirmed:true,rows:[]},res=await fetch(root+'/api/business/personal-finance/tuition-review/submit',{method:'POST',headers:{'Content-Type':'application/json','x-idempotency-key':'same-retry-key'},body:JSON.stringify(input)});assert.equal(res.status,200);assert.equal(received.owner.tenantId,'tenant');assert.equal(received.owner.actor.accountId,'alice');assert.equal(received.key,'same-retry-key');
 }finally{await new Promise(r=>server.close(r));}
});
