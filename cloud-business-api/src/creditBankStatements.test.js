'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseCreditBankHtml}=require('./creditBankStatements');
const {parseCmbPdfRows}=require('./cmbStatement');
const {parseSpdbPdfRows,parseSpdbDetailRows}=require('./spdbStatement');
const {parseHangzhouPdf}=require('./hangzhouStatement');
const {validateRecord}=require('../../shared/personal-finance/ledger');
const {resolveBankAccount}=require('./bankAccountResolution');
const html=(bank,rows)=>'<html><body>'+bank+'<table>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</table></body></html>';
const cz=html('95527@message.czbank.com',[
 ['\u4fe1\u7528\u989d\u5ea6','\u6700\u4f4e\u8fd8\u6b3e\u989d','\u8d26\u5355\u65e5','\u5230\u671f\u8fd8\u6b3e\u65e5'],['Credit Limit','Min.Payment','Statement Date','Payment Due Date'],['1000','1.00','20261010','20261027'],
 ['\uffe580.00','=','\uffe5100.00','-','\uffe550.00','+','\uffe530.00','+','\uffe50.00','+','\uffe50.00'],
 ['20261001','20261001','\u94f6\u8054\u4fe1\u7528\u5361\u8fd8\u6b3e','\uffe5-50.00','1234'],['20261002','20261003','\u6d88\u8d39-Books','\uffe530.00','1234']]);
