'use strict';
// Exercise the real React/Ant tree and media renderer with an isolated database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const webpack = require('webpack');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/playwright/desktop-question-workflow-20261005');
fs.mkdirSync(output, { recursive: true });
const entry = path.join(output, 'fixture.tsx');
fs.writeFileSync(entry, `
import React from 'react';
import {createRoot} from 'react-dom/client';
import TaxonomyManager from '${path.join(root,'src/components/TaxonomyManager').replace(/\\/g,'/')}';
import QuestionPreviewCard from '${path.join(root,'src/components/QuestionPreviewCard').replace(/\\/g,'/')}';
import {ResolvedRichHtml} from '${path.join(root,'src/components/RichAssetImage').replace(/\\/g,'/')}';
import '${path.join(root,'node_modules/katex/dist/katex.min.css').replace(/\\/g,'/')}';
let nodes=[{id:'a',name:'力学',order:0},{id:'b',name:'电磁学',order:1},{id:'c',name:'运动的描述',parent_id:'a',order:0},{id:'d',name:'匀变速直线运动',parent_id:'a',order:1},{id:'e',name:'牛顿运动定律',parent_id:'a',order:2},{id:'f',name:'机械运动',parent_id:'c',order:0},{id:'g',name:'质点',parent_id:'c',order:1},{id:'h',name:'参考系',parent_id:'c',order:2},{id:'i',name:'速度',parent_id:'h',order:0}];
let calls=[];
window.fixture={getNodes:()=>nodes,getCalls:()=>calls};
const db={getTaxonomySystems:()=>[{id:'knowledge',subject:'物理',name:'知识点'}],getTaxonomyNodes:()=>nodes,
 updateTaxonomyNode:(sys,id,patch)=>{calls.push({id,...patch});nodes=nodes.map(n=>n.id===id?{...n,...patch}:n);return true;},
 createTaxonomyNode:(sys,n)=>{const created={...n,id:'new-'+nodes.length};nodes=[...nodes,created];return created;},listTaxonomyDeletionBackups:()=>[]};
let completeSlow;
const slow=new Promise(resolve=>completeSlow=resolve);
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6srUAAAAASUVORK5CYII=';
window.desktopIdentitySessionProvider={readCloudQuestionAsset:async key=>{if(key==='slow')await slow;return image;}};
window.fixture.completeSlow=()=>completeSlow();
const paragraph=text=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
const question={id:'fixture-question',subject:'物理',content:'质量 m，初速度 v₀，求加速度。',answer:'a = 2',analysis:'应用牛顿第二定律。',rich_content:{type:'question-document',sections:{stem:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'质量 m，速度 v，电荷 '},{type:'formula',attrs:{canonicalLatex:'q = -2.00\\\\text{~}\\\\text{μC}'}},{type:'text',text:'。由力求加速度：'},{type:'formula',attrs:{canonicalLatex:'a=\\\\frac{F}{m}'}}]}]},answer:paragraph('a = 2'),analysis:paragraph('应用牛顿第二定律。'),options:[],subQuestions:[]}}};
function Fixture(){const [inBasket,setInBasket]=React.useState(false);return <main className="fixture-layout"><aside><h2>物理 · 体系</h2><TaxonomyManager subject="物理" database={db}/></aside><section><h2>试题预览</h2><QuestionPreviewCard question={question} index={0} inBasket={inBasket} onToggleBasket={()=>setInBasket(value=>!value)} onEdit={()=>window.fixture.edited=true}/><div id="progressive"><ResolvedRichHtml html='<p>图片加载期间仍然能阅读题干和公式。</p><img src="question-asset://fast" alt="已加载图片" /><img src="question-asset://slow" alt="待加载图片" />'/></div></section></main>};
createRoot(document.getElementById('root')).render(<Fixture/>);
`);
async function compile() {
  await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry,output:{path:output,filename:'bundle.js'},
    resolve:{extensions:['.tsx','.ts','.js','.mjs'],modules:[path.join(root,'node_modules'),'node_modules']},
    module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:{loader:require.resolve('babel-loader'),options:{presets:[require.resolve('@babel/preset-typescript'),require.resolve('@babel/preset-react')]}}},{test:/\.css$/,use:[require.resolve('style-loader'),require.resolve('css-loader')]},{test:/\.(woff2?|ttf)$/,type:'asset/inline'}]},
    optimization:{minimize:false}},(error,stats)=>error||stats.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve()));
}
(async()=>{
  await compile();
  const html='<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>桌面题库交互验证</title><style>body{font-family:Segoe UI,Microsoft YaHei,sans-serif;background:#f6f8fc;margin:0;padding:20px;color:#344054}h2{font-size:18px}.fixture-layout{display:grid;grid-template-columns:320px minmax(0,1fr);gap:20px}aside,section{background:white;border:1px solid #e6eaf1;border-radius:8px;padding:16px;min-width:0}#progressive{margin-top:24px}@media(max-width:700px){body{padding:12px}.fixture-layout{grid-template-columns:minmax(0,1fr)}}</style><div id="root"></div><script src="/bundle.js"></script></html>';
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?fs.readFileSync(path.join(output,'bundle.js')):html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const metrics={browserPlugin:'absent',viewports:[],checks:[]};
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByLabel('重命名节点 力学',{exact:true}).waitFor();
    assert.equal(await page.title(),'桌面题库交互验证');
    assert(await page.locator('#progressive').innerText().then(text=>text.includes('仍然能阅读')),'text renders before the slow image resolves');
    await page.locator('#progressive img').first().waitFor();
    assert.equal(await page.locator('#progressive img').count(),1,'fast asset is shown independently');
    assert(await page.locator('#progressive').innerText().then(text=>text.includes('图片加载中')));
    await page.evaluate(()=>window.fixture.completeSlow());
    await page.waitForFunction(()=>document.querySelectorAll('#progressive img').length===2);
    await page.locator('.ant-tree-treenode').filter({has:page.locator('[data-node-id="a"]')}).locator('.ant-tree-switcher').click();
    const toggle=await page.locator('.ant-tree-switcher_open .taxonomy-toggle').first().evaluate(el=>({radius:getComputedStyle(el).borderRadius,background:getComputedStyle(el).backgroundColor}));
    assert.equal(toggle.radius,'50%');assert.equal(toggle.background,'rgb(75, 119, 255)');
    await page.waitForTimeout(350); // Wait for Ant Tree's expand animation before expanding its child.
    await page.locator('.ant-tree-treenode').filter({has:page.locator('[data-node-id="c"]')}).locator('.ant-tree-switcher').click();
    const leaf=page.locator('.ant-tree-treenode').filter({has:page.locator('[data-node-id="f"]')});
    await leaf.waitFor();
    await page.screenshot({path:path.join(output,'tree-lines-debug.png'),fullPage:true});
    fs.writeFileSync(path.join(output,'tree-lines-debug.html'),await page.locator('.taxonomy-tree').innerHTML());
    assert.equal(await leaf.locator('.taxonomy-toggle').count(),0,'leaf nodes have no circles');
    const connector=await leaf.locator('.ant-tree-switcher').evaluate(el=>({vertical:getComputedStyle(el,'::before').borderLeftStyle,horizontal:getComputedStyle(el,'::after').borderTopStyle}));
    assert.equal(connector.vertical,'dashed');assert.equal(connector.horizontal,'dashed');
    const closed=await page.locator('.ant-tree-switcher_close .taxonomy-toggle').first().evaluate(el=>getComputedStyle(el).backgroundColor);
    assert.equal(closed,'rgb(230, 233, 238)');
    const alignment=await page.locator('.ant-tree-treenode').evaluateAll(rows=>rows.flatMap(row=>{const circle=row.querySelector('.taxonomy-toggle'),label=row.querySelector('.taxonomy-node-title > span');if(!circle||!label)return [];const a=circle.getBoundingClientRect(),b=label.getBoundingClientRect();return [Math.abs(a.y+a.height/2-b.y-b.height/2)];}));
    assert(alignment.length>0&&alignment.every(delta=>delta<1),'circles and node text must share a vertical centre');
    const rootAdd=page.getByLabel('添加根节点 知识点',{exact:true});
    assert.equal(await rootAdd.count(),1,'root plus button must have an accessible name');
    assert(await rootAdd.evaluate(el=>Boolean(el.closest('.taxonomy-system-title'))),'root plus belongs to the system title action group');
    assert.equal(await rootAdd.innerText(),'','root creation uses the same icon-only action');
    await rootAdd.click();
    await page.getByRole('textbox',{name:'节点名称',exact:true}).fill('测试根节点');
    await page.screenshot({path:path.join(output,'02-inline-root-add.png'),fullPage:true});
    await page.getByRole('textbox',{name:'节点名称',exact:true}).press('Enter');
    assert(await page.evaluate(()=>window.fixture.getNodes().some(n=>n.name==='测试根节点'&&!n.parent_id)),'root plus creates a root inline');
    assert.equal(await page.locator('.qb-answer-button').count(),0);
    await page.locator('.qb-basket-button').click();assert(await page.locator('.qb-basket-button').innerText().then(text=>text.includes('移出')));
    assert.equal(await page.locator('.qb-question-card').getAttribute('aria-expanded'),'false','basket must not reveal answers');
    await page.locator('.qb-basket-button').click();assert(await page.locator('.qb-basket-button').innerText().then(text=>text.includes('加入试题篮')));
    await page.screenshot({path:path.join(output,'01-tree-and-formulas.png'),fullPage:true});
    const row=await page.locator('[data-node-id="c"]').boundingBox();
    await page.getByLabel('重命名节点 运动的描述',{exact:true}).click();
    const input=page.getByRole('textbox',{name:'节点名称',exact:true});
    await input.waitFor();assert.equal(await page.locator('.ant-modal-content').count(),0);
    const box=await input.boundingBox();assert(Math.abs(box.x-row.x)<10 && Math.abs(box.y-row.y)<10,'edit remains at the original row');
    await page.screenshot({path:path.join(output,'02-inline-rename.png'),fullPage:true});
    await input.fill('运动描述与测量');await input.press('Enter');
    await page.getByLabel('添加子节点 力学',{exact:true}).click();
    await page.getByRole('textbox',{name:'节点名称',exact:true}).fill('参考系');
    await page.screenshot({path:path.join(output,'03-inline-add.png'),fullPage:true});
    await page.locator('.taxonomy-inline-editor__actions button').first().click();
    assert(await page.evaluate(()=>window.fixture.getNodes().some(n=>n.name==='参考系'&&n.parent_id==='a')));
    await page.getByLabel('重命名节点 牛顿运动定律',{exact:true}).click();
    await page.getByRole('textbox',{name:'节点名称',exact:true}).fill('不应保存');await page.getByRole('textbox',{name:'节点名称',exact:true}).press('Escape');
    assert(await page.evaluate(()=>!window.fixture.getNodes().some(n=>n.name==='不应保存')));
    await page.getByLabel('搜索体系节点').fill('匀变速');
    await page.getByLabel('重命名节点 匀变速直线运动',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-node-id="b"]').count(),0,'search keeps the matching branch');
    await page.getByLabel('搜索体系节点').fill('');
    const drag=page.locator('.ant-tree-treenode').filter({has:page.locator('[data-node-id="d"]')}).locator('.ant-tree-node-content-wrapper');
    const sibling=page.locator('.ant-tree-treenode').filter({has:page.locator('[data-node-id="e"]')}).locator('.ant-tree-node-content-wrapper');
    const siblingBox=await sibling.boundingBox();
    await drag.dragTo(sibling,{sourcePosition:{x:30,y:15},targetPosition:{x:30,y:siblingBox.height-2}});
    await page.waitForFunction(()=>{const nodes=window.fixture.getNodes();return nodes.find(n=>n.id==='d').order>nodes.find(n=>n.id==='e').order;});
    const target=page.locator('.ant-tree-treenode').filter({has:page.locator('[data-node-id="b"]')}).locator('.ant-tree-node-content-wrapper');
    const dragBox=await drag.boundingBox();
    const targetBox=await target.boundingBox();
    // rc-tree uses the bottom half plus a rightward movement for drop-inside.
    await drag.dragTo(target,{sourcePosition:{x:30,y:15},targetPosition:{x:dragBox.x-targetBox.x+80,y:targetBox.height-2}});
    await page.waitForFunction(()=>window.fixture.getCalls().some(call=>call.id==='d'&&call.parent_id==='b')).catch(async error=>{
      await page.screenshot({path:path.join(output,'drag-failure.png'),fullPage:true});
      fs.writeFileSync(path.join(output,'drag-failure.json'),JSON.stringify(await page.evaluate(()=>({calls:window.fixture.getCalls(),nodes:window.fixture.getNodes(),tree:document.querySelector('.taxonomy-tree').innerHTML})),null,2));throw error;
    });
    await page.locator('.qb-card-body').click();
    await page.locator('.qb-answer-drawer.is-open .structured-question-viewer__analysis').waitFor({state:'visible'});
    assert(await page.locator('.qb-question-card').innerText().then(text=>text.includes('应用牛顿第二定律')));
    await page.locator('.qb-edit-button').click();assert(await page.evaluate(()=>window.fixture.edited));assert.equal(await page.locator('.qb-question-card').getAttribute('aria-expanded'),'true');
    await page.locator('.qb-card-body').click();assert.equal(await page.locator('.qb-question-card').getAttribute('aria-expanded'),'false');
    await page.locator('.qb-card-body').click();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.qb-answer-drawer')).opacity==='1');
    await page.screenshot({path:path.join(output,'04-drag-and-answer.png'),fullPage:true});
    for(const width of [1280,390]) {
      await page.setViewportSize({width,height:900});
      const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,formulas:document.querySelectorAll('.katex').length,errors:document.querySelectorAll('.katex-error').length}));
      assert(dimensions.scroll<=dimensions.width+1,'tree and formulas fit the viewport');assert.equal(dimensions.errors,0);assert(dimensions.formulas>=2);
      metrics.viewports.push(dimensions);await page.screenshot({path:path.join(output,'05-viewport-'+width+'.png'),fullPage:true});
    }
    assert.deepEqual(errors,[]);metrics.checks=['identity','nonblank','no runtime errors','blue minus / grey plus','vertical circle/text alignment','system-title root plus and inline creation','leaf without circle','dashed sibling connectors','inline rename','inline child creation','Escape cancel','search ancestors','same-level reorder and cross-level drag','whole-card animated answer drawer','no answer button','basket add/remove without answer toggle','edit button independence','progressive images','formula render','narrow sidebar'];
    fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify(metrics,null,2));
    console.log('Desktop question browser checks passed; evidence: '+output);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
