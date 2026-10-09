'use strict';
// Every generated file in this suite is a SYNTHETIC fixture, not a bank certification.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const iconv = require('iconv-lite');
const PDFDocument = require('pdfkit');
const { parseBillFile } = require('./billFileDecoder');
const csv = '交易日期,收入金额,支出金额,摘要\n2026-10-01,0.00,1.25,消费';
const canonical = 'date,type,amount,category,note\n2026-10-01,expense,1.25,test,synthetic';
const file = (filename, buffer) => ({ filename, base64: Buffer.from(buffer).toString('base64') });
function workbook(type, rows = [['date','type','amount','category','note'],['2026-10-01','expense','1.25','test','synthetic']]) {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'synthetic');
  return XLSX.write(book, { type: 'buffer', bookType: type });
}
async function pdf({ scanned = false, encrypted = false } = {}) {
  const doc = new PDFDocument({ margin: 0, ...(encrypted ? { userPassword: 'secret', ownerPassword: 'owner' } : {}) });
  const chunks = []; const done = new Promise(resolve => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); });
  if (!scanned) {
    [['date','type','amount','category','note'],['2026-10-01','expense','1.25','test','synthetic']].forEach((row, index) => row.forEach((cell, col) => doc.fontSize(10).text(cell, 20 + col * 110, 40 + index * 22, { lineBreak: false })));
  } else doc.image(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),20,40,{width:100,height:100});
  doc.end(); return done;
}
test('UTF8/BOM and GB18030 text decode with original-byte hash', async () => {
  for (const buffer of [Buffer.from(csv), Buffer.from('\uFEFF' + csv), iconv.encode(csv, 'gb18030')]) {
    const r = await parseBillFile(file('synthetic.csv', buffer));
    assert.equal(r.errors.length, 0);
    assert.equal(r.records[0].amountMinor, '125');
    assert.equal(r.fileHash, crypto.createHash('sha256').update(buffer).digest('hex'));
  }
});
test('binary XLS and XLSX are actual workbooks, not CSV', async () => {
  for (const type of ['xls','xlsx']) {
    const r = await parseBillFile(file('synthetic.' + type, workbook(type)));
    assert.equal(r.errors.length, 0);
    assert.equal(r.records[0].description, 'synthetic');
  }
  const impostor = await parseBillFile(file('not-excel.xlsx', canonical));
  assert.equal(impostor.errors[0].code, 'BILL_FORMAT_MISMATCH');
});
test('HTML table preserves amounts and explicit mapping', async () => {
  const html = '<html><table><tr><th>posted</th><th>value</th><th>memo</th></tr><tr><td>2026-10-01</td><td>-0.29</td><td>商品&amp;说明</td></tr></table></html>';
  const r = await parseBillFile({ ...file('synthetic.html', html), fieldMapping: { date:'posted', amount:'value', description:'memo', amountConvention:'signed' } });
  assert.equal(r.records[0].amountMinor, '29');
  assert.equal(r.records[0].description, '商品&说明');
});
test('ZIP extracts multiple real supported files and reports unsupported entries', async () => {
  const zip = new JSZip(); zip.file('a.csv', canonical); zip.file('b.xlsx', workbook('xlsx')); zip.file('readme.exe','unsupported');
  const r = await parseBillFile(file('synthetic.zip', await zip.generateAsync({ type:'nodebuffer' })));
  assert.equal(r.records.length, 2);
  assert.equal(r.errors[0].code, 'BILL_ZIP_ENTRY_UNSUPPORTED');
});
test('ZIP compressed expansion and entry count limits block resource abuse', async () => {
  const zip = new JSZip(); zip.file('large.csv', 'x'.repeat(2 * 1024 * 1024));
  const bomb = await parseBillFile(file('bomb.zip', await zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE' })));
  assert.equal(bomb.errors[0].code, 'BILL_ZIP_EXPANSION_LIMIT');
  const many = new JSZip(); for (let i = 0; i < 33; i++) many.file(i + '.csv', canonical);
  assert.equal((await parseBillFile(file('many.zip', await many.generateAsync({ type:'nodebuffer' })))).errors[0].code, 'BILL_ZIP_ENTRY_LIMIT');
});
test('PDF text table decodes while scanned/encrypted PDFs require human verification', async () => {
  const text = await parseBillFile(file('synthetic.pdf', await pdf()));
  assert.deepEqual(text.errors, [], 'synthetic text PDF must decode without errors');
  assert.equal(text.records.length, 1, 'synthetic PDF has exactly one transaction');
  assert.equal(text.records[0].amountMinor, '125');
  assert.ok(text.warnings.some(w => w.code === 'BILL_PDF_VERIFY_REQUIRED'));
  const scanned = await parseBillFile(file('scanned.pdf', await pdf({scanned:true})));
  assert.equal(scanned.errors[0].code, 'BILL_PDF_SCAN_REQUIRES_REVIEW');
  const encrypted = await parseBillFile(file('encrypted.pdf', await pdf({encrypted:true})));
  assert.equal(encrypted.errors[0].code, 'BILL_PDF_ENCRYPTED');
});
test('malformed base64, empty file, over-size and unsafe ZIP path are diagnosed', async () => {
  assert.equal((await parseBillFile({filename:'a.csv',base64:'%%%'})).errors[0].code, 'BILL_BASE64_INVALID');
  assert.equal((await parseBillFile(file('a.csv',''))).errors[0].code, 'BILL_FILE_EMPTY');
  assert.equal((await parseBillFile(file('large.csv', Buffer.alloc(10 * 1024 * 1024 + 1)))).errors[0].code, 'BILL_FILE_SIZE_LIMIT');
  const zip = new JSZip(); zip.file('../unsafe.csv', canonical);
  assert.equal((await parseBillFile(file('unsafe.zip', await zip.generateAsync({type:'nodebuffer'})))).errors[0].code, 'BILL_ZIP_PATH_INVALID');
});
test('Excel numeric identifiers cannot claim precision already lost; fractional cents are rejected', async () => {
  const r = await parseBillFile(file('numeric.xlsx', workbook('xlsx', [['date','type','amount','sourceTransactionId'],['2026-10-01','expense',1.001,90071992547409920]])));
  assert.ok(r.errors.some(e => e.code === 'BILL_EXCEL_NUMBER_PRECISION'));
  assert.equal(r.records.length, 0);
});
test('buffer contract and Excel original decimals do not use rounded cell display', async () => {
  const plain = await parseBillFile({filename:'a.csv',buffer:Buffer.from(canonical)});
  assert.equal(plain.records[0].amountMinor,'125');
  const book = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet([['date','type','amount'],['2026-10-01','expense',1.001]]);
  sheet.C2.z = '0.00'; XLSX.utils.book_append_sheet(book,sheet,'synthetic');
  const precision = await parseBillFile({filename:'a.xlsx',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});
  assert.equal(precision.records.length,0);
  assert.equal(precision.errors[0].code,'BILL_AMOUNT_INVALID');
});
test('workbook sheet, row and column limits are explicit', async () => {
  const book = XLSX.utils.book_new(); for (let i = 0; i < 11; i++) XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['date','type','amount']]),'s' + i);
  assert.equal((await parseBillFile(file('many.xlsx',XLSX.write(book,{type:'buffer',bookType:'xlsx'})))).errors[0].code,'BILL_WORKSHEET_LIMIT');
  for (const ref of ['A1:C10101','A1:DY2']) {
    const bad = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet([['date','type','amount'],['2026-10-01','expense',1]]); sheet['!ref'] = ref; XLSX.utils.book_append_sheet(bad,sheet,'synthetic');
    assert.equal((await parseBillFile(file('oversize.xlsx',XLSX.write(bad,{type:'buffer',bookType:'xlsx'})))).errors[0].code,'BILL_WORKSHEET_SIZE_LIMIT');
  }
});
test('actual inflation is bounded even when ZIP central directory lies about sizes', async () => {
  const zip = new JSZip(); zip.file('large.csv','x'.repeat(21 * 1024 * 1024));
  const data = await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  const central = data.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])); data.writeUInt32LE(10,central + 24);
  assert.equal((await parseBillFile(file('lying.zip',data))).errors[0].code,'BILL_ZIP_EXPANSION_LIMIT');
});
test('nested ZIP returns a clear review diagnostic', async () => {
  const inner = new JSZip(); inner.file('a.csv',canonical);
  const outer = new JSZip(); outer.file('nested.zip',await inner.generateAsync({type:'nodebuffer'}));
  assert.equal((await parseBillFile(file('nested.zip',await outer.generateAsync({type:'nodebuffer'})))).errors[0].code,'BILL_ZIP_NESTED_UNSUPPORTED');
});
test('encrypted Office container requests local decryption and human review', async () => {
  const encrypted = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(encrypted,'EncryptionInfo',Buffer.alloc(20)); XLSX.CFB.utils.cfb_add(encrypted,'EncryptedPackage',Buffer.alloc(20));
  const r = await parseBillFile(file('encrypted.xls',XLSX.CFB.write(encrypted,{type:'buffer'})));
  assert.equal(r.errors[0].code,'BILL_EXCEL_ENCRYPTED');
});
test('Excel numeric money cannot pretend to have cent precision at huge magnitude', async () => {
  const r = await parseBillFile(file('huge-money.xlsx',workbook('xlsx',[['date','type','amount'],['2026-10-01','income',100000000000000]])));
  assert.equal(r.records.length,0);
  assert.equal(r.errors[0].code,'BILL_EXCEL_NUMBER_PRECISION');
});