test('credit statements validate the balance equation and every original transaction amount',()=>{
 const r=parseCreditBankHtml(cz);assert.deepEqual(r.errors,[]);assert.equal(r.records.length,3);r.records.forEach(validateRecord);assert.equal(r.records[0].kind,'debt_payment');assert.equal(r.records[2].balanceEvidence.balanceKind,'billed_debt');
 assert.equal(parseCreditBankHtml(cz.replace('\uffe530.00','\uffe531.00')).errors[0].code,'BILL_BANK_TOTAL_INVALID');
 const resolved=resolveBankAccount({identity:r.accountIdentity,accounts:[],owner:['tenant','owner']});assert.equal(resolved.status,'create');assert.equal(resolved.account.maskedIdentifier,'1234');
 assert.notEqual(resolveBankAccount({identity:r.accountIdentity,accounts:[],owner:['tenant','other']}).account.id,resolved.account.id);
});
test('CCB splits card identity, retains installment principal without charging consumption twice, and keeps interest',()=>{
 const r=parseCreditBankHtml(html('\u9f99\u5361\u4fe1\u7528\u5361\u5bf9\u8d26\u5355',[
 ['\u672c\u671f\u8d26\u5355\u65e5 Statement Date','2026-10-18'],['\u4eba\u6c11\u5e01(CNY)','0.00','32.00','0.00','32.00'],
 ['62270803****1111','\u4eba\u6c11\u5e01(CNY)','10.00','1.00'],['62270818****2222','\u4eba\u6c11\u5e01(CNY)','22.00','1.00'],
 ['2026-10-18','2026-10-18','1111','\u676d\u5dde\u5e02 \u6d88\u8d39 Shop:\u5206','CNY','10.00','CNY','10.00'],
 ['2026-10-18','2026-10-18','2222','\u6d88\u8d39 Shop','CNY','20.00','CNY','20.00'],
 ['2026-10-18','2026-10-18','2222','\u5206\u671f\u5229\u606f','CNY','2.00','CNY','2.00']]));
 assert.deepEqual(r.errors,[]);r.records.forEach(validateRecord);assert.equal(new Set(r.records.map(x=>x.bankAccount.maskedIdentifier)).size,2);
 assert.equal(r.records[0].direction,'neutral');assert.equal(r.records[0].amountMinor,'1000');assert.equal(r.records[2].kind,'interest');
});
test('undated CGB statement interest explicitly uses the statement date and preserves its date basis',()=>{
 const r=parseCreditBankHtml(html('\u5e7f\u53d1\u94f6\u884c\u4fe1\u7528\u5361 \u8d26\u5355\u65e5:2026/10/21',[
 ['1234','\u4eba\u6c11\u5e01','1.23','=','0.00','-','0.00','+','0.00','-','0.00','+','1.23','+','0.00'],['\u5361\u53f7\uff1a3705*******1234'],['','','\u6d88\u8d39\u5229\u606f','1.23','\u4eba\u6c11\u5e01','1.23','\u4eba\u6c11\u5e01']]));
 assert.deepEqual(r.errors,[]);r.records.forEach(validateRecord);assert.equal(r.records[0].rawFields.dateBasis,'statement_date');assert.equal(r.records[0].kind,'interest');
});
test('forwarded BOCOM statement periods keep separate dates and stable transaction IDs',()=>{
 const rows=[];
 for(const [period,day,previous,newBalance]of [['2026/09/07-2026/10/06','09/10','0.00','10.00'],['2026/08/07-2026/09/06','08/10','0.00','10.00']]){
  rows.push(['\u4ea4\u901a\u94f6\u884c 521899******1234 \u8d26\u5355\u5468\u671f '+period],['\u4eba\u6c11\u5e01\u8d26\u6237',newBalance,previous,'0.00','10.00'],['\u6d88\u8d39\u3001\u53d6\u73b0\u3001\u5176\u4ed6\u8d39\u7528\u660e\u7ec6'],['',day,day,'1234','\u6d88\u8d39-Books','CNY 10.00','CNY 10.00']);
 }
 const r=parseCreditBankHtml(html('\u4ea4\u901a\u94f6\u884c',rows));assert.deepEqual(r.errors,[]);r.records.forEach(validateRecord);
 assert.deepEqual(r.records.filter(x=>x.bankStatement).map(x=>x.bankStatement.statementDate),['2026-10-06','2026-09-06']);
 const single=parseCreditBankHtml(html('\u4ea4\u901a\u94f6\u884c',rows.slice(4)));assert.equal(single.records[0].sourceTransactionId,r.records[1].sourceTransactionId);
});
test('legacy BOCOM split currency cells preserve repayment and consumption amounts',()=>{
 for(const withTail of [false,true]){
  const detail=(day,description,amount)=>[day,day,...(withTail?['1234']:[]),description,'RMB',amount,'RMB',amount];
  const r=parseCreditBankHtml(html('\u4ea4\u901a\u94f6\u884c',[
   ['521899******1234 \u8d26\u5355\u5468\u671f 2015/04/07-2015/05/06'],['\u4eba\u6c11\u5e01\u8d26\u6237','5.00','10.00','10.00','5.00'],['\u8fd8\u6b3e\u3001\u9000\u8d27\u3001\u8d39\u7528\u8fd4\u8fd8\u660e\u7ec6'],detail('2015/05/01','\u8f6c\u5e10\u8fd8\u6b3e','10.00'),['\u6d88\u8d39\u3001\u53d6\u73b0\u3001\u5176\u4ed6\u8d39\u7528\u660e\u7ec6'],detail('2015/05/02','POS Books','5.00')]));
  assert.deepEqual(r.errors,[]);r.records.forEach(validateRecord);assert.deepEqual(r.records.slice(0,2).map(x=>[x.direction,x.amountMinor,x.bankAccount.maskedIdentifier]),[['credit','1000','1234'],['debit','500','1234']]);
 }
});

