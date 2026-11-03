'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFinanceMaterializationRepository}=require('./financeMaterializationRepository');
const owner={tenantId:'tenant',actor:{accountId:'one',roles:['teacher']}};
test('every persisted read binds tenant, account, revision, rules and valuation date; payload is explicit',async()=>{
 const calls=[],repo=createFinanceMaterializationRepository({rulesVersion:'rules',day:()=> '2026-11-03',query:async(sql,values)=>{calls.push({sql,values});return{rows:[]};}});
 await repo.read(owner,'7');assert.deepEqual(calls[0].values,['tenant','one','7','rules','2026-11-03']);assert(!calls[0].sql.includes(',payload'));
 await repo.read(owner,'7',{payload:true});assert(calls[1].sql.includes(',payload'));
 await assert.rejects(repo.read({...owner,actor:{accountId:'two',roles:['student']}},'7'),/ACCESS_DENIED/);assert.equal(calls.length,2);
});
test('job receipts are lease guarded and revision checked; no business originals are updated',async()=>{
 const calls=[],repo=createFinanceMaterializationRepository({rulesVersion:'rules',query:async(sql,values)=>{calls.push({sql,values});return{rows:[]};}}),job={tenant_id:'t',account_id:'a',revision:'7',rules_version:'rules',valuation_day:'2026-11-03',lease_token:'token'};
 assert.equal(await repo.complete(job,Buffer.from('computed'),{}),false);assert.match(calls[0].sql,/o.revision=m.revision/);assert.match(calls[0].sql,/m.lease_token=\$6/);assert.match(calls[0].sql,/lease_expires_at>clock_timestamp/);assert.equal(calls[0].values[5],'token');
 await repo.claim();assert.match(calls[1].sql,/attempts>=3/);assert.match(calls[2].sql,/SKIP LOCKED/);assert.match(calls[2].sql,/attempts<3/);
});
