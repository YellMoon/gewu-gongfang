'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),XLSX=require('xlsx'),{parseBillFile}=require('./billFileDecoder'),{validateRecord}=require('../../shared/personal-finance/ledger');
function book({fractional=false,badDate=false}={}){
 const h=Array(16).fill('');for(const [c,s]of [[2,'\u5165\u8d26\u65e5\u671f'],[12,'\u5b9e\u6536\u91d1\u989d'],[13,'\u7f34\u8d39\u65b9\u5f0f'],[14,'\u624b\u7eed\u8d39']])h[c]=s;
 const row=(date,gross,fee,method='\u5fae\u4fe1')=>{const r=Array(16).fill('');r[2]=date;r[12]=gross;r[13]=method;r[14]=fee;return r;},rows=[h,row(badDate?'2019-2-30':'2019-1-2',1875,1.875),row('2019-1-2',1875,1.875),row('2019-1-2',100000,100,'\u652f\u4ed8\u5b9d'),row('2019-1-2',0,null)];if(fractional)rows.push(row('2019-1-3',1875,1.875));
 const b=XLSX.utils.book_new(),s=XLSX.utils.aoa_to_sheet(rows);s.M2.f='1+1';s.IV2={t:'s',v:'Unrelated formatting'};s['!ref']='A1:IV'+rows.length;XLSX.utils.book_append_sheet(b,s,'\u5b66\u8d39\u6536\u5165');for(let i=0;i<15;i++)XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([['Unrelated sheet'],['Not personal cashflow']]),'other'+i);return XLSX.write(b,{type:'buffer',bookType:'xlsm'});
}
const fieldMapping={evidenceRole:'wechat_withdrawal_fees',ownerConfirmedActualFees:true};
test('bounded macro-workbook evidence reads one selected sheet and cached values without posting tuition as personal income',async()=>{
 const p=await parseBillFile({filename:'synthetic.xlsm',buffer:book(),fieldMapping});assert.deepEqual(p.errors,[]);assert.equal(p.records.length,1);assert.equal(p.provider,'wechat');const r=p.records[0];validateRecord(r);assert.equal(r.amountMinor,'0');assert.equal(r.date,'2019-01-02');assert.equal(r.withdrawalFeeEvidence.grossMinor,'375000');assert.equal(r.withdrawalFeeEvidence.feeMinor,'375');assert.deepEqual(r.withdrawalFeeEvidence.rawFeeValues,['1.875','1.875']);assert.deepEqual(r.withdrawalFeeEvidence.sourceRows,[2,3]);assert.equal(r.kind,'transfer');
});
test('fractional-day fees retain their original precision while malformed dates block the import',async()=>{
 const p=await parseBillFile({filename:'synthetic.xlsm',buffer:book({fractional:true}),fieldMapping});assert.deepEqual(p.errors,[]);assert.equal(p.records[1].withdrawalFeeEvidence.feeMinor,null);assert(p.warnings.some(e=>e.code==='BILL_WITHDRAWAL_FEE_PRECISION_UNRESOLVED'));p.records.forEach(validateRecord);
 const bad=await parseBillFile({filename:'synthetic.xlsm',buffer:book({badDate:true}),fieldMapping});assert(bad.errors.some(e=>e.code==='BILL_WITHDRAWAL_FEE_ROW_UNAVAILABLE'));
});
test('the evidence role and actual-fee owner confirmation are required before reading a macro workbook',async()=>{
 for(const mapping of [undefined,{evidenceRole:'wechat_withdrawal_fees'}]){const p=await parseBillFile({filename:'synthetic.xlsm',buffer:book(),fieldMapping:mapping});assert.equal(p.records.length,0);assert(p.errors.some(e=>/BILL_WITHDRAWAL_FEE_(ROLE|CONFIRMATION)_REQUIRED/.test(e.code)));}
});
test('the same workbook can separately supply Alipay evidence without confusing its fees with WeChat',async()=>{
 const p=await parseBillFile({filename:'synthetic.xlsm',buffer:book(),fieldMapping:{evidenceRole:'alipay_withdrawal_fees',ownerConfirmedActualFees:true}});assert.deepEqual(p.errors,[]);assert.equal(p.provider,'alipay');assert.equal(p.records.length,1);assert.equal(p.records[0].withdrawalFeeEvidence.platform,'alipay');assert.equal(p.records[0].withdrawalFeeEvidence.feeMinor,'10000');assert.deepEqual(p.records[0].withdrawalFeeEvidence.sourceRows,[4]);p.records.forEach(validateRecord);
});
test('an explicitly zero fee is preserved while an empty fee or missing date is never silently treated as free',async()=>{
 const h=Array(16).fill('');for(const [c,s]of [[2,'\u5165\u8d26\u65e5\u671f'],[12,'\u5b9e\u6536\u91d1\u989d'],[13,'\u7f34\u8d39\u65b9\u5f0f'],[14,'\u624b\u7eed\u8d39']])h[c]=s;const r=(date,fee)=>{const a=Array(16).fill('');a[2]=date;a[12]=100;a[13]='\u652f\u4ed8\u5b9d';a[14]=fee;return a;},w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([h,r('2019-1-1',0),r('2019-1-2',null),r('\u65e0',0)]),'\u5b66\u8d39\u6536\u5165');const p=await parseBillFile({filename:'synthetic.xlsm',buffer:XLSX.write(w,{type:'buffer',bookType:'xlsm'}),fieldMapping:{evidenceRole:'alipay_withdrawal_fees',ownerConfirmedActualFees:true}});assert.deepEqual(p.errors,[]);assert.deepEqual(p.records.map(o=>o.withdrawalFeeEvidence.feeMinor),['0',null]);assert(p.warnings.some(w=>w.code==='BILL_WITHDRAWAL_FEE_DATE_UNAVAILABLE'));
});

