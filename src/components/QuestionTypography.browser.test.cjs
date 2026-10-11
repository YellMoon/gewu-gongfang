'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const webpack = require('webpack');
const { chromium, _electron } = require('playwright');
const root = path.resolve(__dirname, '../..');
const output = process.env.QUESTION_TYPOGRAPHY_EVIDENCE_DIR || path.join(os.tmpdir(), 'gewu-question-typography-20261011');
fs.mkdirSync(output, { recursive: true });
const absolute = file => path.join(root, file).replace(/\\/g, '/');
const entry = path.join(output, 'fixture.tsx');
const picture = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="55"><path d="M5 30Q20 5 35 30T65 30T95 30" fill="none" stroke="black" stroke-width="2"/></svg>').toString('base64');
fs.writeFileSync(entry, `
import React from 'react';
import {createRoot} from 'react-dom/client';
import RichQuestionEditor from '${absolute('src/components/RichQuestionEditor')}';
import StructuredQuestionViewer from '${absolute('src/components/StructuredQuestionViewer')}';
import QuestionRenderer from '${absolute('src/components/QuestionRenderer')}';
import '${absolute('src/index.css')}';
const text=(text)=>({type:'text',text});
const formula=(canonicalLatex)=>({type:'formula',attrs:{canonicalLatex}});
const p=(...content)=>({type:'paragraph',content});
const doc=(...content)=>({type:'doc',content});
const stem=doc(p(text('字母符号：'),formula('E_1'),text('，粒子 '),formula('\\\\alpha'),text('，比值 '),formula('\\\\frac{2mdE}{q}'),text('，电荷 '),formula('q=-2.00\\\\text{~}\\\\textnormal{μC}'),text('。')));
const empty=doc(p());
const make=(options=[],subQuestions=[])=>({version:1,type:'question-document',sections:{stem,options,subQuestions,answer:empty,analysis:empty}});
const options=['A','B','C','D'].map((label,i)=>({id:label,label,content:doc(p(text('求粒子速度 '),formula(i===3?'\\\\frac{v^2}{2g}':'v_1'),text(' 的大小。')))}));
const images=['A','B','C','D'].map((label,i)=>({id:label,label,content:doc({type:'image',attrs:{src:${JSON.stringify(picture)},width:120,height:45+i*12,align:i%2?'right':'center'}})}));
const subs=[{id:'sub1',label:'(1)',content:doc(p(text('写出粒子的运动方程。')),p(text('第二段仍保留。'))),answer:empty},{id:'sub2',label:'(2)',content:doc(p(text('求速度 '),formula('v_1'),text('，并说明理由。'),{type:'hardBreak'},text('手动换行仍保留。'))),answer:empty}];
function Fixture(){const [value,setValue]=React.useState(stem);return <main style={{maxWidth:1000,margin:'20px auto',padding:16,background:'white'}}><h2>编辑器与题目排版验证</h2><div id="editor"><RichQuestionEditor value={value} output="json" onChange={setValue}/></div><button id="save" onClick={()=>window.saved=JSON.stringify(value)}>保存验证草稿</button><button id="reload" onClick={()=>setValue(JSON.parse(window.saved))}>重新打开</button><h3>文字选项（含高分式）</h3><div id="text"><StructuredQuestionViewer value={make(options)}/></div><h3>图片选项</h3><div id="images"><StructuredQuestionViewer value={make(images)}/></div><h3>解答题 / 实验题小题</h3><div id="subs"><StructuredQuestionViewer value={make([],subs)}/></div><h3>旧格式图片选项</h3><div id="legacy"><QuestionRenderer content="选择正确轨迹" questionType="单选题" options={images.map(o=>({label:o.label,content:'<img src="'+${JSON.stringify(picture)}+'" width="120" height="55" />'}))}/></div></main>}
createRoot(document.getElementById('root')).render(<Fixture/>);
`, 'utf8');

