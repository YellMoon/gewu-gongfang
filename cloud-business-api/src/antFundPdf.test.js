'use strict';
// Synthetic source geometry and CJK PDF fixtures; no customer files or identifiers.
const test=require('node:test'),assert=require('node:assert/strict');
const {parseAntFundPdf}=require('./antFundPdf');
const {parseBillFile}=require('./billFileDecoder');
const HEADERS=['订单号','交易时间','交易类型','基金名称','组合基金名称','基金代码','申请金额','申请份额','确认金额','确认份额','手续费','确认日期'];
const row=['2026100100000001','2026/10/01 09:41','定投买入','合成基金A','','000001','1000.00','/','1000.00','260.2300','1.49','2026/10/03 00:00'];
function page(number,ys,rows){const bounds=[],items=[];for(let c=0;c<13;c++)bounds.push([20+c*45,ys.at(-1),20+c*45,ys[0]]);for(const y of ys)for(let c=0;c<12;c++)bounds.push([20+c*45,y,20+(c+1)*45,y]);rows.forEach((cells,r)=>cells.forEach((str,c)=>{if(str)items.push({str,x:25+c*45,y:(ys[r]+ys[r+1])/2,width:30});}));return {number,bounds,items};}
const split=[...row];split[0]='202609300000';split[1]='2026/09/3';split[3]='合成';split[5]='000002';split[10]='0.00';split[11]='2026/10/0';
const continuation=['0002','0 09:40','','基金B','','','','','','','','2 00:00'];
const conversion=['2026081500000003','2026/08/15 08:30','确认日转换，赎回确认之后发起确认金额的申购的转换','','','','5399.82','1884.1600','/','/','0','2026/08/20 00:00'];
const fixture=()=>[page(2,[150,130,90,50],[HEADERS,row,split]),page(3,[150,110,70],[continuation,conversion])];
test('grid columns and one cross-page continuation preserve all exact values and missing conversion identity',()=>{
 const v=parseAntFundPdf(fixture());assert.deepEqual(v.errors,[]);assert.equal(v.records.length,3);assert.equal(v.records[0].investmentTrade.confirmedUnits,'260.2300');assert.equal(v.records[0].investmentTrade.feeMinor,'149');assert.deepEqual(v.records[1].investmentTrade.sourcePages,[2,3]);assert.equal(v.records[1].date,'2026-09-30');assert.equal(v.records[1].investmentTrade.fundName,'合成基金B');assert.equal(v.records[2].investmentTrade.confirmedUnits,null);assert.equal(v.records[2].investmentTrade.fundCode,null);assert.equal(v.records[2].investmentTrade.appliedUnits,'1884.1600');
});
test('missing continuation, duplicated orders and unsupported trade types fail explicitly',()=>{
 assert(parseAntFundPdf(fixture().slice(0,1)).errors.some(e=>e.code==='BILL_FUND_DATE_INVALID'));
 assert(parseAntFundPdf([page(2,[150,130,90,50],[HEADERS,row,row])]).errors.some(e=>e.code==='BILL_FUND_ORDER_INVALID'));
 assert(parseAntFundPdf([page(2,[150,130,90],[HEADERS,row.map((v,i)=>i===2?'未知转换':v)])]).errors.some(e=>e.code==='BILL_FUND_TRADE_TYPE_UNSUPPORTED'));
});
function unicodePdf(){
 const hex=s=>Buffer.from(s,'utf16le').swap16().toString('hex');
 const content=[['交易日期','收入金额','支出金额','摘要'],['2026-10-01','0.00','1.25','消费']].flatMap((r,n)=>r.map((s,c)=>`BT /F1 10 Tf ${20+c*135} ${760-n*25} Td <${hex(s)}> Tj ET`)).join('\n');
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>','<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>','<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 6 0 R /DW 1000 >>','<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
 let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(pdf);
}
test('production decoder loads nonembedded Chinese CMaps rather than seeing only the page footer',async()=>{
 const v=await parseBillFile({filename:'synthetic-cjk.pdf',buffer:unicodePdf()});assert.deepEqual(v.errors,[]);assert.equal(v.records.length,1);assert.equal(v.records[0].amountMinor,'125');
});
