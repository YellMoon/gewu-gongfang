'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),PDFDocument=require('pdfkit');
const {parseSpdbDebitPdf}=require('./spdbDebitStatement'),{parseBillFile}=require('./billFileDecoder'),{validateRecord}=require('../../shared/personal-finance/ledger');
const item=(str,x,y)=>({str,x,y,width:1}),labels=['交易日期','交易时间','交易账号','交易名称','交易金额','账户余额','对手姓名','对手账号','交易摘要'],hx=[91.22,133.06,181.18,235.57,289.96,338.08,379.92,423.85,467.78],dx=[90.3,132.14,173.98,228.37,282.76,337.16,379,420.84,466.86],card='6217000000007082';
function page(rows,{number=1,total=1}={}){
 const items=[item('第'+number+'页/共'+total+'页，Page '+number+' of '+total,225,20)];
 if(number===1){items.push(item('上海浦东发展银行个人客户交易流水专用回单',137.5,788),item('户名:测试甲账号:'+card+'起止日期:20130101-20261022',90.3,748),item('币种:人民币交易类型:全部',90.3,708));labels.forEach((v,c)=>items.push(item(v,hx[c],663)));}
 rows.forEach((row,r)=>row.forEach((value,c)=>String(value).split('\n').forEach((line,n)=>{if(line)items.push(item(line,dx[c],(number===1?611:788)-r*84-n*16));})));
 return {number,items};
}
const rows=()=>[['20191014','60907',card,'银联入账:余额宝提现','10000.00','10000.42','待收银行','',''],['20191014','163403',card,'支付宝-测试甲','1712.60','11713.0\n2','支付宝','2155000000001234','支付宝-测试甲'],['20191014','164302',card,'信用卡还款','-11712.60','0.42','待划转信用卡','','']];
test('SPDB debit PDF preserves wrapped balances, actual second timestamps, statement coverage and source owner',()=>{
 const source=[page(rows())],before=JSON.stringify(source),r=parseSpdbDebitPdf(source);assert.deepEqual(r.errors,[]);r.records.forEach(validateRecord);assert.equal(r.records.length,3);assert.equal(r.accountIdentity.maskedIdentifier,'7082');assert.equal(r.accountIdentity.type,'debit_card');assert.equal(r.statementOwner.fullName,'测试甲');assert.equal(r.records[0].occurredAt,'2019-10-14T06:09:07+08:00');assert.equal(r.records[1].balanceMinor,'1171302');assert.equal(r.records[1].amountMinor,'171260');assert.equal(r.records[1].rawFields.counterAccount,'****1234');assert.equal(r.records[2].kind,'debt_payment');assert.equal(r.records[0].statementFlow.openingBeforeFirstMinor,'42');assert.equal(r.records[0].statementFlow.periodEnd,'2026-10-22');assert.equal(JSON.stringify(source),before);assert(!JSON.stringify(r).includes('2155000000001234'));
});
test('missing pages, missing dates, altered amounts, mixed own accounts and invalid time fail the whole import',()=>{
 const source=[page(rows().slice(0,2),{total:2}),page(rows().slice(2),{number:2,total:2})];assert.deepEqual(parseSpdbDebitPdf(source).errors,[]);
 const mutations=[p=>p.pop(),p=>p[1].items.find(i=>i.str==='0.42').str='0.43',p=>p[1].items.find(i=>i.str===card).str='6217000000009999',p=>p[1].items.find(i=>i.str==='20191014').str='',p=>p[1].items.find(i=>i.str==='164302').str='256000',p=>p[0].items.find(i=>i.str==='交易金额').x+=15];
 for(const mutate of mutations){const p=structuredClone(source);mutate(p);const r=parseSpdbDebitPdf(p);assert(r.errors.length);assert.equal(r.records.length,0);assert.equal(r.accountIdentity,undefined);}
 assert.equal(parseSpdbDebitPdf([{items:[item('Other bank',0,0)]}]),null);
});
test('overlapping query ranges preserve original transaction identities',()=>{
 const a=page(rows()),b=structuredClone(a);b.items.find(i=>i.str.startsWith('户名:')).str='户名:测试甲账号:'+card+'起止日期:20190101-20261022';assert.deepEqual(parseSpdbDebitPdf([a]).records.map(o=>o.sourceTransactionId),parseSpdbDebitPdf([b]).records.map(o=>o.sourceTransactionId));
});
test('the production file decoder routes SPDB debit PDF separately from SPDB credit statements',async()=>{
 const doc=new PDFDocument({size:[595,842],margin:0}),chunks=[],done=new Promise(resolve=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));});doc.font(path.resolve(__dirname,'../../backend/assets/fonts/NotoSansCJKsc-Regular.otf')).fontSize(7);
 for(const i of page(rows()).items)doc.text(i.str,i.x,842-i.y-8,{lineBreak:false});doc.end();const r=await parseBillFile({filename:'spdb-debit.pdf',base64:(await done).toString('base64')});assert.deepEqual(r.errors,[]);assert.equal(r.provider,'spdb');assert.equal(r.templateId,'spdb-debit-v1');assert.equal(r.records.length,3);r.records.forEach(validateRecord);
});
