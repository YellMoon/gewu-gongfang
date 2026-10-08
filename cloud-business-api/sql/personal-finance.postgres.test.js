'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const migration=path.join(__dirname,'20261008-personal-finance.sql');
assert.ok(fs.existsSync(migration),'personal finance migration must exist');
const {createPersonalFinanceRepository}=require('../src/personalFinanceRepository');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
(async()=>{
 const runtime=createDisposablePg17Runtime();await runtime.start();const handle=await runtime.createIsolatedHandle();
 try{
 const evidence={appliedAt:'2026-10-08T00:00:00.000Z',appliedBy:'personal-finance-test'};await createVNextPg17CatalogBoundary(runtime).apply(handle,evidence);await createBusinessFoundationCatalogBoundary(runtime).apply(handle,evidence);
 await withVNextPg17SyntheticQuery(handle,'fixture-provisioner',async db=>{
 await db.query('CREATE ROLE gewu_cloud_schedule_reader NOLOGIN');
 for(const name of ['20260823-personal-asset-import.sql','20260824-supplemental-business-authority.sql','20261008-personal-finance.sql'])await db.query(fs.readFileSync(path.join(__dirname,name),'utf8'));
 await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('finance-test','Test',false,now(),now()),('other-tenant','Other',false,now(),now())");
 const transaction=async work=>{await db.query('BEGIN');try{const result=await work((s,v)=>db.query(s,v));await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}};
 const record={sourceTransactionId:'bill-1',occurredAt:'2026-10-08T10:00:00+08:00',date:'2026-10-08',amountMinor:'9007199254740993',currency:'CNY',direction:'debit',kind:'expense',description:'Books',counterparty:'Shop',category:'Books',paymentChannel:'',paymentAccountHint:'',balanceMinor:null,relatedReference:'',status:'completed',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{}};
 let parsedRecords=[record],parseErrors=[],archiveCalls=0,beforeParseReturn=null;
 const repo=createPersonalFinanceRepository({query:(s,v)=>db.query(s,v),transaction,parseBillFile:async()=>{if(beforeParseReturn)await beforeParseReturn();return {provider:'bank',templateId:'test',records:parsedRecords,errors:parseErrors,warnings:[]};},archiveSource:async ({fileHash})=>{archiveCalls++;return {id:'archive_'+fileHash,fileHash,storage:'controlled-private',encrypted:true};}});
 const context={tenantId:'finance-test',actor:{accountId:'alice',roles:['teacher']}};
 const account={label:'Bank',provider:'bank',type:'bank',maskedIdentifier:'1234',currency:'CNY',openingBalanceMinor:null,openingDate:null,status:'active'};
 const saved=await repo.createAccount({...context,account});assert.ok(saved.account.id);assert.equal(saved.revision,'1');
 const input={...context,financialAccountId:saved.account.id,filename:'bill.csv',base64:Buffer.from('bill').toString('base64'),idempotencyKey:'retry-1'};
 const receipt=await repo.import({...input,expectedRevision:saved.revision}),replay=await repo.import({...input,expectedRevision:saved.revision});assert.equal(receipt.importId,replay.importId);assert.equal(replay.replayed,true);assert.equal(archiveCalls,1,'retry does not archive twice');
 let ledger=await repo.getLedger(context);assert.equal(ledger.observations[0].amountMinor,'9007199254740993');assert.equal(ledger.revision,'2');assert.equal(ledger.imports[0].archiveReference.storage,'controlled-private');
 assert.deepEqual(ledger.imports[0].observationIds,receipt.observationIds,'every import exposes immutable source memberships');
 parsedRecords=[{...record,sourceTransactionId:'different'}];await assert.rejects(repo.import(input),/IDEMPOTENCY_CONFLICT/);assert.equal((await repo.getLedger(context)).observations.length,1);
 parsedRecords=[record];await repo.import({...input,idempotencyKey:'new-key'});ledger=await repo.getLedger(context);assert.equal(ledger.observations.length,1,'stable transaction identity deduplicates repeated exports');
 parseErrors=[{row:2,message:'Invalid amount'}];await assert.rejects(repo.import({...input,idempotencyKey:'bad'}),/IMPORT_INVALID/);assert.equal((await repo.getLedger(context)).revision,ledger.revision);parseErrors=[];
 await assert.rejects(repo.updateAccount({...context,id:saved.account.id,patch:{label:'Changed'},expectedRevision:'0'}),/REVISION_CONFLICT/);
 for(const scope of [{...context,actor:{accountId:'mallory',roles:['super_admin']}},{...context,tenantId:'other-tenant'}]){assert.equal((await repo.getLedger(scope)).accounts.length,0);await assert.rejects(repo.import({...input,...scope}),/ACCOUNT_NOT_FOUND/);}
 await assert.rejects(repo.createAccount({...context,account:{...account,ownerAccountId:'mallory'}}),/INPUT_INVALID/);
 await assert.rejects(repo.createBalanceSnapshot({...context,snapshot:{financialAccountId:saved.account.id,asOf:'2026-10-08T00:00:00Z',balanceMinor:'1000',currency:'CNY',source:'statement'}}),/INPUT_INVALID/,'a statement anchor requires an actual statement observation');
 const calibrated=await repo.createBalanceSnapshot({...context,snapshot:{financialAccountId:saved.account.id,asOf:'2026-10-08T00:00:00Z',balanceMinor:'1000',currency:'CNY',source:'manual'}});assert.equal(calibrated.snapshot.balanceMinor,'1000');
 await db.query("INSERT INTO business.personal_asset_manual_records(record_id,tenant_id,account_id,record_date,record_type,category_id,category_name,amount,note) VALUES ('legacy','finance-test','alice','2026-01-01','expense','old','Old',1.23,'unchanged')");
 ledger=await repo.getLedger(context);assert.equal(ledger.legacyRecords[0].record_id,'legacy');assert.equal(ledger.legacyRecords[0].amount,1.23);assert.equal(ledger.legacyRecords[0].financialAccountId,undefined);
 parsedRecords=[{...record,sourceTransactionId:'bill-2'}];await repo.import({...input,base64:Buffer.from('other bill').toString('base64'),idempotencyKey:'second'});ledger=await repo.getLedger(context);
 const ids=ledger.observations.map(o=>o.id),link=await repo.createLink({...context,link:{type:'duplicate',observationIds:ids,note:'Confirmed'},expectedRevision:ledger.revision});
 await repo.deleteLink({...context,id:link.link.id,expectedRevision:link.revision});ledger=await repo.getLedger(context);assert.equal(ledger.links[0].status,'deleted');assert.equal(ledger.observations.length,2);
 const sourceBefore=JSON.stringify(ledger.observations[0]);
 assert.equal(typeof repo.annotateObservation,'function','owner can annotate immutable sources');
 const annotation=await repo.annotateObservation({...context,observationId:ids[0],patch:{category:'Corrected',kind:'debt_payment',principalMinor:'9007199254740963',interestMinor:'20',feeMinor:'10'},expectedRevision:ledger.revision});
 ledger=await repo.getLedger(context);assert.equal(ledger.annotations[0].id,annotation.annotation.id);assert.equal(JSON.stringify(ledger.observations[0]),sourceBefore,'classification never rewrites original source');
 await assert.rejects(repo.annotateObservation({...context,observationId:ids[0],patch:{principalMinor:'1'},expectedRevision:ledger.revision}),/INPUT_INVALID/,'partial edit must validate cumulative split against total');
 await assert.rejects(repo.annotateObservation({...context,observationId:ids[0],patch:{amountMinor:'1'}}),/INPUT_INVALID/);
 await assert.rejects(repo.annotateObservation({...context,observationId:ids[0],patch:{category:'X'},expectedRevision:'0'}),/REVISION_CONFLICT/);
 await assert.rejects(repo.annotateObservation({...context,actor:{accountId:'mallory',roles:['super_admin']},observationId:ids[0],patch:{category:'X'}}),/OBSERVATION_NOT_FOUND/);
 const secondAnnotation=await repo.annotateObservation({...context,observationId:ids[0],patch:{category:'Updated'},expectedRevision:ledger.revision});assert.equal(secondAnnotation.annotation.patch.principalMinor,'9007199254740963','annotation snapshots carry prior edits');
 const loanAccount=await repo.createAccount({...context,account:{...account,label:'Loan',type:'loan'}});
 parsedRecords=[{...record,sourceTransactionId:'annotated-loan-credit',kind:'unknown',direction:'credit',amountMinor:'530'}];const loanImport=await repo.import({...input,financialAccountId:loanAccount.account.id,base64:Buffer.from('loan source').toString('base64'),idempotencyKey:'loan-source'});
 await repo.annotateObservation({...context,observationId:loanImport.observationIds[0],patch:{kind:'debt_payment',principalMinor:'500',interestMinor:'20',feeMinor:'10'}});
 parsedRecords=[{...record,sourceTransactionId:'annotated-refund',kind:'income',direction:'credit',amountMinor:'20'}];const refundImport=await repo.import({...input,base64:Buffer.from('refund source').toString('base64'),idempotencyKey:'refund-source'});
 await repo.annotateObservation({...context,observationId:refundImport.observationIds[0],patch:{kind:'refund'}});
 const refundLink=await repo.createLink({...context,link:{type:'refund',observationIds:[refundImport.observationIds[0],ids[1]]}});assert.equal(refundLink.link.type,'refund','manual links validate current classifications, preserving source');
 assert.ok((await db.query('SELECT count(*)::int AS n FROM business.personal_finance_audit')).rows[0].n>=6);
 await db.query('GRANT USAGE ON SCHEMA business TO gewu_cloud_schedule_reader');
 await db.query('GRANT gewu_cloud_schedule_reader TO vnext_pg17_runtime');
 await withVNextPg17SyntheticQuery(handle,'runtime',async secondDb=>{
  await secondDb.query('SET ROLE gewu_cloud_schedule_reader');
  const secondTransaction=async work=>{await secondDb.query('BEGIN');try{const result=await work((s,v)=>secondDb.query(s,v));await secondDb.query('COMMIT');return result;}catch(e){await secondDb.query('ROLLBACK');throw e;}};
  const secondRepo=createPersonalFinanceRepository({query:(s,v)=>secondDb.query(s,v),transaction:secondTransaction,parseBillFile:async()=>({provider:'bank',templateId:'test',records:parsedRecords,errors:[],warnings:[]}),archiveSource:async ({fileHash})=>{archiveCalls++;return {id:'archive_'+fileHash,fileHash};}});
  parsedRecords=[{...record,sourceTransactionId:'concurrent'}];const concurrentRevision=(await repo.getLedger(context)).revision;const concurrentInput={...input,base64:Buffer.from('concurrent').toString('base64'),idempotencyKey:'concurrent',expectedRevision:concurrentRevision};
  const beforeArchives=archiveCalls;const [one,two]=await Promise.all([repo.import(concurrentInput),secondRepo.import(concurrentInput)]);assert.equal(one.importId,two.importId);assert.notEqual(one.replayed,two.replayed);assert.equal(archiveCalls-beforeArchives,1);
  const revision=(await repo.getLedger(context)).revision;
  const attempts=await Promise.allSettled([repo.updateAccount({...context,id:saved.account.id,patch:{label:'One'},expectedRevision:revision}),secondRepo.updateAccount({...context,id:saved.account.id,patch:{label:'Two'},expectedRevision:revision})]);
  assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);assert.equal(attempts.find(a=>a.status==='rejected').reason.code,'CLOUD_PERSONAL_FINANCE_REVISION_CONFLICT');
  await assert.rejects(secondDb.query('DELETE FROM business.personal_finance_observations'),/permission denied/,'runtime cannot erase sources');
  await assert.rejects(secondDb.query("UPDATE business.personal_finance_audit SET action='tampered'"),/permission denied/,'runtime cannot alter audit history');
  await secondDb.query('RESET ROLE');
 });
 parsedRecords=[{...record,sourceTransactionId:'status-lifecycle',amountMinor:'77',status:'pending'}];await repo.import({...input,base64:Buffer.from('pending source').toString('base64'),idempotencyKey:'pending-source'});
 parsedRecords=[{...record,sourceTransactionId:'status-lifecycle',amountMinor:'77',status:'completed'}];await repo.import({...input,base64:Buffer.from('final source').toString('base64'),idempotencyKey:'final-source'});
 const versionLedger=await repo.getLedger(context),versions=versionLedger.observations.filter(o=>o.sourceTransactionId==='status-lifecycle');assert.equal(versions.length,2);assert.ok(versions.some(o=>o.status==='pending'));assert.ok(versions.some(o=>o.status==='completed'));
 const versionView=require('../../shared/personal-finance/ledger').buildFinanceView(versionLedger);const versionTransactions=versionView.transactions.filter(t=>t.sourceTransactionId==='status-lifecycle');assert.equal(versionTransactions.length,1);assert.equal(versionTransactions[0].consumptionMinor,'77');assert.equal(versionTransactions[0].sources.length,2,'immutable pending/final sources remain visible');
 parsedRecords=[{...record,sourceTransactionId:'status-lifecycle',amountMinor:'99',status:'completed'}];await assert.rejects(repo.import({...input,base64:Buffer.from('changed amount').toString('base64'),idempotencyKey:'changed-final'}),/SOURCE_TRANSACTION_CONFLICT/);
 for(const changed of [{status:'archived'},{currency:'USD'}]){
  const raceAccount=await repo.createAccount({...context,account:{...account,label:'Race account'}});const beforeArchive=archiveCalls;parsedRecords=[{...record,sourceTransactionId:'race-source'}];
  beforeParseReturn=async()=>{beforeParseReturn=null;await repo.updateAccount({...context,id:raceAccount.account.id,patch:changed});};
  await assert.rejects(repo.import({...input,financialAccountId:raceAccount.account.id,base64:Buffer.from('race source '+raceAccount.account.id).toString('base64'),idempotencyKey:'race-'+raceAccount.account.id}),/ACCOUNT_ARCHIVED|CURRENCY_MISMATCH/);assert.equal(archiveCalls,beforeArchive,'state changes during parsing block before archiving and inserting');
 }
 const malformed={...record,id:'malformed',financialAccountId:saved.account.id,importId:receipt.importId,amountMinor:'1.2'};
 await assert.rejects(db.query('INSERT INTO business.personal_finance_observations(id,tenant_id,account_id,financial_account_id,import_id,source_key,transaction_key,data) VALUES($1,$2,$3,$4,$5,$6,$6,$7)', ['malformed','finance-test','alice',saved.account.id,receipt.importId,'a'.repeat(64),JSON.stringify(malformed)]),/check constraint/,'database rejects fractional minor units even without repository validation');
 await assert.rejects(db.query('INSERT INTO business.personal_finance_observations(id,tenant_id,account_id,financial_account_id,import_id,source_key,transaction_key,data) VALUES($1,$2,$3,$4,$5,$6,$6,$7)', ['wrong-owner','finance-test','mallory',saved.account.id,receipt.importId,'b'.repeat(64),JSON.stringify({...malformed,id:'wrong-owner',amountMinor:'1'})]),/foreign key/);
 });
 }finally{await runtime.disposeHandle(handle);await runtime.stop();}
 console.log('personal finance real PostgreSQL exact amounts, owner boundaries, receipts, rollback, revision and audit passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
