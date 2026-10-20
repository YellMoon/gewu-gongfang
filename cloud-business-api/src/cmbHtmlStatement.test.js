'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseCmbHtml}=require('./cmbHtmlStatement');
const {parseCmbPdfRows}=require('./cmbStatement');
const {buildFinanceView}=require('../../shared/personal-finance/ledger');
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const tr=r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>';
const detail=(trade,posted,description,amount,tail='8718',original=amount)=>['',trade,posted,description,'\u00a5 '+amount,tail,'CN',original];
function statement(details,{period='2026/09/07-2026/10/06',summary=['100.30','10.80','10.80','100.30','0.00','0.00']}={}){
 return '<html><body><p>\u62db\u5546\u94f6\u884c</p><script>throw new Error("must not execute");</script><table>'+
 tr(['','',''+period,'','\u00a5 63,000.00'])+
 tr(['',...summary.map(v=>'\u00a5 '+v)])+details.map(tr).join('')+'</table></body></html>';
}
const sample=()=>statement([
 detail('','0908','\u638c\u4e0a\u751f\u6d3b\u8fd8\u6b3e','-10.80'),
 detail('0916','0917','Shop A','78.50'),
 detail('0929','0930','Shop B','1.90'),
 detail('0929','0930','Shop C','19.90')
]);
test('CMB HTML preserves credit/debit, dates, card identity and exact billed debt',()=>{
 const p=parseCmbHtml(sample());
 assert.deepEqual(p.errors,[]);assert.equal(p.records.length,5);
 assert.deepEqual(p.records.slice(0,4).map(x=>x.direction),['credit','debit','debit','debit']);
 assert.deepEqual(p.records.slice(0,4).map(x=>x.amountMinor),['1080','7850','190','1990']);
 assert.equal(p.records[0].date,'2026-09-08');assert.equal(p.records[1].date,'2026-09-16');
 assert.equal(p.records[1].rawFields.postedDate,'2026-09-17');
 assert.equal(p.records[4].balanceMinor,'-10030');assert.equal(p.records[4].date,'2026-10-06');
 assert.deepEqual(p.accountIdentity,{provider:'\u62db\u5546\u94f6\u884c',type:'credit_card',maskedIdentifier:'8718',currency:'CNY'});
 assert.equal(parseCmbHtml('<table><tr><td>Unrelated bank</td></tr></table>'),null);
});
test('CMB HTML and PDF emit the same source IDs and statement semantics',()=>{
 const html=parseCmbHtml(sample());
 const pdf=parseCmbPdfRows([
  ['\u62db\u5546\u94f6\u884c\u4fe1\u7528\u5361\u5bf9\u8d26\u5355','2026\u5e7410\u670806\u65e5','TransactionDetails'],
  ['09/08','\u638c\u4e0a\u751f\u6d3b\u8fd8\u6b3e','-10.80','8718','-10.80'],
  ['09/16','09/17','Shop A','78.50','8718','78.50'],
  ['09/29','09/30','Shop B','1.90','8718','1.90'],
  ['09/29','09/30','Shop C','19.90','8718','19.90'],
  ['\u672c\u671f\u5e94\u8fd8\u91d1\u989d','\u4e0a\u671f\u8d26\u5355\u91d1\u989d'],
  ['\u00a5 100.30','\u00a5 10.80','\u00a5 10.80','\u00a5 100.30','\u00a5 0.00','\u00a5 0.00']
 ]);
 assert.deepEqual(pdf.errors,[]);assert.deepEqual(html.records,pdf.records);
 const account={id:'cmb-test',label:'CMB test',provider:'\u62db\u5546\u94f6\u884c',type:'credit_card',maskedIdentifier:'8718',currency:'CNY',openingBalanceMinor:null,openingDate:null,status:'active'};
 const observe=(records,source)=>records.map((r,i)=>({...r,id:source+i,financialAccountId:account.id,provider:'cmb',importId:source}));
 const ledger={accounts:[account],observations:observe(pdf.records,'pdf'),links:[],balanceSnapshots:[],imports:[],legacyRecords:[],revision:0};
 const before=buildFinanceView(ledger),after=buildFinanceView({...ledger,observations:[...ledger.observations,...observe(html.records,'html')]});
 assert.equal(after.transactions.length,before.transactions.length);
 assert.deepEqual(after.currencyTotals,before.currencyTotals);
 for(const k of ['cashInMinor','cashOutMinor','consumptionMinor','incomeMinor','balanceMinor'])assert.equal(after.accountStats[account.id][k],before.accountStats[account.id][k]);
});
test('CMB rejects missing or corrupted rows, compensating total errors, mixed cards and unsupported currency atomically',()=>{
 for(const html of [
  sample().replace('<td>\u00a5 1.90</td>','<td>\u00a5 1.91</td>'),
  sample().replace('<td>\u00a5 100.30</td>','<td>\u00a5 100.31</td>'),
  sample().replace('<td>\u00a5 1.90</td><td>8718</td>','<td>invalid</td><td>8718</td>'),
  sample().replace('<td>\u00a5 1.90</td><td>8718</td>','<td>\u00a5 1.90</td><td>1234</td>'),
  sample().replace('<td>\u00a5 1.90</td>','<td>USD 1.90</td>'),
  sample().replace('<td>0917</td>','<td>1007</td>'),
  sample().replace('<td>0916</td>','<td>0931</td>'),
  // Alter debit and refund subtotals equally: net-only validation would miss this.
  statement([detail('0916','0917','Shop','10.00'),detail('0916','0917','Refund','-10.00')],{summary:['0.00','0.00','0.00','0.00','0.00','0.00']})
 ]){
  const p=parseCmbHtml(html);assert.ok(p.errors.length);assert.deepEqual(p.records,[]);
 }
});
test('CMB refuses summary/image-only mail and preserves duplicate same-day amounts and overpayments',()=>{
 const imageOnly='<p>\u62db\u5546\u94f6\u884c</p><img src="https://example.invalid/image">';
 assert.equal(parseCmbHtml(imageOnly).errors[0].code,'BILL_BANK_DETAIL_UNAVAILABLE');
 const p=parseCmbHtml(statement([detail('0916','0917','Same shop','2.00'),detail('0916','0917','Same shop','2.00')],{summary:['-6.00','-10.00','0.00','4.00','0.00','0.00']}));
 assert.deepEqual(p.errors,[]);assert.notEqual(p.records[0].sourceTransactionId,p.records[1].sourceTransactionId);
 assert.equal(p.records[2].balanceMinor,'600');
 const year=parseCmbHtml(statement([detail('1230','0102','Year boundary','1.00')],{period:'2025/12/07-2026/01/06',summary:['1.00','0.00','0.00','1.00','0.00','0.00']}));
 assert.deepEqual(year.errors,[]);assert.equal(year.records[0].date,'2025-12-30');assert.equal(year.records[0].rawFields.postedDate,'2026-01-02');
});
