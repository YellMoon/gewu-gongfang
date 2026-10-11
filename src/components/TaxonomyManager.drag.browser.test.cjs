'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),http=require('http'),webpack=require('webpack');
const {chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'output/playwright/taxonomy-2026-10-11');fs.mkdirSync(out,{recursive:true});
const entry=path.join(out,'entry.tsx');
fs.writeFileSync(entry,`
import React from 'react';import {createRoot} from 'react-dom/client';
import Manager from ${JSON.stringify(path.join(root,'src/components/TaxonomyManager.tsx'))};
import AppShell from ${JSON.stringify(path.join(root,'src/layout/AppShell.tsx'))};
import ${JSON.stringify(path.join(root,'src/index.css'))};
const nodes=[{id:'p',name:'Parent',order:0},{id:'q',name:'Second root',order:1},{id:'a',name:'First child',parent_id:'p',order:0},{id:'b',name:'Second child',parent_id:'p',order:1},{id:'c',name:'Last child',parent_id:'p',order:2}];window.__nodes=nodes;window.__writes=[];
const database={getTaxonomySystems:subject=>[{id:'s',name:'Knowledge',subject,sort_no:0}],getTaxonomyNodes:()=>nodes.map(x=>({...x})),updateTaxonomyNode:(system,id,patch)=>{const n=nodes.find(x=>x.id===id);Object.assign(n,patch);window.__writes.push({id,...patch});return n;}};
function Fixture(){const [subject,setSubject]=React.useState('\\u7269\\u7406');return <AppShell currentPage="question-bank-preview" questionBankSubject={subject} onQuestionBankSubjectChange={setSubject} onNavigate={()=>{}} onRefresh={()=>{}}><div style={{width:360,padding:12}}><Manager subject={subject} database={database}/></div></AppShell>};createRoot(document.getElementById('root')).render(<Fixture/>);
`,'utf8');
(async()=>{
await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry,output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js','.mjs'],modules:[path.join(root,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:{loader:require.resolve('babel-loader'),options:{presets:[require.resolve('@babel/preset-typescript'),require.resolve('@babel/preset-react')]}}},{test:/\.css$/,use:[require.resolve('style-loader'),require.resolve('css-loader')]},{test:/\.(woff2?|ttf|png|svg)$/,type:'asset/inline'}]},optimization:{minimize:false}},(err,stats)=>err||stats.hasErrors()?reject(err||new Error(stats.toString({all:false,errors:true}))):resolve()));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?fs.readFileSync(path.join(out,'bundle.js')):'<!doctype html><meta charset="utf-8"><title>Taxonomy drag verification</title><div id="root"></div><script src="/bundle.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1200,height:850}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('[data-node-id="p"]').waitFor();
await page.locator('[data-node-id="p"]').locator('xpath=ancestor::div[contains(@class,"ant-tree-treenode")][1]').locator('.ant-tree-switcher').click();
await page.locator('[data-node-id="c"]').waitFor();await page.waitForFunction(()=>!document.querySelector('.ant-motion-collapse'));
const row=id=>page.locator('[data-node-id="'+id+'"]').locator('xpath=ancestor::span[contains(@class,"ant-tree-node-content-wrapper")][1]');
async function drag(from,to,edge){const a=await row(from).boundingBox(),b=await row(to).boundingBox();assert(a&&b);await page.mouse.move(a.x+25,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+28,a.y+a.height/2+8,{steps:5});await page.mouse.move(b.x+25,b.y+(edge==='top'?2:b.height-2),{steps:16});await page.mouse.up();}
await drag('c','a','top');await page.waitForFunction(()=>window.__nodes.find(x=>x.id==='c').order===0);assert.equal(await page.evaluate(()=>window.__nodes.find(x=>x.id==='c').parent_id),'p');
await page.screenshot({path:path.join(out,'child-to-top.png')});
await drag('c','b','bottom');await page.waitForFunction(()=>window.__nodes.find(x=>x.id==='c').order===2);
await drag('q','p','top');await page.waitForFunction(()=>window.__nodes.find(x=>x.id==='q').order===0);
await page.getByRole('button',{name:'\u9009\u62e9\u79d1\u76ee\u9898\u5e93'}).click();
for(const subject of ['\u4fe1\u606f\u6280\u672f','\u901a\u7528\u6280\u672f'])assert.equal(await page.getByRole('menuitem',{name:subject+'\u9898\u5e93',exact:true}).count(),1);
await page.screenshot({path:path.join(out,'subjects.png')});
await page.getByRole('menuitem',{name:'\u4fe1\u606f\u6280\u672f\u9898\u5e93',exact:true}).click();await page.waitForFunction(()=>document.querySelector('h1')?.textContent.includes('\u4fe1\u606f\u6280\u672f'));
assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({passed:true,viewport:{width:1200,height:850},checks:['child-to-top','first-child-down','root-to-top','extra-subject-menu','subject-switch'],errors},null,2),'utf8');console.log('Real browser taxonomy drag and subject checks passed: '+out);
}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
