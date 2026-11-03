'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),v8=require('node:v8'),zlib=require('node:zlib'),{Worker}=require('node:worker_threads');
const {materializeFinanceView,restoreFinanceView}=require('../../shared/personal-finance/ledger'),{buildAssetRegister}=require('../../shared/personal-finance/assetRegister');
function fixture(accountId){
 const account={id:accountId,label:accountId,provider:'wechat',type:'wallet',currency:'CNY',status:'active',openingBalanceMinor:null,openingDate:null};
 const ledger={revision:'7',accounts:[account],observations:Array.from({length:57},(_,i)=>({id:accountId+'-'+i,financialAccountId:accountId,provider:'wechat',sourceTransactionId:'receipt-'+i,occurredAt:'2026-10-01T10:00:00+08:00',date:'2026-10-01',amountMinor:String(100+i),currency:'CNY',direction:'credit',kind:'income',description:'tuition '+i,counterparty:'Parent',category:'Education',paymentChannel:'',paymentAccountHint:'',balanceMinor:null,relatedReference:'',status:'completed',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{privateOriginal:'preserved'}})),links:[],annotations:[],balanceSnapshots:[],imports:[],legacyRecords:[]};
 const state=materializeFinanceView(ledger),full=restoreFinanceView(state)({});
 return{schema:'finance-materialization-v1',runtime:v8.cachedDataVersionTag(),revision:'7',state,accounts:ledger.accounts,imports:[],links:[],assetRegister:buildAssetRegister(ledger),observationScopes:{},globalReview:full.review};
}
test('the real cloud worker restores persisted facts, pages them, isolates owners and reads originals only on demand',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-materialization-')),repository=require.resolve('./financeMaterializationRepository');
 for(const id of ['alice','bob'])fs.writeFileSync(path.join(dir,id+'.bin'),zlib.gzipSync(v8.serialize(fixture(id))));
 const preload=path.join(dir,'preload.cjs');
 fs.writeFileSync(preload,`const fs=require('node:fs');require.cache[${JSON.stringify(repository)}]={exports:{createFinanceMaterializationRepository:()=>({read:async(owner)=>{if(owner.tenantId!=='fixture'||!['alice','bob'].includes(owner.actor.accountId))return null;return{state:'ready',payload:fs.readFileSync(${JSON.stringify(dir)}+'/'+owner.actor.accountId+'.bin'),completed_at:'2026-11-03T00:00:00Z'};}})}};`,'utf8');
 const worker=new Worker(path.join(__dirname,'financeMaterializationWorker.js'),{workerData:{rulesVersion:'fixture'},execArgv:['--require',preload]});let next=0;const pending=new Map();
 worker.on('message',m=>{const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
 worker.on('error',e=>{for(const p of pending.values())p.reject(e);pending.clear();});
 const read=(accountId,input={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});worker.postMessage({id,type:'read',owner:{tenantId:'fixture',actor:{accountId,roles:['teacher']}},revision:'7',input});});
 try{
  const warmed=await new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});worker.postMessage({id,type:'warm',owner:{tenantId:'fixture',actor:{accountId:'alice',roles:['teacher']}},revision:'7'});});assert.equal(warmed.ready,true);
  const first=await read('alice',{page:1,pageSize:50}),second=await read('alice',{page:2,pageSize:50});
  assert.equal(first.transactions.total,57);assert.equal(first.transactions.items.length,50);assert.equal(second.transactions.items.length,7);assert.equal(new Set([...first.transactions.items,...second.transactions.items].map(t=>t.id)).size,57);
  assert.deepEqual(first.ledger.observations,[]);assert(!JSON.stringify(first).includes('privateOriginal'));assert.equal(first.view.currencyTotals.CNY.incomeMinor,'7296');
  assert.deepEqual(first.view.securities,[]);assert.deepEqual(first.view.securitiesPeriodSummary,[]);assert.equal(first.view.balanceGroups[0].key,'other');assert.doesNotThrow(()=>JSON.stringify(first));
  const row=first.transactions.items[0],detail=await read('alice',{transactionId:row.id});assert.equal(detail.transaction.sources[0].rawFields.privateOriginal,'preserved');assert.equal(detail.revision,'7');
  const [a,b,a2]=await Promise.all([read('alice'),read('bob'),read('alice',{search:'tuition 56'})]);assert(a.transactions.items.every(t=>t.financialAccountIds.includes('alice')));assert(b.transactions.items.every(t=>t.financialAccountIds.includes('bob')));assert.equal(a2.transactions.total,1);
  const tuition=await read('alice',{tuitionContext:{students:[],payments:[],links:[]}});assert.equal(tuition.candidates.length,57);
  await assert.rejects(read('alice',{transactionId:'bob-0'}),/NOT_FOUND/);
 }finally{await worker.terminate();fs.rmSync(dir,{recursive:true,force:true});}
});
