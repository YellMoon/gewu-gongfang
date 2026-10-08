'use strict';
const assert=require('node:assert/strict');
let registerPersonalFinanceRoutes;try{({registerPersonalFinanceRoutes}=require('./personalFinanceRoutes'));}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
assert.equal(typeof registerPersonalFinanceRoutes,'function','finance routes must exist');
(async()=>{
 const routes=new Map(),app=Object.fromEntries(['get','post','patch','delete'].map(method=>[method,(path,handler)=>routes.set(method+' '+path,handler)]));
 const actor={accountId:'alice',roles:['teacher']};let received;
 const finance={getLedger:async input=>{received=input;return {revision:'0',accounts:[]};},previewImport:async input=>{received=input;return {records:[]};},import:async input=>{received=input;return {importId:'i'};},createAccount:async()=>({}),updateAccount:async()=>({}),createLink:async()=>({}),deleteLink:async()=>({}),createBalanceSnapshot:async()=>({}),annotateObservation:async input=>{received=input;return {annotation:{id:'annotation'}};}};
 registerPersonalFinanceRoutes({app,finance,tenantId:'tenant',desktopContext:async()=>actor,miniappContext:async()=>actor});
 const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
 await routes.get('get /api/business/personal-finance/ledger')({},res);assert.equal(res.body.ok,true);assert.deepEqual(received,{tenantId:'tenant',actor});
 for(const method of ['post','patch','delete']) assert.equal([...routes.keys()].filter(k=>k.startsWith(method+' /api/business/miniapp-personal-finance/')).some(k=>/accounts|links|balance-snapshots/.test(k)),false,'miniapp has no arbitrary edit routes');
 await routes.get('post /api/business/miniapp-personal-finance/imports')({body:{filename:'bill.csv',base64:'YQ==',financialAccountId:'bank',accountId:'mallory'},get:()=>''},res);assert.equal(res.statusCode,400);assert.equal(res.body.code,'CLOUD_PERSONAL_FINANCE_INPUT_INVALID');
 await routes.get('post /api/business/miniapp-personal-finance/imports')({body:{filename:'bill.csv',base64:'YQ==',financialAccountId:'bank'},get:()=> 'retry'},res);assert.equal(received.actor.accountId,'alice');assert.equal(received.idempotencyKey,'retry');
 assert.equal(typeof routes.get('patch /api/business/personal-finance/transactions/:observationId'),'function','desktop can correct purpose without changing original observations');
 assert.equal(routes.has('patch /api/business/miniapp-personal-finance/transactions/:observationId'),false,'miniapp cannot rewrite classifications');
 await routes.get('patch /api/business/personal-finance/transactions/:observationId')({params:{observationId:'observation'},body:{patch:{category:'Food'},expectedRevision:'3'}},res);assert.equal(received.observationId,'observation');assert.equal(received.actor.accountId,'alice');
 registerPersonalFinanceRoutes({app,finance,tenantId:'tenant',desktopContext:async()=>{throw Object.assign(new Error('auth denied'),{code:'CLOUD_BUSINESS_ACCESS_DENIED'});},miniappContext:async()=>actor});
 await routes.get('get /api/business/personal-finance/ledger')({},res);assert.equal(res.statusCode,403,'expired authorization preserves access denial status');
 console.log('personal finance routes scopes and miniapp mutation boundary passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