test('CMB PDF preserves original versus posting date across year boundaries and rejects missing totals',()=>{
 const rows=[['\u62db\u5546\u94f6\u884c\u4fe1\u7528\u5361\u5bf9\u8d26\u5355','Transaction Details'],['2026\u5e7401\u670806\u65e5'],['12/19','\u94f6\u8054\u8f6c\u8d26\u8fd8\u6b3e','-10.00','1234','-10.00'],['11/07','12/08','\u6d88\u8d39\u5206\u671f-Books \u672c\u91d1 \u7b2c2/3\u671f','20.00','1234','20.00'],['\u672c\u671f\u5e94\u8fd8\u91d1\u989d','\u4e0a\u671f\u8d26\u5355\u91d1\u989d'],['\u00a520.00','\u00a510.00','\u00a510.00','\u00a520.00','\u00a50.00','\u00a50.00']];
 const r=parseCmbPdfRows(rows);assert.deepEqual(r.errors,[]);r.records.forEach(validateRecord);assert.equal(r.records[1].date,'2025-11-07');assert.equal(r.records[1].bankStatement.postedDate,'2025-12-08');assert.equal(r.records[1].direction,'neutral');
 assert.ok(parseCmbPdfRows(rows.slice(0,-1)).errors.length);
});

test('SPDB PDF retains cross-page detail and wrapped repayment descriptions, validates original totals',()=>{
 const rows=[['202606\u4fe1\u7528\u5361\u8d26\u5355'],['\u60a8\u6d66\u53d1\u4e2a\u4eba\u4fe1\u7528\u5361\u5bf9\u8d26\u5355'],['\u8d26\u5355\u65e5:','24'],['Payment/Credit'],['\uffe5','0.00','\uffe5','10.00','\uffe5','30.00','\uffe5','20.00'],['20260601','20260602','\u7f51\u8054\u81ea\u52a9\u8f6c\u5165-\u4fe1','1234','\uffe5','-30.00'],['\u7528\u5361\u8fd8\u6b3e'],['\u7b2c 1 \u9875 \u5171 2 \u9875'],['20260603','20260603','Books','1234','\uffe5','20.00'],['\u672c\u671f\u79ef\u5206\u60c5\u51b5']];
 const r=parseSpdbPdfRows(rows);assert.deepEqual(r.errors,[]);r.records.forEach(validateRecord);assert.equal(r.records.length,3);assert.equal(r.records[0].kind,'debt_payment');assert.equal(r.records[1].amountMinor,'2000');assert.equal(r.accountIdentity.provider,'\u6d66\u53d1\u94f6\u884c');
 assert.equal(parseSpdbPdfRows(rows.filter(x=>x[0]!=='20260603')).errors[0].code,'BILL_BANK_TOTAL_INVALID');
 assert.equal(parseSpdbPdfRows(rows.map(x=>x[0]==='20260603'?[...x.slice(0,-1),'21.00']:x)).errors[0].code,'BILL_BANK_TOTAL_INVALID');
});

test('BOCOM aggregate statement does not assign a combined debt balance to one of several cards',()=>{
 const r=parseCreditBankHtml(html('\u4ea4\u901a\u94f6\u884c',[
 ['521899******1234 \u8d26\u5355\u5468\u671f 2026/09/07-2026/10/06'],['\u4eba\u6c11\u5e01\u8d26\u6237','15.00','5.00','5.00','15.00'],['\u8fd8\u6b3e\u3001\u9000\u8d27\u3001\u8d39\u7528\u8fd4\u8fd8\u660e\u7ec6'],['09/10','09/10','1234','\u4fe1\u7528\u5361\u8fd8\u6b3e','CNY 5.00','CNY 5.00'],['\u6d88\u8d39\u3001\u53d6\u73b0\u3001\u5176\u4ed6\u8d39\u7528\u660e\u7ec6'],['09/11','09/11','5678','Books','CNY 15.00','CNY 15.00']]));
 assert.deepEqual(r.errors,[]);assert.equal(r.records.length,2);assert.ok(r.records.every(x=>!x.balanceEvidence));assert.deepEqual(r.records.map(x=>x.bankAccount.maskedIdentifier),['1234','5678']);
});

