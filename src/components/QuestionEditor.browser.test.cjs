'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const webpack = require('webpack');
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const output = process.env.QUESTION_EDITOR_EVIDENCE_DIR || path.join(root, 'output/playwright/question-editor-20261006');
fs.mkdirSync(output, { recursive: true });
const entry = path.join(output, 'fixture.tsx');
let fixturePng;
const absolute = file => path.join(root, file).replace(/\\/g, '/');
fs.writeFileSync(entry, `
import React from 'react';
import {createRoot} from 'react-dom/client';
import QuestionStructureEditor from '${absolute('src/components/question-editor/QuestionStructureEditor')}';
import StructuredQuestionViewer from '${absolute('src/components/StructuredQuestionViewer')}';
import {normalizeQuestionRichContent} from '${absolute('src/services/questionRichContent')}';
import {storeQuestionAsset} from '${absolute('src/services/questionAssetStore')}';
import '${absolute('src/index.css')}';
import '${absolute('node_modules/katex/dist/katex.min.css')}';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6srUAAAAASUVORK5CYII=';
const doc=(label,id)=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:label+' '},{type:'formula',attrs:{id:'formula-'+id,canonicalLatex:'x^2',displayMode:'inline'}}]},{type:'image',attrs:{src:'question-asset://diagram',assetKey:'diagram',alt:'题图 '+label,width:107.5,height:49,align:'center'}},{type:'paragraph',content:[{type:'text',text:'图片之后 '+label}]}]});
const seed={version:1,type:'question-document',sections:{stem:doc('题干','stem'),options:[{id:'option-a',label:'A',isCorrect:true,content:doc('选项','option')},{id:'option-b',label:'B',isCorrect:false,content:doc('选项B','option-b')}],subQuestions:[{id:'sub-1',label:'(1)',content:doc('小题题干','sub'),answer:doc('小题答案','sub-answer')}],answer:doc('主答案','answer'),analysis:doc('解析','analysis')}};
window.fixture={normalize:normalizeQuestionRichContent};
function Fixture(){const [value,setValue]=React.useState(seed),[epoch,setEpoch]=React.useState(0);window.fixture.value=value;window.fixture.setValue=setValue;window.fixture.seed=seed;return <main style={{maxWidth:960,margin:'20px auto',padding:16,background:'white'}}><h2>编辑试题 · 实际组件验证</h2><button id="save" onClick={()=>{const saved=normalizeQuestionRichContent(value);localStorage.setItem('question-editor-verification',JSON.stringify(saved));window.fixture.saved=saved}}>保存验证草稿</button><button id="reload" onClick={()=>{setValue(JSON.parse(localStorage.getItem('question-editor-verification')));setEpoch(v=>v+1)}}>重新打开验证草稿</button><QuestionStructureEditor key={epoch} questionType="单选题" value={value} onChange={setValue}/><h3>保存内容预览</h3><StructuredQuestionViewer value={value} showAnswer/></main>}
storeQuestionAsset('diagram',image).then(()=>createRoot(document.getElementById('root')).render(<Fixture/>));
`);

