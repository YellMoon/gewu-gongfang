'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{HEADERS,parseGuotaiPdf,operatorItems}=require('./brokerageStatement'),{parseBillCsv}=require('./billCsv');
const xs=[21.33,70.5,126.49,182.49,234.38,286.28,335.45,384.61,433.78,480.67,535.3,593.1,634.07,675.04,716.02,757.89,789.76],width=h=>h.length*10;
const pages=()=>[{number:1,width:842,items:[{str:'\u56fd\u6cf0\u6d77\u901a\u8bc1\u5238\u5ba2\u6237\u8d26\u6237\u5bf9\u8d26\u5355',x:100,y:530,width:240},{str:'\u5bf9\u8d26\u671f\u9650:20261001-20261031',x:423,y:439,width:150},...HEADERS.map((str,i)=>({str,x:xs[i],y:311,width:width(str)})),...['20261001','90001234','\u94f6\u884c\u8f6c\u8bc1\u5238','','','0.000','0.00','0.00','0.00','1000.00','1000.00','0.00','0.00','0.00','0.00','CNY','0.00'].flatMap((str,i)=>str?[{str,x:i===2?117:xs[i]+2,y:287,width:i===2?50:Math.min(34,str.length*4)}]:[])]}];
test('validated brokerage PDF header, columns, period, cash amounts and cash-only balance scope',()=>{const r=parseGuotaiPdf(pages());assert.deepEqual(r.errors,[]);assert.equal(r.records.length,1);assert.equal(r.records[0].amountMinor,'100000');assert.equal(r.records[0].balanceMinor,null);assert.equal(r.records[0].brokerage.cashBalanceMinor,'100000');assert.equal(r.records[0].brokerage.periodEnd,'2026-10-31');assert.equal(r.records[0].rawFields['\u8d44\u91d1\u8d26\u53f7'],'****1234');});
test('unknown issuer, missing column, wrong currency and discontinuous cash are blocked',()=>{
 for(const mutate of [p=>p[0].items[0].str='Other issuer',p=>p[0].items=p[0].items.filter(i=>i.str!==HEADERS[11]),p=>p[0].items.find(i=>i.str==='CNY').str='USD']){const p=pages();mutate(p);assert(parseGuotaiPdf(p).errors.length);}
 const p=pages();const body=p[0].items.filter(i=>i.y===287).map(i=>({...i,y:263}));body.find(i=>i.x>535&&i.x<590).str='1001.00';p[0].items.push(...body);assert(parseGuotaiPdf(p).errors.some(e=>e.code==='BILL_BROKER_CASH_GAP'));
});
test('CSV preserves actual cash/gross fees despite rounded display prices and incomplete fee components',()=>{
 const h=['\u4ea4\u6536\u65e5\u671f','\u8bc1\u5238\u4ee3\u7801','\u8bc1\u5238\u540d\u79f0','\u4ea4\u6613\u7c7b\u578b','\u6210\u4ea4\u4ef7\u683c','\u6210\u4ea4\u6570\u91cf','\u6210\u4ea4\u91d1\u989d','\u53d1\u751f\u91d1\u989d','\u4f63\u91d1','\u5370\u82b1\u7a0e','\u8fc7\u6237\u8d39','\u8d44\u91d1\u8d26\u6237','\u5e01\u79cd'];
 const r=parseBillCsv(h.map(x=>x+'\t').join(',')+'\n2026-08-28,159516,ETF,\u8bc1\u5238\u4e70\u5165,0.74,181600,134202.40,-134209.11,1.34,0.00,0.00,90001234,CNY');assert.deepEqual(r.errors,[]);assert.equal(r.provider,'brokerage','header alone must not certify a broker');assert.equal(r.records[0].feeMinor,'671');assert.equal(r.records[0].brokerage.fees.commissionMinor,'134');assert.equal(r.records[0].brokerage.displayPrice,'0.74');assert.equal(r.records[0].brokerage.cashBalanceMinor,null);
});
test('PDF operator text recovers wrapped/clipped text and transforms rotated coordinates',()=>{
 const OPS={save:1,transform:2,beginText:3,setTextMatrix:4,setFont:5,showText:6,restore:7},operators={fnArray:[1,2,3,4,5,6,4,6,7],argsArray:[null,[0,1,-1,0,595,0],null,[1,0,0,1,117,139],['font',10],[[{unicode:'Tax',width:1000}]],[1,0,0,1,117,129],[[{unicode:'row',width:1000}]],null]},viewport={height:595,convertToViewportPoint:(x,y)=>[y,x]};
 const items=operatorItems(operators,viewport,OPS);assert.deepEqual(items.map(i=>({str:i.str,x:i.x,y:i.y})),[{str:'Tax',x:117,y:139},{str:'row',x:117,y:129}]);
});

test('funds account identity is checked before masking, including equal last four digits',()=>{
 const p=pages(),body=p[0].items.filter(i=>i.y===287).map(i=>({...i,y:263}));
 body.find(i=>i.str==='90001234').str='80001234';p[0].items.push(...body);
 assert(parseGuotaiPdf(p).errors.some(e=>e.code==='BILL_BROKER_MIXED_ACCOUNTS'));
 const h=['\u4ea4\u6536\u65e5\u671f','\u8bc1\u5238\u4ee3\u7801','\u8bc1\u5238\u540d\u79f0','\u4ea4\u6613\u7c7b\u578b','\u6210\u4ea4\u4ef7\u683c','\u6210\u4ea4\u6570\u91cf','\u6210\u4ea4\u91d1\u989d','\u53d1\u751f\u91d1\u989d','\u4f63\u91d1','\u5370\u82b1\u7a0e','\u8fc7\u6237\u8d39','\u8d44\u91d1\u8d26\u6237','\u5e01\u79cd'];
 const row=id=>'2026-08-28,159516,ETF,\u8bc1\u5238\u4e70\u5165,1.00,100,100.00,-100.01,0.01,0.00,0.00,'+id+',CNY';
 const parsed=parseBillCsv(h.join(',')+'\n'+row('90001234')+'\n'+row('80001234'));assert(parsed.errors.some(e=>e.code==='BILL_BROKER_MIXED_ACCOUNTS'));assert.equal(parsed.records.length,0);
});

test('operator arrays and nesting are bounded; PDF cash balances cannot be silently blank',()=>{
 const viewport={height:595,convertToViewportPoint:(x,y)=>[x,y]},OPS={save:1};
 assert.throws(()=>operatorItems({fnArray:[1],argsArray:[]},viewport,OPS),/OPERATORS_INVALID/);
 assert.throws(()=>operatorItems({fnArray:Array(257).fill(1),argsArray:Array(257).fill(null)},viewport,OPS),/OPERATORS_INVALID/);
 const p=pages();p[0].items=p[0].items.filter(i=>!(i.y===287&&i.x>535&&i.x<590));assert(parseGuotaiPdf(p).errors.some(e=>e.code==='BILL_BROKER_CASH_BALANCE_MISSING'));
});