test('Hangzhou PDF validates high-page-position rows, trimmed dates, sequence and every closing balance',()=>{
 const items=[{x:10,y:820,str:'\u676d\u5dde\u94f6\u884c\u501f\u8bb0\u8d26\u6237\u5386\u53f2\u660e\u7ec6 \u8d77\u6b62\u65f6\u95f4:2026.10.01-2026.10.19 \u8d26\u53f7:6220000000001234 \u6237\u540d:Test\u5e01\u79cd:CNY'}];
 for(const [i,day,amount,balance,description]of [[1,'2026-10-02 ','-10.00','90.00','\u6d88\u8d39'],[2,'2026-10-03','5.00','95.00','\u5229\u606f']])for(const[x,str]of [[20,String(i)],[60,day],[120,amount],[180,balance],[245,description],[355,'6220000000005678'],[470,'Bank']])items.push({x,y:790-i*25,str});
 items.push({x:10,y:20,str:'\u6536\u5165\u5408\u8ba1:5.00 \u652f\u51fa\u5408\u8ba1:10.00'});
 const r=parseHangzhouPdf([{number:1,items}]);assert.deepEqual(r.errors,[]);assert.equal(r.records.length,2);r.records.forEach(validateRecord);assert.equal(r.records[0].date,'2026-10-02');assert.equal(r.records[0].kind,'expense');assert.equal(r.records[1].kind,'income');assert.equal(r.records[1].statementFlow.periodEnd,'2026-10-20');
 const changed=items.map(x=>x.str==='95.00'?{...x,str:'94.00'}:x);assert.equal(parseHangzhouPdf([{number:1,items:changed}]).errors[0].code,'BILL_BANK_BALANCE_CHAIN_INVALID');
});

test('CITIC layout spacer cells cannot turn the card tail into the transaction description',()=>{
 const r=parseCreditBankHtml(html('\u4e2d\u4fe1\u94f6\u884c\u4fe1\u7528\u5361 2026\u5e7410\u670818\u65e5\u8d26\u6237\u53d8\u52a8\u4fe1\u606f',[
 ['','621000****1234','RMB','100.00','50.00','20.00','70.00','3.50'],['','2026-10-08','2026-10-08','1234','\u652f\u4ed8\u5b9d\u8fd8\u6b3e','RMB','-50.00','RMB','-50.00'],['','2026-10-09','2026-10-09','1234','Books','RMB','20.00','RMB','20.00']]));
 assert.deepEqual(r.errors,[]);r.records.forEach(validateRecord);assert.equal(r.records[0].description,'\u652f\u4ed8\u5b9d\u8fd8\u6b3e');assert.equal(r.records[0].kind,'debt_payment');assert.equal(r.records[1].description,'Books');
});

test('BOCOM foreign settlement keeps separate currency accounts and does not count FX funding as consumption',()=>{
 const r=parseCreditBankHtml(html('\u4ea4\u901a\u94f6\u884c',[
 ['521899******1234 \u8d26\u5355\u5468\u671f 2026/09/07-2026/10/06'],['\u4eba\u6c11\u5e01\u8d26\u6237','10.00','0.00','0.00','10.00'],['\u7f8e\u5143\u8d26\u6237','0.00','0.00','2.00','2.00'],['\u8fd8\u6b3e\u3001\u9000\u8d27\u3001\u8d39\u7528\u8fd4\u8fd8\u660e\u7ec6'],['2026/10/06','2026/10/06','\u8d26\u5355\u65e5\u81ea\u52a8\u8d2d\u6c47\u7f8e\u5143\u8fd8\u6b3e','USD 2.00','USD 2.00'],['\u6d88\u8d39\u3001\u53d6\u73b0\u3001\u5176\u4ed6\u8d39\u7528\u660e\u7ec6'],['2026/10/06','2026/10/06','\u8d26\u5355\u65e5\u81ea\u52a8\u8d2d\u6c47\u4eba\u6c11\u5e01\u6263\u6b3e','RMB 10.00','RMB 10.00'],['2026/09/10','2026/09/11','POS Books','VND 1000','USD 2.00']]));
 assert.deepEqual(r.errors,[]);r.records.forEach(validateRecord);assert.equal(r.records[0].currency,'USD');assert.equal(r.records[0].kind,'debt_payment');assert.equal(r.records[1].currency,'CNY');assert.equal(r.records[1].kind,'transfer');assert.equal(r.records[2].amountMinor,'200');assert.equal(r.records[2].currency,'USD');assert.deepEqual(r.records.filter(x=>x.balanceEvidence).map(x=>[x.currency,x.balanceMinor]),[['CNY','-1000'],['USD','0']]);
 const resolutions=r.records.slice(0,2).map(x=>resolveBankAccount({identity:x.bankAccount,accounts:[],owner:['tenant','owner']}));assert.notEqual(resolutions[0].account.id,resolutions[1].account.id);
});

