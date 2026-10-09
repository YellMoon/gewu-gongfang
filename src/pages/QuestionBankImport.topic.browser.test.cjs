'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const webpack = require('webpack');
const { chromium, _electron } = require('playwright');
const root = path.resolve(__dirname, '../..');
const output = process.env.QUESTION_TOPIC_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-topic-ui-'));
fs.mkdirSync(output, { recursive: true });
const defaultFile = path.join(output, 'topic.docx');
if (!process.env.QUESTION_TOPIC_FILES) fs.writeFileSync(defaultFile, require('../../public/topicQuestionIntake.test').createTopicFixture());
const files = process.env.QUESTION_TOPIC_FILES ? JSON.parse(process.env.QUESTION_TOPIC_FILES) : [defaultFile];
const sources = new Map(files.map(file => [path.basename(file), fs.readFileSync(file)]));
const emptyFile = path.join(output, 'all-skipped.docx');
const emptyBytes = require('../../public/topicQuestionIntake.test').createTopicFixture({ onlyAmbiguous: true });
fs.writeFileSync(emptyFile, emptyBytes);sources.set(path.basename(emptyFile),emptyBytes);
const intakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-topic-ui-intake-'));
const intake = require('../../public/desktopQuestionIntake').createDesktopQuestionIntake({ appRoot: root, workRoot: intakeRoot });
const entry = path.join(output, 'entry.tsx');
fs.writeFileSync(entry, `import React from 'react';import {createRoot} from 'react-dom/client';
import Import from ${JSON.stringify(path.join(root, 'src/pages/QuestionBankImport.tsx'))};
import AppShell from ${JSON.stringify(path.join(root, 'src/layout/AppShell.tsx'))};
import ${JSON.stringify(path.join(root, 'src/index.css'))};
window.dbService={getKnowledgeTree:()=>[],getModelTree:()=>[],getTaxonomySystems:()=>[],getTaxonomyNodes:()=>[]};
window.desktopIdentitySessionProvider={listCloudQuestions:async()=>[]};
window.questionImportRelay={parseSource:async input=>{
 const digest=await crypto.subtle.digest('SHA-256',input.bytes);
 const result=await window.parseFixture({sourceType:input.sourceType,sourceFileName:input.sourceFileName,bytes:input.bytes.length,sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')});
 return {...result,mediaBytes:result.mediaBytes.map(media=>media.map(value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0))))};
}};
createRoot(document.getElementById('root')).render(<AppShell currentPage="question-bank-tools" onNavigate={()=>{}} onRefresh={()=>{}}><Import/></AppShell>);`, 'utf8');
function compile() {return new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry,output:{path:output,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js','.mjs'],modules:[path.join(root,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:{loader:require.resolve('babel-loader'),options:{presets:[require.resolve('@babel/preset-typescript'),require.resolve('@babel/preset-react')]}}},{test:/\.css$/,use:[require.resolve('style-loader'),require.resolve('css-loader')]},{test:/\.(woff2?|ttf|png|svg)$/,type:'asset/inline'}]},optimization:{minimize:false}},(error,stats)=>error||stats.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve()));}
(async()=>{
 await compile();
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?fs.readFileSync(path.join(output,'bundle.js')):'<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div><script src="/bundle.js"></script></html>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const mainFile=path.join(output,'electron-main.cjs');
 fs.writeFileSync(mainFile,`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const win=new BrowserWindow({width:1440,height:1050,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});win.loadURL('${url}');win.showInactive();});app.on('window-all-closed',()=>app.quit());`,'utf8');
 const electron=process.env.QUESTION_TOPIC_RUNTIME==='electron';const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const browser=electron?await _electron.launch({executablePath:require('electron'),args:[mainFile],env}):await chromium.launch({channel:'chrome',headless:true});
 const results=[],errors=[],consoleErrors=[];let page;
 try{
  page=electron?await browser.firstWindow():await browser.newPage({viewport:{width:1440,height:1050}});
  await page.exposeFunction('parseFixture',async input=>{
   assert.equal(input.sourceType,'topic','selected format reaches the topic parser');
   const bytes=sources.get(input.sourceFileName);assert(bytes);assert.equal(input.bytes,bytes.length);assert.equal(input.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
   const parsed=await intake.parse({sourceType:input.sourceType,sourceFileName:input.sourceFileName,bytes:new Uint8Array(bytes)});
   assert(parsed.candidates.every(item=>item.candidate.sub_questions.every(sub=>!sub.answer)), 'numbered solutions remain only in the whole-question answer');
   const subIndex=parsed.candidates.findIndex(item=>item.candidate.sub_questions.length&&JSON.stringify(item.candidate.rich_content.sections.stem).includes('"type":"image"'));
   results.push({file:input.sourceFileName,count:parsed.candidates.length,skipped:parsed.qualityReport.topic_collection.skipped_groups,formulaCount:parsed.candidates.reduce((sum,item)=>sum+item.candidate.formulas.length,0),editorIndex:subIndex<8?Math.max(0,subIndex):0});
   return {...parsed,mediaBytes:parsed.mediaBytes.map(media=>media.map(bytes=>Buffer.from(bytes).toString('base64')))};
  });
  page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error'&&!msg.text().startsWith('Warning: [antd:'))consoleErrors.push(msg.text());});
  await page.route('https://**/*',route=>{throw new Error('local preview contacted an external service: '+route.request().url());});
  for(const [index,file] of [...files,emptyFile].entries()){
   await page.goto(url);await page.locator('.ant-radio-button-wrapper').filter({hasText:'\u4e13\u9898\u9898\u96c6'}).click();
   assert(await page.getByText('\u5f00\u59cb\u89e3\u6790\u5728\u672c\u673a\u8bfb\u53d6\u6587\u6863', {exact:false}).isVisible(), 'import instructions are expanded by default');
   assert(await page.getByRole('heading',{name:'\u8bd5\u9898\u5bfc\u5165',exact:true}).isVisible());
   assert(await page.locator('.app-shell__topbar button:visible').filter({hasText:'\u9898\u5e93'}).first().isVisible());
   const picker=page.waitForEvent('filechooser');await page.locator('button:visible').filter({hasText:/^\u9009\u62e9\u6587\u4ef6$/}).click();await (await picker).setFiles(file);
   if(index===0){
    await page.getByRole('button',{name:'\u53d6\u6d88\u9009\u62e9',exact:true}).click();
    assert(await page.locator('button:visible').filter({hasText:/^\u5f00\u59cb\u89e3\u6790$/}).isDisabled());assert.equal(results.length,0);
    assert.equal(await page.getByText(path.basename(file),{exact:false}).count(),0);
    const again=page.waitForEvent('filechooser');await page.locator('button:visible').filter({hasText:/^\u9009\u62e9\u6587\u4ef6$/}).click();await(await again).setFiles(file);
   }
   await page.locator('button:visible').filter({hasText:/^\u5f00\u59cb\u89e3\u6790$/}).click();
   if(file===emptyFile){
    await page.getByText('\u5df2\u8df3\u8fc7\u65e0\u6cd5\u72ec\u7acb\u62c6\u5206\u7684\u9898\u7ec4',{exact:true}).waitFor();
    assert.equal(results.at(-1).count,0);assert.equal(await page.locator('.ant-statistic').count(),0);
    assert.equal(await page.getByRole('button',{name:'\u751f\u6210\u5f85\u63d0\u4ea4\u8349\u7a3f',exact:true}).count(),0);
    await page.screenshot({path:path.join(output,'all-skipped-warning.png'),fullPage:false});continue;
   }
   await page.locator('.ant-statistic').filter({hasText:'\u603b\u9898\u6570'}).waitFor({timeout:90000});
   const result=results.at(-1);const total=page.locator('.ant-statistic').filter({hasText:'\u603b\u9898\u6570'});assert.equal(await total.locator('.ant-statistic-content-value').innerText(),String(result.count));
   assert.equal(await page.locator('.ant-statistic').filter({hasText:'\u5931\u8d25'}).locator('.ant-statistic-content-value').innerText(),'0');
   if(result.skipped.length){assert(await page.getByText('\u5df2\u8df3\u8fc7\u65e0\u6cd5\u72ec\u7acb\u62c6\u5206\u7684\u9898\u7ec4',{exact:true}).isVisible());for(const group of result.skipped)assert(await page.getByText('原文题号 '+group.numbers.join('、'),{exact:false}).isVisible());}
   await total.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,index+'-parse-preview.png'),fullPage:false});
   assert.equal(await page.getByText(/\u7b2c \d+ \u5c0f\u9898\u7b54\u6848\u4e3a\u7a7a/).count(),0,'whole-question answers must not produce missing sub-answer warnings');
   await page.getByRole('button',{name:'\u7f16\u8f91',exact:true}).nth(result.editorIndex).click();await page.locator('.question-structure-editor').waitFor();
   assert(!/^\s*[\uff08(](?:19|20)\d{2}/u.test(await page.locator('.question-structure-editor .tiptap').first().innerText()));
   await page.waitForFunction(()=>Array.from(document.querySelectorAll('.question-structure-editor img')).some(img=>img.complete&&img.naturalWidth>0));
   if(result.editorIndex>0){await page.getByRole('tab',{name:/^\u5c0f\u9898/}).click();assert.equal(await page.getByText('\u5c0f\u9898\u7b54\u6848',{exact:true}).count(),0);}
   await page.getByRole('tab',{name:'\u89e3\u6790',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.question-structure-editor .katex'));
   await page.screenshot({path:path.join(output,index+'-rich-editor.png'),fullPage:false});
   result.renderedFormulas=await page.locator('.question-structure-editor .katex').count();result.renderedImages=await page.locator('.question-structure-editor img').count();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
  fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({runtime:electron?'electron':'chrome',results,errors,consoleErrors},null,2),'utf8');console.log(JSON.stringify({runtime:electron?'electron':'chrome',results,output}));
 }catch(error){if(page){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});console.error(errors,consoleErrors,await page.locator('body').innerText());}throw error;}
 finally{await browser.close();await new Promise(resolve=>server.close(resolve));assert(path.resolve(intakeRoot).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(intakeRoot,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
