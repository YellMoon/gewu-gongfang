'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseCcbDebitRows}=require('./ccbDebitStatement');
const header=['\u5e8f\u53f7','\u6458\u8981','\u5e01\u522b','\u949e\u6c47','\u4ea4\u6613\u65e5\u671f','\u4ea4\u6613\u91d1\u989d','\u8d26\u6237\u4f59\u989d','\u4ea4\u6613\u5730\u70b9/\u9644\u8a00','\u5bf9\u65b9\u8d26\u53f7\u4e0e\u6237\u540d'];
const row=(sequence,summary,date,amount,balance,location='',counter='')=>[String(sequence),summary,'\u4eba\u6c11\u5e01\u5143','\u949e',date,amount,balance,location,counter];
function statement(body,{start='20260101',end='20261020',income='120.20',expense='111.00'}={}){
 return [
  ['','','','','\u4e2d\u56fd\u5efa\u8bbe\u94f6\u884c\u4e2a\u4eba\u6d3b\u671f\u8d26\u6237\u5168\u90e8\u4ea4\u6613\u660e\u7ec6','','','',''],
  ['','\u5361\u53f7/\u8d26\u53f7:6227000000006943','','\u5ba2\u6237\u540d\u79f0:\u6d4b\u8bd5\u7528\u6237','','\u8d77\u59cb\u65e5\u671f:'+start,'','\u7ed3\u675f\u65e5\u671f:'+end,''],
  ['','\u5f53\u524d\u65f6\u95f4\u6bb5\u6536\u652f\u91d1\u989d\u5408\u8ba1\uff1a\u4eba\u6c11\u5e01\u5143\uff1b  \u603b\u652f\u51fa\uff1a'+expense+'    \u603b\u6536\u5165\uff1a'+income,'','','','','','',''],
  [...header],...body
 ];
}
const sample=()=>statement([
 row(1,'\u8f6c\u8d26\u5b58\u5165','20261001','100.00','1100.00','','6227000000000900/\u6d4b\u8bd5\u5bf9\u65b9'),
 row(2,'\u6d88\u8d39','20261002','-100.00','1000.00','\u8d22\u4ed8\u901a-\u5fae\u4fe1\u652f\u4ed8-Shop'),
 row(3,'\u0045\u0054\u0043\u901a\u884c\u8d39','20261003','-10.00','990.00','Highway'),
 row(4,'\u5229\u606f\u5b58\u5165','20261004','0.20','990.20'),
 row(5,'\u6d88\u8d39\u9000\u8d27','20261005','20.00','1010.20'),
 row(6,'\u624b\u7eed\u8d39','20261006','-1.00','1009.20')
]);
test('CCB debit rows validate signed cash, totals, running balances, explicit purposes and masked identity',()=>{
 const rows=sample(),before=JSON.stringify(rows),result=parseCcbDebitRows(rows);
 assert.deepEqual(result.errors,[]);assert.equal(result.records.length,6);
 assert.deepEqual(result.records.map(o=>o.kind),['unknown','expense','expense','income','refund','fee']);
 assert.deepEqual(result.accountIdentity,{provider:'\u5efa\u8bbe\u94f6\u884c',type:'debit_card',maskedIdentifier:'6943',currency:'CNY'});
 assert.equal(result.records[0].statementFlow.openingBeforeFirstMinor,'100000');
 assert.equal(result.records.at(-1).balanceMinor,'100920');
 assert.equal(result.records[1].amountMinor,'10000');assert.equal(result.records[1].direction,'debit');
 assert.equal(result.records[1].statementFlow.timePrecision,'day');assert.equal(result.records[1].rawFields.timePrecision,'day');
 assert.equal(result.records[1].occurredAt,'2026-10-02T23:59:59+08:00');
 assert.equal(result.records[0].rawFields['\u5bf9\u65b9\u8d26\u53f7'],'****0900');
 assert.ok(!JSON.stringify(result).includes('622700000000'));assert.equal(JSON.stringify(rows),before);
 assert.equal(parseCcbDebitRows([['Unrelated workbook']]),null);
});
test('CCB rejects missing columns, currency/direction errors, gaps, chronology and any inconsistent final total',()=>{
 const changes=[
  r=>r[3].pop(),r=>r[4].pop(),r=>r[4][2]='USD',r=>r[4][3]='\u6c47',
  r=>r[5][0]='3',r=>r[5][4]='20260230',r=>r[5][4]='20260930',
  r=>r[5][5]='100.00',r=>r[5][5]='-1,00.00',r=>r[5][5]='-1e2',
  r=>r[5][6]='1000.01',r=>r[4][5]='0.00',
  r=>r[1][5]='\u8d77\u59cb\u65e5\u671f:20261003',
  r=>r[2][1]=r[2][1].replace('120.20','120.21'),
  r=>r[2][1]=r[2][1].replace('111.00','111.01'),
  r=>r.push(['2','unexpected body']),
  r=>r[1].push('\u5361\u53f7/\u8d26\u53f7:6227000000009999')
 ];
 for(const change of changes){const rows=sample();change(rows);const result=parseCcbDebitRows(rows);assert.ok(result.errors.length);assert.equal(result.records.length,0);assert.equal(result.accountIdentity,undefined);}
});
test('CCB source identity survives overlapping requests and distinguishes repeated same-day equal payments',()=>{
 const body=[row(1,'\u6d88\u8d39','20261001','-10.00','90.00','Shop'),row(2,'\u6d88\u8d39','20261001','-10.00','80.00','Shop')];
 const full=parseCcbDebitRows(statement(body,{income:'0.00',expense:'20.00'}));
 const subsetRow=[...body[1]];subsetRow[0]='1';
 const subset=parseCcbDebitRows(statement([subsetRow],{start:'20261001',end:'20261002',income:'0.00',expense:'10.00'}));
 assert.deepEqual(full.errors,[]);assert.deepEqual(subset.errors,[]);
 assert.notEqual(full.records[0].sourceTransactionId,full.records[1].sourceTransactionId);
 assert.equal(full.records[1].sourceTransactionId,subset.records[0].sourceTransactionId);
 const cycle=parseCcbDebitRows(statement([row(1,'\u6d88\u8d39','20261001','-10.00','90.00','Shop'),row(2,'\u8f6c\u8d26\u5b58\u5165','20261001','10.00','100.00'),row(3,'\u6d88\u8d39','20261001','-10.00','90.00','Shop')],{income:'10.00',expense:'20.00'}));
 assert.deepEqual(cycle.errors,[]);assert.equal(new Set(cycle.records.map(o=>o.sourceTransactionId)).size,3);
});
test('CCB preserves exact large money and keeps ambiguous purpose or wrong-sign refund unresolved',()=>{
 const result=parseCcbDebitRows(statement([
  row(1,'\u8f6c\u8d26\u5b58\u5165','20261001','90,071,992,547,409.93','90,071,992,547,409.93'),
  row(2,'\u9000\u6b3e','20261002','-0.01','90,071,992,547,409.92'),
  row(3,'\u51b2\u6b63','20261003','0.01','90,071,992,547,409.93')
 ],{income:'90,071,992,547,409.94',expense:'0.01'}));
 assert.deepEqual(result.errors,[]);assert.equal(result.records[0].amountMinor,'9007199254740993');assert.ok(result.records.every(o=>o.kind==='unknown'));
});
