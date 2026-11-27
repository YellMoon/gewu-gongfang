'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const assert = require('node:assert/strict');
const webpack = require('webpack');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-bill-categories-'));
const today = require('dayjs')().format('YYYY-MM-DD');
const observations = Array.from({length:66}, (_,index) => ({
 id:'bill-'+index, financialAccountId:'A', provider:'synthetic', sourceTransactionId:'source-'+index,
 date:today, occurredAt:today+'T'+String(index % 24).padStart(2,'0')+':00:00+08:00',
 currency:'CNY', amountMinor:index===65?'100000':'1000', direction:'debit', kind:index===64?'unknown':'expense',
 status:'completed', description:index<2?'\u505c\u8f66\u8d39':'Shopping '+index,
 category:'', counterparty:'Fixture', paymentChannel:'', paymentAccountHint:'', relatedReference:'',
 principalMinor:null, interestMinor:null, feeMinor:null, balanceMinor:null, rawFields:{},
}));
const ledger = {revision:'0',accounts:[{id:'A',label:'Fixture account',type:'bank',provider:'synthetic',currency:'CNY',status:'active',openingBalanceMinor:null,openingDate:null}],observations,annotations:[],links:[],imports:[],balanceSnapshots:[],legacyRecords:[]};
fs.writeFileSync(path.join(output,'entry.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import Panel from ${JSON.stringify(path.join(root,'src/components/PersonalFinancePanel.tsx'))};createRoot(document.getElementById('root')).render(<main style={{padding:24}}><Panel/></main>);`, 'utf8');
fs.writeFileSync(path.join(output,'client.mjs'), `import {buildFinanceView} from ${JSON.stringify(path.join(root,'shared/personal-finance/ledger.js'))};import {buildAssetRegister} from ${JSON.stringify(path.join(root,'shared/personal-finance/assetRegister.js'))};import {balanceGroups} from ${JSON.stringify(path.join(root,'shared/personal-finance/balanceGroups.js'))};import {billCategory,compareBillAmount,compareBillTime,largeBillThresholds,isLargeBill} from ${JSON.stringify(path.join(root,'shared/personal-finance/billPresentation.js'))};export const formatMinor=v=>v==null?'Unknown':(Number(v)/100).toFixed(2);export const parseMoney=v=>String(Math.round(Number(v)*100));const ledger=${JSON.stringify(ledger)};
if(new URLSearchParams(location.search).has('account-discovery')){
 ledger.accounts[0].provider='Test bank';
 ledger.observations.push({...ledger.observations[0],id:'mortgage-payment',sourceTransactionId:'mortgage-payment',kind:'debt_payment',description:'贷款还款',counterparty:'个人贷款户',rawFields:{'对方卡/账号':'1234'}});
 ledger.observations.push({...ledger.observations[0],id:'card-payment',sourceTransactionId:'card-payment',paymentChannel:'测试银行储蓄卡(4321)'});
}
const discoverAccounts=async ({expectedRevision})=>{
 (window.discoveryRevisions??=[]).push(expectedRevision);
 if(expectedRevision!==ledger.revision)throw Object.assign(Error('REVISION_CONFLICT'),{code:'CLOUD_PERSONAL_FINANCE_REVISION_CONFLICT'});
 const proposals=buildAssetRegister(ledger).proposals.accounts;
 const accounts=proposals.map(({key,...fields},i)=>({id:'discovered-'+i,status:'active',...fields}));
 ledger.accounts.push(...accounts);
 ledger.revision=String(Number(ledger.revision)+accounts.length);
 return {accounts,revision:ledger.revision};
};export const createPersonalFinanceClient=()=>({discoverAccounts,updateAccount:async(id,{patch,expectedRevision})=>{if(expectedRevision!==ledger.revision)throw Error('REVISION_CONFLICT');Object.assign(ledger.accounts.find(a=>a.id===id),patch);ledger.revision=String(Number(ledger.revision)+1);return {revision:ledger.revision};},mailboxStatus:async()=>({}),searchObservations:async input=>{window.searchBatchSizes=(window.searchBatchSizes||[]).concat(input.ids?.length||0);if(input.ids?.length>40)throw Error('ID_LIMIT');return {observations:ledger.observations.filter(o=>input.ids?.includes(o.id)||input.search&&o.description.includes(input.search))};},transactionDetails:async id=>({projection:{revision:ledger.revision,transaction:buildFinanceView(ledger).transactions.find(t=>t.id===id)}}),annotateObservation:async(id,input)=>{if(input.expectedRevision!==ledger.revision)throw Error('REVISION_CONFLICT');window.savedAnnotation={id,...input};ledger.annotations.push({id:'annotation',observationId:id,patch:input.patch,revision:'1'});ledger.revision='1';return {revision:'1'};},queryProjection:async input=>{window.lastInput=input;const view=buildFinanceView(ledger,input);const register=buildAssetRegister(ledger);view.balanceGroups=balanceGroups(register.accounts,view,input);for(const g of view.review.groups)if(g.reason==='unknown_kind')for(const issue of g.issues)issue.candidateObservationIds=localStorage.wideCandidates?Array.from({length:41},(_,i)=>'bill-'+i).concat('bill-63'):['bill-63'];let rows=view.transactions;if(input.reviewGroupId){const ids=new Set(view.review.groups.find(g=>g.id===input.reviewGroupId)?.transactionIds||[]);rows=rows.filter(t=>ids.has(t.id));}const thresholds=largeBillThresholds(rows);if(input.billCategories?.length)rows=rows.filter(t=>input.billCategories.includes(billCategory(t)));const compare=input.sortField==='amount'?compareBillAmount:compareBillTime;rows=[...rows].sort((a,b)=>(input.sortOrder==='ascend'?1:-1)*(compare(a,b)||compareBillTime(a,b)));return {projection:{status:'ready',ledger:{...ledger,observations:[]},view:{...view,transactions:[]},globalReview:view.review,assetRegister:register,trend:[],transactions:{total:rows.length,page:input.page,pageSize:50,items:rows.slice((input.page-1)*50,input.page*50).map(t=>({...t,billCategory:billCategory(t),isLargeBill:isLargeBill(t,thresholds)}))}}};}});`, 'utf8');
fs.writeFileSync(path.join(output,'auth.mjs'), `export const readDesktopAuthorizationSession=()=>({authorization:'fixture',authContext:{activeRole:'teacher'}});`, 'utf8');
async function main() {
 await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry:path.join(output,'entry.tsx'),output:{path:output,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js','.mjs'],modules:[path.join(root,'node_modules')],alias:{[path.join(root,'src/services/personalFinanceClient.mjs')]:path.join(output,'client.mjs'),[path.join(root,'src/services/desktopAuthorizationSession.mjs')]:path.join(output,'auth.mjs')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:{loader:require.resolve('babel-loader'),options:{presets:[require.resolve('@babel/preset-typescript'),require.resolve('@babel/preset-react')]}}},{test:/\.css$/,use:[require.resolve('style-loader'),require.resolve('css-loader')]}]}},(error,stats)=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
 const server = http.createServer((request,response)=>{
  response.setHeader('Content-Type',request.url==='/bundle.js'?'text/javascript':'text/html; charset=utf-8');
  response.end(request.url==='/bundle.js'?fs.readFileSync(path.join(output,'bundle.js')):'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser = await chromium.launch({headless:true});
 try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.addStyleTag({content:'*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;}'});
  await page.getByRole('tab',{name:'\u5168\u90e8\u6d41\u6c34',exact:true}).click();
  const select=page.getByRole('combobox',{name:'\u751f\u6d3b\u8d26\u5355\u5206\u7c7b',exact:true});
  await select.click();
  await page.getByTitle('\u505c\u8f66\u8d39',{exact:true}).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.querySelectorAll('tr.ant-table-row').length===2);
  assert.equal(await page.locator('tr.ant-table-row').count(),2);
  await select.click();
  await page.getByTitle('\u65e5\u5e38\u6d88\u8d39',{exact:true}).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.querySelectorAll('tr.ant-table-row').length===50);
  const amount=page.getByRole('columnheader',{name:'\u4ea4\u6613\u91d1\u989d',exact:false});
  await amount.click();
  await amount.click();
  await page.waitForFunction(()=>document.querySelector('tr.ant-table-row')?.textContent.includes('Shopping 65'));
  assert.equal(await page.locator('.finance-large-amount').count(),1);
  await page.screenshot({path:path.join(output,'categories-large-descending.png'),fullPage:true});
  const date=page.getByRole('columnheader',{name:'\u65e5\u671f\u65f6\u95f4',exact:false});
  await date.click();
  await page.waitForFunction(()=>window.lastInput?.sortField==='time'&&window.lastInput?.sortOrder==='ascend');
  await page.waitForFunction(()=>document.querySelector('tr.ant-table-row')?.textContent.includes('00:00:00'));
  await date.click();
  await page.waitForFunction(()=>window.lastInput?.sortField==='time'&&window.lastInput?.sortOrder==='descend');
  await page.waitForFunction(()=>document.querySelector('tr.ant-table-row')?.textContent.includes('23:00:00'));
  await page.getByRole('button',{name:'\u6e05\u9664\u660e\u7ec6\u7b5b\u9009',exact:true}).click();
  await page.setViewportSize({width:850,height:900});
  await page.screenshot({path:path.join(output,'narrow.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('tab',{name:/^\u5f85\u6838\u5bf9/}).click();
  await page.getByRole('button',{name:'\u6838\u5bf9\u5e76\u5904\u7406',exact:true}).first().click();
  await page.getByRole('button',{name:'\u5904\u7406\u8fd9\u7b14',exact:true}).first().click();
  await page.getByText(/\u5019\u9009\u539f\u4ef6.*Shopping 63/).waitFor();
  assert.equal(await page.getByRole('button',{name:'\u4fdd\u5b58\u5173\u8054',exact:true}).isEnabled(),true);
  const sourceRecord=page.locator('.finance-detail-drawer .finance-source-record');
  await sourceRecord.locator('summary').click();
  assert.equal(await sourceRecord.locator('details').getAttribute('open'),'');
  await sourceRecord.locator('summary').click();
  await page.getByRole('dialog',{name:'处理待核对流水',exact:true}).screenshot({path:path.join(output,'review-source.png'),animations:'disabled'});
  await page.getByRole('button',{name:'\u6821\u6b63\u7edf\u8ba1\u5206\u7c7b/\u8fd8\u6b3e\u62c6\u5206',exact:true}).click();
  await page.locator('#finance-annotation select[name=kind]').selectOption('expense');
  await page.locator('#finance-annotation input[name=category]').fill('Reviewed expense');
  await page.waitForFunction(()=>{const input=document.querySelector('#finance-annotation input[name=category]'),modal=input?.closest('.ant-modal');if(!input||!modal||getComputedStyle(modal).opacity!=='1'||modal.getBoundingClientRect().width<415)return false;const r=input.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===input;});
  const correction=page.locator('.ant-modal.finance-correction');
  const categoryBox=await correction.locator('input[name=category]').boundingBox();
  const kindBox=await correction.locator('select[name=kind]').boundingBox();
  assert.equal(categoryBox.width,kindBox.width);
  const amounts=correction.locator('.finance-correction__amount .ant-input-affix-wrapper');
  assert.equal(await amounts.count(),3);
  const boxes=await Promise.all([0,1,2].map(index=>amounts.nth(index).boundingBox()));
  assert(Math.max(...boxes.map(box=>box.width))-Math.min(...boxes.map(box=>box.width))<1);
  assert.equal(new Set(boxes.map(box=>box.y)).size,1);
  await correction.screenshot({path:path.join(output,'review-edit.png'),animations:'disabled'});
  await page.getByRole('button',{name:'\u4fdd\u5b58\u6838\u5bf9',exact:true}).click();
  await page.waitForFunction(()=>window.savedAnnotation?.patch.kind==='expense'&&document.body.textContent.includes('\u5f85\u6838\u5bf9 0 \u7b14'));
  assert.equal(await page.evaluate(()=>window.savedAnnotation.id),'bill-64');
  assert.equal(await page.evaluate(()=>window.savedAnnotation.expectedRevision),'0');
  assert.equal(await page.evaluate(()=>window.savedAnnotation.patch.category),'Reviewed expense');
  await page.evaluate(()=>localStorage.setItem('wideCandidates','1'));
  await page.reload();
  await page.getByRole('tab',{name:/^\u5f85\u6838\u5bf9/}).click();
  await page.getByRole('button',{name:'\u6838\u5bf9\u5e76\u5904\u7406',exact:true}).first().click();
  await page.getByRole('button',{name:'\u5904\u7406\u8fd9\u7b14',exact:true}).first().click();
  await page.getByText(/\u5019\u9009\u539f\u4ef6.*Shopping 63/).waitFor();
  assert.equal(await page.getByRole('button',{name:'\u4fdd\u5b58\u5173\u8054',exact:true}).isEnabled(),false);
  assert.equal(await page.evaluate(()=>Math.max(...window.searchBatchSizes)),40);
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('tab',{name:'导入账单',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles({name:'合成银行账单.zip',mimeType:'application/zip',buffer:Buffer.from('synthetic')});
  await page.getByRole('button',{name:'输入此文件解压密码',exact:true}).click();
  const password=page.getByRole('dialog',{name:'账单解压密码'});
  await password.getByText('合成银行账单.zip',{exact:true}).waitFor();
  const passwordContent=password.locator('.ant-modal-content');
  await page.waitForFunction(()=>{
   const modal=document.getElementById('finance-file-password')?.closest('.ant-modal');
   return modal&&modal.getBoundingClientRect().width>=419&&getComputedStyle(modal).opacity==='1';
  });
  await passwordContent.screenshot({path:path.join(output,'file-password.png'),animations:'disabled'});
  await password.getByLabel('本地账单解压密码').fill('synthetic-only');
  await password.getByRole('button',{name:/确\s*定/}).click();
  await password.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'输入此文件解压密码',exact:true}).click();
  assert.equal(await password.getByLabel('本地账单解压密码').inputValue(),'synthetic-only');
  await page.goto('http://127.0.0.1:'+server.address().port+'/?account-discovery');
  const accountNotice=page.getByRole('alert').filter({hasText:'房贷账户已建立，请补充资料'});
  await accountNotice.waitFor();
  assert.match(await accountNotice.textContent(),/原贷款额.*原合同期限.*首次还款日期/);
  assert.doesNotMatch(await accountNotice.textContent(),/账单尾号/);
  assert.deepEqual(await page.evaluate(()=>window.discoveryRevisions),['0']);
  assert.match(await page.getByTestId('balance-mortgage-commercial').locator('..').textContent(),/待核对/);
  await page.getByRole('button',{name:'测试银行储蓄卡（4321）',exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'mortgage-account-created.png')});
  await page.getByRole('button',{name:'查看房贷账户'}).click();
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'finance-mortgage-accounts');
  await page.getByRole('region',{name:'房贷账户',exact:true}).getByRole('button',{name:'补充资料'}).click();
  const mortgage=page.getByRole('dialog',{name:'补充房贷资料'});
  await mortgage.waitFor();
  assert.equal(await mortgage.getByLabel('账单尾号').inputValue(),'1234');
  await mortgage.getByLabel('原贷款额').fill('150000');
  await mortgage.getByLabel('原合同期限').fill('360');
  await mortgage.getByLabel('首次还款日期').fill(today);
  await mortgage.getByLabel('已知年利率').fill('3.3');
  await mortgage.getByRole('button',{name:'保存参数'}).click();
  await mortgage.waitFor({state:'hidden'});
  await accountNotice.waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(()=>window.discoveryRevisions),['0']);
  // Fixture resets on browser reload; persistence of the server route is covered
  // by the repository and route tests. This browser check proves the UI writes.
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['single category','multiple categories','sorting before pagination','relative large highlight','time ascending','time descending','clear filters','narrow render','review opens scoped records','review edits original annotation','saved review recalculates count','42 candidates use bounded queries and require selection','automatically creates card and mortgage before editing','supplementing mortgage details clears the reminder'],output}));
 } finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
