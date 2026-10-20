'use strict';
// Synthetic statement rows and PDFs; no customer originals are checked in.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),PDFDocument=require('pdfkit');
const {parseCibPdfRows}=require('./cibStatement'),{parseBillFile}=require('./billFileDecoder'),{validateRecord,buildFinanceView}=require('../../shared/personal-finance/ledger');
const period=(month,summary,transactions)=>[
 ['\u5174\u4e1a\u94f6\u884c\u4fe1\u7528\u5361\u5bf9\u8d26\u5355'],['Industrial Bank Credit Card Statement'],
 ['\u8d26\u5355\u65e5','STATEMENT DATE','2026\u5e74'+month+'\u670825\u65e5'],['\u672c\u671f\u5e94\u8fd8\u6b3e\u603b\u989d','NEW BALANCE','RMB '+summary[0]],
 ['New Balance','=','Previous Balance','-','Payment & Credit','+','new_activity','+','Adjustment','+','Finance Charge'],summary,
 ['****','\u4e3b\u5361','\u4ea4\u6613\uff08\u5361\u53f7\u672b\u56db\u4f4d','8547','\uff09****'],['\u4eba\u6c11\u5e01 RMB'],...transactions,['*******END*******'],
];
const january=()=>period('01',['100.00','0.00','0.00','100.00','0.00','0.00'],[['2026-01-02 12:30','2026-01-03','merchant','100.00']]);
const february=()=>period('02',['50.00','100.00','100.00','50.00','0.00','0.00'],[['2026-02-01','2026-02-01','\u8f6c\u8d26','-100.00'],['2026-02-02','2026-02-02','merchant','50.00']]);
test('combined monthly statements reconcile each period and preserve bank identity and printed transaction time',()=>{
 const rows=[...january(),['\u7b2c 1 \u9875 / \u5171','1 \u9875'],...february()],before=JSON.stringify(rows),r=parseCibPdfRows(rows);
 assert.deepEqual(r.errors,[]);assert.equal(r.records.length,5);assert.equal(r.accountIdentity.provider,'\u5174\u4e1a\u94f6\u884c');assert.equal(r.accountIdentity.maskedIdentifier,'8547');r.records.forEach(validateRecord);
 assert.equal(r.records[0].date,'2026-01-02');assert.equal(r.records[0].rawFields.sourceTradeDateTime,'2026-01-02 12:30');assert.equal(r.records[0].bankStatement.postedDate,'2026-01-03');
 assert.equal(r.records.find(o=>o.description==='\u8f6c\u8d26').kind,'debt_payment');assert.equal(r.records.filter(o=>o.balanceEvidence).length,2);assert.equal(JSON.stringify(rows),before);
});
test('a bad later period rejects the entire file, and identity/date/currency ambiguities fail closed',()=>{
 const corrupt=february();corrupt[5]=['50.01','100.00','100.00','50.00','0.00','0.00'];
 for(const rows of [[...january(),...corrupt],[...january(),...january()],january().map(r=>r.map(v=>v==='2026-01-02 12:30'?'2026-01-02 25:80':v)),[...january(),['\u7f8e\u5143\u8d26\u6237 USD Account']],january().map(r=>r.map(v=>v==='8547'?'missing':v))]){
  const r=parseCibPdfRows(rows);assert.ok(r.errors.length);assert.equal(r.records.length,0);assert.equal(r.accountIdentity,undefined);
 }
 assert.equal(parseCibPdfRows([['unrelated PDF']]),null);
});
test('installment principal and refinancing remain visible without counting the same purchase twice',()=>{
 const r=parseCibPdfRows(period('01',['100.86','0.00','300.00','400.86','0.00','0.00'],[['2026-01-02','2026-01-02','merchant','300.00'],['2026-01-02','2026-01-02','merchant \u8f6c\u5206\u671f\u4ed8\u6b3e','-300.00'],['2026-01-25','2026-01-25','merchant\u7b2c1\u671f\u51713\u671f','100.00'],['2026-01-25','2026-01-25','\u5206\u671f\u4ed8\u6b3e\u624b\u7eed\u8d39\u7b2c1\u671f\u51713\u671f','0.86']]));assert.deepEqual(r.errors,[]);
 const observations=r.records.map((o,i)=>({...o,id:'o'+i,financialAccountId:'card'})),v=buildFinanceView({accounts:[{id:'card',...r.accountIdentity,status:'active',label:'CIB',openingBalanceMinor:null}],observations});
 assert.equal(r.records.filter(o=>o.bankStatement?.nonCash).length,2);assert.equal(r.records.find(o=>o.kind==='fee').amountMinor,'86');assert.equal(v.currencyTotals.CNY.consumptionMinor,'30086');assert.equal(v.transactions.length,4);
});
test('the real isolated PDF decoder routes combined CIB statements to the validated bank parser',async()=>{
 const doc=new PDFDocument({size:[2400,1800],margin:0}),chunks=[],done=new Promise(resolve=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));});
 doc.font(path.resolve(__dirname,'../../backend/assets/fonts/NotoSansCJKsc-Regular.otf')).fontSize(10);
 for(const [index,rows]of [january(),february()].entries()){if(index)doc.addPage();rows.forEach((r,i)=>r.forEach((text,c)=>doc.text(text,20+c*180,30+i*25,{lineBreak:false})));}doc.end();
 const buffer=await done,r=await parseBillFile({filename:'synthetic-cib.pdf',base64:buffer.toString('base64')});assert.deepEqual(r.errors,[]);assert.equal(r.provider,'cib');assert.equal(r.records.length,5);assert.equal(r.accountIdentity.maskedIdentifier,'8547');
});
