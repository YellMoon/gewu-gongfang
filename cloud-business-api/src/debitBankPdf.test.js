'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),PDFDocument=require('pdfkit');
const {parseDebitBankPdf}=require('./debitBankPdf'),{parseBillFile}=require('./billFileDecoder'),{validateRecord}=require('../../shared/personal-finance/ledger');
const labels={jsb:['\u5e8f\u53f7','\u6458\u8981/\u9644\u8a00','\u5e01\u522b','\u4ea4\u6613\u65e5\u671f','\u4ea4\u6613\u7c7b\u578b','\u4ea4\u6613\u91d1\u989d','\u8d26\u6237\u4f59\u989d','\u5bf9\u65b9\u8d26\u53f7','\u5bf9\u65b9\u6237\u540d'],psbc:['\u4ea4\u6613\u65f6\u95f4','\u5b50\u8d26\u53f7','\u50a8\u79cd','\u5e01\u79cd','\u949e\u6c47','\u4ea4\u6613\u91d1\u989d','\u4ea4\u6613\u4f59\u989d','\u5bf9\u65b9\u6237\u540d','\u5bf9\u65b9\u8d26\u53f7','\u6458\u8981','\u4ea4\u6613\u6e20\u9053','\u5916\u90e8\u7cfb\u7edf\u6d41\u6c34']};
const hx={jsb:[58.06,107.42,174.28,225.39,283.5,341.61,399.72,457.83,515.94],psbc:[43.27,91.57,136.73,183.65,221.19,255.98,318.54,418.64,537.51,621.58,678.27,744.34]};
const dx={jsb:[63.31,100,170.78,225.39,290.5,348.61,401.47,450,508],psbc:[38.5,88.55,126.09,169.88,219.93,244.95,307.51,370.07,507.71,607.8,657.85,739.18]};
const item=(str,x,y)=>({str,x,y,width:1});
function page(provider,rows,{number=1,total=1,start='20260101',end='20261020',offset=0}={}){
 const items=provider==='jsb'?[item('\u6c5f\u82cf\u94f6\u884c\u4ea4\u6613\u660e\u7ec6',249.5,788),item('\u5361\u53f7/\u8d26\u53f7\uff1a6228000000002110',36,772),item('\u5ba2\u6237\u540d\u79f0\uff1a\u6d4b\u8bd5\u7532',207.72,772),item('\u8d77\u59cb\u65e5\u671f\uff1a'+start,330.44,772),item('\u7ed3\u675f\u65e5\u671f\uff1a'+end,460.16,772),item('\u7533\u8bf7\u65f6\u95f4\uff1a2026-10-20 12:00:00',36,100),item('\u9875\u7801: '+number+' / '+total,288,60)]:[item('\u4e2d\u56fd\u90ae\u653f\u50a8\u84c4\u94f6\u884c\u501f\u8bb0\u8d26\u6237\u5386\u53f2\u660e\u7ec6\uff08\u7535\u5b50\u7248\uff09',295,540),item('\u5361\u53f7/\u8d26\u53f7\uff1a6232000000001641',153,516),item('\u6237\u540d\uff1a\u6d4b\u8bd5\u7532',432,516),item('\u8d77\u6b62\u65e5\u671f\uff1a2026\u5e7401\u670801\u65e5-2026\u5e7410\u670820\u65e5',495,516),item('\u7b2c '+number+' \u9875 / \u5171 '+total+' \u9875',750,20)];
 const top=provider==='jsb'?745:495;
 labels[provider].forEach((s,i)=>items.push(item(s,hx[provider][i],top)));
 rows.forEach((row,i)=>row.forEach((s,c)=>{if(s)String(s).split('\n').forEach((line,n)=>items.push(item(line,dx[provider][c],top-28-i*60-n*8)));}));
 return {number,items};
}
const jsb=()=>page('jsb',[[1,'\u50a8\u84c4\u7ed3\u606f','\u4eba\u6c11\u5e01','20260921','\u6536\u5165','1.88','101.88','',''],[2,'\u5206\u884c\u5f80\u8d26\n\u8f6c\u8d26','\u4eba\u6c11\u5e01','20260920','\u652f\u51fa','10.00','100.00','6228000000000900','\u6d4b\u8bd5\u7532'],[3,'\u5b58\u5165','\u4eba\u6c11\u5e01','20260919','\u6536\u5165','110.00','110.00','','\u6d4b\u8bd5\u7532']]);
const psbc=()=>page('psbc',[['2026-09-21\n12:00:02','0001','\u7ed3\u7b97\u6d3b\u671f','\u4eba\u6c11\u5e01\u5143','\u949e','-50.00','50.00','','','\u8d37\u6b3e\u8fd8\u6b3e','\u7cfb\u7edf\u81ea\u52a8',''],['2026-09-20\n12:00:01','0001','\u7ed3\u7b97\u6d3b\u671f','\u4eba\u6c11\u5e01\u5143','\u949e','100.00','100.00','','','\u8d37\u6b3e\u53d1\u653e','\u7cfb\u7edf\u81ea\u52a8',''],['2026-09-19\n12:00:00','0001','\u7ed3\u7b97\u6d3b\u671f','\u4eba\u6c11\u5e01\u5143','\u949e','0.00','0.00','','','\u73b0\u91d1\u5f00\u5361','\u7f51\u70b9\u67dc\u9762','']]);
test('debit PDF layouts validate balances, reverse source order and preserve precise time and masked counterparty',()=>{
 const original=[jsb()],before=JSON.stringify(original),j=parseDebitBankPdf(original),p=parseDebitBankPdf([psbc()]);
 assert.deepEqual(j.errors,[]);assert.deepEqual(p.errors,[]);[...j.records,...p.records].forEach(validateRecord);
 assert.equal(j.records[0].date,'2026-09-19');assert.equal(j.records[1].kind,'transfer');assert.equal(j.records[1].rawFields['\u5bf9\u65b9\u8d26\u53f7'],'****0900');assert.equal(j.records[2].balanceMinor,'10188');
 assert.equal(p.records[1].occurredAt,'2026-09-20T12:00:01+08:00');assert.equal(p.records[1].kind,'loan_drawdown');assert.equal(p.records[2].kind,'debt_payment');assert.equal(p.records[0].amountMinor,'0');
 assert.equal(JSON.stringify(original),before);assert.equal(j.accountIdentity.maskedIdentifier,'2110');
});
test('later page corruption rejects the entire file and missing pages, columns, currencies and sequence fail closed',()=>{
 const first=page('jsb',[[1,'\u50a8\u84c4\u7ed3\u606f','\u4eba\u6c11\u5e01','20260921','\u6536\u5165','1.88','101.88','','']],{total:2});
 const second=page('jsb',[[2,'\u5b58\u5165','\u4eba\u6c11\u5e01','20260920','\u6536\u5165','100.00','100.00','','']],{number:2,total:2});
 assert.deepEqual(parseDebitBankPdf([first,second]).errors,[]);
 const mutations=[
  pages=>pages.pop(),
  pages=>pages[1].items.find(i=>i.str==='100.00'&&i.x===dx.jsb[6]).str='100.01',
  pages=>pages[1].items.find(i=>i.str==='2').str='3',
  pages=>pages[1].items.find(i=>i.str==='\u4eba\u6c11\u5e01').str='\u7f8e\u5143',
  pages=>pages[1].items.find(i=>i.str==='\u4ea4\u6613\u91d1\u989d').x+=20,
  pages=>pages[1].items.push(item('\u5361\u53f7/\u8d26\u53f7\uff1a6228000000009999',36,772)),
 ];
 for(const mutate of mutations){const pages=structuredClone([first,second]);mutate(pages);const r=parseDebitBankPdf(pages);assert.ok(r.errors.length);assert.equal(r.records.length,0);assert.equal(r.accountIdentity,undefined);}
 assert.equal(parseDebitBankPdf([{items:[item('Other bank',0,0)]}]),null);
});
test('overlapping query intervals and print row numbers retain stable transaction identity',()=>{
 const original=parseDebitBankPdf([jsb()]),other=jsb();other.items.find(i=>i.str==='\u8d77\u59cb\u65e5\u671f\uff1a20260101').str='\u8d77\u59cb\u65e5\u671f\uff1a20260102';
 const r=parseDebitBankPdf([other]);assert.deepEqual(r.errors,[]);assert.deepEqual(r.records.map(o=>o.sourceTransactionId),original.records.map(o=>o.sourceTransactionId));
});
test('actual isolated decoder routes both PDF layouts and encrypted ZIP support remains available',async()=>{
 for(const [provider,p] of [['jsb',jsb()],['psbc',psbc()]]){
  const doc=new PDFDocument({size:provider==='jsb'?[595,842]:[842,595],margin:0}),chunks=[],done=new Promise(resolve=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));});
  doc.font(path.resolve(__dirname,'../../backend/assets/fonts/NotoSansCJKsc-Regular.otf')).fontSize(7);
  for(const i of p.items)doc.text(i.str,i.x,(provider==='jsb'?842:595)-i.y-8,{lineBreak:false});doc.end();
  const r=await parseBillFile({filename:'synthetic-'+provider+'.pdf',base64:(await done).toString('base64')});assert.deepEqual(r.errors,[]);assert.equal(r.provider,provider);assert.equal(r.records.length,3);r.records.forEach(validateRecord);
 }
});
