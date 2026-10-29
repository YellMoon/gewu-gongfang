'use strict';
const {parentPort}=require('node:worker_threads'),{prepareFinanceView}=require('../../shared/personal-finance/ledger'),{buildTrend}=require('../../shared/personal-finance/accountAnalytics');
let project,accounts,revision,review;
async function readOwnerLedger(owner){
 const {Pool}=require('pg'),{resolveRuntimeDatabaseUser}=require('./runtimeDatabaseRole'),pool=new Pool({host:process.env.POSTGRES_HOST||'gewu-postgres17',port:Number(process.env.POSTGRES_PORT||5432),database:process.env.POSTGRES_DB||'gewu_cloud',user:resolveRuntimeDatabaseUser(process.env.POSTGRES_USER),password:process.env.POSTGRES_PASSWORD,max:1,connectionTimeoutMillis:10000});
 const c=await pool.connect();try{await c.query('BEGIN READ ONLY');const finance=require('./personalFinanceRepository').createPersonalFinanceRepository({query:(s,v)=>c.query(s,v),transaction:()=>{throw Error('READ_ONLY_PROJECTION');},parseBillFile:()=>{throw Error('READ_ONLY_PROJECTION');},fundNavService:require('./fundNavService').createFundNavService()});const ledger=await finance.getLedger(owner);await c.query('COMMIT');return ledger;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();await pool.end();}
}
parentPort.on('message',async message=>{
 try{
  if(message.type==='initialize_owner')message={type:'initialize',ledger:await readOwnerLedger(message.owner)};
  if(message.type==='initialize'){
   project=prepareFinanceView(message.ledger);const full=project({});review=full.review;revision=message.ledger.revision;
   accounts=message.ledger.accounts.map(({id,label,provider,type,currency,maskedIdentifier,status})=>({id,label,provider,type,currency,maskedIdentifier,status}));parentPort.postMessage({type:'ready',revision});return;
  }
  if(message.type==='scope'&&project){const {granularity,...options}=message.scope,v=project(options),view={};for(const k of ['accountStats','currencyTotals','portfolioBalances','mortgages','comparison','categoryTotals','fundingBreakdown'])view[k]=v[k];view.review=review;view.hasStatisticsExclusions=v.transactions.some(t=>t.statisticsExclusions?.length);parentPort.postMessage({type:'result',id:message.id,result:{status:'ready',revision,accounts,view,trend:buildTrend(v.transactions,{...options,granularity,currencies:Object.keys(v.currencyTotals)})}});}
 }catch{parentPort.postMessage({type:'failed',id:message.id});}
});
