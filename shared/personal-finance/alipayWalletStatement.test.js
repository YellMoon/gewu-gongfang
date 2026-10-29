'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseAlipayWalletBalanceRows,ALIPAY_WALLET_BALANCE_HEADER:HEADER}=require('./alipayWalletStatement');
const {parseBillCsv}=require('./billCsv');
const {validateRecord}=require('./ledger');
const bank='\u6c5f\u82cf\u94f6\u884c',ali='\u652f\u4ed8\u5b9d';
function rows(){return[
 ['201803050000000002','2018-03-05 12:00:02','\u5728\u7ebf\u652f\u4ed8','','-10.00','100.00',ali,''],
 ['201803050000000002','2018-03-05 12:00:02','\u8f6c\u8d26','10.00','','110.00',ali,''],
 ['201803050000000001','2018-03-05 12:00:01','\u5145\u503c\u5230\u4f59\u989d','100.00','','100.00',bank,'']
];}
test('wallet cash rows preserve both clearing legs without another consumption or income',()=>{
 const original=rows(),before=JSON.stringify(original),parsed=parseAlipayWalletBalanceRows(original);
 assert.deepEqual(parsed.errors,[]);assert.equal(parsed.records.length,3);assert.equal(JSON.stringify(original),before);
 assert.equal(parsed.records[0].balanceEvidence.openingBeforeFirstMinor,'0');assert.equal(parsed.records[1].relatedReference,parsed.records[2].relatedReference);
 assert.notEqual(parsed.records[1].sourceTransactionId,parsed.records[2].sourceTransactionId);
 for(const row of parsed.records){validateRecord(row);assert.equal(row.amountMinor,'0');assert.equal(row.kind,'transfer');}
 assert.equal(parsed.records[0].rawFields['\u8d44\u91d1\u6e20\u9053'],bank);
});
test('the exact wallet CSV layout enters the production bill parser',()=>{
 const content=[HEADER,...rows()].map(r=>r.map(v=>'"'+v.replace(/"/g,'""')+'"').join(',')).join('\n');
 const parsed=parseBillCsv(content,{filename:'alipay-wallet.csv'});
 assert.equal(parsed.templateId,'alipay-wallet-balance-table-v1');assert.equal(parsed.records.length,3);assert.deepEqual(parsed.errors,[]);
 assert.notEqual(parseBillCsv(content,{filename:'other.csv'}).templateId,parsed.templateId);
});
test('invalid balances, ordering, dates, signs and precision reject the whole statement',()=>{
 for(const change of[
  r=>r[0][5]='99.00',r=>r[0][4]='10.00',r=>r[0][3]='1.00',r=>r[1][3]='10.001',
  r=>r[1][1]='2018-02-30 12:00:02',r=>r[0][6]='',r=>r.push([...r[0].slice(0,2),'Different original description',...r[0].slice(3)]),r=>r.reverse(),
 ]){const sample=rows();change(sample);const parsed=parseAlipayWalletBalanceRows(sample);assert.equal(parsed.records.length,0);assert.equal(parsed.errors[0].code,'BILL_WALLET_BALANCE_INVALID');}
});
test('identical repeated native rows are retained once with source positions and a warning, while the cash chain remains mandatory',()=>{
 const sample=rows(),raw=[...sample.slice(0,2).map(r=>[...r]),...sample],before=JSON.stringify(raw),parsed=parseAlipayWalletBalanceRows(raw);
 assert.deepEqual(parsed.errors,[]);assert.equal(parsed.records.length,3);assert.equal(parsed.normalization.sourceRowCount,5);assert.equal(parsed.normalization.canonicalRowCount,3);assert.equal(parsed.normalization.exactDuplicateRowCount,2);assert(parsed.warnings.some(w=>w.code==='BILL_EXACT_DUPLICATE_BALANCE_ROWS'&&w.count===2));assert.deepEqual(parsed.records[2].rawFields.sourceTableRowNumbers,[1,3]);assert.equal(JSON.stringify(raw),before);
 const broken=[...raw.map(r=>[...r])];broken.at(-1)[5]='99.99';assert.equal(parseAlipayWalletBalanceRows(broken).records.length,0);
});
test('opaque dotted native cash references preserve the full original identifier without accepting URLs or paths',()=>{
 const sample=rows(),ref='1472723038980-2847-10.55.249.12-1092882740';sample[0][0]=ref;sample[1][0]=ref;const parsed=parseAlipayWalletBalanceRows(sample);assert.deepEqual(parsed.errors,[]);assert.equal(parsed.records[1].relatedReference,ref);assert.equal(parsed.records[2].relatedReference,ref);for(const r of parsed.records)validateRecord(r);
 for(const value of ['https://example.test/entry','../secret']){const invalid=rows();invalid[0][0]=value;assert.equal(parseAlipayWalletBalanceRows(invalid).records.length,0);}
});