test('owner-confirmed blank fees mean zero only for the selected workbook evidence, with original precision and blanks preserved',async()=>{
 const h=Array(16).fill('');for(const [c,s]of [[2,'\u5165\u8d26\u65e5\u671f'],[12,'\u5b9e\u6536\u91d1\u989d'],[13,'\u7f34\u8d39\u65b9\u5f0f'],[14,'\u624b\u7eed\u8d39']])h[c]=s;
 const row=(date,fee)=>{const r=Array(16).fill('');r[2]=date;r[12]=100;r[13]='\u652f\u4ed8\u5b9d';r[14]=fee;return r;},w=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([h,row('2019-1-1',null),row('2019-1-1','  '),row('2019-1-2','unknown'),row('2019-1-3',1.875),row('2019-1-3',null)]),'\u5b66\u8d39\u6536\u5165');
 const buffer=XLSX.write(w,{type:'buffer',bookType:'xlsm'}),mapping={evidenceRole:'alipay_withdrawal_fees',ownerConfirmedActualFees:true};
 const normal=await parseBillFile({filename:'synthetic.xlsm',buffer,fieldMapping:mapping});assert.deepEqual(normal.records.map(o=>o.withdrawalFeeEvidence.feeMinor),[null,null,null]);
 const p=await parseBillFile({filename:'synthetic.xlsm',buffer,fieldMapping:{...mapping,ownerConfirmedBlankFeesZero:true}});assert.deepEqual(p.errors,[]);p.records.forEach(validateRecord);assert.deepEqual(p.records.map(o=>o.withdrawalFeeEvidence.feeMinor),['0',null,null]);
 const e=p.records[0].withdrawalFeeEvidence;assert.equal(e.blankFeeInterpretation,'owner_confirmed_zero');assert.deepEqual(e.rawFeeValues,[null,'  ']);assert.equal(p.records[1].withdrawalFeeEvidence.blankFeeInterpretation,undefined);assert.deepEqual(p.records[2].withdrawalFeeEvidence.rawFeeValues,['1.875',null]);
 assert.throws(()=>validateRecord({...p.records[0],withdrawalFeeEvidence:{...e,blankFeeInterpretation:'assumed'}}),/EVIDENCE_INVALID/);
 const missingConfirmation=await parseBillFile({filename:'synthetic.xlsm',buffer,fieldMapping:{evidenceRole:'alipay_withdrawal_fees',ownerConfirmedBlankFeesZero:true}});assert.equal(missingConfirmation.records.length,0);
});