async function compile() {
  fixturePng = await require('sharp')(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#f4f8ff"/><path d="M20 130H140M30 140V20M30 130L125 45" stroke="#31598f" stroke-width="4" fill="none"/><circle cx="125" cy="45" r="7" fill="#d59a36"/></svg>')).png().toBuffer();
  const fixtureSource = fs.readFileSync(entry, 'utf8').replace(/const image='[^']+';/, `const image='data:image/png;base64,${fixturePng.toString('base64')}';`);
  fs.writeFileSync(entry, fixtureSource);
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, entry,
    output: { path: output, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js', '.mjs'], modules: [path.join(root, 'node_modules'), 'node_modules'] },
    module: { rules: [
      { test: /\.tsx?$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'), options: { presets: [require.resolve('@babel/preset-typescript'), require.resolve('@babel/preset-react')] } } },
      { test: /\.css$/, use: [require.resolve('style-loader'), require.resolve('css-loader')] },
      { test: /\.(woff2?|ttf)$/, type: 'asset/inline' },
    ] }, optimization: { minimize: false },
  }, (error, stats) => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
}

async function verify(page, carrier) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.rich-question-editor__surface').first().waitFor();
  await page.locator('.rich-image-node img').first().waitFor();
  const stem = page.locator('.question-structure-editor .ant-card').first().locator('.rich-question-editor');
  const tab = name => page.getByRole('tab', { name, exact: true });
  const activeEditors = () => page.locator('.ant-tabs-tabpane-active .rich-question-editor');
  const stemImage = stem.locator('.rich-image-node img').first();
  const geometry = await stemImage.evaluate(img => ({ width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height }));
  assert(Math.abs(geometry.width - 107.5) < 0.1 && Math.abs(geometry.height - 49) < 0.1, 'editor retains document display size even when intrinsic image ratio differs');
  const previewGeometry = await page.locator('.structured-question-viewer > img').first().evaluate(img => ({ width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height }));
  assert.deepEqual(previewGeometry, geometry, 'viewer and editor use identical image dimensions');
  const fonts = await page.evaluate(() => ({ editor: getComputedStyle(document.querySelector('.rich-question-editor__surface')).fontFamily, viewer: getComputedStyle(document.querySelector('.structured-question-viewer')).fontFamily }));
  assert.equal(fonts.editor, fonts.viewer, 'editor defaults to displayed question font');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root: domRoot } = await cdp.send('DOM.getDocument');
  const actualFonts = {};
  for (const [name, selector] of [['editor', '.rich-question-editor__surface p'], ['viewer', '.structured-question-viewer > p']]) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: domRoot.nodeId, selector });
    actualFonts[name] = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
  }
  assert(actualFonts.editor.length && actualFonts.viewer.length, 'font evidence includes actual rendered platform faces');
  await stemImage.click();
  await stem.getByLabel('图片宽度', { exact: true }).fill('215');
  await stem.getByLabel('图片宽度', { exact: true }).press('Enter');
  await page.waitForFunction(() => window.fixture.value.sections.stem.content.some(n => n.type === 'image' && n.attrs.width === 215 && n.attrs.height === 98));
  await stem.getByLabel('图片右对齐', { exact: true }).click();
  assert.equal(await stem.locator('.rich-image-node').first().getAttribute('data-align'), 'right');

  assert.equal(await page.getByRole('button',{name:/^H[123]$/}).count(),0);
  await stem.getByRole('button',{name:'上标',exact:true}).waitFor({state:'visible'});
  await stem.getByRole('button',{name:'下标',exact:true}).waitFor({state:'visible'});
  assert.equal(await page.getByRole('button',{name:'剪切图片',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'粘贴图片到光标',exact:true}).count(),0);
  assert.equal(await page.getByLabel('图片替代文本',{exact:true}).count(),0);
  assert.equal(await stem.locator('.rich-image-node').first().evaluate(el=>getComputedStyle(el).display),'block');
  await page.setViewportSize({width:1280,height:1800});
  const stemSurface=stem.locator('.rich-question-editor__surface');const stemBox=await stemSurface.boundingBox();
  await stem.locator('.rich-image-node').first().dragTo(stemSurface,{targetPosition:{x:20,y:stemBox.height-8}});
  await page.waitForFunction(()=>{const c=window.fixture.value.sections.stem.content;return c.findIndex(n=>n.type==='image')>c.findIndex(n=>JSON.stringify(n).includes('图片之后'));});
  await tab('解析').click();
  const analysis=activeEditors().first();const surface=analysis.locator('.rich-question-editor__surface');const targetBox=await surface.boundingBox();
  await stem.locator('.rich-image-node').first().dragTo(surface,{targetPosition:{x:20,y:targetBox.height-8}});
  await page.waitForFunction(()=>window.fixture.value.sections.stem.content.every(n=>n.type!=='image')&&window.fixture.value.sections.analysis.content.filter(n=>n.type==='image').length===2);
  const moved=analysis.locator('.rich-image-node').filter({has:page.locator('img[alt="题图 题干"]')});
  assert.equal(await moved.locator('img').getAttribute('width'),'215');assert.equal(await moved.locator('img').getAttribute('height'),'98');
  await moved.hover();const close=moved.getByRole('button',{name:'删除图片',exact:true});
  const corner=await close.boundingBox(),picture=await moved.locator('img').boundingBox();
  assert(Math.abs(corner.x+corner.width-(picture.x+picture.width))<1&&Math.abs(corner.y-picture.y)<1,'delete cross sits at the image top-right corner');
  await close.click();assert.equal(await analysis.locator('.rich-image-node img').count(),1);
  await analysis.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await analysis.locator('.rich-image-node img').count(),2);
  await moved.hover();await moved.getByRole('button',{name:'删除图片',exact:true}).click();
  await page.screenshot({path:path.join(output,carrier+'-image-move-delete.png'),fullPage:false});

  const editArea = async (editor, marker) => {
    const surface = editor.locator('.rich-question-editor__surface');
    await surface.click();
    await surface.press('Control+End');
    await surface.press('End');
    await surface.pressSequentially(marker);
    await editor.locator('.rich-formula-node').first().dblclick();
    const modal = page.locator('.ant-modal-content:visible');
    await modal.getByLabel('LaTeX 公式', { exact: true }).fill('\\frac{a}{b}');
    await modal.getByRole('button', { name: '更新公式', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    assert.equal(await editor.locator('.rich-formula-node').first().getAttribute('data-latex'), '\\frac{a}{b}');
    await surface.click(); await surface.press('Control+End');
    await editor.locator('input[type=file]').setInputFiles({ name: 'new-diagram.png', mimeType: 'image/png', buffer: fixturePng });
    await editor.locator('img[alt="new-diagram.png"]').waitFor();
  };
  await editArea(stem, '题干已编辑');
  await tab('选项 (2)').click(); await editArea(activeEditors().first(), '选项已编辑');
  await tab('小题 (1)').click(); await editArea(activeEditors().first(), '小题已编辑'); await editArea(activeEditors().nth(1), '小题答案已编辑');
  await tab('主答案').click(); await editArea(activeEditors().first(), '主答案已编辑');
  await tab('解析').click(); await editArea(activeEditors().first(), '解析已编辑');
  await page.locator('#save').click();
  const saved = await page.evaluate(() => window.fixture.saved);
  const docs = [saved.sections.stem, saved.sections.options[0].content, saved.sections.subQuestions[0].content, saved.sections.subQuestions[0].answer, saved.sections.answer, saved.sections.analysis];
  for (const doc of docs) {
    const json = JSON.stringify(doc);
    assert(json.includes('已编辑') && json.includes('\\\\frac{a}{b}') && json.includes('new-diagram.png'), 'all six areas save edited text, LaTeX and uploaded image');
    assert(!json.includes('data:image') && !json.includes('persistedSrc'), 'only persisted asset references may enter saved content');
  }
  await page.locator('#reload').click();
  await tab('主答案').click();
  assert((await activeEditors().first().innerText()).includes('主答案已编辑'));
  assert.equal(await activeEditors().first().locator('img[alt="new-diagram.png"]').count(), 1);
  await tab('选项 (2)').click();
  await activeEditors().nth(1).locator('.rich-question-editor__surface').click();
  await activeEditors().nth(1).locator('.rich-question-editor__surface').press('Control+End');
  await activeEditors().nth(1).locator('.rich-question-editor__surface').pressSequentially('不会覆盖答案');
  assert.deepEqual(await page.evaluate(() => window.fixture.normalize(window.fixture.value).sections.answer), saved.sections.answer);
  await page.screenshot({ path: path.join(output, `${carrier}-options.png`), fullPage: true });
  await tab('小题 (1)').click(); await page.screenshot({ path: path.join(output, `${carrier}-subquestions.png`), fullPage: true });
  await tab('主答案').click(); await page.screenshot({ path: path.join(output, `${carrier}-answer.png`), fullPage: true });
  await tab('解析').click(); await page.screenshot({ path: path.join(output, `${carrier}-analysis.png`), fullPage: true });
  await page.evaluate(() => {
    const value = structuredClone(window.fixture.value);
    const docs = [value.sections.stem, value.sections.options[0].content, value.sections.subQuestions[0].content, value.sections.subQuestions[0].answer, value.sections.answer, value.sections.analysis];
    docs.forEach(doc => doc.content.push({ type: 'image', attrs: { src: 'question-asset://diagram', assetKey: 'diagram', alt: 'website logo', width: 1, height: 1 } }));
    window.fixture.setValue(value);
  });
  await page.getByRole('button', { name: '清理微小标识图片（6）', exact: true }).click();
  await page.locator('.ant-modal-content:visible').getByRole('button', { name: /清\s*理/ }).click();
  await page.waitForFunction(() => !JSON.stringify(window.fixture.value).includes('website logo'));
  await page.locator('#save').click();
  assert((await page.evaluate(() => JSON.stringify(window.fixture.saved))).includes('new-diagram.png'), 'cleanup retains normal uploaded images');
  if (carrier === 'chrome') {
    await page.setViewportSize({ width: 420, height: 920 });
    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, body: document.documentElement.scrollWidth }));
    assert(width.body <= width.viewport + 1, 'editing toolbar and content remain reachable in a narrow window');
    await page.screenshot({ path: path.join(output, 'chrome-narrow.png'), fullPage: true });
  }
  const report = { carrier, userAgent: await page.evaluate(() => navigator.userAgent), geometry, previewGeometry, fonts, actualFonts, contentAreas: 6, textFormulaImageRoundtrip: true, imageMoveAcrossSections: true, imageResizeAlignDeleteUpload: true, authoredAnswerPreserved: true, cleanupAcrossSixAreas: true, errors, pass: errors.length === 0, verifiedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output, `${carrier}-report.json`), JSON.stringify(report, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report));
}

