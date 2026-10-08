'use strict';
const assert=require('node:assert/strict');
let createPersonalFinanceRepository;try{({createPersonalFinanceRepository}=require('./personalFinanceRepository'));}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
assert.equal(typeof createPersonalFinanceRepository,'function','repository must exist');
(async()=>{
  let queries=0;
  const query=async()=>{queries++;return {rows:[]};};
  const repo=createPersonalFinanceRepository({query,transaction:async work=>work(query),parseBillFile:()=>({})});
  for(const roles of [['student'],['family_member'],[],['admin']]) await assert.rejects(repo.getLedger({tenantId:'test',actor:{accountId:'alice',roles}}),/ACCESS_DENIED/);
  assert.equal(queries,0,'unauthorized requests never query finance data');
  await assert.rejects(repo.createAccount({tenantId:'test',actor:{accountId:'alice',roles:['teacher']},account:{id:'bank',label:'bank',provider:'bank',type:'bank',maskedIdentifier:'1234',currency:'CNY',openingBalanceMinor:1.1,openingDate:null,status:'active'}}),/INPUT_INVALID/);
  await assert.rejects(repo.previewImport({tenantId:'test',actor:{accountId:'alice',roles:['teacher']},filename:'a.csv',base64:'not base64',financialAccountId:'bank'}),/INPUT_INVALID/);
  assert.equal(queries,0);
  const canonical={sourceTransactionId:'test',occurredAt:'2026-10-08T00:00:00Z',date:'2026-10-08',amountMinor:'1',currency:'CNY',direction:'debit',kind:'expense',description:'',counterparty:'',category:'',paymentChannel:'',paymentAccountHint:'',balanceMinor:null,relatedReference:'',status:'completed',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{}};
  const previewRepo=createPersonalFinanceRepository({query:async()=>({rows:[{data:{status:'active',currency:'CNY'}}]}),transaction:async()=>{},parseBillFile:()=>({provider:'generic',templateId:null,records:[],errors:[{message:'Unrecognized headers'}],warnings:[]})});
  const unknownPreview=await previewRepo.previewImport({tenantId:'test',actor:{accountId:'alice',roles:['teacher']},filename:'unknown.csv',base64:'YQ==',financialAccountId:'bank'});assert.equal(unknownPreview.templateId,null);assert.equal(unknownPreview.errors[0].message,'Unrecognized headers');
  assert.equal((await previewRepo.previewImport({tenantId:'test',actor:{accountId:'alice',roles:['teacher']},filename:'large.csv',base64:Buffer.alloc(5*1024*1024,65).toString('base64'),financialAccountId:'bank'})).errors.length,1,'valid 5 MB base64 reaches the parser without stack overflow');
  for(const changed of [{status:'archived',currency:'CNY'},{status:'active',currency:'USD'}]){
   let archiveCalls=0,writes=0;
   const raceQuery=async sql=>{if(sql.startsWith('SELECT revision'))return {rows:[{revision:'0'}]};if(sql.startsWith('SELECT data FROM business.personal_finance_accounts'))return {rows:[{data:changed}]};if(sql.startsWith('INSERT INTO business.personal_finance_imports'))writes++;return {rows:[]};};
   const raceRepo=createPersonalFinanceRepository({query:async()=>({rows:[{data:{status:'active',currency:'CNY'}}]}),transaction:async work=>work(raceQuery),parseBillFile:()=>({provider:'generic',templateId:'generic',records:[canonical],errors:[],warnings:[]}),archiveSource:async()=>{archiveCalls++;}});
   await assert.rejects(raceRepo.import({tenantId:'test',actor:{accountId:'alice',roles:['teacher']},filename:'race.csv',base64:'YQ==',financialAccountId:'bank',idempotencyKey:'race'}),/ACCOUNT_ARCHIVED|CURRENCY_MISMATCH/);assert.equal(archiveCalls,0);assert.equal(writes,0);
  }
  // Every supported non-cash asset account keeps the same fixed schema.
  for(const type of ['investment','insurance','receivable','property','precious_metal','retirement']) {
    let saved;
    const q=async(sql,values)=>{if(sql.startsWith('SELECT revision'))return {rows:[{revision:'0'}]};if(sql.startsWith('UPDATE business.personal_finance_owners'))return {rows:[{revision:'1'}]};if(sql.startsWith('INSERT INTO business.personal_finance_accounts'))saved=JSON.parse(values[3]);return {rows:[]};};
    const r=createPersonalFinanceRepository({query:q,transaction:async work=>work(q),parseBillFile:()=>({})});
    await r.createAccount({tenantId:'test',actor:{accountId:'alice',roles:['teacher']},account:{label:type,provider:'manual',type,maskedIdentifier:'',currency:'CNY',openingBalanceMinor:null,openingDate:null,status:'active'}});
    assert.equal(saved.type,type);
  }
  console.log('personal finance repository authorization and input checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
