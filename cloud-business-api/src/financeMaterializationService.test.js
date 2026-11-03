'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createFinanceMaterializationService,normalizeProjectionQuery}=require('./financeMaterializationService');
const owner={tenantId:'tenant',actor:{accountId:'one',roles:['teacher']}},tick=()=>new Promise(setImmediate);
class Worker extends EventEmitter{constructor(){super();this.calls=[];}postMessage(m){this.calls.push(m);queueMicrotask(()=>this.emit('message',{id:m.id,result:m.type==='build'?{saved:true}:{status:'ready',ledger:{revision:m.revision},view:{transactions:[]},readOnly:true}}));}async terminate(){this.emit('exit',0);}}
test('ready persisted versions are queried without rebuilding or loading original ledgers, including service restart',async()=>{
 let ledgerReads=0,dirty=0;const workers=[],store={read:async()=>({state:'ready'}),enqueueDirty:async()=>{dirty++;},claim:async()=>null};
 const options={finance:{getRevision:async()=> '7',getLedger:async()=>{ledgerReads++;throw Error('must not load originals');}},store,rulesVersion:'fixture',start:false,createWorker:()=>{const w=new Worker();workers.push(w);return w;}};
 const first=createFinanceMaterializationService(options);assert.equal((await first.request(owner,{})).status,'ready');assert.equal((await first.request(owner,{page:2,pageSize:50})).status,'ready');assert.equal(workers.length,1);assert.equal(ledgerReads,0);assert.equal(dirty,0);await first.dispose();
 const restarted=createFinanceMaterializationService(options);assert.equal((await restarted.request(owner,{})).status,'ready');assert.equal(workers[1].calls[0].type,'read');await restarted.dispose();
});
test('queued builds are bounded, persisted and survive page requests without spawning duplicate jobs',async()=>{
 let claims=0,enqueued=0,failed=0;const workers=[],job={tenant_id:'tenant',account_id:'one',revision:'7',lease_token:'lease'};
 const service=createFinanceMaterializationService({finance:{getRevision:async()=> '7'},rulesVersion:'fixture',start:false,store:{read:async()=>null,enqueue:async()=>{enqueued++;},enqueueDirty:async()=>{},claim:async()=>{claims++;return job;},fail:async()=>{failed++;}},createWorker:()=>{const w=new Worker();workers.push(w);return w;}});
 const result=await service.request(owner,{});assert.equal(result.status,'preparing');await tick();assert.equal(claims,1);assert.equal(enqueued,1);assert.equal(workers[0].calls[0].type,'build');assert.equal(failed,0);await service.dispose();
});
test('a cloud revision change cannot publish a stale read as current',async()=>{
 let n=0;const service=createFinanceMaterializationService({finance:{getRevision:async()=>++n===1?'1':'2'},store:{read:async()=>({state:'ready'})},rulesVersion:'fixture',start:false,createWorker:()=>new Worker()});
 assert.equal((await service.request(owner,{})).status,'preparing');await service.dispose();
});
test('projection paging and query inputs are bounded',()=>{
 for(const input of [{page:0},{pageSize:101},{pageSize:1.5},{search:'x'.repeat(257)},{transactionId:42},{other:1},{retry:'yes'}])assert.throws(()=>normalizeProjectionQuery(input));
 assert.equal(normalizeProjectionQuery({page:2,pageSize:50,search:'merchant'}).page,2);
 assert.equal(normalizeProjectionQuery({granularity:'auto'}).granularity,'auto');
});
test('miniapp requests retain the compact read contract without desktop details',async()=>{
 class CompactWorker extends Worker{postMessage(m){queueMicrotask(()=>this.emit('message',{id:m.id,result:{status:'ready',accounts:[{id:'a',label:'A',rawFields:{private:true}}],view:{transactions:[],currencyTotals:{CNY:{incomeMinor:'1'}}},hasStatisticsExclusions:true,globalReview:{transactionCount:1},ledger:{observations:['private']},trend:[]}}));}}
 const service=createFinanceMaterializationService({finance:{getRevision:async()=> '7'},store:{read:async()=>({state:'ready'})},rulesVersion:'fixture',start:false,createWorker:()=>new CompactWorker()});
 const r=await service.request(owner,{}, {compact:true});assert.equal(r.ledger,undefined);assert.equal(r.accounts[0].rawFields,undefined);assert.equal(r.view.hasStatisticsExclusions,true);assert.equal(r.view.review.transactionCount,1);await service.dispose();
});
test('imports release the calculation worker before parsing and serialize against each other',async()=>{
 class PendingWorker extends Worker{postMessage(m){this.calls.push(m);}async terminate(){this.terminated=true;return super.terminate();}}
 const workers=[],failed=[];let revision='7',claimed=false;
 const service=createFinanceMaterializationService({finance:{getRevision:async()=>revision},rulesVersion:'fixture',start:false,createWorker:()=>{const w=new PendingWorker();workers.push(w);return w;},store:{read:async()=>null,enqueue:async()=>{},enqueueDirty:async()=>{},claim:async()=>{if(claimed)return null;claimed=true;return{revision:'7'};},fail:async(job)=>failed.push(job)}});
 await service.request(owner,{});await tick();assert.equal(workers.length,1);
 let release;const gate=new Promise(r=>{release=r;}),order=[];
 const first=service.exclusive(async()=>{assert(workers.every(w=>w.terminated));order.push('first');revision='8';await gate;});
 const second=service.exclusive(async()=>{order.push('second');});await tick();assert.deepEqual(order,['first']);assert.equal(failed.length,1);release();await Promise.all([first,second]);assert.deepEqual(order,['first','second']);await service.dispose();
});
test('the default desktop page reads the persisted summary immediately without requiring an active calculation worker',async()=>{
 let boots=0;const service=createFinanceMaterializationService({finance:{getRevision:async()=> '7',getLedger:async()=>{throw Error('no source read');}},store:{read:async(_owner,_revision,options)=>{assert.equal(options.summary,true);return{state:'ready',completed_at:'saved',summary:{schema:'finance-default-query-v1',projection:{status:'ready',revision:'7',transactions:{total:57,items:[]}}}};}},start:false,jobsEnabled:false,rulesVersion:'fixture',createWorker:()=>{boots++;throw Error('must not start');}});
 const r=await service.request(owner,{currency:'CNY',granularity:'auto'});assert.equal(r.status,'ready');assert.equal(r.transactions.total,57);assert.equal(r.completedAt,'saved');assert.equal(boots,0);await service.dispose();
});
test('candidate mode never claims background jobs and another heavy task defers financial query work',async()=>{
 let claims=0,allowed=false;const store={read:async()=>({state:'ready'}),enqueueDirty:async()=>{claims++;},claim:async()=>null};
 const service=createFinanceMaterializationService({finance:{getRevision:async()=> '7'},store,rulesVersion:'fixture',jobsEnabled:false,start:true,canRun:()=>allowed,createWorker:()=>new Worker()});
 await service.pump();assert.equal(claims,0);assert.equal((await service.request(owner,{})).status,'busy');allowed=true;assert.equal((await service.request(owner,{})).status,'ready');await service.releaseIdle();await service.dispose();
});
test('market valuation enriches persisted defaults without a ledger rebuild and guards concurrent corrections',async()=>{
 let revision='7',valuations=0;const service=createFinanceMaterializationService({finance:{getRevision:async()=>revision},store:{read:async()=>({state:'ready',summary:{schema:'finance-default-query-v1',projection:{status:'ready',revision:'7',view:{securities:[]}}}})},marketData:{enrich:async p=>{valuations++;if(valuations===2)revision='8';return{...p,valued:true};}},jobsEnabled:false,start:false,rulesVersion:'fixture',createWorker:()=>{throw Error('must not rebuild');}});
 assert.equal((await service.request(owner,{currency:'CNY',granularity:'auto'})).valued,true);assert.equal((await service.request(owner,{currency:'CNY',granularity:'auto'})).status,'preparing');await service.dispose();
});