test('SPDB detail export requires declared source, preserves real dates and shares event IDs with PDF',()=>{
 const rows=[['\u4ea4\u6613\u65e5\u671f','\u8bb0\u8d26\u65e5\u671f','\u4ea4\u6613\u6458\u8981','\u5361\u53f7\u672b\u56db\u4f4d','\u5361\u7247\u7c7b\u578b','\u4ea4\u6613\u5e01\u79cd','\u4ea4\u6613\u91d1\u989d'],['20260601','20260602','Books','1234','\u4e3b\u5361','\u4eba\u6c11\u5e01','20.00']];
 assert.equal(parseSpdbDetailRows(rows).errors[0].code,'BILL_BANK_SOURCE_REQUIRED');
 const detail=parseSpdbDetailRows(rows,{provider:'spdb'});assert.deepEqual(detail.errors,[]);detail.records.forEach(validateRecord);assert.equal(detail.records[0].bankStatement.schema,'bank-credit-detail-v1');assert.equal(detail.records[0].bankStatement.statementDate,undefined);assert.equal(detail.records[0].balanceMinor,null);
 const pdf=parseSpdbPdfRows([['202606\u4fe1\u7528\u5361\u8d26\u5355'],['\u60a8\u6d66\u53d1\u4e2a\u4eba\u4fe1\u7528\u5361\u5bf9\u8d26\u5355'],['\u8d26\u5355\u65e5:','24'],['Payment/Credit'],['\uffe5','20.00','\uffe5','0.00','\uffe5','0.00','\uffe5','20.00'],['20260601','20260602','Books','1234','\uffe5','20.00']]);
 assert.deepEqual(pdf.errors,[]);assert.equal(detail.records[0].sourceTransactionId,pdf.records[0].sourceTransactionId);
 const converted=parseSpdbDetailRows([rows[0],['20260601','20260602','\u94f6\u8054\u5206\u671f\u8f6c\u5206\u671f\u4ed8\u6b3e','1234','\u4e3b\u5361','\u4eba\u6c11\u5e01','-20.00']],{provider:'spdb'});converted.records.forEach(validateRecord);assert.equal(converted.records[0].kind,'unknown');assert.equal(converted.records[0].direction,'credit');assert.equal(converted.records[0].bankStatement.nonCash,false);
});

test('legacy CGB summaries retain billed debt evidence without inventing individual income or expenses',()=>{
 const r=parseCreditBankHtml(html('\u5e7f\u53d1\u94f6\u884c\u4fe1\u7528\u5361 \u8d26\u5355\u5468\u671f:2016/09/22 \u81f3 2016/10/21',[
 ['','6225********9755','\u4eba\u6c11\u5e01','100.00','50.00','80.00','30.00']]));
 assert.deepEqual(r.errors,[]);assert.equal(r.records.length,1);r.records.forEach(validateRecord);assert.equal(r.records[0].amountMinor,'0');assert.equal(r.records[0].balanceMinor,'-10000');assert.equal(r.records[0].date,'2016-10-21');assert.equal(r.records[0].balanceEvidence.balanceKind,'billed_debt');assert.ok(r.warnings.some(w=>w.code==='BILL_BANK_SUMMARY_ONLY'));
});
