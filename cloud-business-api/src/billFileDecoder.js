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
function inspectZip(buffer, maxEntries) {
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break; }
  }
  if (end < 0) fail('BILL_ZIP_INVALID','ZIP 中央目录无效');
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || count === 65535 || size === 0xffffffff || start === 0xffffffff) fail('BILL_ZIP_UNSUPPORTED','不支持分卷或 ZIP64，请拆分导出');
  if (count > maxEntries) fail('BILL_ZIP_ENTRY_LIMIT',`ZIP 条目超过 ${maxEntries} 个`);
  if (start + size !== end) fail('BILL_ZIP_INVALID','ZIP 中央目录边界无效');
  let cursor = start, total = 0; const names = new Set();
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) fail('BILL_ZIP_INVALID','ZIP 条目无效');
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10), compressed = buffer.readUInt32LE(cursor + 20), expanded = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32);
    const finish = cursor + 46 + nameLength + extraLength + commentLength;
    if (finish > end) fail('BILL_ZIP_INVALID','ZIP 条目长度无效');
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (!name || /(^\/|^[a-z]:|\\|\x00|(?:^|\/)\.\.(?:\/|$))/i.test(name) || names.has(name)) fail('BILL_ZIP_PATH_INVALID','ZIP 内含不安全或重复路径');
    names.add(name);
    if (flags & 1) fail('BILL_ZIP_ENCRYPTED','ZIP 已加密，请在本地解密后重新导入并人工核验');
    if (![0,8].includes(method)) fail('BILL_ZIP_UNSUPPORTED','ZIP 压缩方式不支持，请使用 STORE/DEFLATE');
    total += expanded;
    if (expanded > LIMITS.entryBytes || total > LIMITS.expandedBytes || (expanded > 1024 * 1024 && expanded / Math.max(compressed,1) > LIMITS.expansionRatio)) fail('BILL_ZIP_EXPANSION_LIMIT','ZIP 解压尺寸或膨胀比例超限，请拆分文件');
    cursor = finish;
  }
  if (cursor !== end) fail('BILL_ZIP_INVALID','ZIP 条目计数与中央目录不一致');
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
async function unpack(buffer, maxEntries, budget) {
  inspectZip(buffer,maxEntries);
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
    if (range.e.r >= LIMITS.rows + 100 || range.e.c >= LIMITS.columns) fail('BILL_WORKSHEET_SIZE_LIMIT','工作表行数或列数超限（最多10000条记录、100行说明、128列）');
    const rows = []; const precisionErrors = [];
    for (let r = 0; r <= range.e.r; r += 1) {
      const row = []; let bad = false;
      for (let c = 0; c <= range.e.c; c += 1) {
        const cell = sheet[XLSX.utils.encode_cell({r,c})]; let value = cell ? cell.v : '';
        if (cell && cell.f) { precisionErrors.push(issue('BILL_EXCEL_FORMULA_REQUIRES_REVIEW',`[${name}] 公式单元格必须先导出为核验后的值`,r + 1)); bad = true; }
        if (cell && cell.t === 'n') {
          // Excel guarantees only 15 significant decimal digits. Reserve two for cents.
          if (!Number.isFinite(value) || Math.abs(value) >= 1e13 || String(value).replace(/[^0-9]/g,'').replace(/^0+/,'').length > 15) { precisionErrors.push(issue('BILL_EXCEL_NUMBER_PRECISION',`[${name}] Excel 数字无法保证原始编号/分精度，请以文本导出交易号和大额金额`,r + 1)); bad = true; }
          else if (cell.z && XLSX.SSF.is_date(cell.z)) {
            const parts = XLSX.SSF.parse_date_code(value,{date1904:!!book.Workbook?.WBProps?.date1904});
            value = parts ? `${parts.y}-${String(parts.m).padStart(2,'0')}-${String(parts.d).padStart(2,'0')} ${String(parts.H).padStart(2,'0')}:${String(parts.M).padStart(2,'0')}:${String(parts.S).padStart(2,'0')}` : '';
          }
        }
        row.push(value);
      }
      // Preserve line positions but do not pretend already-lost Excel precision can be recovered.
      rows.push(bad ? Array(range.e.c + 1).fill('') : row);
    }
    const parsed = parseBillCsv(csvText(rows),{filename,fieldMapping});
    if (precisionErrors.length) parsed.errors = [...precisionErrors,...parsed.errors.filter(error => error.code !== 'BILL_NO_RECORDS')];
    merge(result,parsed,name);
  }
  if (!result.records.length && !result.errors.length) result.errors.push(issue('BILL_NO_RECORDS','工作簿中没有账单记录'));
  return result;
}
async function pdfTable(buffer,filename,fieldMapping) {
  const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({data:new Uint8Array(buffer), isEvalSupported:false, useSystemFonts:false, disableFontFace:true, verbosity:0});
  let document;
  try {
    document = await task.promise;
    if (document.numPages > LIMITS.pdfPages) fail('BILL_PDF_PAGE_LIMIT','PDF 超过100页，请拆分文件');
    const table = []; let textCount = 0;
    for (let p = 1; p <= document.numPages; p += 1) {
      const page = await document.getPage(p), content = await page.getTextContent();
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
    const result = parseBillCsv(csvText(table),{filename,fieldMapping});
    result.warnings.push(issue('BILL_PDF_VERIFY_REQUIRED','PDF 按文本位置重建表格，必须人工核对列对齐、跨页、合计、金额与方向后提交'));
    return result;
  } catch (error) {
    if (error.name === 'PasswordException') fail('BILL_PDF_ENCRYPTED','PDF 已加密，请本地解密并人工核验后重新导入');
    throw error;
  } finally { await task.destroy(); }
}
async function decode(buffer,filename,fieldMapping,budget,depth = 0) {
  const extension = path.extname(filename).toLowerCase();
  if (!SUPPORTED.has(extension)) fail('BILL_FILE_UNSUPPORTED','支持 CSV/TXT、XLS/XLSX、ZIP、文本 PDF、HTML；请先导出支持的格式');
  if (extension === '.zip') {
    if (depth) fail('BILL_ZIP_NESTED_UNSUPPORTED','不支持嵌套 ZIP，请先在本地展开');
    const entries = await unpack(buffer,LIMITS.archiveEntries,budget), result = empty();
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
    if (!html || !/<table[\s>]/i.test(decodeText(buffer))) fail('BILL_HTML_TABLE_MISSING','HTML 中未找到可解析账单表格');
    return spreadsheet(buffer,filename,fieldMapping,budget,true);
  }
  if (['.xls','.xlsx'].includes(extension)) {
    const ole = buffer.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
    const zip = buffer[0] === 0x50 && buffer[1] === 0x4b;
    if (ole && buffer.includes(Buffer.from('EncryptedPackage','utf16le')) && buffer.includes(Buffer.from('EncryptionInfo','utf16le'))) fail('BILL_EXCEL_ENCRYPTED','Excel 已加密，请本地解密并人工核验后重新导入');
    if ((extension === '.xls' && !ole) || (extension === '.xlsx' && !zip)) fail('BILL_FORMAT_MISMATCH','Excel 扩展名与真实文件格式不匹配，请重新导出工作簿');
    return spreadsheet(buffer,filename,fieldMapping,budget);
  }
  if (buffer.includes(0)) fail('BILL_FORMAT_MISMATCH','文本文件包含二进制内容，请选择真实格式');
  return parseBillCsv(decodeText(buffer),{filename,fieldMapping});
}
let activeWorkers = 0;
async function parseBillFile({filename,base64,buffer,fieldMapping} = {}) {
  const result = empty(); let bytes;
  try {
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
        const worker = new Worker(__filename,{workerData:{billDecode:true,bytes,filename,fieldMapping},resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32}});
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
  decode(Buffer.from(workerData.bytes),workerData.filename,workerData.fieldMapping,{total:0}).then(result => parentPort.postMessage(result)).catch(error => {
    const result = empty(); result.errors.push(issue(error.code || 'BILL_FILE_DECODE_FAILED',error.message || '文件解析失败')); parentPort.postMessage(result);
  });
}
module.exports = Object.freeze({parseBillFile,BILL_FILE_LIMITS:LIMITS});