(async () => {
  await compile();
  const html = '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>试题编辑验证</title><body style="margin:0;background:#f6f8fc"><div id="root"></div><script src="/bundle.js"></script></body></html>';
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html; charset=utf-8'); res.end(req.url === '/bundle.js' ? fs.readFileSync(path.join(output, 'bundle.js')) : html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try { const page = await browser.newPage({ viewport: { width: 1280, height: 920 } }); await page.goto(url); try { await verify(page, 'chrome'); } catch(error) { await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}); console.error((await page.locator('.question-structure-editor').innerText()).slice(0,3000)); throw error; } }
    finally { await browser.close(); }
    const main = path.join(output, 'electron-main.cjs');
    fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron');let win;app.whenReady().then(()=>{win=new BrowserWindow({width:1280,height:920,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});win.loadURL(${JSON.stringify(url)});});app.on('window-all-closed',()=>app.quit());`);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), ['--remote-debugging-port=9351', main, '--user-data-dir=' + path.join(output, 'electron-profile')], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    let electron;
    try {
      for (let attempt = 0; attempt < 60; attempt++) {
        try { electron = await chromium.connectOverCDP('http://127.0.0.1:9351', { timeout: 3000, noDefaults: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
      }
      assert(electron, 'Electron CDP connection must become available: ' + stderr);
      const page = electron.contexts()[0].pages()[0];
      await page.waitForURL(url + '/');
      await verify(page, 'electron');
    } finally {
      if (electron) await electron.close();
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* Already exited. */ }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
