'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const webpack = require('webpack');
const { chromium, _electron } = require('playwright');
const root = path.resolve(__dirname, '../..');
const output = process.env.QUESTION_TAGGING_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-question-tagging-'));
fs.mkdirSync(output, { recursive: true });
const entry = path.join(output, 'entry.tsx');
fs.writeFileSync(entry, `
import React from 'react';
import {createRoot} from 'react-dom/client';
import Preview from ${JSON.stringify(path.join(root, 'src/pages/QuestionBankPreview.tsx'))};
import Edit from ${JSON.stringify(path.join(root, 'src/pages/QuestionBankEdit.tsx'))};
import {upsertQuestionLocalRecord} from ${JSON.stringify(path.join(root, 'src/services/questionLocalStore.ts'))};
import AppShell from ${JSON.stringify(path.join(root, 'src/layout/AppShell.tsx'))};
import Basket from ${JSON.stringify(path.join(root, 'src/components/QuestionBasket.tsx'))};
import ${JSON.stringify(path.join(root, 'src/index.css'))};
const systems=['课程知识','解题方法','能力层级','教材章节','命题主题'].map((name,index)=>({id:'s'+(index+1),name,subject:'物理',sort_no:index}));
const nodes=Object.fromEntries(systems.map((system,index)=>[system.id, [
 {id:system.id+'root',name:index===0?'力学主题':'标签主题'+index,order:0},
 {id:system.id+'a',name:index===0?'牛顿运动定律':'主题标签'+index,parent_id:system.id+'root',order:0},
 {id:system.id+'b',name:index===0?'匀变速直线运动':'其他标签'+index,parent_id:system.id+'root',order:1},
]]));
const questions=Array.from({length:24},(_,index)=>({id:'q'+index,subject:'物理',type:index%3===2?'填空题':'单选题',content:'第'+index+'道验证试题，研究小球的运动。',options:[{label:'A',content:'独特选项'+index}],subQuestions:[{content:'实验小题'+index}],answer:'参考答案',analysis:'解析内容',status:'published',exam_type:index%2?'模拟题':'高考真题',grade:['高一','高二','高三'][index%3],semester:'上学期',difficulty:index%3+1,year:index===2?'2034-2035':index%2?'2026-2027':'2025-2026',taxonomy_ids:{s1:[index%2?'s1b':'s1a'],s5:['s5a']},knowledge_ids:[],model_ids:[]}));
questions.forEach((question,index)=>{question.source='原卷来源'+index;question.region=index%2?'上海':'浙江';question.school='验证中学'+index;});
nodes.s1.push({id:'s1c',name:'三级标签',parent_id:'s1a',order:0});
for(let i=0;i<16;i++) nodes.s5.push({id:'s5extra'+i,name:'扩展标签'+i,parent_id:'s5root',order:i+2});
questions.forEach((question,index)=>{question.created_at=new Date(Date.UTC(2026,9,1,0,0,24-index)).toISOString();question.answer='A';question.options=[{label:'A',content:'选项一',is_correct:true},{label:'B',content:'选项二'}];});
const stored=JSON.parse(localStorage.getItem('tagging-fixture-questions')||'null');if(stored)questions.splice(0,questions.length,...stored);
let basket=[]; window.__writes=[];window.__failIds=[];window.__offline=false;window.__questions=questions;

window.__GEWU_DESKTOP_IDENTITY_PARTITION__='question-filter-isolated-fixture';
window.dbService={
 refreshAuthorityProjection:async()=>{if(window.__offline)throw new Error('OFFLINE');},
 getLatestQuestionVersions:()=>[],
 updateQuestion:(id,patch)=>{if(window.__failIds.includes(id))return false;const index=questions.findIndex(q=>q.id===id);if(index<0)return false;questions[index]={...questions[index],...patch};window.__writes.push({id,patch});localStorage.setItem('tagging-fixture-questions',JSON.stringify(questions));upsertQuestionLocalRecord(questions[index]);return true;},
 getAllQuestions:()=>questions,
 getKnowledgeTree:()=>[], getModelTree:()=>[],initDefaultModelTree:()=>{},
 getTaxonomySystems:subject=>subject==='物理'?systems:[],
 getTaxonomyNodes:id=>nodes[id]||[],
 getQuestionBasketIds:()=>basket,setQuestionBasketIds:ids=>basket=ids,
};
function Fixture(){const [subject,setSubject]=React.useState('物理'),[route,setRoute]=React.useState('question-bank-edit'),[context,setContext]=React.useState(undefined);
 const navigate=target=>{setRoute(typeof target==='string'?target:target.page);setContext(typeof target==='string'?undefined:target.context);};
 React.useEffect(()=>{const listener=event=>navigate(event.detail);window.addEventListener('navigate-page',listener);return()=>window.removeEventListener('navigate-page',listener);},[]);
 window.__navigate=navigate;
 return <AppShell currentPage={route} questionBankSubject={subject} onQuestionBankSubjectChange={setSubject} onNavigate={navigate} onRefresh={()=>window.dispatchEvent(new Event('authority-projection-refreshed'))}>
 {route==='question-bank-edit'?<Edit subject={subject} context={context}/>:<Preview subject={subject}/>}<Basket/></AppShell>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
`, 'utf8');
function compile() {
 return new Promise((resolve,reject)=>webpack({
  mode:'development',devtool:false,entry,output:{path:output,filename:'bundle.js'},
  resolve:{extensions:['.tsx','.ts','.js','.mjs'],modules:[path.join(root,'node_modules'),'node_modules']},
  module:{rules:[
   {test:/\.tsx?$/,exclude:/node_modules/,use:{loader:require.resolve('babel-loader'),options:{presets:[require.resolve('@babel/preset-typescript'),require.resolve('@babel/preset-react')]}}},
   {test:/\.css$/,use:[require.resolve('style-loader'),require.resolve('css-loader')]},
   {test:/\.(woff2?|ttf|png|svg)$/,type:'asset/inline'},
  ]},optimization:{minimize:false},
 },(error,stats)=>error||stats.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve()));
}

