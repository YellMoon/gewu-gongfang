'use strict';
const {Worker}=require('node:worker_threads'),path=require('node:path');
const unavailable=()=>Object.assign(Error('CLOUD_PERSONAL_FINANCE_UNAVAILABLE'),{code:'CLOUD_PERSONAL_FINANCE_UNAVAILABLE'});
function normalizeScope(value={}){
 const invalid=()=>{throw Object.assign(Error('CLOUD_PERSONAL_FINANCE_INPUT_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_INPUT_INVALID'});};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['accountIds','startDate','endDate','granularity'].includes(k)))invalid();
 const result={granularity:value.granularity||'month'};if(!['day','week','month'].includes(result.granularity))invalid();
 if(value.accountIds!==undefined){if(!Array.isArray(value.accountIds)||value.accountIds.length>256||value.accountIds.some(id=>typeof id!=='string'||!id||id.length>512)||new Set(value.accountIds).size!==value.accountIds.length)invalid();if(value.accountIds.length)result.accountIds=[...value.accountIds].sort();}
 for(const k of ['startDate','endDate'])if(value[k]!==undefined&&value[k]!==''){if(!require('../../shared/personal-finance/ledger').validDate(value[k]))invalid();result[k]=value[k];}if(result.startDate&&result.endDate&&result.startDate>result.endDate)invalid();return result;
}
function createFinanceProjectionService({finance,createWorker=()=>new Worker(path.join(__dirname,'financeProjectionWorker.js'),{resourceLimits:{maxOldGenerationSizeMb:512,maxYoungGenerationSizeMb:16}}),loadInWorker=false,idleMs=10*60*1000,maxOwners=1,now=Date.now}={}){
 const jobs=new Map(),terminating=new Set();let nextId=0,exclusiveCount=0,exclusiveQueue=Promise.resolve(),closed=false;
 const valuationDay=()=>new Date(now()+8*3600000).toISOString().slice(0,10);
 const dispose=job=>{if(job.disposed)return job.stopped;job.disposed=true;clearTimeout(job.idle);for(const p of job.pending.values()){clearTimeout(p.timer);p.reject(unavailable());}job.pending.clear();if(jobs.get(job.key)===job)jobs.delete(job.key);
  let termination;try{termination=job.worker?.terminate();}catch{job.terminationFailed=true;}
  const stopped=Promise.all([job.initializing,termination]).catch(()=>{job.terminationFailed=true;}).then(()=>{terminating.delete(stopped);});job.stopped=stopped;terminating.add(stopped);return stopped;
 };
 const touch=job=>{clearTimeout(job.idle);job.idle=setTimeout(()=>dispose(job),idleMs);job.idle.unref?.();};
 const start=(key,owner,revision)=>{
  const job={key,revision,valuationDay:valuationDay(),status:'preparing',disposed:false,pending:new Map()};jobs.set(key,job);touch(job);
  job.initializing=Promise.resolve().then(()=>job.disposed||loadInWorker?null:finance.getLedger(owner)).then(ledger=>{
   if(job.disposed)return;if(ledger)job.revision=ledger.revision;const worker=createWorker();job.worker=worker;worker.unref?.();
   worker.on('message',m=>{if(job.disposed||job.worker!==worker)return;if(m.type==='ready'){job.status='ready';if(m.revision)job.revision=m.revision;}else if(m.type==='failed'){job.status='failed';for(const p of job.pending.values()){clearTimeout(p.timer);p.reject(unavailable());}job.pending.clear();}else if(m.type==='result'){const p=job.pending.get(m.id);if(p){clearTimeout(p.timer);job.pending.delete(m.id);p.resolve(m.result);}}});
   worker.on('error',()=>{if(!job.disposed){job.status='failed';for(const p of job.pending.values()){clearTimeout(p.timer);p.reject(unavailable());}job.pending.clear();}});
   worker.on('exit',code=>{if(!job.disposed&&code!==0)job.status='failed';});worker.postMessage(loadInWorker?{type:'initialize_owner',owner}:{type:'initialize',ledger});
  }).catch(()=>{if(!job.disposed)job.status='failed';});return job;
 };
 return {
  async request(owner,input){const scope=normalizeScope(input),revision=await finance.getRevision(owner),key=JSON.stringify([owner.tenantId,owner.actor.accountId]);if(closed)throw unavailable();if(exclusiveCount||terminating.size)return{status:'busy',retryAfterMs:3000};let job=jobs.get(key);if(job&&(job.revision!==revision||job.valuationDay!==valuationDay())){dispose(job);return{status:'preparing',revision,retryAfterMs:2000};}if(!job){if(jobs.size>=maxOwners)return{status:'busy',retryAfterMs:3000};job=start(key,owner,revision);}touch(job);if(job.status==='failed'){dispose(job);throw unavailable();}if(job.status!=='ready')return{status:'preparing',revision:job.revision,retryAfterMs:2000};if(job.pending.size>=8)return{status:'busy',retryAfterMs:2000};return new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{job.pending.delete(id);reject(unavailable());},30000);timer.unref?.();job.pending.set(id,{resolve,reject,timer});job.worker.postMessage({type:'scope',id,scope});});},
  exclusive(work){
   if(closed||exclusiveCount>=4)return Promise.reject(unavailable());exclusiveCount++;
   const result=exclusiveQueue.then(async()=>{if(closed)throw unavailable();const active=[...jobs.values()];for(const job of active)dispose(job);await Promise.all([...terminating]);if(active.some(job=>job.terminationFailed))throw unavailable();return work();});
   exclusiveQueue=result.catch(()=>{});return result.finally(()=>{exclusiveCount--;});
  },
  dispose(){closed=true;for(const job of jobs.values())dispose(job);return Promise.all([...terminating]);},
 };
}
module.exports={createFinanceProjectionService,normalizeScope};
