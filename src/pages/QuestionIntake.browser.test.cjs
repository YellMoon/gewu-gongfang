'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const webpack = require('webpack');
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const { createFixture } = require('../../public/desktopQuestionIntake.test');
const { createDesktopQuestionIntake } = require('../../public/desktopQuestionIntake');
const { createQuestionImportTaskRepository } = require('../../cloud-business-api/src/questionImportTaskRepository');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/playwright/question-intake-20261006');
fs.mkdirSync(output, { recursive: true });
const absolute = file => path.join(root, file).replace(/\\/g, '/');
const entry = path.join(output, 'fixture.tsx');
fs.writeFileSync(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import {ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
import QuestionBankImport from '${absolute('src/pages/QuestionBankImport')}';
import {saveDesktopAuthorizationSession} from '${absolute('src/services/desktopAuthorizationSession.mjs')}';
import '${absolute('src/index.css')}';import '${absolute('node_modules/katex/dist/katex.min.css')}';
window.dbService={getKnowledgeTree:()=>[],getModelTree:()=>[],getTaxonomySystems:()=>[],getTaxonomyNodes:()=>[]};
window.desktopIdentitySessionProvider={listCloudQuestions:async()=>[]};
window.fixture={cloudRequests:0};
window.fixture.saveSession=saveDesktopAuthorizationSession;
window.fetch=async(...args)=>{window.fixture.cloudRequests++;if(window.fixture.fetchHandler)return window.fixture.fetchHandler(...args);throw new Error('Offline fixture blocks all business requests')};
if(!window.questionImportRelay)window.questionImportRelay={parseSource:input=>window.fixtureParse({...input,bytes:Array.from(input.bytes)}).then(result=>({...result,mediaBytes:result.mediaBytes.map(items=>items.map(bytes=>new Uint8Array(bytes)))})),sealSource:async input=>window.fixture.seal(input),sealAsset:async input=>window.fixture.seal(input)};
createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><main style={{padding:24}}><QuestionBankImport/></main></ConfigProvider>);`);
async function compile() {
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, entry, output: { path: output, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js', '.mjs'], modules: [path.join(root, 'node_modules'), 'node_modules'], fallback: { crypto: false } },
    module: { rules: [
      { test: /\.tsx?$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'), options: { presets: [require.resolve('@babel/preset-typescript'), require.resolve('@babel/preset-react')] } } },
      { test: /\.css$/, use: [require.resolve('style-loader'), require.resolve('css-loader')] }, { test: /\.(woff2?|ttf)$/, type: 'asset/inline' },
    ] }, optimization: { minimize: false },
  }, (error, stats) => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
}
async function verify(page, carrier) {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.locator('.ant-radio-button-wrapper').filter({ hasText: '试卷格式' }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /选择文件/ }).click();
  await (await chooserPromise).setFiles(path.join(output, '本地录入.docx'));
  await page.context().setOffline(true);
  await page.getByRole('button', { name: /开始解析/ }).click();
  await page.getByText('本机图片清理：已移除 2 处微小标识图片', { exact: true }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const surface = page.locator('.rich-question-editor__surface').first();
  const image = page.locator('.rich-image-node img').first(); await image.waitFor();
  await page.waitForFunction(() => Math.abs(document.querySelector('.rich-image-node img').getBoundingClientRect().width - 107.5) < 0.1);
  const geometry = await image.evaluate(img => ({ width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height }));
  assert(Math.abs(geometry.width - 107.5) < 0.1 && Math.abs(geometry.height - 49) < 0.1, JSON.stringify(geometry));
  assert.equal(await page.locator('.rich-formula-node').first().getAttribute('data-latex'), 'x');
  const font = await surface.evaluate(el => getComputedStyle(el).fontFamily);
  const cdp = await page.context().newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root: dom } = await cdp.send('DOM.getDocument'); const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: dom.nodeId, selector: '.rich-question-editor__surface p' });
  const actualFonts = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
  await surface.click(); await surface.press('Control+End'); await surface.pressSequentially('本地校对完成');
  const uploadedImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  await page.locator('.rich-question-editor').first().locator('input[type=file]').setInputFiles({ name: '新增图片.png', mimeType: 'image/png', buffer: uploadedImage });
  await page.locator('img[alt="新增图片.png"]').waitFor();
  await page.screenshot({ path: path.join(output, carrier + '-offline-editor.png'), fullPage: true });
  await page.locator('.ant-modal-content:visible').getByRole('button', { name: /确\s*定/ }).click();
  await page.locator('.ant-modal-content:visible').waitFor({ state: 'hidden' });
  assert((await page.locator('tbody').innerText()).includes('本地校对完成'));
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  assert((await surface.innerText()).includes('本地校对完成'));
  assert.equal(await page.locator('img[alt="新增图片.png"]').count(), 1, 'editor upload persists in local preview');
  await page.locator('.ant-modal-content:visible').getByRole('button', { name: /取\s*消/ }).click();
  assert.equal(await page.evaluate(() => window.fixture.cloudRequests), 0, 'offline parse, cleanup, edit and reopening use no business requests');
  await page.screenshot({ path: path.join(output, carrier + '-offline-preview.png'), fullPage: true });
  assert.deepEqual(errors, []);
  const report = { carrier, userAgent: await page.evaluate(() => navigator.userAgent), offline: true, cloudRequests: 0, removedImages: 2,
    geometry, latex: 'x', editedTextRoundtrip: true, font, actualFonts, errors, pass: true, verifiedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output, carrier + '-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  if (carrier === 'chrome') await verifyDraftRecovery(page);
}
async function verifyDraftRecovery(page) {
  await page.context().setOffline(false);
  await page.evaluate(async () => {
    const fixture = window.fixture;
    await fixture.saveSession({ token: 'fixture-token', userId: 'user_fixture', deviceId: 'device_fixture', activeRole: 'teacher' });
    if (sessionStorage.getItem('gewu_desktop_authorization_session') !== null) throw Error('session must remain in memory');
    let issued = 0; window.questionDraftProvenance = { issueDraft: async () => ({questionId:'fixture-draft-'+(++issued)}) };
    fixture.drafts=[];fixture.createAttempts=0;fixture.prepareCalls=0;fixture.taskCreates=0;
    window.dbService.getAllQuestions=()=>fixture.drafts;
    window.dbService.createQuestion=(data,id)=>{fixture.createAttempts++;if(fixture.createAttempts===2)throw Error('fixture interrupted second draft');const draft={...data,id,storage_state:'local_draft'};fixture.drafts.push(draft);return draft};
    fixture.seal=async input=>({sourceSha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',input.bytes)),b=>b.toString(16).padStart(2,'0')).join(''),sourceBytes:input.bytes.length,envelope:{fixture:true},ciphertextBase64:'fixture ciphertext'});
    fixture.fetchHandler=async(url,options={})=>{
      const ok=task=>new Response(JSON.stringify({ok:true,task}),{status:200,headers:{'content-type':'application/json'}});
      if(url.endsWith('/relay-key'))return new Response(JSON.stringify({ok:true,intakeProcessing:'desktop-v1',agentPublicKey:'A'.repeat(43),agentKeyFingerprint:'b'.repeat(64)}),{status:200});
      if(url.endsWith('/parsed')){fixture.taskCreates++;const body=JSON.parse(options.body);const candidate=body.parsed.candidates[0];fixture.task={taskId:'question_import_task_fixture01',status:'candidates_ready',phase:'media_pending',sourceStorageState:'queued',mediaStorageState:'verified',mediaTargets:candidate.mediaManifest.map((media,index)=>({...media,itemIndex:0,assetIndex:index,storageTaskId:'task_fixture001',objectId:'obj_fixture001',mediaId:'question_import_media_fixture001',objectVersion:1,storageState:'verified'})),items:[0,1,2].map(index=>({...candidate,itemId:'question_import_item_fixture00'+index,itemIndex:index,status:index===2?'rejected':'accepted'}))};return ok(fixture.task)}
      if(url.endsWith('/prepare-drafts')){fixture.prepareCalls++;fixture.task.status='drafts_prepared';fixture.task.items.forEach(item=>{if(item.status==='accepted')item.status='draft_prepared'});throw Error('fixture dropped prepared HTTP response')}
      return ok(fixture.task);
    };
  });
  const generate=page.locator('button').filter({hasText:'生成待提交草稿'});
  await generate.click();await page.waitForFunction(()=>document.body.textContent.includes('原件与图片正在归档')||document.body.textContent.includes('生成待提交草稿失败:'));
  assert((await page.locator('body').innerText()).includes('原件与图片正在归档'),(await page.locator('body').innerText()).slice(-1500));
  assert.equal(await page.evaluate(()=>window.fixture.drafts.length),0,'storage receipt gate prevents drafts');
  await page.evaluate(()=>{window.fixture.task.sourceStorageState='verified';window.fixture.task.phase='candidates_ready'});
  await generate.click();await page.getByText(/fixture dropped prepared HTTP response/).waitFor();
  await generate.click({timeout:5000}).catch(async error=>{throw Error(error.message+'\n'+await page.locator('body').innerText())});await page.getByText(/fixture interrupted second draft/).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.drafts.length),1);
  await generate.click();await page.getByText(/待提交草稿已生成：2 题/).waitFor();
  const result=await page.evaluate(()=>({drafts:window.fixture.drafts,prepareCalls:window.fixture.prepareCalls,taskCreates:window.fixture.taskCreates,attempts:window.fixture.createAttempts}));
  assert.equal(result.drafts.length,2);assert.equal(result.prepareCalls,1);assert.equal(result.taskCreates,1);
  assert.equal(new Set(result.drafts.map(draft=>draft.import_item_id)).size,2);
  assert(!JSON.stringify(result.drafts).includes('question-asset://image-'),'staged canonical references survive draft creation');
  assert.equal(await generate.isDisabled(),true,'completed batch cannot duplicate drafts');
  fs.writeFileSync(path.join(output,'draft-recovery-report.json'),JSON.stringify({...result,verifiedAt:new Date().toISOString(),pass:true},null,2));
  console.log('actual import page: receipt gate, lost prepare response, partial local failure, rejected item exclusion and duplicate prevention passed');
}
async function verifyActualSource(page, carrier) {
  const sourcePath = process.env.QUESTION_INTAKE_SOURCE;
  if (!sourcePath) return;
  await page.exposeFunction('fixtureCloudValidate', async body => {
    const ciphertext = Buffer.from('fixture encrypted original');
    const b64 = size => Buffer.alloc(size, 1).toString('base64url');
    let candidates;
    const repo = createQuestionImportTaskRepository({ query: async (sql, values) => {
      if (sql.startsWith('SELECT task_id')) return { rows: [] };
      candidates = JSON.parse(values[20]);
      throw Error('VALIDATED');
    } });
    const request = { ...body, relay: { agentKeyFingerprint: 'b'.repeat(64), ciphertext,
      expiresAt: new Date(Date.now() + 600000).toISOString(), envelope: {
        version: 'x25519-aes-256-gcm-v1', ephemeralPublicKey: b64(44), keyDerivationSalt: b64(16),
        wrappedKeyNonce: b64(12), wrappedKeyCiphertext: b64(32), wrappedKeyTag: b64(16), contentNonce: b64(12), contentTag: b64(16),
        ciphertextSha256: crypto.createHash('sha256').update(ciphertext).digest('hex'), ciphertextBytes: ciphertext.length,
        plaintextSha256: body.sourceSha256, plaintextBytes: body.sourceBytes,
      } } };
    try { await repo.createParsed({ tenantId: 'default', actor: { accountId: 'fixture', roles: ['teacher'] }, idempotencyKey: 'source-fixture', request }); }
    catch (error) { if (error.message !== 'VALIDATED') throw error; }
    assert.equal(candidates.length, 7);
    return candidates;
  });
  await page.locator('.ant-radio-button-wrapper').filter({ hasText: '\u4e13\u9898\u9898\u96c6' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /\u9009\u62e9\u6587\u4ef6/ }).click();
  await (await chooser).setFiles(sourcePath);
  await page.getByRole('button', { name: /\u5f00\u59cb\u89e3\u6790/ }).click();
  await page.locator('tbody tr').filter({ has: page.getByRole('button', { name: '\u7f16\u8f91', exact: true }) }).nth(6).waitFor({ timeout: 90000 });
  const before = await page.locator('tbody').innerText();
  assert(!before.includes('\u539f\u6587\u4e2d\u7684\u5355\u4f4d\u201ck\u201d') && !before.includes('\u539f\u6587\u4e2d\u7684\u5355\u4f4d\u201cv\u201d'));
  await page.getByRole('button', { name: '\u7f16\u8f91', exact: true }).nth(4).click();
  const italic = await page.locator('.rich-question-editor__surface').evaluateAll(elements => elements.flatMap(el => Array.from(el.querySelectorAll('em')).filter(node => ['v','k'].includes(node.textContent.trim())).map(node => ({text:node.textContent,fontStyle:getComputedStyle(node).fontStyle}))));
  assert(italic.some(node => node.text === 'v' && node.fontStyle === 'italic'));
  assert(italic.some(node => node.text === 'k' && node.fontStyle === 'italic'));
  await page.screenshot({ path: path.join(output, carrier + '-actual-source-italic.png'), fullPage: true });
  await page.locator('.ant-modal-content:visible').getByRole('button', { name: /\u53d6\s*\u6d88/ }).click();
  await page.evaluate(async () => {
    const fixture = window.fixture;
    await fixture.saveSession({ token: 'fixture-token', userId: 'user_fixture', deviceId: 'device_fixture', activeRole: 'teacher' });
    fixture.drafts = []; fixture.rejected = false; let issued = 0;
    window.questionDraftProvenance = { issueDraft: async () => ({ questionId: 'actual-draft-' + (++issued) }) };
    window.dbService.getAllQuestions = () => fixture.drafts;
    window.dbService.createQuestion = (data,id) => { const row={...data,id,storage_state:'local_draft'};fixture.drafts.push(row);return row; };
    fixture.seal = async input => ({ sourceSha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',input.bytes)),byte=>byte.toString(16).padStart(2,'0')).join(''),sourceBytes:input.bytes.length,envelope:{fixture:true},ciphertextBase64:'fixture' });
    fixture.fetchHandler = async (url, options={}) => {
      const ok=task=>new Response(JSON.stringify({ok:true,task}),{status:200});
      if(url.endsWith('/relay-key')) return new Response(JSON.stringify({ok:true,intakeProcessing:'desktop-v1',agentPublicKey:'A'.repeat(43),agentKeyFingerprint:'b'.repeat(64)}),{status:200});
      if(url.endsWith('/parsed')) {
        if(!fixture.rejected){fixture.rejected=true;return new Response(JSON.stringify({ok:false,code:'CLOUD_BUSINESS_INPUT_INVALID'}),{status:400});}
        const items=await window.fixtureCloudValidate(JSON.parse(options.body));
        fixture.task={taskId:'question_import_task_actualsrc1',status:'candidates_ready',phase:'candidates_ready',sourceStorageState:'verified',mediaStorageState:'verified',
          items:items.map(item=>({...item,status:item.validation.status})),mediaTargets:items.flatMap(item=>item.mediaManifest.map(media=>({...media,itemIndex:item.itemIndex,storageState:'verified'})))};
        return ok(fixture.task);
      }
      if(url.endsWith('/prepare-drafts')) {fixture.task.status='drafts_prepared';fixture.task.items.forEach(item=>{if(['accepted','warning'].includes(item.status))item.status='draft_prepared'});}
      return ok(fixture.task);
    };
  });
  const generate = page.locator('button').filter({ hasText: '\u751f\u6210\u5f85\u63d0\u4ea4\u8349\u7a3f' });
  await generate.click(); await page.getByText('\u8349\u7a3f\u751f\u6210\u672a\u5b8c\u6210', { exact: true }).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.drafts.length),0);
  await page.screenshot({ path: path.join(output, carrier + '-actual-source-rejected.png'), fullPage: true });
  await generate.click(); await page.getByText(/\u5f85\u63d0\u4ea4\u8349\u7a3f\u5df2\u751f\u6210\uff1a7 \u9898/).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.drafts.length),7);
  assert.equal(await generate.isDisabled(),true);
  await page.screenshot({ path: path.join(output, carrier + '-actual-source-drafts.png'), fullPage: true });
  fs.writeFileSync(path.join(output,carrier+'-actual-source-report.json'),JSON.stringify({carrier,count:7,italic,inputValidation:'actual cloud repository',storage:'fixture verified receipts',persistentFailure:true,retryPassed:true,duplicatePrevention:true,verifiedAt:new Date().toISOString()},null,2),'utf8');
  console.log(carrier + ': actual source 7 questions, italic v/k, persistent rejection, cloud validation, retry and duplicate prevention passed');
}
(async () => {
  fs.writeFileSync(path.join(output, '本地录入.docx'), createFixture()); await compile();
  const html = '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>本机录入验证</title><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
  const server = http.createServer((req,res) => {res.setHeader('Content-Type',req.url === '/bundle.js' ? 'text/javascript' : 'text/html; charset=utf-8');res.end(req.url === '/bundle.js' ? fs.readFileSync(path.join(output,'bundle.js')) : html)});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const native = createDesktopQuestionIntake({ appRoot: root, workRoot: path.join(output,'chrome-work') });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try { const page = await browser.newPage({ viewport: {width:1280,height:920} });
      await page.exposeFunction('fixtureParse', async input => {const result=await native.parse({...input,bytes:new Uint8Array(input.bytes)});return {...result,mediaBytes:result.mediaBytes.map(items=>items.map(bytes=>Array.from(bytes)))} });
      await page.goto(url); await verify(page,'chrome'); await verifyActualSource(page,'chrome');
    } finally {await browser.close()}
    const main = path.join(output,'electron-main.cjs'), preload=path.join(output,'electron-preload.cjs');
    fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('questionImportRelay',{parseSource:input=>ipcRenderer.invoke('intake-parse',input),sealSource:input=>ipcRenderer.invoke('intake-seal',input),sealAsset:input=>ipcRenderer.invoke('intake-seal',input)});`, 'utf8');
    fs.writeFileSync(main, `const {app,BrowserWindow,ipcMain}=require('electron');const {createDesktopQuestionIntake}=require(${JSON.stringify(path.join(root,'public/desktopQuestionIntake.js'))});let win;const parser=createDesktopQuestionIntake({appRoot:${JSON.stringify(root)},workRoot:${JSON.stringify(path.join(output,'electron-work'))}});ipcMain.handle('intake-parse',(_,input)=>parser.parse(input));app.whenReady().then(()=>{win=new BrowserWindow({width:1280,height:920,show:false,webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});win.loadURL(${JSON.stringify(url)});});app.on('window-all-closed',()=>app.quit());`);
    fs.writeFileSync(main, fs.readFileSync(main, 'utf8') + `\nipcMain.handle('intake-seal',(_,input)=>({sourceSha256:require('crypto').createHash('sha256').update(Buffer.from(input.bytes)).digest('hex'),sourceBytes:input.bytes.length,envelope:{fixture:true},ciphertextBase64:'fixture'}));`, 'utf8');
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(require('electron'),['--remote-debugging-port=9352',main,'--user-data-dir='+path.join(output,'electron-profile')],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4000)});let electron;
    try {for(let attempt=0;attempt<60;attempt++){try{electron=await chromium.connectOverCDP('http://127.0.0.1:9352',{timeout:3000,noDefaults:true});break}catch{await new Promise(resolve=>setTimeout(resolve,250))}}assert(electron,'Electron CDP unavailable: '+stderr);const page=electron.contexts()[0].pages()[0];await page.waitForURL(url+'/');await verify(page,'electron');await verifyActualSource(page,'electron')}
    finally {if(electron)await electron.close();try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'})}catch{}}
  } finally {await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