(async()=>{
 await compile();
 const html='<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>编辑与体系打标验证</title><div id="root"></div><script src="/bundle.js"></script></html>';
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?fs.readFileSync(path.join(output,'bundle.js')):html);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const useElectron=process.env.QUESTION_TAGGING_RUNTIME==='electron';
 const electronMain=path.join(output,'electron-main.cjs');
 fs.writeFileSync(electronMain,`const {app,BrowserWindow}=require('electron'); app.whenReady().then(()=>{const win=new BrowserWindow({width:1440,height:1050,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});win.loadURL('http://127.0.0.1:${server.address().port}');win.showInactive();});app.on('window-all-closed',()=>app.quit());`,'utf8');
 const electronEnv={...process.env};delete electronEnv.ELECTRON_RUN_AS_NODE;
 const browser=useElectron?await _electron.launch({executablePath:require('electron'),args:[electronMain],env:electronEnv}):await chromium.launch({channel:'chrome',headless:true});
 const page=useElectron?await browser.firstWindow():await browser.newPage({viewport:{width:1440,height:1050}});
 const errors=[],consoleErrors=[],checks=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error'&&!msg.text().startsWith('Warning: [antd:'))consoleErrors.push(msg.text());});
 const expectState=predicate=>page.waitForFunction(predicate);
 async function add(scope,label,search,option){
  await scope.getByRole('button',{name:'添加'+label,exact:true}).click();
  await scope.getByRole('combobox',{name:'搜索'+label,exact:true}).fill(search);
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({has:page.getByText(option,{exact:true})}).click();
  await scope.locator('.qb-tag-picker[aria-label="'+label+'"]').getByRole('button',{name:'确定',exact:true}).click();
 }
 async function select(text){await page.getByRole('textbox',{name:'批量选择题号',exact:true}).fill(text);await page.getByRole('button',{name:'按题号加入选择',exact:true}).click();}
 async function apply(){await page.getByRole('button',{name:'应用到所选试题',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.qb-tagging-toolbar .ant-btn-loading'));}
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>document.querySelector('h1')?.textContent.includes('物理编辑与打标'));
  await page.waitForFunction(()=>document.querySelectorAll('.qb-tagging-question').length===10);
  assert.equal(await page.title(),'编辑与体系打标验证');
  const first=page.locator('[data-question-id="q0"]'), batch=page.locator('.qb-tagging-toolbar');
  assert.equal(await first.locator('[data-tagging-system]').count(),5);
  assert.equal(await batch.locator('[data-tagging-system]').count(),5);
  assert.equal(await first.getByText('知识点：',{exact:true}).count(),0);
  await add(first,'课程知识','力学主题','力学主题');
  await add(first,'课程知识','三级','力学主题 / 牛顿运动定律 / 三级标签');
  for(let i=0;i<16;i++) await add(first,'命题主题','扩展标签'+i,'标签主题4 / 扩展标签'+i);
  await expectState(()=>window.__questions[0].taxonomy_ids.s5.length===17);
  assert.deepEqual(await page.evaluate(()=>window.__questions[0].taxonomy_ids.s1),['s1a','s1root','s1c']);
  const geometry=await first.locator('[data-tagging-system]').evaluateAll(rows=>rows.map(row=>({top:row.getBoundingClientRect().y,bottom:row.getBoundingClientRect().bottom,width:row.getBoundingClientRect().width,scroll:row.scrollWidth,font:getComputedStyle(row).fontStyle})));
  assert(geometry.every((row,index)=>row.font==='normal'&&row.scroll<=row.width+1&&(!index||row.top>=geometry[index-1].bottom)));
  await first.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'01-inline-all-systems.png')});
  checks.push('all five systems have separate rows; any level including root/grandchild; 17 selections without clipping or limit; immediate persistence');
  await first.getByRole('button',{name:/编辑/}).click();
  const modal=page.locator('.ant-modal:visible');
  assert.equal(await modal.locator('[data-tagging-system]').count(),5);
  assert.equal(await modal.getByText('关联知识点',{exact:true}).count(),0);
  assert.equal(await modal.getByText('关联模型',{exact:true}).count(),0);
  await modal.locator('.tiptap[contenteditable="true"]').first().fill('修改后的试题内容');
  await add(modal,'解题方法','其他标签1','标签主题1 / 其他标签1');
  await page.screenshot({path:path.join(output,'02-dynamic-editor.png')});
  await modal.locator('.ant-modal-footer .ant-btn-primary').click();
  await page.waitForFunction(()=>window.__questions[0].content.includes('修改后的试题内容'));
  await page.locator('.ant-modal:visible').waitFor({state:'hidden'});
  await page.reload();await first.waitFor();
  await expectState(()=>window.__questions[0].taxonomy_ids.s5.length===17);
  assert.deepEqual(await page.evaluate(()=>window.__questions[0].taxonomy_ids.s2),['s2b']);
  checks.push('full shared rich editor saves edited content with dynamic system names; taxonomy survives route reload');
  await select('1, 11, 24');
  await page.getByText('已选 3 题（跨页保留）',{exact:true}).waitFor();
  await add(batch,'课程知识','力学主题','力学主题');
  await add(batch,'解题方法','主题标签1','标签主题1 / 主题标签1');
  await page.evaluate(()=>window.__failIds=['q10']);
  await apply();await page.getByText('已选 1 题（跨页保留）',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__questions[23].taxonomy_ids.s1),['s1b','s1root']);
  assert.deepEqual(await page.evaluate(()=>window.__questions[10].taxonomy_ids.s1),['s1a']);
  await page.evaluate(()=>window.__failIds=[]);await apply();await page.getByText('已选 0 题（跨页保留）',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__questions[10].taxonomy_ids.s2),['s2a']);
  await select('1,24');
  await batch.locator('.ant-select').filter({has:page.getByRole('combobox',{name:'批量打标方式',exact:true})}).locator('.ant-select-selector').click();
  await page.locator('.ant-select-dropdown:visible').getByText('替换所选体系',{exact:true}).click();
  await apply();assert.deepEqual(await page.evaluate(()=>window.__questions[23].taxonomy_ids.s1),['s1root']);
  assert.equal(await page.evaluate(()=>window.__questions[0].taxonomy_ids.s5.length),17);
  await select('1,24');await batch.locator('.ant-select').filter({has:page.getByRole('combobox',{name:'批量打标方式',exact:true})}).locator('.ant-select-selector').click();
  await page.locator('.ant-select-dropdown:visible').getByText('移除节点',{exact:true}).click();
  await apply();assert.deepEqual(await page.evaluate(()=>window.__questions[23].taxonomy_ids.s1),[]);
  await select('1,3,8-12');await page.getByText('已选 7 题（跨页保留）',{exact:true}).waitFor();
  await page.getByRole('button',{name:'清空选择',exact:true}).click();
  await select('0,99');await page.getByText(/题号须在 1 至 24 之间/).waitFor();
  assert.equal(await page.getByText('已选 0 题（跨页保留）',{exact:true}).count(),1);
  await batch.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'03-batch-cross-page.png')});
  checks.push('arbitrary cross-page numbers, ranges, invalid input; multi-system append/replace/remove; preserve unaffected systems; retain only failed questions and retry');
  await page.evaluate(()=>window.__navigate('question-bank-preview'));
  await page.waitForFunction(()=>document.querySelector('h1')?.textContent.includes('物理题库'));
  await page.locator('.qb-question-card').first().getByRole('button',{name:/编辑/}).click();
  assert.equal(await page.locator('.ant-modal:visible [data-tagging-system]').count(),5);
  await page.locator('.ant-modal:visible .ant-modal-footer .ant-btn-primary').click();
  await page.locator('.ant-modal:visible').waitFor({state:'hidden'});
  await page.getByRole('checkbox',{name:'选择第1题',exact:true}).check();
  await page.getByRole('button',{name:'批量打标',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('h1')?.textContent.includes('物理编辑与打标'));
  await page.getByText('已选 1 题（跨页保留）',{exact:true}).waitFor();
  await page.evaluate(()=>{window.__offline=true;window.dispatchEvent(new Event('authority-projection-refreshed'));});
  await page.getByText(/暂时无法读取最新题库，显示本地已保存的试题/).waitFor();
  assert.equal(await page.locator('.qb-tagging-question').count(),10);
  checks.push('original question-bank editor retained; preview batch entry transfers selected IDs; offline cache still readable');
  await page.getByRole('button',{name:'选择科目题库',exact:true}).click();
  await page.getByRole('menuitem',{name:'化学题库',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('h1')?.textContent.includes('化学编辑与打标'));
  await page.waitForFunction(()=>!document.querySelectorAll('.qb-tagging-question').length);
  assert.equal(await batch.locator('[data-tagging-system]').count(),0);
  await page.getByText('当前学科暂无体系，请在左侧新建体系',{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'04-empty-offline.png')});
  await page.setViewportSize({width:1366,height:768});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
  fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({browserPlugin:'absent; repository Playwright fixture',runtime:useElectron?'Electron':'Chrome',checks,errors,consoleErrors,geometry},null,2),'utf8');
  console.log('Tagging runtime checks passed: '+checks.length+' groups. Evidence: '+output);
 }catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:false});console.error('Runtime errors',errors,'console errors',consoleErrors,'evidence',output);throw error;}
 finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
