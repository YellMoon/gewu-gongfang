'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const webpack = require('webpack');
const { chromium, _electron } = require('playwright');
const root = path.resolve(__dirname, '../..');
const output = process.env.QUESTION_FILTER_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-question-filters-'));
fs.mkdirSync(output, { recursive: true });
const entry = path.join(output, 'entry.tsx');
fs.writeFileSync(entry, `
import React from 'react';
import {createRoot} from 'react-dom/client';
import Preview from ${JSON.stringify(path.join(root, 'src/pages/QuestionBankPreview.tsx'))};
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
let basket=[];
window.__GEWU_DESKTOP_IDENTITY_PARTITION__='question-filter-isolated-fixture';
window.dbService={
 refreshAuthorityProjection:async()=>{},
 getAllQuestions:()=>questions,
 getKnowledgeTree:()=>[], getModelTree:()=>[],initDefaultModelTree:()=>{},
 getTaxonomySystems:subject=>subject==='物理'?systems:[],
 getTaxonomyNodes:id=>nodes[id]||[],
 getQuestionBasketIds:()=>basket,setQuestionBasketIds:ids=>basket=ids,
};
function Fixture(){const [subject,setSubject]=React.useState('物理');return <AppShell currentPage="question-bank-preview" questionBankSubject={subject} onQuestionBankSubjectChange={setSubject} onNavigate={()=>{}} onRefresh={()=>{}}><Preview subject={subject}/><Basket/></AppShell>;}
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
 const html='<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>桌面试题库筛选验证</title><style>body{margin:0;background:#f6f8fc}.app-shell__content{box-sizing:border-box}.qb-preview-sidebar{position:relative}</style><div id="root"></div><script src="/bundle.js"></script></html>';
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?fs.readFileSync(path.join(output,'bundle.js')):html);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const useElectron=process.env.QUESTION_FILTER_RUNTIME==='electron';
 const electronMain=path.join(output,'electron-main.cjs');
 fs.writeFileSync(electronMain,`const {app,BrowserWindow}=require('electron'); app.whenReady().then(()=>{const win=new BrowserWindow({width:1440,height:1050,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});win.loadURL('http://127.0.0.1:${server.address().port}');win.showInactive();}); app.on('window-all-closed',()=>app.quit());`,'utf8');
 const electronEnv={...process.env};delete electronEnv.ELECTRON_RUN_AS_NODE;
 const browser=useElectron?await _electron.launch({executablePath:require('electron'),args:[electronMain],env:electronEnv}):await chromium.launch({channel:'chrome',headless:true});
 const checks=[]; const measurements={};
 try{
  const page=useElectron?await browser.firstWindow():await browser.newPage({viewport:{width:1440,height:1050}});
  if(useElectron)await page.setViewportSize({width:1440,height:1050});
  const errors=[],consoleErrors=[],consoleWarnings=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error'){if(msg.text().startsWith('Warning: [antd:')&&msg.text().includes('deprecated'))consoleWarnings.push(msg.text());else consoleErrors.push(msg.text());}});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const total=async count=> { try { await page.waitForFunction(count=>document.querySelector('.qb-result-count')?.textContent.includes('共 '+count+' 题'),count); } catch(error) { await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}); console.error('EXPECTED',count,'ERRORS',errors,'DOM',await page.locator('body').innerText()); throw error; } };
  await total(24);
  await page.setViewportSize({width:1366,height:768});
  await page.screenshot({path:path.join(output,'00-compact-first-screen-1366.png'),fullPage:false});
  const firstCard=await page.locator('.qb-question-card').first().boundingBox();
  assert(firstCard && firstCard.y+firstCard.height<=768,'default merged filters must leave a complete question card visible at 1366x768 with the application header');
  const labelLefts=await page.locator('.qb-filter-lines > .qb-choice-row:not([data-filter-row="status"]):not([data-filter-row="grade"]):not([data-filter-row="semester"]) > .qb-choice-label,.qb-taxonomy-filter-rows > .qb-choice-row > .qb-choice-label').evaluateAll(labels=>labels.map(el=>el.getBoundingClientRect().x));
  assert(labelLefts.every(left=>Math.abs(left-labelLefts[0])<1),'first-column labels align across every background block');
  const backgrounds=await page.locator('.qb-choice-row').evaluateAll(rows=>rows.map(el=>getComputedStyle(el).backgroundColor));
  assert(backgrounds.every(color=>color!=='rgba(0, 0, 0, 0)'&&color!=='transparent'),'all filter rows have visible background blocks');
  const typeBox=await page.locator('[data-filter-row="type"]').boundingBox(),statusBox=await page.locator('[data-filter-row="status"]').boundingBox();
  const difficultyBox=await page.locator('[data-filter-row="difficulty"]').boundingBox(),gradeBox=await page.locator('[data-filter-row="grade"]').boundingBox(),semesterBox=await page.locator('[data-filter-row="semester"]').boundingBox();
  assert(Math.abs(typeBox.y-statusBox.y)<1,'type and status share one row');
  assert(Math.abs(difficultyBox.y-gradeBox.y)<1&&Math.abs(gradeBox.y-semesterBox.y)<1,'difficulty, grade and semester share one row');
  const systemButton=page.getByRole('button',{name:'课程知识',exact:true});
  await page.locator('#taxonomy-system-body-s1 .ant-tree-switcher').first().click();
  await page.locator('[data-node-id="s1b"]').waitFor();
  await systemButton.click();assert.equal(await systemButton.getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('[data-node-id="s1b"]').isVisible(),false);
  assert.equal(await page.locator('#taxonomy-system-body-s2').isVisible(),true,'systems collapse independently');
  await page.getByLabel('搜索体系节点').fill('匀变速');
  assert.equal(await page.locator('[data-node-id="s1b"]').isVisible(),true,'search temporarily reveals a collapsed system');
  await page.getByLabel('搜索体系节点').fill('');
  assert.equal(await page.locator('[data-node-id="s1b"]').isVisible(),false,'clearing search restores its collapse state');
  await systemButton.press('Enter');assert.equal(await page.locator('[data-node-id="s1b"]').isVisible(),true,'keyboard toggling preserves node expansion');
  await page.setViewportSize({width:1200,height:768});
  await page.mouse.move(1200,700);
  measurements.tree=await page.locator('[data-node-id="s1b"] > span').evaluate(el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el),range=document.createRange();range.selectNodeContents(el);return{label:el.textContent,width:b.width,height:b.height,textWidth:range.getBoundingClientRect().width,fontSize:s.fontSize,lineHeight:s.lineHeight,sidebarWidth:document.querySelector('.qb-preview-tree-card').getBoundingClientRect().width};});
  assert.equal(measurements.tree.fontSize,'13px');
  assert(measurements.tree.width>=measurements.tree.textWidth && measurements.tree.height<25,'seven-character second-level node fits one line at 1200px viewport');
  assert(measurements.tree.sidebarWidth>=260,'tree card retains stable usable width');
  await page.screenshot({path:path.join(output,'08-tree-readable-1200.png'),fullPage:false});
  await systemButton.click();
  await page.screenshot({path:path.join(output,'09-independent-system-collapse.png'),fullPage:false});
  await systemButton.click();
  await page.locator('#taxonomy-system-body-s1 .ant-tree-switcher').first().click();
  checks.push('tree matches reference 13px density; seven-character child fits at 1200px; independent mouse/keyboard system collapse and search reveal');
  await page.setViewportSize({width:1440,height:1050});
  checks.push('compact defaults: fixed-option groups share tinted rows; complete first question visible at 1366x768 with app header');
  assert.equal(await page.title(),'桌面试题库筛选验证');
  assert.equal(await page.getByRole('button',{name:'删除备份',exact:true}).count(),0);
  assert.equal(await page.locator('[data-filter-system]').count(),3);
  await page.screenshot({path:path.join(output,'01-default-rows.png'),fullPage:true});
  checks.push('page identity, nonblank, no backup entry, default first three user-named systems');
  const grade=page.locator('[data-filter-row="grade"]');
  await grade.getByRole('button',{name:'高一',exact:true}).click();await total(8);
  await grade.getByRole('button',{name:'高二',exact:true}).click();await total(16);
  assert.equal(await grade.locator('[aria-pressed="true"]').count(),2);
  await grade.getByRole('button',{name:'高一',exact:true}).click();await total(8);
  await grade.getByRole('button',{name:'全部',exact:true}).click();await total(24);
  const resultSearch=page.getByRole('textbox',{name:'在结果中搜索',exact:true});
  const searchBox=await resultSearch.boundingBox(),resetBox=await page.getByRole('button',{name:'重置',exact:true}).boundingBox(),countBox=await page.locator('.qb-result-count').boundingBox();
  assert(searchBox.x>resetBox.x+resetBox.width && Math.abs(searchBox.y-resetBox.y)<6,'search follows reset on the same row');
  assert(countBox.x>searchBox.x+searchBox.width,'result count is to the right of search');
  for(const [term,count] of [['参考答案',0],['解析内容',0],['独特选项23',1],['实验小题23',1],['研究小球',24]]){
    await resultSearch.fill(term);await resultSearch.press('Enter');await total(count);
  }
  await page.screenshot({path:path.join(output,'07-result-stem-search.png'),fullPage:true});
  await page.getByRole('button',{name:'重置',exact:true}).click();await total(24);
  checks.push('search beside reset with far-right count; only stems, options and subquestions match');
  checks.push('inline multi-select changes real query results, deselection and all reset');
  async function add(label, search, option){
   await page.getByRole('button',{name:'添加'+label,exact:true}).click();
   const input=page.getByRole('combobox',{name:'搜索'+label,exact:true});
   await input.fill(search);
   await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({hasText:option}).click();
   await page.locator('.qb-tag-picker[aria-label="'+label+'"]').getByRole('button',{name:'确定',exact:true}).click();
  }
  await add('学年','2025','2025-2026学年');await total(11);
  await add('学年','2026-2027','2026-2027学年');await total(23);
  await page.locator('.qb-tag-picker[aria-label="学年"] .qb-filter-text-tag button').first().click();await total(12);
  await page.locator('.qb-tag-picker[aria-label="学年"] .qb-filter-text-tag button').first().click();await total(24);
  await add('学年','2034','2034-2035学年');await total(1);
  await page.getByRole('button',{name:'重置',exact:true}).click();await total(24);
  checks.push('searchable multi-year tags, removal, real-data future year');
  await add('课程知识包含','牛顿','力学主题 / 牛顿运动定律');await total(12);
  assert(await page.locator('[data-node-id="s1a"]').count()===0,'collapsed tree remains collapsed while selecting a tag');
  await page.getByLabel('搜索体系节点').fill('牛顿');
  const tree=page.locator('[data-node-id="s1a"]');
  assert((await tree.innerText()).includes('包含'));
  await tree.click({button:'right'});
  await page.getByRole('menuitem',{name:'选定为排除标签',exact:true}).click();await total(12);
  assert.equal(await page.locator('.qb-tag-picker[aria-label="课程知识包含"] .qb-filter-text-tag').count(),0);
  assert.equal(await page.locator('.qb-tag-picker[aria-label="课程知识排除"] .qb-filter-text-tag').count(),1);
  await tree.click({button:'right'});
  await page.getByRole('menuitem',{name:'取消标签筛选',exact:true}).click();await total(24);
  await tree.click({button:'right'});
  await page.getByRole('menuitem',{name:'选定为包含标签',exact:true}).click();await total(12);
  await page.screenshot({path:path.join(output,'02-search-and-tree-filter.png'),fullPage:true});
  await page.getByRole('button',{name:'重置',exact:true}).click();await total(24);
  await page.getByLabel('搜索体系节点').fill('');
  checks.push('fuzzy node search, full path candidates, include/exclude mutual exclusion, tree right-click selection/cancellation');
  await page.getByRole('button',{name:'添加新标签筛选',exact:true}).click();
  assert.equal(await page.locator('[data-filter-system]').count(),4);
  await page.getByLabel('搜索体系节点').fill('主题标签4');
  await page.locator('[data-node-id="s5a"]').click({button:'right'});
  await page.getByRole('menuitem',{name:'选定为包含标签',exact:true}).click();
  await page.locator('[data-filter-system="s5"]').waitFor();
  assert.equal(await page.locator('[data-filter-system]').count(),5);
  await page.screenshot({path:path.join(output,'03-extra-system.png'),fullPage:true});
  await page.getByRole('button',{name:'重置',exact:true}).click();
  await page.getByLabel('搜索体系节点').fill('');
  checks.push('fourth system appended in order; right-click fifth system reveals its filter row');
  await page.getByRole('button',{name:'调整筛选栏',exact:true}).click();
  await page.getByRole('checkbox',{name:'合并固定选项到同一行',exact:true}).uncheck();
  assert.equal(await page.locator('.qb-choice-group').count(),0,'manual setting can split each fixed filter into a separate row');
  await page.getByRole('checkbox',{name:'合并固定选项到同一行',exact:true}).check();
  await page.getByRole('button',{name:'上移题型',exact:true}).click();
  await page.getByRole('spinbutton',{name:'筛选行间距',exact:true}).fill('20');
  await page.getByRole('spinbutton',{name:'筛选行间距',exact:true}).press('Tab');
  await page.getByRole('spinbutton',{name:'筛选标签栏宽度',exact:true}).fill('110');
  await page.getByRole('spinbutton',{name:'筛选标签栏宽度',exact:true}).press('Tab');
  await page.getByRole('checkbox',{name:'发布状态',exact:true}).uncheck();
  await page.screenshot({path:path.join(output,'04-manual-layout.png'),fullPage:true});
  await page.locator('.ant-drawer-close').click();
  await page.reload();await total(24);
  assert.equal(await page.locator('[data-filter-row]').first().getAttribute('data-filter-row'),'type');
  assert.equal(await page.locator('[data-filter-row="status"]').count(),0);
  assert.equal(await page.locator('.qb-row-filters').evaluate(el=>el.style.getPropertyValue('--qb-filter-gap')),'20px');
  assert.equal(await page.locator('.qb-row-filters').evaluate(el=>el.style.getPropertyValue('--qb-filter-label-width')),'110px');
  checks.push('manual row ordering, visibility, spacing and width persisted across reload');
  const basket=page.getByRole('button',{name:'打开试题篮',exact:true});
  const original=await basket.boundingBox();
  await page.mouse.move(original.x+35,original.y+35);await page.mouse.down();await page.mouse.move(original.x-230,original.y-125,{steps:10});await page.mouse.up();
  const moved=await basket.boundingBox();
  assert(moved.x<original.x-200&&moved.y<original.y-100);
  assert.equal(await page.locator('.question-basket-drawer').count(),0,'drag must not open basket');
  assert.equal(await page.locator('.app-shell__content').evaluate(el=>getComputedStyle(el).paddingRight),'18px');
  await page.reload();await total(24);
  const saved=await basket.boundingBox();assert(Math.abs(saved.x-moved.x)<2&&Math.abs(saved.y-moved.y)<2);
  await basket.click();await page.locator('.question-basket-drawer').waitFor();await page.locator('.question-basket-drawer .ant-drawer-close').click();
  await page.setViewportSize({width:1024,height:850});
  const narrow=await basket.boundingBox();assert(narrow.x>=8&&narrow.x+narrow.width<=1016.5&&narrow.y+narrow.height<=842.5);
  await page.screenshot({path:path.join(output,'05-narrow-floating-basket.png'),fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no horizontal page overflow');
  checks.push('two-axis floating drag, no reserved column, persistence, click drawer, resize clamp, 1024px overflow check');
  assert.equal(await page.locator('h1').innerText(),'物理题库');
  assert.equal(await page.locator('.qb-subject-select').count(),0);
  assert.equal(await page.getByRole('button',{name:'选择科目体系',exact:true}).count(),0);
  await page.getByRole('button',{name:'选择科目题库',exact:true}).click();
  await page.getByRole('menuitem',{name:'化学题库',exact:true}).click();
  await page.getByText('化学体系',{exact:true}).waitFor();
  assert.equal(await page.locator('h1').innerText(),'化学题库');
  await total(0);
  await page.getByRole('button',{name:'添加新标签筛选',exact:true}).click();
  await page.getByText('目前尚未设置体系并打标，请先在左侧新建体系，为试题关联标签后再筛选',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-filter-system]').count(),0);
  await page.screenshot({path:path.join(output,'06-no-systems.png'),fullPage:true});
  checks.push('empty subject has no invented knowledge/type systems and shows setup/tagging guidance');
  assert.deepEqual(errors,[]);
  assert.deepEqual(consoleErrors,[]);
  fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({browserPlugin:'absent; repository Playwright workflow used',checks,measurements,errors,consoleErrors,consoleWarnings,runtime:useElectron?'Electron':'Chrome',viewports:[1200,1366,1440,1024]},null,2),'utf8');
  console.log('Question filter browser checks passed: '+checks.length+' groups. Evidence: '+output);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
