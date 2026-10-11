'use strict';
// Actual BrowserDatabase -> native encrypted outbox -> HTTP -> cloud service -> PostgreSQL.
// The desktop identity and OS encryption adapter are isolated fixtures. No mutation or receipt is stubbed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {JSDOM}=require('jsdom'),ts=require('typescript');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery:withQuery}=require('../../shared/vnext-pg17/disposableRuntime');
const {createVNextPg17CatalogBoundary}=require('../../shared/vnext-pg17/catalogAssertion');
const {createBusinessFoundationCatalogBoundary}=require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const {createQuestionAuthorityService}=require('../../cloud-business-api/src/questionAuthorityService');
const {createCloudBusinessApp}=require('../../cloud-business-api/src/app');
const {createDesktopAuthorityRuntime}=require('../../public/desktopAuthorityRuntime');
const {QuestionDraftProvenanceRegistry,verifyCloudDesktopSession}=require('../../public/questionDraftProvenanceRegistry');
const root=path.resolve(__dirname,'../..'),work=fs.mkdtempSync(path.join(os.tmpdir(),'gewu-real-import-submit-'));
const HASH='a'.repeat(64),actor={accountId:'teacher-1',deviceId:'fixture-device',roles:['teacher'],activeRole:'teacher'};
const doc=text=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
function input(){
  if(process.env.REAL_IMPORT_INPUT_PATH)return JSON.parse(fs.readFileSync(process.env.REAL_IMPORT_INPUT_PATH,'utf8'));
  return {items:Array.from({length:7},(_,index)=>({itemIndex:index,contentHash:HASH,candidate:{subject:'\u7269\u7406',type:'\u89e3\u7b54\u9898',stem:'Import '+index,answer:'2v',analysis:'Solution',source:'',year:'',grade:'',semester:'',exam_type:'',region:'',school:'',
    rich_content:{version:1,type:'question-document',sections:{stem:{type:'doc',content:[...doc('Import '+index).content,{type:'image',attrs:{assetKey:HASH,src:'question-asset://'+HASH,width:317.5,height:126.25}}]},answer:doc('2v'),analysis:doc('Solution'),options:[],subQuestions:[]}},
    assets:[{assetIndex:0,assetType:'image',fileName:'diagram.png',mimeType:'image/png',sizeBytes:5,contentHash:HASH}]}}))};
}
(async()=>{
 const pg=createDisposablePg17Runtime();await pg.start();const handle=await pg.createIsolatedHandle();
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),priorTs=require.extensions['.ts'];
 let server;
 try{
  const apply={appliedAt:'2026-10-11T00:00:00.000Z',appliedBy:'actual-import-submission-regression'};
  await createVNextPg17CatalogBoundary(pg).apply(handle,apply);await createBusinessFoundationCatalogBoundary(pg).apply(handle,apply);
  await withQuery(handle,'fixture-provisioner',async db=>{
   await db.query('CREATE ROLE gewu_cloud_schedule_reader');
   for(const name of ['20260822-storage-agent-tasks.sql','20260823-cloud-question-import-tasks.sql','20260823-cloud-question-authority.sql',
    '20260823-question-import-media-objects.sql','20260823-cloud-question-command-receipts.sql','20260824-question-taxonomy-authority.sql','20261010-question-difficulty-coefficient.sql']){
    await db.query(fs.readFileSync(path.join(root,'cloud-business-api/sql',name),'utf8').replace('BEGIN;','BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;'));
   }
   await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES('tenant-1','Fixture',false,now(),now())");
   const source=input();let mediaCount=0;
   for(const batch of ['old','new']){
    const taskId='question_import_task_regression_'+batch;
    await db.query(`INSERT INTO business.question_import_tasks(task_id,tenant_id,account_id,idempotency_key,source_type,source_file_name,source_mime_type,source_sha256,source_size_bytes,request_hash,status,phase)
     VALUES($1,'tenant-1','teacher-1',$1,'lecture','fixture.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',$2,10,$2,'drafts_prepared','drafts_prepared')`,[taskId,HASH]);
    for(const item of source.items){
     await db.query(`INSERT INTO business.question_import_items(item_id,import_task_id,item_index,content_hash,candidate_json,status) VALUES($1,$2,$3,$4,$5::jsonb,'draft_prepared')`,
      ['question_import_item_regression_'+batch+'_'+item.itemIndex,taskId,item.itemIndex,item.contentHash,JSON.stringify(item.candidate)]);
     for(const asset of item.candidate.assets||[]){
      const suffix=batch+'_'+item.itemIndex+'_'+asset.assetIndex,storage='task_regression_'+suffix,object='obj_regression_'+suffix;
      await db.query("INSERT INTO business.storage_object_tasks(task_id,object_id,object_version,expected_sha256,expected_bytes,media_type,state) VALUES($1,$2,1,$3,$4,$5,'verified')",[storage,object,asset.contentHash,asset.sizeBytes,asset.mimeType]);
      await db.query(`INSERT INTO business.question_import_media_objects(media_id,import_task_id,item_index,asset_index,object_id,object_version,storage_task_id,expected_sha256,expected_bytes,mime_type,storage_state,verified_at)
       VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,'verified',now())`,['question_import_media_regression_'+suffix,taskId,item.itemIndex,asset.assetIndex,object,storage,asset.contentHash,asset.sizeBytes,asset.mimeType]);
      await db.query("INSERT INTO business.storage_task_receipts(receipt_id,task_id,agent_id,observed_sha256,observed_bytes) VALUES($1,$2,'fixture-agent',$3,$4)",['storage_receipt_regression_'+suffix,storage,asset.contentHash,asset.sizeBytes]);mediaCount++;
     }
    }
   }
   const query=(sql,args)=>db.query(sql,args),service=createQuestionAuthorityService({query,transaction:async work=>{
    await db.query('BEGIN');try{const result=await work(query);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}
   }});
   let interrupt=true,requests=0;
   const app=createCloudBusinessApp({query,businessTenantId:'tenant-1',questionAuthority:service,desktopRegistration:{begin:async()=>{},register:async()=>{},sessionContext:async({sessionToken})=>{
    assert.equal(sessionToken,'fixture.signature');return actor;
   }}});
   // Fault injection is transport-only; successful attempts execute the shipped REST handler/service.
   const http=require('node:http');server=http.createServer((req,res)=>{
    if(req.url==='/api/desktop/question-bank/commands'){requests++;if(interrupt){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,code:'CLOUD_BUSINESS_UNAVAILABLE'}));return;}}
    app(req,res);
   });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
   global.window=dom.window;global.document=dom.window.document;global.localStorage=dom.window.localStorage;global.sessionStorage=dom.window.sessionStorage;
   global.CustomEvent=dom.window.CustomEvent;global.Event=dom.window.Event;
   const {setCurrentDesktopIdentityContext}=await import('./desktopIdentityPartition.mjs');
   setCurrentDesktopIdentityContext({userId:actor.accountId,activeRole:'teacher',partitionKey:'isolated-import-submit'},globalThis);
   const {saveDesktopAuthorizationSession}=await import('./desktopAuthorizationSession.mjs');await saveDesktopAuthorizationSession({token:'fixture.signature',userId:actor.accountId,deviceId:actor.deviceId,activeRole:'teacher'});
   const key=crypto.randomBytes(32),safeStorage={isEncryptionAvailable:()=>true,
    encryptString:value=>{const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce),bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),bytes]);},
    decryptString:value=>{const decipher=crypto.createDecipheriv('aes-256-gcm',key,value.subarray(0,12));decipher.setAuthTag(value.subarray(12,28));return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8');}};
   const now=Date.now(),vault={status:()=>({state:'unlocked',unlocked:true,user:{id:actor.accountId},activeRole:'teacher',deviceId:actor.deviceId,authorizationId:'fixture-auth',credentialVersion:1,
    offlineLease:{userId:actor.accountId,deviceId:actor.deviceId,authorizationId:'fixture-auth',credentialVersion:1,issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+3600000).toISOString()}})};
   const outboxPath=path.join(work,'outbox.bin');const native=createDesktopAuthorityRuntime({filePath:outboxPath,safeStorage,vault,cloudBusinessBaseUrl:base});window.desktopAuthority=native;
   const registry=new QuestionDraftProvenanceRegistry({filePath:path.join(work,'provenance.json'),tokenVerifier:authorization=>verifyCloudDesktopSession({baseUrl:base,authorization})});
   global.questionDraftProvenance={issueDraft:authorization=>registry.issue(authorization),verifyDraft:(id,authorization)=>registry.verify(id,authorization)};
   require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
   const browserDb=require('./browserDatabase.ts').default;window.dbService=browserDb;
   const {createNativeQuestionDraft}=require('./nativeQuestionDraftCreate');
   for(const item of source.items){
    await createNativeQuestionDraft(browserDb,{...item.candidate,subject:item.candidate.subject||'\u7269\u7406',type:item.candidate.type||'\u89e3\u7b54\u9898',content:item.candidate.content??item.candidate.stem??'',analysis:item.candidate.analysis||item.candidate.explanation||'',
     import_task_id:'question_import_task_regression_new',import_item_id:'question_import_item_regression_new_'+item.itemIndex,import_item_index:item.itemIndex,import_content_hash:item.contentHash});
   }
   const fresh=await native.list();assert.equal(fresh.length,7);assert(fresh.every(item=>item.createdOffline===false&&item.payload.record.edit_status==='unreviewed'));
   for(const item of fresh){const record={...item.payload.record,id:crypto.randomUUID(),edit_status:'\u672a\u7f16\u8f91',import_task_id:'question_import_task_regression_old',import_item_id:'question_import_item_regression_old_'+item.payload.record.import_item_index};
    native.appendDraftSync({type:item.type,payload:{record}});
   }
   assert(!fs.readFileSync(outboxPath,'utf8').includes('edit_status'),'the actual native outbox stays encrypted');
   window.desktopIdentitySessionProvider={businessAuthority:base,listCloudBusinessProjection:async()=>({}),listCloudQuestions:async()=>{
    const response=await fetch(base+'/api/desktop/question-bank/questions',{headers:{authorization:'Bearer fixture.signature'}});assert.equal(response.status,200);return (await response.json()).questions;
   }};
   const {createDesktopSyncController}=await import('./desktopSyncController.mjs');
   const controller=createDesktopSyncController({bridge:native,sessionToken:()=> 'fixture.signature',isOnline:()=>true,refreshProjection:options=>browserDb.refreshAuthorityProjection(options)});
   await controller.tick();assert.equal(controller.getState().error,'CLOUD_BUSINESS_UNAVAILABLE');assert.equal(controller.getState().open,false);assert.equal((await native.list()).length,14);
   interrupt=false;await controller.tick();
   const final=await native.list();assert(final.every(item=>item.status==='completed'),JSON.stringify({error:controller.getState().error,states:final.map(x=>x.status)}));
   assert.equal(controller.getState().open,false);assert.equal(browserDb.getAllQuestions().filter(q=>q.storage_state==='cloud_cached').length,14,'actual cloud readback populates the real question bank cache');
   assert.deepEqual((await db.query('SELECT edit_status,count(*)::integer AS count FROM business.questions GROUP BY edit_status')).rows,[{edit_status:'unreviewed',count:14}]);
   assert.equal((await db.query('SELECT count(*)::integer AS count FROM business.question_assets')).rows[0].count,mediaCount);
   assert.equal((await db.query('SELECT count(*)::integer AS count FROM business.desktop_question_command_receipts')).rows[0].count,14);
   assert((await db.query('SELECT status FROM business.question_import_tasks')).rows.every(row=>row.status==='submitted'));
   for(const item of final){const before=item.submission.command;
    const replay=await fetch(base+'/api/desktop/question-bank/commands',{method:'POST',headers:{authorization:'Bearer fixture.signature','content-type':'application/json'},body:JSON.stringify(before)});
    assert.equal(replay.status,200);assert.deepEqual((await replay.json()).receipt,item.receipt);assert.deepEqual((await native.get(item.id)).submission.command,before);
   }
   assert.equal((await db.query('SELECT count(*)::integer AS count FROM business.questions')).rows[0].count,14,'same sealed command retries never duplicate questions or assets');
   controller.stop();console.log(JSON.stringify({actualBrowserDatabase:true,actualNativeDraftProvenance:true,encryptedOutbox:true,actualHttpAndPostgres:true,questions:14,verifiedMedia:mediaCount,silentFailureAndRecovery:true,legacySignedDraftRecovery:true,noDuplicateRetries:true,requests}));
  });
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));if(priorTs)require.extensions['.ts']=priorTs;else delete require.extensions['.ts'];
  dom.window.close();await pg.disposeHandle(handle).catch(()=>{});await pg.stop().catch(()=>{});fs.rmSync(work,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error.stack||error);process.exitCode=1});
