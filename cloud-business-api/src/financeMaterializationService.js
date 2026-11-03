'use strict';
const {Worker}=require('node:worker_threads'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto'),v8=require('node:v8');
const {normalizeScope}=require('./financeProjectionService');
const invalid=()=>Object.assign(Error('CLOUD_PERSONAL_FINANCE_INPUT_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_INPUT_INVALID'});
function financeRulesVersion(){const dir=path.resolve(__dirname,'../../shared/personal-finance'),hash=crypto.createHash('sha256');for(const file of fs.readdirSync(dir).filter(n=>n.endsWith('.js')&&!n.endsWith('.test.js')).sort()){hash.update(file);hash.update(fs.readFileSync(path.join(dir,file)));}hash.update(fs.readFileSync(path.join(__dirname,'financeMaterializationWorker.js')));hash.update(String(v8.cachedDataVersionTag()));return hash.digest('hex');}
function normalizeProjectionQuery(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw invalid();
 const allowed=['accountIds','startDate','endDate','granularity','currency','search','kind','category','reviewGroupId','page','pageSize','transactionId','retry'];if(Object.keys(input).some(k=>!allowed.includes(k)))throw invalid();
 const base={};for(const k of['accountIds','startDate','endDate','granularity'])if(input[k]!==undefined)base[k]=input[k];const auto=input.granularity==='auto';if(auto)base.granularity='month';const result=normalizeScope(base);if(auto)result.granularity='auto';
 for(const k of['currency','search','kind','category','reviewGroupId','transactionId'])if(input[k]!==undefined){if(typeof input[k]!=='string'||input[k].length>(k==='reviewGroupId'?2048:256))throw invalid();result[k]=input[k];}
 for(const[k,max]of[['page',1000000],['pageSize',100]])if(input[k]!==undefined){if(!Number.isSafeInteger(input[k])||input[k]<1||input[k]>max)throw invalid();result[k]=input[k];}
 if(input.retry!==undefined){if(typeof input.retry!=='boolean')throw invalid();result.retry=input.retry;}
 return result;
}
function createFinanceMaterializationService({finance,store,marketData=null,rulesVersion=financeRulesVersion(),createWorker=()=>new Worker(path.join(__dirname,'financeMaterializationWorker.js'),{workerData:{rulesVersion},resourceLimits:{maxOldGenerationSizeMb:512,maxYoungGenerationSizeMb:16}}),canRun=()=>true,jobsEnabled=process.env.CLOUD_FINANCE_MATERIALIZER_ENABLED!=='0',start=true}={}){
 let closed=false,pumping=false,reading=0,mutating=0,nextId=0,reader,builder,mutationQueue=Promise.resolve();const workers=new Set();
 function boot(){const worker=createWorker(),pending=new Map();workers.add(worker);worker.unref?.();
  const rejectAll=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CLOUD_PERSONAL_FINANCE_UNAVAILABLE'));}pending.clear();};
  worker.on('message',m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Object.assign(Error(m.error),{code:m.error})):p.resolve(m.result);});worker.on('error',rejectAll);worker.on('exit',()=>{rejectAll();workers.delete(worker);if(reader?.worker===worker)reader=null;if(builder?.worker===worker)builder=null;});
  return{worker,call(type,payload,timeoutMs){return new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error('CLOUD_PERSONAL_FINANCE_UNAVAILABLE'));void worker.terminate();},timeoutMs);timer.unref?.();pending.set(id,{resolve,reject,timer});worker.postMessage({id,type,...payload});});}};
 }
 async function pump(){if(closed||!jobsEnabled||pumping||reading||mutating||!canRun())return;pumping=true;let job;try{await store.enqueueDirty();job=await store.claim();if(!job)return;if(reader){await reader.worker.terminate();reader=null;}if(mutating){await store.fail(job,'FINANCE_MATERIALIZATION_FAILED');return;}builder=boot();const result=await builder.call('build',{job},28*60*1000);if(!result.saved)await store.fail(job,'FINANCE_MATERIALIZATION_OBSOLETE');}catch(e){if(job)await store.fail(job,'FINANCE_MATERIALIZATION_FAILED').catch(()=>{});}finally{if(builder){await builder.worker.terminate();builder=null;}pumping=false;}}
 const timer=start&&jobsEnabled?setInterval(()=>{void pump();},10000):null;timer?.unref?.();if(start)void pump();
 return{
  materialized:true,
  isBusy:()=>pumping||reading>0||mutating>0,
  async releaseIdle(){if(!pumping&&!reading&&reader){await reader.worker.terminate();reader=null;}},
  async request(owner,input={},options={}){const query=normalizeProjectionQuery(input),revision=await finance.getRevision(owner);if(query.retry&&store.retry)await store.retry(owner,revision);
   const defaultQuery=!options.compact&&!options.tuitionContext&&query.currency==='CNY'&&query.granularity==='auto'&&!query.accountIds?.length&&!query.startDate&&!query.endDate&&!query.search&&!query.category&&(!query.kind||query.kind==='all')&&!query.reviewGroupId&&!query.transactionId&&(!query.page||query.page===1)&&(!query.pageSize||query.pageSize===50);
   const row=await store.read(owner,revision,{summary:defaultQuery});if(row?.state!=='ready'){await store.enqueue(owner,revision);void pump();return{status:row?.state==='failed'?'failed':'preparing',revision,rulesVersion,retryAfterMs:3000,errorCode:row?.error_code||null};}
   if(defaultQuery&&row.summary?.schema==='finance-default-query-v1'&&row.summary.projection?.revision===revision){
    if(await finance.getRevision(owner)!==revision)return{status:'preparing',revision:await finance.getRevision(owner),rulesVersion,retryAfterMs:2000};
    if(jobsEnabled&&!pumping&&!mutating&&!reader&&canRun()){
     reader=boot();reading++;void reader.call('warm',{owner,revision,valuationDay:row.valuation_day},60000).catch(()=>{}).finally(()=>{reading--;});
    }
    const result={...row.summary.projection,completedAt:row.completed_at,rulesVersion};
    const valued=marketData?await marketData.enrich(result,query):result;
    if(marketData&&await finance.getRevision(owner)!==revision)return{status:'preparing',revision:await finance.getRevision(owner),rulesVersion,retryAfterMs:2000};
    return valued;
   }
   if(pumping||mutating||reading>=4||!canRun())return{status:'busy',revision,rulesVersion,retryAfterMs:3000};
   if(!reader)reader=boot();let result;reading++;try{result=await reader.call('read',{owner,revision,valuationDay:row.valuation_day,input:{...query,...(options.tuitionContext?{tuitionContext:options.tuitionContext}:{})}},60000);}finally{reading--;}
   if(await finance.getRevision(owner)!==revision)return{status:'preparing',revision:await finance.getRevision(owner),rulesVersion,retryAfterMs:2000};
   if(marketData&&!options.tuitionContext){result=await marketData.enrich(result,query);if(await finance.getRevision(owner)!==revision)return{status:'preparing',revision:await finance.getRevision(owner),rulesVersion,retryAfterMs:2000};}
   if(options.compact&&result.status==='ready'){
    const view={};for(const key of ['accountStats','currencyTotals','portfolioBalances','balanceGroups','securitiesPeriodSummary','mortgages','comparison','categoryTotals','fundingBreakdown'])view[key]=result.view[key];
    view.review=result.globalReview;view.hasStatisticsExclusions=!!result.hasStatisticsExclusions;
    return{status:'ready',revision,rulesVersion,completedAt:result.completedAt,accounts:result.accounts.map(({id,label,provider,type,currency,maskedIdentifier,status})=>({id,label,provider,type,currency,maskedIdentifier,status})),view,trend:result.trend};
   }
   return{...result,rulesVersion};
  },
  async exclusive(work){mutating++;const run=mutationQueue.catch(()=>{}).then(async()=>{
    await Promise.all([...workers].map(w=>w.terminate()));
    return work();
   });mutationQueue=run;try{return await run;}finally{mutating--;void pump();}},
  async dispose(){closed=true;clearInterval(timer);await Promise.all([...workers].map(w=>w.terminate()));},
  pump,
 };
}
module.exports={financeRulesVersion,normalizeProjectionQuery,createFinanceMaterializationService};