async function compile() {
  const png = 'data:image/png;base64,' + (await require('sharp')(Buffer.from(picture.split(',')[1], 'base64')).png().toBuffer()).toString('base64');
  fs.writeFileSync(entry, fs.readFileSync(entry, 'utf8').replaceAll(picture, png), 'utf8');
  await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry,output:{path:output,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js','.mjs'],modules:[path.join(root,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:{loader:require.resolve('babel-loader'),options:{presets:[require.resolve('@babel/preset-typescript'),require.resolve('@babel/preset-react')]}}},{test:/\.css$/,use:[require.resolve('style-loader'),require.resolve('css-loader')]},{test:/\.(woff2?|ttf)$/,type:'asset/inline'}]},optimization:{minimize:false}},(err,stats)=>err||stats.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));
}
async function verify(page,carrier,url) {
  const errors=[]; page.on('pageerror',err=>errors.push(err.message));
  await page.goto(url); await page.locator('.rich-formula-node .katex').first().waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('img')).every(img=>img.complete && img.naturalWidth>0));
  assert.equal(await page.title(),'题目排版验证');
  const metrics=await page.evaluate(()=>{
    const baseline=el=>{const probe=document.createElement('span');probe.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline';el.append(probe);const y=probe.getBoundingClientRect().bottom;probe.remove();return y;};
    const options=Array.from(document.querySelectorAll('#text .structured-question-viewer__option')).map(row=>({label:baseline(row.firstElementChild),content:baseline(row.lastElementChild.firstElementChild),weight:getComputedStyle(row.firstElementChild).fontWeight}));
    const images=Array.from(document.querySelectorAll('#images .structured-question-viewer__option, #legacy .question-option')).map(row=>{const label=row.firstElementChild;const img=row.querySelector('img');return {gap:img.getBoundingClientRect().left-label.getBoundingClientRect().right,labelBaseline:baseline(label),bottom:img.getBoundingClientRect().bottom,display:getComputedStyle(img).display};});
    const subs=Array.from(document.querySelectorAll('#subs .structured-question-viewer__sub')).map(row=>{const p=row.querySelector('p'),label=p.firstElementChild,range=document.createRange();range.selectNodeContents(p.childNodes[1]);return {labelY:label.getBoundingClientRect().top,textY:range.getBoundingClientRect().top,weight:getComputedStyle(label).fontWeight,paragraphs:row.querySelectorAll('p').length,breaks:row.querySelectorAll('br').length};});
    return {editorSize:getComputedStyle(document.querySelector('.rich-question-editor__surface')).fontSize,formulaSize:getComputedStyle(document.querySelector('.rich-formula-node .katex')).fontSize,subscriptSize:getComputedStyle(document.querySelector('.rich-formula-node .katex .sizing')).fontSize,options,images,subs};
  });
  assert.equal(metrics.formulaSize,metrics.editorSize,'editor math must use the surrounding body size');
  assert(parseFloat(metrics.subscriptSize)<parseFloat(metrics.formulaSize),'actual subscripts stay smaller');
  metrics.options.forEach(row=>{assert(Math.abs(row.label-row.content)<1,'text and fraction options share first-line baseline');assert.equal(row.weight,'400');});
  for(let i=0;i<metrics.options.length;i+=2)assert(Math.abs(metrics.options[i].label-metrics.options[i+1].label)<1,'options in a shared grid row use the same baseline even with tall fractions');
  metrics.images.forEach(row=>{assert(row.gap>=0&&row.gap<9,'image immediately follows option label');assert(Math.abs(row.labelBaseline-row.bottom)<1,'embedded image bottom follows label baseline');assert.equal(row.display,'inline-block');});
  metrics.images.slice(0,4).forEach(row=>assert(Math.abs(row.bottom-metrics.images[0].bottom)<1,'different-height images on one option row share their bottom baseline'));
  metrics.subs.forEach(row=>{assert(Math.abs(row.labelY-row.textY)<2,'subquestion label and first text share a line');assert.equal(row.weight,'400');});
  assert.equal(metrics.subs[0].paragraphs,2);assert.equal(metrics.subs[1].breaks,1);
  const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const {root:dom}=await cdp.send('DOM.getDocument');const actualFonts={};
  for(const [name,selector] of [['editor','.rich-formula-node .katex .mathnormal'],['viewer','#text .katex .mathnormal']]){const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:dom.nodeId,selector});actualFonts[name]=(await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts;assert(actualFonts[name].length,'actual rendered formula font faces are available');}
  const surface=page.locator('.rich-question-editor__surface');await surface.click();await surface.press('Control+End');await surface.pressSequentially('保存后排版一致');
  await page.locator('#save').click();await page.locator('#reload').click();assert((await surface.innerText()).includes('保存后排版一致'));
  await page.screenshot({path:path.join(output,carrier+'-desktop.png'),fullPage:true});
  await page.setViewportSize({width:540,height:920});await page.screenshot({path:path.join(output,carrier+'-narrow.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,carrier+'-report.json'),JSON.stringify({carrier,url,metrics,actualFonts,errors,saveReload:true,verifiedAt:new Date().toISOString()},null,2),'utf8');
  console.log(carrier+' typography geometry, font sizes, paragraphs and save/reload passed');
}
(async()=>{
  await compile();const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/bundle.js'?fs.readFileSync(path.join(output,'bundle.js')):'<!doctype html><meta charset="UTF-8"><title>题目排版验证</title><div id="root"></div><script src="/bundle.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
  try{const browser=await chromium.launch({channel:'chrome',headless:true});try{await verify(await browser.newPage({viewport:{width:1280,height:1000}}),'chrome',url);}finally{await browser.close();}
    const main=path.join(output,'electron-main.cjs');fs.writeFileSync(main,"const {app,BrowserWindow}=require('electron');let win;app.whenReady().then(()=>{win=new BrowserWindow({width:1280,height:1000,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});win.loadURL("+JSON.stringify(url)+");});app.on('window-all-closed',()=>app.quit());",'utf8');const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const electron=await _electron.launch({args:[main],env});try{await verify(await electron.firstWindow(),'electron',url);}finally{await electron.close();}
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(err=>{console.error(err);process.exitCode=1;});
