'use strict';
const {parentPort,workerData}=require('node:worker_threads'),v8=require('node:v8'),zlib=require('node:zlib');
const {Pool}=require('pg'),{resolveRuntimeDatabaseUser}=require('./runtimeDatabaseRole');
const {createPersonalFinanceRepository}=require('./personalFinanceRepository');
const {createFinanceMaterializationRepository}=require('./financeMaterializationRepository');
const {materializeFinanceView,restoreFinanceView}=require('../../shared/personal-finance/ledger');
const {buildAssetRegister}=require('../../shared/personal-finance/assetRegister');
const {buildTrend}=require('../../shared/personal-finance/accountAnalytics');
const {importMetadata}=require('./financeReadMetadata');
const pool=new Pool({host:process.env.POSTGRES_HOST||'gewu-postgres17',port:Number(process.env.POSTGRES_PORT||5432),database:process.env.POSTGRES_DB||'gewu_cloud',user:resolveRuntimeDatabaseUser(process.env.POSTGRES_USER),password:process.env.POSTGRES_PASSWORD,max:1,connectionTimeoutMillis:10000});
const query=(s,v)=>pool.query(s,v),store=createFinanceMaterializationRepository({query,rulesVersion:workerData.rulesVersion});
let loaded,project,cachedScope,cachedView;
function ownerFor(job){return{tenantId:job.tenant_id,actor:{accountId:job.account_id,roles:['teacher']}};}
function summary(bundle,view){
 const scoped={};for(const key of ['accountStats','portfolioBalances','currencyTotals','categoryTotals','fundingBreakdown','comparison','mortgages','fundValuations','investmentTrades','unresolvedAssociations','information'])scoped[key]=view[key];
 return{revision:bundle.revision,accounts:bundle.accounts,assetRegister:bundle.assetRegister,view:{...scoped,transactions:[]},globalReview:bundle.globalReview,hasStatisticsExclusions:view.transactions.some(t=>t.statisticsExclusions?.length),completedAt:new Date().toISOString()};
}
async function build(job){
 const owner=ownerFor(job),c=await pool.connect();let ledger;
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const finance=createPersonalFinanceRepository({query:(s,v)=>c.query(s,v),transaction:()=>{throw Error('PROJECTION_READ_ONLY');},parseBillFile:()=>{throw Error('PROJECTION_READ_ONLY');},fundNavService:require('./fundNavService').createFundNavService()});
  ledger=await finance.getLedger(owner);await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 if(ledger.revision!==job.revision)return false;
 const state=materializeFinanceView(ledger),nextProject=restoreFinanceView(state),full=nextProject({}),assetRegister=buildAssetRegister(ledger);
 const observationScopes=Object.fromEntries(ledger.observations.map(o=>[o.id,{id:o.id,currency:o.currency,date:o.date,financialAccountId:o.financialAccountId,accountRelations:o.accountRelations}]));
 const bundle={schema:'finance-materialization-v1',runtime:v8.cachedDataVersionTag(),revision:ledger.revision,state,accounts:ledger.accounts,imports:ledger.imports.map(importMetadata),links:ledger.links,assetRegister,observationScopes,globalReview:full.review};
 const payload=zlib.gzipSync(v8.serialize(bundle),{level:1});
 const defaultProjection=projectionResult(bundle,full,{currency:'CNY',page:1,pageSize:50,granularity:'auto'},new Date().toISOString());
 return store.complete(job,payload,{schema:'finance-default-query-v1',projection:defaultProjection});
}
async function load(owner,revision,valuationDay){
 const key=JSON.stringify([owner.tenantId,owner.actor.accountId,revision,valuationDay]);if(loaded?.key===key)return;
 const row=await store.read(owner,revision,{payload:true});if(row?.state!=='ready')throw Error('FINANCE_MATERIALIZATION_NOT_READY');
 const bundle=v8.deserialize(zlib.gunzipSync(row.payload));if(bundle.schema!=='finance-materialization-v1'||bundle.runtime!==v8.cachedDataVersionTag()||bundle.revision!==revision)throw Error('FINANCE_MATERIALIZATION_INVALID');
 loaded={key,bundle,completedAt:row.completed_at};project=restoreFinanceView(bundle.state);cachedScope=cachedView=undefined;
}
function transactionPage(view,input,bundle=loaded.bundle){
 const {statisticsState}=require('../../shared/personal-finance/transactionStatisticsState'),issues=new Map();
 for(const issue of view.unresolvedAssociations)for(const id of [issue.observationId,...(issue.observationIds||[])].filter(Boolean))issues.set(id,[...(issues.get(id)||[]),issue.reason]);
 const presentation=t=>statisticsState(t,t.observationIds.flatMap(id=>issues.get(id)||[]));
 let rows=view.transactions;const text=String(input.search||'').toLowerCase(),ids=input.reviewGroupId?new Set(bundle.globalReview.groups.find(g=>g.id===input.reviewGroupId)?.transactionIds||[]):null;
 if(input.currency)rows=rows.filter(t=>t.currency===input.currency);
 if(input.kind&&input.kind!=='all'){
  rows=rows.filter(t=>presentation(t).key===input.kind);
 }
 if(input.category)rows=rows.filter(t=>t.category===input.category);
 if(ids)rows=rows.filter(t=>ids.has(t.id));
 if(text)rows=rows.filter(t=>[t.date,t.description,t.counterparty,t.sourceTransactionId,...t.financialAccountIds.map(id=>bundle.accounts.find(a=>a.id===id)?.label)].some(s=>String(s||'').toLowerCase().includes(text)));
 rows=[...rows].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
 const page=input.page||1,pageSize=input.pageSize||50;
 const items=rows.slice((page-1)*pageSize,page*pageSize).map(t=>{
  const {rawFields,...item}=t;
  return{...item,statisticsPresentation:presentation(t),sources:(t.sources||[]).map(({id,provider,financialAccountId,date,occurredAt,description,counterparty,sourceTransactionId,kind,status,amountMinor,currency,direction})=>({id,provider,financialAccountId,date,occurredAt,description,counterparty,sourceTransactionId,kind,status,amountMinor,currency,direction}))};
 });return{page,pageSize,total:rows.length,items};
}
async function read(owner,revision,input,valuationDay){
 await load(owner,revision,valuationDay);const scope={};for(const key of['accountIds','startDate','endDate'])if(input[key]!==undefined)scope[key]=input[key];
 if(scope.accountIds?.some(id=>!loaded.bundle.accounts.some(a=>a.id===id)))throw Error('CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
 const key=JSON.stringify(scope);if(cachedScope!==key){cachedView=project(scope);cachedScope=key;}
 if(input.tuitionContext){
  const {buildTuitionCandidates}=require('../../shared/personal-finance/tuitionReview'),context={...input.tuitionContext,transactions:cachedView.transactions};
  return{status:'ready',revision,candidates:buildTuitionCandidates({...context,includeAll:true}),likelyIds:buildTuitionCandidates(context).map(r=>r.id)};
 }
 if(input.transactionId){const row=cachedView.transactions.find(t=>t.id===input.transactionId);if(!row)throw Error('CLOUD_PERSONAL_FINANCE_NOT_FOUND');return{revision,transaction:row};}
 return projectionResult(loaded.bundle,cachedView,input,loaded.completedAt);
}
function projectionResult(bundle,cachedView,input,completedAt){
 const page=transactionPage(cachedView,input,bundle),base=summary(bundle,cachedView);
 const dateBounds=cachedView.transactions.reduce((b,t)=>({start:!b.start||t.date<b.start?t.date:b.start,end:!b.end||t.date>b.end?t.date:b.end}),{start:'',end:''});
 const sourceIds=new Set([...bundle.assetRegister.products.flatMap(p=>p.sourceObservationIds||[]),...bundle.assetRegister.conversions.map(c=>c.id)]);
 const sourceScopes=[...sourceIds].map(id=>bundle.observationScopes[id]).filter(Boolean);
 const investmentFeeMinor=cachedView.investmentTrades.filter(t=>!input.currency||bundle.observationScopes[t.id]?.currency===input.currency).reduce((n,t)=>n+BigInt(t.feeMinor),0n).toString();
 return{status:'ready',...base,dateBounds,completedAt,sourceScopes,investmentFeeMinor,ledger:{revision:bundle.revision,accounts:bundle.accounts,observations:[],annotations:[],links:bundle.links,imports:bundle.imports.map(importMetadata),balanceSnapshots:[],legacyRecords:[]},view:base.view,transactions:page,trend:buildTrend(cachedView.transactions,{...input,granularity:input.granularity==='auto'?((Date.parse(dateBounds.end)-Date.parse(dateBounds.start))/86400000<=62?'day':(Date.parse(dateBounds.end)-Date.parse(dateBounds.start))/86400000<=180?'week':'month'):input.granularity||'month',currencies:input.currency?[input.currency]:[...new Set(bundle.accounts.map(a=>a.currency))]})};
}
let queue=Promise.resolve();
parentPort.on('message',message=>{queue=queue.then(async()=>{
 try{
  if(message.type==='build'){const saved=await build(message.job);parentPort.postMessage({id:message.id,result:{saved}});return;}
  if(message.type==='warm'){await load(message.owner,message.revision,message.valuationDay);cachedView=project({});cachedScope='{}';parentPort.postMessage({id:message.id,result:{ready:true}});return;}
  if(message.type==='read'){const result=await read(message.owner,message.revision,message.input,message.valuationDay);parentPort.postMessage({id:message.id,result});return;}
  if(message.type==='close'){await pool.end();return;}
  throw Error('FINANCE_MATERIALIZATION_INPUT_INVALID');
 }catch(e){parentPort.postMessage({id:message.id,error:/^[A-Z_]+$/.test(e.message||'')?e.message:'FINANCE_MATERIALIZATION_FAILED'});}
});});
