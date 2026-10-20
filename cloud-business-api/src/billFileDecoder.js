'use strict';
const { createHash } = require('node:crypto');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const { parseBillCsv } = require('../../shared/personal-finance/billCsv');

const LIMITS = Object.freeze({ fileBytes: 10 * 1024 * 1024, expandedBytes: 32 * 1024 * 1024, entryBytes: 20 * 1024 * 1024,
  archiveEntries: 32, workbookEntries: 256, expansionRatio: 200, sheets: 10, rows: 10000, columns: 128, pdfPages: 100, timeoutMs: 20000 });
const SUPPORTED = new Set(['.csv','.txt','.xls','.xlsx','.zip','.pdf','.html','.htm']);
function issue(code, message, line = 1) { return { line, code, message }; }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function empty(fileHash = null) { return { provider:'unknown', templateId:null, records:[], errors:[], warnings:[], fileHash }; }
function csvText(rows) { return rows.map(row => row.map(value => `"${String(value == null ? '' : value).replace(/"/g,'""')}"`).join(',')).join('\n'); }
function decodeText(buffer) {
  const iconv = require('iconv-lite');
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return iconv.decode(buffer,'utf16-le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return iconv.decode(buffer,'utf16-be');
  try { return new TextDecoder('utf-8', { fatal:true }).decode(buffer); }
  catch (_) {
    const source = iconv.decode(buffer, 'gb18030');
    if (source.includes('\uFFFD') || !iconv.encode(source,'gb18030').equals(buffer)) fail('BILL_ENCODING_INVALID','文件既不是有效 UTF-8，也不是可无损解码的 GB18030，请重新导出文本');
    return source;
  }
}
// Read the central directory before invoking any decompressor, including workbook readers.
function inspectZip(buffer, maxEntries, password) {
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break; }
  }
  if (end < 0) fail('BILL_ZIP_INVALID','ZIP 中央目录无效');
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || count === 65535 || size === 0xffffffff || start === 0xffffffff) fail('BILL_ZIP_UNSUPPORTED','不支持分卷或 ZIP64，请拆分导出');
  if (count > maxEntries) fail('BILL_ZIP_ENTRY_LIMIT',`ZIP 条目超过 ${maxEntries} 个`);
  if (start + size !== end) fail('BILL_ZIP_INVALID','ZIP 中央目录边界无效');
  let cursor = start, total = 0, encrypted = false; const names = new Set();
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) fail('BILL_ZIP_INVALID','ZIP 条目无效');
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10), compressed = buffer.readUInt32LE(cursor + 20), expanded = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32);
    const finish = cursor + 46 + nameLength + extraLength + commentLength;
    if (finish > end) fail('BILL_ZIP_INVALID','ZIP 条目长度无效');
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (!name || /(^\/|^[a-z]:|\\|\x00|(?:^|\/)\.\.(?:\/|$))/i.test(name) || names.has(name)) fail('BILL_ZIP_PATH_INVALID','ZIP 内含不安全或重复路径');
    names.add(name);
    if (flags & 1) { encrypted = true; if (!password) fail('BILL_ZIP_ENCRYPTED','请输入这份账单的解压密码'); }
    if (![0,8].includes(method) && !(flags & 1 && method === 99)) fail('BILL_ZIP_UNSUPPORTED','ZIP 压缩方式不支持，请使用 STORE/DEFLATE');
    total += expanded;
    if (expanded > LIMITS.entryBytes || total > LIMITS.expandedBytes || (expanded > 1024 * 1024 && expanded / Math.max(compressed,1) > LIMITS.expansionRatio)) fail('BILL_ZIP_EXPANSION_LIMIT','ZIP 解压尺寸或膨胀比例超限，请拆分文件');
    cursor = finish;
  }
  if (cursor !== end) fail('BILL_ZIP_INVALID','ZIP 条目计数与中央目录不一致');
  return encrypted;
}
async function boundedEntry(entry, budget) {
  return new Promise((resolve, reject) => {
    const chunks = []; let length = 0;
    const stream = entry.internalStream('nodebuffer');
    stream.on('data', chunk => {
      length += chunk.length;
      if (length > LIMITS.entryBytes || budget.total + length > LIMITS.expandedBytes) { stream.pause(); reject(Object.assign(new Error('实际 ZIP 解压尺寸超限'), {code:'BILL_ZIP_EXPANSION_LIMIT'})); return; }
      chunks.push(chunk);
    }).on('error', reject).on('end', () => { budget.total += length; resolve(Buffer.concat(chunks)); }).resume();
  });
}
async function unpack(buffer, maxEntries, budget, password) {
  const encrypted = inspectZip(buffer,maxEntries,password);
  if (encrypted) {
    const { ZipReader, Uint8ArrayReader } = await import('@zip.js/zip.js');
    const reader = new ZipReader(new Uint8ArrayReader(buffer), { useWebWorkers:false });
    try {
      const entries = [], names = new Set();
      for (const entry of await reader.getEntries()) {
        if (entry.directory) continue;
        const name = entry.filename;
        if (!name || /(^\/|^[a-z]:|\\|\x00|(?:^|\/)\.\.(?:\/|$))/i.test(name) || names.has(name)) fail('BILL_ZIP_PATH_INVALID','ZIP 路径无效');
        names.add(name); const chunks = []; let length = 0;
        await entry.getData(new WritableStream({ write(chunk) {
          length += chunk.length;
          if (length > LIMITS.entryBytes || budget.total + length > LIMITS.expandedBytes) fail('BILL_ZIP_EXPANSION_LIMIT','ZIP 实际解压尺寸超限');
          chunks.push(Buffer.from(chunk));
        } }), { password, checkCrc32:true, useWebWorkers:false });
        budget.total += length; entries.push({name,buffer:Buffer.concat(chunks,length)});
      }
      return entries;
    } catch (error) {
      if (/password|signature|crc/i.test(error.message || '') && !error.code) fail('BILL_ZIP_PASSWORD_INVALID','解压密码不正确或文件已损坏，请核对这份文件的密码');
      throw error;
    } finally { await reader.close(); }
  }
  const zip = await require('jszip').loadAsync(buffer);
  const entries = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) fail('BILL_ZIP_PATH_INVALID','ZIP 条目路径被安全清理，拒绝导入');
    entries.push({name:entry.name,buffer:await boundedEntry(entry,budget)});
  }
  return entries;
}
function merge(target, source, label) {
  if (target.records.length + source.records.length > LIMITS.rows) fail('BILL_ROW_LIMIT','文件合计超过10000行交易，请拆分文件');
  if (target.provider === 'unknown') { target.provider = source.provider; target.templateId = source.templateId; }
  else if (source.provider !== target.provider) { target.provider = 'mixed'; target.templateId = 'mixed-files-v1'; }
  if(source.accountIdentity){if(target.accountIdentity&&JSON.stringify(target.accountIdentity)!==JSON.stringify(source.accountIdentity))fail('BILL_ACCOUNT_MIXED','Multiple statement accounts in one file');target.accountIdentity=source.accountIdentity;}
  target.records.push(...source.records);
  for (const key of ['errors','warnings']) target[key].push(...source[key].map(item => ({...item,message:label ? `[${label}] ${item.message}` : item.message})));
}
async function spreadsheet(buffer, filename, fieldMapping, budget, html = false) {
  const XLSX = require('xlsx');
  let data = buffer;
  if (!html && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const entries = await unpack(buffer,LIMITS.workbookEntries,budget);
    if (!entries.some(entry => entry.name === 'xl/workbook.xml')) fail('BILL_FORMAT_MISMATCH','文件不是 XLSX 工作簿');
    // Rebuild a STORE archive after bounded inflation, preventing forged ZIP lengths from reaching SheetJS.
    const safe = new (require('jszip'))(); for (const entry of entries) safe.file(entry.name,entry.buffer);
    data = await safe.generateAsync({type:'nodebuffer',compression:'STORE'});
  }
  let book;
  try { book = XLSX.read(html ? decodeText(data) : data, { type:html ? 'string' : 'buffer', raw:true, cellDates:false, cellNF:true, cellHTML:false, sheetRows:LIMITS.rows + 102, WTF:false }); }
  catch (error) {
    if (/password|encrypt|FilePass/i.test(error.message)) fail('BILL_EXCEL_ENCRYPTED','Excel 已加密，请本地解密并人工核验后重新导入');
    throw error;
  }
  if (book.SheetNames.length > LIMITS.sheets) fail('BILL_WORKSHEET_LIMIT','工作表超过10个，请拆分文件');
  const result = empty();
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name]; if (!sheet['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
    // Some bank exports retain a template dimension (row 11) while storing hundreds
    // of cells below it. Derive the actual range from parsed cells before iterating.
    for(const address of Object.keys(sheet)){if(address.startsWith('!'))continue;const cell=XLSX.utils.decode_cell(address);range.e.r=Math.max(range.e.r,cell.r);range.e.c=Math.max(range.e.c,cell.c);}
    if (range.e.r >= LIMITS.rows + 100 || range.e.c >= LIMITS.columns) fail('BILL_WORKSHEET_SIZE_LIMIT','工作表行数或列数超限（最多10000条记录、100行说明、128列）');
    const rows = []; const precisionErrors = [];
    for (let r = 0; r <= range.e.r; r += 1) {
      const row = []; let bad = false;
      for (let c = 0; c <= range.e.c; c += 1) {
        const cell = sheet[XLSX.utils.encode_cell({r,c})]; let value = cell ? cell.v : '';
        if (cell && cell.f) { precisionErrors.push(issue('BILL_EXCEL_FORMULA_REQUIRES_REVIEW',`[${name}] 公式单元格必须先导出为核验后的值`,r + 1)); bad = true; }
        if (cell && cell.t === 'n') {
          // Excel guarantees only 15 significant decimal digits. Reserve two for cents.
          if (Number.isFinite(value) && cell.z && XLSX.SSF.is_date(cell.z)) {
            const parts = XLSX.SSF.parse_date_code(value,{date1904:!!book.Workbook?.WBProps?.date1904});
            value = parts ? `${parts.y}-${String(parts.m).padStart(2,'0')}-${String(parts.d).padStart(2,'0')} ${String(parts.H).padStart(2,'0')}:${String(parts.M).padStart(2,'0')}:${String(parts.S).padStart(2,'0')}` : '';
          } else if (!Number.isFinite(value) || Math.abs(value) >= 1e13 || String(value).replace(/[^0-9]/g,'').replace(/^0+/,'').length > 15) { precisionErrors.push(issue('BILL_EXCEL_NUMBER_PRECISION',`[${name}] Excel 数字无法保证原始编号/分精度，请以文本导出交易号和大额金额`,r + 1)); bad = true; }
        }
        row.push(value);
      }
      // Preserve line positions but do not pretend already-lost Excel precision can be recovered.
      rows.push(bad ? Array(range.e.c + 1).fill('') : row);
    }
    // Add support for validated CCB debit account spreadsheets before generic CSV mapping.
    const parsed = require('./spdbStatement').parseSpdbDetailRows(rows,fieldMapping)||require('./mybankStatement').parseMybankRows(rows)||require('./huaxiaStatement').parseHuaxiaRows(rows)||require('./ccbDebitStatement').parseCcbDebitRows(rows)||parseBillCsv(csvText(rows),{filename,fieldMapping});
    if (precisionErrors.length) parsed.errors = [...precisionErrors,...parsed.errors.filter(error => error.code !== 'BILL_NO_RECORDS')];
    merge(result,parsed,name);
  }
  if (!result.records.length && !result.errors.length) result.errors.push(issue('BILL_NO_RECORDS','工作簿中没有账单记录'));
  return result;
}
const isAntFundCover=text=>text.includes('蚂蚁(杭州)基金销售有限公司')&&text.includes('基金(含资产管理计划)交易明细');
async function pdfTable(buffer,filename,fieldMapping) {
  const {getDocument,OPS} = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfRoot=path.dirname(require.resolve('pdfjs-dist/package.json'));
  const task = getDocument({data:new Uint8Array(buffer), cMapUrl:path.join(pdfRoot,'cmaps')+'/',cMapPacked:true,standardFontDataUrl:path.join(pdfRoot,'standard_fonts')+'/',isEvalSupported:false, useSystemFonts:false, disableFontFace:true, verbosity:0});
  let document;
  try {
    document = await task.promise;
    if (document.numPages > LIMITS.pdfPages) fail('BILL_PDF_PAGE_LIMIT','PDF 超过100页，请拆分文件');
    const table = [],fundPages=[]; let textCount = 0,fundCandidate=false,balanceCandidate=false,yuebaoCandidate=false,mybankCandidate=false,certificateCandidate=false,hangzhouCandidate=false,debitBankCandidate=false;
    for (let p = 1; p <= document.numPages; p += 1) {
      const page = await document.getPage(p), content = await page.getTextContent();
      const pageText=content.items.map(item=>item.str||'').join('').normalize('NFKC').replace(/\s/g,'');
      if(p===1&&(/\u6c5f\u82cf\u94f6\u884c\u4ea4\u6613\u660e\u7ec6|\u4e2d\u56fd\u90ae\u653f\u50a8\u84c4\u94f6\u884c\u501f\u8bb0\u8d26\u6237\u5386\u53f2\u660e\u7ec6/.test(pageText)))debitBankCandidate=true;
      if(p===1&&pageText.includes('\u676d\u5dde\u94f6\u884c\u501f\u8bb0\u8d26\u6237\u5386\u53f2\u660e\u7ec6'))hangzhouCandidate=true;
      if(p===1&&isAntFundCover(pageText))fundCandidate=true;
      if(p===1&&pageText.includes('\u4f59\u5229\u5b9d\u8d44\u91d1\u660e\u7ec6')&&pageText.includes('\u4ea4\u6613\u8d26\u53f7'))mybankCandidate=true;
      if(p===1&&pageText.includes('\u4f59\u989d\u5b9d\u8d44\u4ea7\u67e5\u8be2\u60c5\u51b5\u544a\u77e5\u4e66'))certificateCandidate=true;
      if(p===1&&pageText.includes('\u4f59\u989d\u5b9d\u6d41\u6c34\u660e\u7ec6\u67e5\u8be2')&&pageText.includes('\u4f59\u989d\u5b9d\u53ef\u7528\u4f59\u989d'))yuebaoCandidate=true;
      if(p===1&&pageText.includes('\u652f\u4ed8\u5b9d\u6536\u652f\u660e\u7ec6\u8bc1\u660e')&&pageText.includes('\u8d26\u6237\u4f59\u989d'))balanceCandidate=true;
      if(fundCandidate||balanceCandidate||yuebaoCandidate||mybankCandidate||certificateCandidate||hangzhouCandidate||debitBankCandidate){const operators=await page.getOperatorList();fundPages.push({number:p,items:content.items.filter(item=>typeof item.str==='string').map(item=>({str:item.str,x:item.transform[4],y:item.transform[5],width:item.width})),bounds:operators.fnArray.flatMap((fn,i)=>fn===OPS.constructPath&&(Array.isArray(operators.argsArray[i]?.[2])||ArrayBuffer.isView(operators.argsArray[i]?.[2]))?[Array.from(operators.argsArray[i][2])]:[])});}
      const lines = [];
      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        textCount += item.str.length;
        if (textCount > LIMITS.entryBytes) fail('BILL_PDF_TEXT_LIMIT','PDF 文本量超限');
        const y = item.transform[5]; let line = lines.find(row => Math.abs(row.y - y) < 2);
        if (!line) { line = {y,items:[]}; lines.push(line); }
        line.items.push({x:item.transform[4],text:item.str});
      }
      lines.sort((a,b) => b.y - a.y);
      for (const line of lines) { line.items.sort((a,b) => a.x - b.x); table.push(line.items.map(item => item.text)); }
      page.cleanup();
    }
    if (!textCount) fail('BILL_PDF_SCAN_REQUIRES_REVIEW','PDF 无可提取文字，可能是扫描件；请人工核验或导出 CSV/Excel，不能自动入账');
    if(debitBankCandidate)return require('./debitBankPdf').parseDebitBankPdf(fundPages);
    if(hangzhouCandidate)return require('./hangzhouStatement').parseHangzhouPdf(fundPages);
    if(mybankCandidate)return require('./mybankStatement').parseMybankFundPdf(fundPages);
    if(certificateCandidate)return require('./yuebaoCertificate').parseYuebaoCertificate(fundPages);
    if(fundCandidate)return require('./antFundPdf').parseAntFundPdf(fundPages);
    if(balanceCandidate)return require('./alipayBalancePdf').parseAlipayBalancePdf(fundPages);
    if(yuebaoCandidate)return require('./yuebaoBalancePdf').parseYuebaoBalancePdf(fundPages);
    const creditStatement=require('./cibStatement').parseCibPdfRows(table)||require('./spdbStatement').parseSpdbPdfRows(table)||require('./cmbStatement').parseCmbPdfRows(table);if(creditStatement)return creditStatement;
    const result = parseBillCsv(csvText(table),{filename,fieldMapping});
    result.warnings.push(issue('BILL_PDF_VERIFY_REQUIRED','PDF 按文本位置重建表格，必须人工核对列对齐、跨页、合计、金额与方向后提交'));
    return result;
  } catch (error) {
    if (error.name === 'PasswordException') fail('BILL_PDF_ENCRYPTED','PDF 已加密，请本地解密并人工核验后重新导入');
    throw error;
  } finally { await task.destroy(); }
}
async function decode(buffer,filename,fieldMapping,budget,depth = 0,password) {
  const extension = path.extname(filename).toLowerCase();
  if (!SUPPORTED.has(extension)) fail('BILL_FILE_UNSUPPORTED','支持 CSV/TXT、XLS/XLSX、ZIP、文本 PDF、HTML；请先导出支持的格式');
  if (extension === '.zip') {
    if (depth) fail('BILL_ZIP_NESTED_UNSUPPORTED','不支持嵌套 ZIP，请先在本地展开');
    const entries = await unpack(buffer,LIMITS.archiveEntries,budget,password), result = empty();
    for (const entry of entries) {
      if (!SUPPORTED.has(path.extname(entry.name).toLowerCase())) { result.errors.push(issue('BILL_ZIP_ENTRY_UNSUPPORTED',`[${entry.name}] ZIP 内含不支持的文件`)); continue; }
      try { merge(result,await decode(entry.buffer,entry.name,fieldMapping,budget,depth + 1),entry.name); }
      catch (error) { result.errors.push(issue(error.code || 'BILL_FILE_DECODE_FAILED',`[${entry.name}] ${error.message}`)); }
    }
    if (!entries.length) result.errors.push(issue('BILL_ZIP_EMPTY','ZIP 内没有文件'));
    return result;
  }
  if (extension === '.pdf') {
    if (!buffer.subarray(0,5).equals(Buffer.from('%PDF-'))) fail('BILL_FORMAT_MISMATCH','文件不是有效 PDF');
    return pdfTable(buffer,filename,fieldMapping);
  }
  const html = /^\s*(?:<!doctype\s+html|<html|<table)/i.test(buffer.subarray(0,4096).toString('utf8'));
  if (['.html','.htm'].includes(extension) || (extension === '.xls' && html)) {
    const sourceHtml=decodeText(buffer),statement=require('./minshengStatement').parseMinshengHtml(sourceHtml)||require('./creditBankStatements').parseCreditBankHtml(sourceHtml)||require('./cmbHtmlStatement').parseCmbHtml(sourceHtml);if(statement)return statement;
    if (!html || !/<table[\s>]/i.test(decodeText(buffer))) fail('BILL_HTML_TABLE_MISSING','HTML 中未找到可解析账单表格');
    return spreadsheet(buffer,filename,fieldMapping,budget,true);
  }
  if (['.xls','.xlsx'].includes(extension)) {
    const ole = buffer.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
    const zip = buffer[0] === 0x50 && buffer[1] === 0x4b;
    if (ole && buffer.includes(Buffer.from('EncryptedPackage','utf16le')) && buffer.includes(Buffer.from('EncryptionInfo','utf16le'))) {
      if(!password)fail('BILL_EXCEL_ENCRYPTED','\u8bf7\u8f93\u5165\u8fd9\u4efd Excel \u8d26\u5355\u7684\u6253\u5f00\u5bc6\u7801');
      let decrypted;
      try { decrypted=await require('officecrypto-tool').decrypt(buffer,{password}); }
      catch { fail('BILL_EXCEL_PASSWORD_INVALID','\u5bc6\u7801\u4e0d\u6b63\u786e\u6216\u52a0\u5bc6\u683c\u5f0f\u4e0d\u652f\u6301\uff0c\u8bf7\u6838\u5bf9\u8fd9\u4efd\u6587\u4ef6\u7684\u6253\u5f00\u5bc6\u7801'); }
      if(decrypted.length>LIMITS.fileBytes)fail('BILL_FILE_SIZE_LIMIT','Decrypted workbook exceeds the file size limit');
      if(decrypted[0]!==0x50||decrypted[1]!==0x4b)fail('BILL_FORMAT_MISMATCH','Decrypted file is not an XLSX workbook');
      return spreadsheet(decrypted,filename.replace(/\.xls$/i,'.xlsx'),fieldMapping,budget);
    }
    if ((extension === '.xls' && !ole) || (extension === '.xlsx' && !zip)) fail('BILL_FORMAT_MISMATCH','Excel 扩展名与真实文件格式不匹配，请重新导出工作簿');
    return spreadsheet(buffer,filename,fieldMapping,budget);
  }
  if (buffer.includes(0)) fail('BILL_FORMAT_MISMATCH','文本文件包含二进制内容，请选择真实格式');
  return parseBillCsv(decodeText(buffer),{filename,fieldMapping});
}
let activeWorkers = 0;
async function parseBillFile({filename,base64,buffer,fieldMapping,password} = {}) {
  const result = empty(); let bytes;
  try {
    if (password !== undefined && (typeof password !== 'string' || password.length > 256)) fail('BILL_PASSWORD_INVALID','解压密码格式无效');
    if (typeof filename !== 'string' || !filename || filename.length > 512) fail('BILL_FILENAME_INVALID','文件名无效');
    if (buffer !== undefined) {
      if (base64 !== undefined || !(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array)) fail('BILL_BUFFER_INVALID','请提供一个 Buffer/Uint8Array 或 base64 来源');
      if (buffer.length > LIMITS.fileBytes) fail('BILL_FILE_SIZE_LIMIT','账单文件超过10 MiB，请拆分文件');
      bytes = Buffer.from(buffer);
    } else {
      if (typeof base64 !== 'string') fail('BILL_BASE64_INVALID','文件 base64 编码无效');
      if (base64.length > Math.ceil(LIMITS.fileBytes / 3) * 4) fail('BILL_FILE_SIZE_LIMIT','账单文件超过10 MiB，请拆分文件');
      if (base64.length % 4 || /[^A-Za-z0-9+/=]/.test(base64) || /=/.test(base64.slice(0,-2))) fail('BILL_BASE64_INVALID','文件 base64 编码无效');
      bytes = Buffer.from(base64,'base64');
      if (bytes.toString('base64') !== base64) fail('BILL_BASE64_INVALID','文件 base64 编码不规范');
    }
    if (!bytes.length) fail('BILL_FILE_EMPTY','账单文件为空');
    if (bytes.length > LIMITS.fileBytes) fail('BILL_FILE_SIZE_LIMIT','账单文件超过10 MiB，请拆分文件');
    result.fileHash = createHash('sha256').update(bytes).digest('hex');
    if (activeWorkers >= 2) fail('BILL_DECODER_BUSY','正在解析其他账单，请稍后重试');
    activeWorkers += 1;
    try {
      const parsed = await new Promise((resolve,reject) => {
        let settled = false;
        const worker = new Worker(__filename,{workerData:{billDecode:true,bytes,filename,fieldMapping,password},resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32}});
        const timer = setTimeout(() => { settled = true; worker.terminate(); reject(Object.assign(new Error('解析超时，请拆分文件或人工核验'),{code:'BILL_DECODE_TIMEOUT'})); },LIMITS.timeoutMs);
        worker.once('message',message => { settled = true; clearTimeout(timer); worker.terminate(); resolve(message); });
        worker.once('error',error => { settled = true; clearTimeout(timer); reject(error); });
        worker.once('exit',() => { clearTimeout(timer); if (!settled) reject(Object.assign(new Error('解析进程资源超限或异常退出'),{code:'BILL_DECODE_RESOURCE_LIMIT'})); });
      });
      return {...parsed,fileHash:result.fileHash};
    } finally { activeWorkers -= 1; }
  } catch (error) { result.errors.push(issue(error.code || 'BILL_FILE_DECODE_FAILED',error.message || '文件解析失败')); return result; }
}
if (!isMainThread && workerData?.billDecode) {
  decode(Buffer.from(workerData.bytes),workerData.filename,workerData.fieldMapping,{total:0},0,workerData.password).then(result => parentPort.postMessage(result)).catch(error => {
    const result = empty(); result.errors.push(issue(error.code || 'BILL_FILE_DECODE_FAILED',error.message || '文件解析失败')); parentPort.postMessage(result);
  });
}
module.exports = Object.freeze({parseBillFile,BILL_FILE_LIMITS:LIMITS});
