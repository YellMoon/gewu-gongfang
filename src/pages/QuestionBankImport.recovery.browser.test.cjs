'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const webpack=require('webpack'),{chromium,_electron}=require('playwright');
const root=path.resolve(__dirname,'../..'),output=process.env.IMPORT_RECOVERY_EVIDENCE_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'gewu-import-recovery-'));
fs.mkdirSync(output,{recursive:true});
const file=name=>path.join(output,name),absolute=name=>JSON.stringify(path.join(root,name));
fs.writeFileSync(file('client.mjs'),`export function createDesktopQuestionImportClient(){return window.__importClient;}`, 'utf8');
fs.writeFileSync(file('native.js'),`module.exports={createNativeQuestionDraft:async(db,data)=>db.createQuestion(data)};`, 'utf8');
fs.writeFileSync(file('session.mjs'),`export function readDesktopAuthorizationSession(){return {authorization:'Bearer fixture-token',authContext:{userId:'owner',deviceId:'fixture-device',role:'teacher',activeRole:'teacher'}};}export function saveDesktopAuthorizationSession(){}export function clearDesktopAuthorizationSession(){}`, 'utf8');
fs.writeFileSync(file('entry.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import ImportPage from ${absolute('src/pages/QuestionBankImport.tsx')};
import Preview from ${absolute('src/pages/QuestionBankPreview.tsx')};
import AutoSync from ${absolute('src/components/DesktopAutoSync.tsx')};
import {upsertQuestionLocalRecord} from ${absolute('src/services/questionLocalStore.ts')};
import ${absolute('src/index.css')};
window.__GEWU_DESKTOP_IDENTITY_PARTITION__='isolated-import-recovery';
const items=Array.from({length:7},(_,i)=>({itemId:'question_import_item_recovery'+i,itemIndex:i,contentHash:'a'.repeat(64),
 candidate:{subject:'\u7269\u7406',type:'\u89e3\u7b54\u9898',content:'\u914d\u901f\u6cd5\u7b2c'+(i+1)+'\u9898',answer:'2v',analysis:'\u89e3\u6790',assets:[],source:'',year:'',grade:'',semester:'',exam_type:'',region:'',school:''},validation:{status:'accepted',codes:[]},mediaManifest:[],status:'accepted'}));
let status='awaiting_source_storage';const id='question_import_task_recovery01';
const task=()=>({taskId:id,status,phase:status,sourceStorageState:window.__archiveReady?'verified':'queued',mediaStorageState:window.__archiveReady?'verified':'queued',
 processingLocation:'desktop',sourceFileName:'\u914d\u901f\u6cd5.docx',sourceType:'lecture',metadata:{importFormat:'topic'},createdAt:'2026-10-11T01:00:00.000Z',updatedAt:'2026-10-11T01:00:00.000Z',items:structuredClone(items)});
window.__archiveReady=false;window.__created=[];window.__submitted=[];window.__prepareCalls=0;window.__reads=0;window.__historyFailure=false;
window.__importClient={list:async()=>{if(window.__historyFailure)throw Error('OFFLINE');return [{...task(),totalItems:7,submittedItems:window.__submitted.length,warningItems:0,failedItems:0}];},
 read:async()=>{window.__reads++;if(window.__archiveReady&&status==='awaiting_source_storage')status='candidates_ready';return task();},
 prepareDrafts:async()=>{window.__prepareCalls++;status='drafts_prepared';items.forEach(item=>item.status='draft_prepared');return task();}};
const questions=[],outbox=[];window.__questions=questions;
window.desktopIdentitySessionProvider={listCloudQuestions:async()=>questions.filter(q=>q.storage_state==='cloud_cached'),listCloudBusinessProjection:async()=>({}),ensureOnline:async()=>{}};
window.dbService={data:{questions},getAllQuestions:()=>questions,getKnowledgeTree:()=>[],getModelTree:()=>[],getTaxonomySystems:()=>[],getTaxonomyNodes:()=>[],
 initDefaultKnowledgeTree:()=>{},initDefaultModelTree:()=>{},getLatestQuestionVersions:()=>[],
 createQuestion:data=>{const question={...data,id:'q'+data.import_item_index,storage_state:'local_draft',status:'draft',created_at:'2026-10-11',updated_at:'2026-10-11'};
 questions.push(question);window.__created.push(question.id);outbox.push({id:'outbox'+question.id,type:'question.create.v1',payload:{record:question},status:'awaiting_confirmation',createdOffline:false});
 upsertQuestionLocalRecord(question);window.dispatchEvent(new Event('desktop-authority-drafts-changed'));return question;},
 refreshAuthorityProjection:async()=>window.dispatchEvent(new Event('authority-projection-refreshed'))};
window.desktopAuthority={list:async()=>structuredClone(outbox),confirmAndSubmit:async draftId=>{const draft=outbox.find(row=>row.id===draftId);draft.status='completed';
 const question=questions.find(q=>q.id===draft.payload.record.id);question.storage_state='cloud_cached';question.status='published';window.__submitted.push(question.id);
 items[question.import_item_index].status='submitted';if(window.__submitted.length===7)status='submitted';return {receipt:{status:'committed',result:{}}};}};
function Fixture(){const [route,setRoute]=React.useState('import');window.__navigate=setRoute;return <><AutoSync/>{route==='import'?<ImportPage/>:route==='bank'?<Preview subject="\u7269\u7406"/>:<div>away</div>}</>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
`, 'utf8');
function compile(){return new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry:file('entry.tsx'),output:{path:output,filename:'bundle.js'},
 resolve:{extensions:['.tsx','.ts','.js','.mjs'],modules:[path.join(root,'node_modules'),'node_modules']},
 plugins:[new webpack.NormalModuleReplacementPlugin(/desktopQuestionImportClient\.mjs$/,file('client.mjs')),
 new webpack.NormalModuleReplacementPlugin(/nativeQuestionDraftCreate(?:\.js)?$/,file('native.js')),
 new webpack.NormalModuleReplacementPlugin(/desktopAuthorizationSession\.mjs$/,file('session.mjs'))],
 module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:{loader:require.resolve('babel-loader'),options:{presets:[require.resolve('@babel/preset-typescript'),require.resolve('@babel/preset-react')]}}},
 {test:/\.css$/,use:[require.resolve('style-loader'),require.resolve('css-loader')]},{test:/\.(woff2?|ttf|png|svg)$/,type:'asset/inline'}]},optimization:{minimize:false}},
 (error,stats)=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));}
(async()=>{await compile();const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?fs.readFileSync(file('bundle.js')):'<!doctype html><meta charset="UTF-8"><div id="root"></div><script src="/bundle.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const electron=process.env.IMPORT_RECOVERY_RUNTIME==='electron';
 fs.writeFileSync(file('electron-main.cjs'),`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{new BrowserWindow({width:1440,height:1050,webPreferences:{contextIsolation:true,nodeIntegration:false}}).loadURL('http://127.0.0.1:${server.address().port}');});`, 'utf8');
 const browser=electron?await _electron.launch({args:[file('electron-main.cjs')]}):await chromium.launch({channel:'chrome',headless:true});
 const page=electron?await browser.firstWindow():await browser.newPage({viewport:{width:1440,height:1050}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('\u914d\u901f\u6cd5.docx',{exact:true}).waitFor();
 await page.waitForFunction(()=>window.__reads>0);assert.equal(await page.evaluate(()=>window.__created.length),0);
 await page.screenshot({path:file('01-restored-awaiting-storage.png'),fullPage:true});
 await page.evaluate(()=>window.__navigate('away'));await page.getByText('away',{exact:true}).waitFor();
 await page.evaluate(()=>window.__navigate('import'));await page.getByText('\u914d\u901f\u6cd5.docx',{exact:true}).waitFor();
 await page.evaluate(()=>{window.__archiveReady=true;});await page.waitForFunction(()=>window.__submitted.length===7,{},{timeout:20000});
 assert.deepEqual(await page.evaluate(()=>window.__created),['q0','q1','q2','q3','q4','q5','q6']);assert.equal(await page.evaluate(()=>window.__prepareCalls),1);
 assert.equal(await page.getByRole('dialog').count(),0,'online imports must not demand a synchronization confirmation');
 await page.waitForFunction(()=>document.body.textContent.includes('\u5df2\u5165\u5e93'));
 await page.getByRole('button',{name:'\u8be6\u60c5',exact:true}).click();await page.getByText('\u914d\u901f\u6cd5\u7b2c7\u9898',{exact:true}).last().waitFor();
 await page.waitForFunction(()=>Math.abs(document.querySelector('.ant-drawer-content-wrapper').getBoundingClientRect().right-innerWidth)<2);
 await page.screenshot({path:file('02-completed-history-detail.png'),fullPage:true});
 await page.evaluate(()=>window.__navigate('bank'));await page.waitForFunction(()=>document.body.textContent.includes('\u914d\u901f\u6cd5\u7b2c7\u9898'));
 await page.screenshot({path:file('03-seven-questions-in-bank.png'),fullPage:true});
 await page.evaluate(()=>window.__navigate('import'));await page.getByText('\u914d\u901f\u6cd5.docx',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__created.length),7);
 await page.evaluate(()=>{window.__historyFailure=true;});await page.getByRole('button',{name:'\u5237\u65b0\u8bb0\u5f55',exact:true}).click();await page.getByText(/OFFLINE/).waitFor();
 assert.equal(await page.getByText('\u914d\u901f\u6cd5.docx',{exact:true}).count(),1,'history failure must retain the previous records');assert.deepEqual(errors,[]);
 fs.writeFileSync(file('checks.json'),JSON.stringify({runtime:electron?'electron':'chrome',restoredTask:true,sevenQuestionsSubmittedSilently:true,historyRetained:true,detailLoaded:true,noDuplicates:true,bankVisible:true,errors},null,2),'utf8');
 console.log('actual import page navigation recovery, storage polling, seven-question silent sync, persistent history/detail, bank visibility and retry checks passed');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
