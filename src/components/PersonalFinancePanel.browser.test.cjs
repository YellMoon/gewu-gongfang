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
 currency:'CNY', amountMinor:index===65?'100000':'1000', direction:'debit', kind:'expense',
 status:'completed', description:index<2?'\u505c\u8f66\u8d39':'Shopping '+index,
 category:'', counterparty:'Fixture', paymentChannel:'', paymentAccountHint:'', relatedReference:'',
 principalMinor:null, interestMinor:null, feeMinor:null, balanceMinor:null, rawFields:{},
}));
const ledger = {revision:'0',accounts:[{id:'A',label:'Fixture account',type:'bank',provider:'synthetic',currency:'CNY',status:'active',openingBalanceMinor:null,openingDate:null}],observations,annotations:[],links:[],imports:[],balanceSnapshots:[],legacyRecords:[]};
fs.writeFileSync(path.join(output,'entry.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import Panel from ${JSON.stringify(path.join(root,'src/components/PersonalFinancePanel.tsx'))};createRoot(document.getElementById('root')).render(<main style={{padding:24}}><Panel/></main>);`, 'utf8');
fs.writeFileSync(path.join(output,'client.mjs'), `import {buildFinanceView} from ${JSON.stringify(path.join(root,'shared/personal-finance/ledger.js'))};import {buildAssetRegister} from ${JSON.stringify(path.join(root,'shared/personal-finance/assetRegister.js'))};import {billCategory,compareBillAmount,compareBillTime,largeBillThresholds,isLargeBill} from ${JSON.stringify(path.join(root,'shared/personal-finance/billPresentation.js'))};export const formatMinor=v=>v==null?'Unknown':(Number(v)/100).toFixed(2);export const parseMoney=v=>String(Math.round(Number(v)*100));const ledger=${JSON.stringify(ledger)};export const createPersonalFinanceClient=()=>({mailboxStatus:async()=>({}),queryProjection:async input=>{window.lastInput=input;const view=buildFinanceView(ledger,input);let rows=view.transactions;const thresholds=largeBillThresholds(rows);if(input.billCategories?.length)rows=rows.filter(t=>input.billCategories.includes(billCategory(t)));const compare=input.sortField==='amount'?compareBillAmount:compareBillTime;rows=[...rows].sort((a,b)=>(input.sortOrder==='ascend'?1:-1)*(compare(a,b)||compareBillTime(a,b)));return {projection:{status:'ready',ledger:{...ledger,observations:[]},view:{...view,transactions:[]},globalReview:view.review,assetRegister:buildAssetRegister(ledger),trend:[],transactions:{total:rows.length,page:input.page,pageSize:50,items:rows.slice((input.page-1)*50,input.page*50).map(t=>({...t,billCategory:billCategory(t),isLargeBill:isLargeBill(t,thresholds)}))}}};}});`, 'utf8');
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
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['single category','multiple categories','sorting before pagination','relative large highlight','time ascending','time descending','clear filters','narrow render'],output}));
 } finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
