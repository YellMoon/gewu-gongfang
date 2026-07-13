const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dns = require('dns');
const net = require('net');
const { AlignmentType, Document, ImageRun, Packer, Paragraph, SectionType, Table, TableCell, TableRow, TextRun, WidthType } = require('docx');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
const { initQuestionBankStore, resolveQuestionAssetPath } = require('./questionBankStorageService');
const { latexToEqField, latexToMathml, renderLatexSvg, resolveFormulaMode } = require('./formulaExportService');

const LABELS = {
  defaultTitle: '\u7ec3\u4e60\u8bd5\u5377', subject: '\u79d1\u76ee\uff1a', count: '\u9898\u76ee\u6570\uff1a',
  answer: '\u7b54\u6848\uff1a', analysis: '\u89e3\u6790\uff1a', option: '\u9009\u9879', sub: '\u5c0f\u9898',
};
const DEFAULT_TEMPLATE_PATH = path.join(__dirname, '..', '..', 'resources', 'paper', 'default-paper-template.docx');
const CHOICE_TYPES = new Set(['\u5355\u9009\u9898', '\u591a\u9009\u9898', 'single-choice', 'multiple-choice', 'single', 'multiple']);

function isPrivateNetworkAddress(value) {
  const address = String(value || '').toLowerCase().split('%')[0];
  if (net.isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
      || octets[0] >= 224;
  }
  if (net.isIP(address) === 6) {
    if (address === '::' || address === '::1' || address.startsWith('fe8') || address.startsWith('fe9') || address.startsWith('fea') || address.startsWith('feb') || address.startsWith('fc') || address.startsWith('fd')) return true;
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateNetworkAddress(mapped[1]);
    const parts = address.split(':');
    const marker = parts.length - 3;
    if (marker >= 0 && parts[marker] === 'ffff' && parts.slice(0, marker).every(part => !part || /^0+$/.test(part))) {
      const high = Number.parseInt(parts[marker + 1], 16);
      const low = Number.parseInt(parts[marker + 2], 16);
      if (Number.isInteger(high) && Number.isInteger(low)) {
        return isPrivateNetworkAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
      }
    }
    return false;
  }
  return false;
}

function normalizeBackendQuestionType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (['\u9009\u62e9\u9898', '\u5355\u9009', '\u5355\u9009\u9898', 'single', 'single-choice', 'choice'].includes(type)) return '\u5355\u9009\u9898';
  if (['\u591a\u9009', '\u591a\u9009\u9898', 'multi', 'multiple', 'multiple-choice'].includes(type)) return '\u591a\u9009\u9898';
  if (['\u5b9e\u9a8c', '\u5b9e\u9a8c\u9898', 'experiment'].includes(type)) return '\u5b9e\u9a8c\u9898';
  if (['\u5224\u65ad', '\u5224\u65ad\u9898', 'judge'].includes(type)) return '\u5224\u65ad\u9898';
  if (['\u586b\u7a7a\u9898', '\u7b80\u7b54\u9898', '\u4f5c\u56fe\u9898', '\u8ba1\u7b97\u9898', '\u95ee\u7b54\u9898', '\u89e3\u7b54\u9898', 'calculation', 'problem', 'fill', 'short', 'drawing'].includes(type)) return '\u89e3\u7b54\u9898';
  return '\u89e3\u7b54\u9898';
}

function normalizeAnswerPosition(value, includeAnswers) {
  if (includeAnswers === false || value === 'hidden') return 'hidden';
  if (['after-each', 'inline', 'after-question'].includes(value)) return 'after-each';
  return 'end';
}

function safeFileName(value) { return String(value || 'paper').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'paper'; }
function escapeXml(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function stripHtml(value) { return String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' '); }
function exportRoot(options = {}) { const root = options.root || process.env.QUESTION_BANK_ROOT || path.join(process.cwd(), 'data', 'GewuQuestionBank'); initQuestionBankStore(root, { deviceId: options.deviceId || process.env.GEWU_DEVICE_ID || 'unknown' }); return root; }
function artifactUrl(fileName, options = {}) { const base = (options.hostBaseUrl || process.env.GEWU_HOST_BASE_URL || '').replace(/\/+$/, ''); const part = `/api/cloud-relay-host/artifacts/${encodeURIComponent(fileName)}`; return base ? `${base}${part}` : part; }

function legacySegments(value) {
  const source = stripHtml(value);
  const rows = []; let cursor = 0; const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g; let match;
  while ((match = pattern.exec(source))) { if (match.index > cursor) rows.push({ type: 'text', text: source.slice(cursor, match.index) }); rows.push({ type: 'formula', latex: match[1] || match[2], display: Boolean(match[1]) }); cursor = pattern.lastIndex; }
  if (cursor < source.length) rows.push({ type: 'text', text: source.slice(cursor) });
  return rows.length ? rows : [{ type: 'text', text: source }];
}

function documentSegments(documentNode) {
  const result = [];
  const visit = node => {
    if (!node) return;
    if (node.type === 'text') result.push({ type: 'text', text: String(node.text || ''), marks: node.marks || [] });
    else if (node.type === 'formula') result.push({ type: 'formula', latex: String(node.attrs?.canonicalLatex || ''), display: node.attrs?.displayMode === 'block' });
    else if (node.type === 'image' && (node.attrs?.assetKey || node.attrs?.asset_key || node.attrs?.src)) result.push({ type: 'image', assetKey: node.attrs.assetKey || node.attrs.asset_key || '', src: node.attrs.src || '', width: Number(node.attrs.width || 320), required: true });
    else if (node.type === 'hardBreak') result.push({ type: 'text', text: '\n' });
    else { (node.content || []).forEach(visit); if (['paragraph', 'heading', 'listItem'].includes(node.type)) result.push({ type: 'text', text: '\n' }); }
  };
  visit(documentNode);
  if (result.at(-1)?.type === 'text') result[result.length - 1].text = result.at(-1).text.replace(/\n$/, '');
  return result;
}

function normalizedQuestion(question = {}, index = 0) {
  const rich = question.rich_content?.type === 'question-document' ? question.rich_content.sections : null;
  const options = rich?.options || (question.options || []).map((item, optionIndex) => ({ label: item.label || String.fromCharCode(65 + optionIndex), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: typeof item === 'string' ? item : item.content || item.text || '' }] }] } }));
  const richStem = rich ? documentSegments(rich.stem) : legacySegments(question.stem || question.content || question.title || '');
  const assetImages = (Array.isArray(question.assets) ? question.assets : [])
    .filter(asset => String(asset.mime_type || asset.mimeType || '').startsWith('image/') && (asset.assetKey || asset.asset_key || asset.oss_key || asset.oss_url || asset.url || asset.data_url))
    .map(asset => ({ type: 'image', assetKey: asset.assetKey || asset.asset_key || asset.oss_key || '', src: asset.oss_url || asset.url || asset.data_url || '', width: Number(asset.width || 320), required: true }));
  return {
    number: index + 1,
    stem: [...richStem, ...(richStem.some(segment => segment.type === 'image') ? [] : assetImages)],
    options: options.map(item => ({ label: item.label || '', content: documentSegments(item.content) })),
    subs: (rich?.subQuestions || []).map(item => ({ label: item.label || '', content: documentSegments(item.content), answer: documentSegments(item.answer) })),
    answer: rich ? documentSegments(rich.answer) : legacySegments(question.answer || ''),
    analysis: rich ? documentSegments(rich.analysis) : legacySegments(question.explanation || question.analysis || ''),
    type: normalizeBackendQuestionType(question.type || question.question_type || ''),
    knowledge: legacySegments((Array.isArray(question.knowledge_points) ? question.knowledge_points
      : Array.isArray(question.knowledge_point_names) ? question.knowledge_point_names
        : question.knowledge_point ? [question.knowledge_point] : []).join('\u3001')),
    assets: Array.isArray(question.assets) ? question.assets : [],
  };
}

function pythonExecutable() {
  const candidates = [process.env.GEWU_PYTHON, path.join(process.cwd(), 'runtime', 'python', 'python.exe'), process.resourcesPath && path.join(process.resourcesPath, 'runtime', 'python', 'python.exe'), 'python'].filter(Boolean);
  return candidates.find(candidate => candidate === 'python' || fs.existsSync(candidate));
}

function mathmlRowsToOmml(mathmlRows) {
  if (!mathmlRows.length) return [];
  const script = path.join(process.cwd(), 'modules', 'question-bank', 'exporters', 'mathml_to_omml.py');
  const result = spawnSync(pythonExecutable(), [script], { input: JSON.stringify(mathmlRows), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 30000 });
  if (result.status !== 0) return mathmlRows.map(() => null);
  try { const parsed = JSON.parse(result.stdout); return Array.isArray(parsed.rows) ? parsed.rows : mathmlRows.map(() => null); } catch (_error) { return mathmlRows.map(() => null); }
}

function normalizeDocxPackage(filePath) {
  const script = path.join(process.cwd(), 'modules', 'question-bank', 'exporters', 'normalize_docx.py');
  const normalized = `${filePath}.normalized.docx`;
  const result = spawnSync(pythonExecutable(), [script, filePath, normalized], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.status !== 0 || !fs.existsSync(normalized)) throw new Error(`DOCX formula package normalization failed: ${result.stderr || result.status}`);
  fs.rmSync(filePath, { force: true });
  fs.renameSync(normalized, filePath);
}

function formulaRows(questions) {
  const rows = [];
  const scan = segments => segments.forEach(segment => { if (segment.type === 'formula' && segment.latex) { segment.formulaIndex = rows.length; rows.push(segment); } });
  questions.forEach(question => { scan(question.stem); question.options.forEach(item => scan(item.content)); question.subs.forEach(item => { scan(item.content); scan(item.answer); }); scan(question.answer); scan(question.knowledge); scan(question.analysis); });
  return rows;
}

async function prepareFormulaRows(rows, preferredMode) {
  const mode = resolveFormulaMode(preferredMode);
  const omml = ['word-native', 'eq-field'].includes(mode) ? mathmlRowsToOmml(rows.map(row => latexToMathml(row.latex))) : rows.map(() => null);
  return Promise.all(rows.map(async (row, index) => {
    const rendered = renderLatexSvg(row.latex, row.display);
    const png = await sharp(Buffer.from(rendered.svg)).resize(rendered.width * 4, rendered.height * 4, { fit: 'fill' }).png().toBuffer();
    const native = omml[index];
    const effectiveMode = mode === 'mathtype-compatible' ? 'mathtype-compatible' : (native ? mode : 'latex-vector');
    return { ...row, ...rendered, png, omml: native, effectiveMode, fallbackUsed: !native && mode !== 'latex-vector' && mode !== 'mathtype-compatible' };
  }));
}

function textRun(segment) {
  const marks = segment.marks || [];
  const mark = type => marks.some(item => item.type === type);
  const style = marks.find(item => item.type === 'textStyle')?.attrs || {};
  return new TextRun({ text: segment.text, font: style.fontFamily || 'SimSun', size: style.fontSize ? Math.round(parseFloat(style.fontSize) * 1.5) : 22, bold: mark('bold'), italics: mark('italic'), underline: mark('underline') ? {} : undefined, strike: mark('strike') });
}

function resolvedImageBytes(resolved, maxBytes) {
  if (!resolved) return null;
  if (resolved.bytes || resolved.data) return Buffer.from(resolved.bytes || resolved.data);
  if (!resolved.path) return Buffer.alloc(0);
  const filePath = path.resolve(String(resolved.path));
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    const error = new Error('IMAGE_LOCAL_PATH_INVALID'); error.code = 'IMAGE_LOCAL_PATH_INVALID'; throw error;
  }
  if (stat.size > maxBytes) {
    const error = new Error('IMAGE_TOO_LARGE'); error.code = 'IMAGE_TOO_LARGE'; throw error;
  }
  return fs.readFileSync(filePath);
}

async function resolveImageSegments(questions, options = {}) {
  const maxBytes = Number(options.imageMaxBytes || 8 * 1024 * 1024);
  const timeoutMs = Number(options.imageTimeoutMs || 10000);
  const allowedOrigins = new Set(options.allowedImageOrigins || []);
  const segments = [];
  questions.forEach(question => {
    segments.push(...question.stem);
    question.options.forEach(option => segments.push(...option.content));
    question.subs.forEach(sub => segments.push(...sub.content, ...sub.answer));
    segments.push(...question.answer, ...question.analysis);
  });
  for (const segment of segments.filter(item => item.type === 'image')) {
    let bytes; let contentType = '';
    const source = String(segment.assetKey || segment.src || '');
    const dataMatch = String(segment.src || '').match(/^data:(image\/(?:png|jpe?g|gif));base64,(.+)$/i);
    if (dataMatch) {
      if (dataMatch[2].length > Math.ceil(maxBytes / 3) * 4 + 4) { const error = new Error('IMAGE_TOO_LARGE'); error.code = 'IMAGE_TOO_LARGE'; throw error; }
      contentType = dataMatch[1].toLowerCase(); bytes = Buffer.from(dataMatch[2], 'base64');
    }
    else {
      let resolved = null;
      if (segment.assetKey && typeof options.resolveImageAsset === 'function') resolved = await options.resolveImageAsset(segment.assetKey, { root: options.root, maxBytes });
      if (resolved) { bytes = resolvedImageBytes(resolved, maxBytes); contentType = String(resolved.contentType || resolved.mimeType || '').toLowerCase(); }
    }
    if (!bytes && /^https?:\/\//i.test(segment.src || '')) {
      const url = new URL(segment.src);
      if (!allowedOrigins.has(url.origin)) { const error = new Error('IMAGE_ORIGIN_NOT_ALLOWED'); error.code = 'IMAGE_ORIGIN_NOT_ALLOWED'; throw error; }
      if (typeof options.fetchImage !== 'function') { const error = new Error('IMAGE_FETCH_UNAVAILABLE'); error.code = 'IMAGE_FETCH_UNAVAILABLE'; throw error; }
      if (isPrivateNetworkAddress(url.hostname.replace(/^\[|\]$/g, ''))) { const error = new Error('IMAGE_HOST_NOT_ALLOWED'); error.code = 'IMAGE_HOST_NOT_ALLOWED'; throw error; }
      const resolver = options.resolveHostname || (options.fetchImage === globalThis.fetch ? async hostname => dns.promises.lookup(hostname, { all: true }) : null);
      if (!resolver) { const error = new Error('IMAGE_HOST_RESOLVER_REQUIRED'); error.code = 'IMAGE_HOST_RESOLVER_REQUIRED'; throw error; }
      const addresses = await resolver(url.hostname);
      const rows = Array.isArray(addresses) ? addresses : [addresses];
      if (!rows.length || rows.some(row => isPrivateNetworkAddress(row.address || row))) { const error = new Error('IMAGE_HOST_NOT_ALLOWED'); error.code = 'IMAGE_HOST_NOT_ALLOWED'; throw error; }
      let timer; const controller = new AbortController();
      try {
        const result = await Promise.race([
          options.fetchImage(url.toString(), { timeoutMs, maxBytes, signal: controller.signal, redirect: 'manual' }),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); const error = new Error('IMAGE_FETCH_TIMEOUT'); error.code = 'IMAGE_FETCH_TIMEOUT'; reject(error); }, timeoutMs); }),
        ]);
        if (Number(result?.status) >= 300 && Number(result?.status) < 400) { controller.abort(); const error = new Error('IMAGE_REDIRECT_NOT_ALLOWED'); error.code = 'IMAGE_REDIRECT_NOT_ALLOWED'; throw error; }
        if (result?.url && !allowedOrigins.has(new URL(result.url).origin)) { controller.abort(); const error = new Error('IMAGE_REDIRECT_ORIGIN_NOT_ALLOWED'); error.code = 'IMAGE_REDIRECT_ORIGIN_NOT_ALLOWED'; throw error; }
        contentType = String(result?.headers?.get?.('content-type') || result?.contentType || result?.mimeType || '').split(';')[0].toLowerCase();
        const rawContentLength = result?.headers?.get?.('content-length');
        const contentLength = rawContentLength === null || rawContentLength === undefined || rawContentLength === '' ? Number.NaN : Number(rawContentLength);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) { controller.abort(); const error = new Error('IMAGE_TOO_LARGE'); error.code = 'IMAGE_TOO_LARGE'; throw error; }
        if (result?.body?.getReader) {
          const reader = result.body.getReader(); const parts = []; let total = 0;
          while (true) { const row = await reader.read(); if (row.done) break; total += row.value.byteLength; if (total > maxBytes) { controller.abort(); const error = new Error('IMAGE_TOO_LARGE'); error.code = 'IMAGE_TOO_LARGE'; throw error; } parts.push(Buffer.from(row.value)); }
          bytes = Buffer.concat(parts);
        } else if (typeof result?.arrayBuffer === 'function') {
          const error = new Error('IMAGE_STREAM_REQUIRED'); error.code = 'IMAGE_STREAM_REQUIRED'; throw error;
        }
        else bytes = Buffer.from(result?.bytes || result?.data || []);
      } finally { if (timer) clearTimeout(timer); }
    } else if (!bytes) {
      const resolved = typeof options.resolveImageAsset === 'function' ? await options.resolveImageAsset(source, { root: options.root, maxBytes }) : null;
      if (resolved) { bytes = resolvedImageBytes(resolved, maxBytes); contentType = String(resolved.contentType || resolved.mimeType || '').toLowerCase(); }
    }
    if (!bytes?.length) { const error = new Error('IMAGE_REQUIRED_UNRESOLVED'); error.code = 'IMAGE_REQUIRED_UNRESOLVED'; throw error; }
    if (bytes.length > maxBytes) { const error = new Error('IMAGE_TOO_LARGE'); error.code = 'IMAGE_TOO_LARGE'; throw error; }
    const detectedType = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
      : (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ? 'jpg'
        : ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')) ? 'gif' : '';
    const declaredType = contentType.split('/')[1]?.replace('jpeg', 'jpg');
    if (!detectedType || declaredType !== detectedType) { const error = new Error('IMAGE_CONTENT_TYPE_INVALID'); error.code = 'IMAGE_CONTENT_TYPE_INVALID'; throw error; }
    segment.resolvedData = bytes;
    segment.resolvedType = detectedType;
  }
}

function createLocalQuestionImageResolver(root) {
  const fixedRoot = path.resolve(root);
  return async (assetKey, resolverOptions = {}) => {
    if (!assetKey) return null;
    if (!fs.existsSync(fixedRoot) || fs.lstatSync(fixedRoot).isSymbolicLink()) return null;
    const imagesRoot = path.resolve(fixedRoot, 'assets', 'images');
    let boundary = fixedRoot;
    for (const part of ['assets', 'images']) { boundary = path.join(boundary, part); if (!fs.existsSync(boundary) || fs.lstatSync(boundary).isSymbolicLink()) return null; }
    const normalizedKey = String(assetKey).replace(/\\/g, '/').replace(/^(?:assets\/)?images\//, '');
    if (!normalizedKey || path.posix.isAbsolute(normalizedKey) || normalizedKey.split('/').includes('..')) return null;
    const resolved = path.resolve(imagesRoot, ...normalizedKey.split('/'));
    const relative = path.relative(imagesRoot, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(resolved)) return null;
    let cursor = imagesRoot;
    for (const part of relative.split(path.sep)) { cursor = path.join(cursor, part); if (fs.lstatSync(cursor).isSymbolicLink()) return null; }
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    if (stat.size > Number(resolverOptions.maxBytes || 8 * 1024 * 1024)) { const error = new Error('IMAGE_TOO_LARGE'); error.code = 'IMAGE_TOO_LARGE'; throw error; }
    const real = fs.realpathSync(resolved);
    const rootReal = fs.realpathSync(imagesRoot); const realRelative = path.relative(rootReal, real);
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) return null;
    const extension = path.extname(resolved).slice(1).toLowerCase().replace('jpg', 'jpeg');
    if (!['png', 'jpeg', 'gif'].includes(extension)) return null;
    return { path: resolved, contentType: `image/${extension}` };
  };
}

function imageBytes(segment) {
  if (segment.resolvedData) return { type: segment.resolvedType, data: segment.resolvedData };
  const dataMatch = String(segment.src || '').match(/^data:image\/(png|jpe?g|gif);base64,(.+)$/i);
  if (dataMatch) return { type: dataMatch[1].toLowerCase().replace('jpeg', 'jpg'), data: Buffer.from(dataMatch[2], 'base64') };
  if (fs.existsSync(String(segment.src || ''))) return { type: path.extname(segment.src).slice(1).toLowerCase().replace('jpeg', 'jpg'), data: fs.readFileSync(segment.src) };
  return null;
}

function runsForSegments(segments, prepared) {
  return segments.flatMap(segment => {
    if (segment.type === 'text') return [textRun(segment)];
    if (segment.type === 'image') {
      const image = imageBytes(segment);
      if (!image || !['png', 'jpg', 'gif'].includes(image.type)) return [];
      const width = Math.min(520, Math.max(40, Number(segment.width || 320)));
      return [new ImageRun({ type: image.type, data: image.data, transformation: { width, height: Math.round(width * 0.6) } })];
    }
    const formula = prepared[segment.formulaIndex];
    if (formula?.omml && ['word-native', 'eq-field'].includes(formula.effectiveMode)) return [new TextRun({ text: `[[GEWU_FORMULA_${segment.formulaIndex}]]` })];
    return [new ImageRun({ type: 'svg', data: Buffer.from(formula.svg), fallback: { type: 'png', data: formula.png }, transformation: { width: formula.width, height: formula.height } })];
  });
}

function replaceFormulaPlaceholders(buffer, prepared) {
  const files = unzipSync(new Uint8Array(buffer));
  let xml = strFromU8(files['word/document.xml']);
  prepared.forEach((formula, index) => {
    if (!formula.omml) return;
    const marker = `[[GEWU_FORMULA_${index}]]`;
    const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const runPattern = new RegExp(`<w:r(?:\\s[^>]*)?>(?:(?!<\\/w:r>)[\\s\\S])*?<w:t[^>]*>${escapedMarker}<\\/w:t>(?:(?!<\\/w:r>)[\\s\\S])*?<\\/w:r>`);
    const replacement = formula.effectiveMode === 'eq-field'
      ? `<w:fldSimple w:instr=" EQ ${escapeXml(latexToEqField(formula.latex))} " w:fldLock="true" w:dirty="false">${formula.omml}</w:fldSimple>`
      : formula.omml;
    xml = xml.replace(runPattern, replacement);
  });
  files['word/document.xml'] = strToU8(xml);
  return Buffer.from(zipSync(files, { level: 6 }));
}

function templateDerivedPackage(buffer, answerPosition) {
  const generated = unzipSync(new Uint8Array(buffer));
  const template = unzipSync(new Uint8Array(fs.readFileSync(DEFAULT_TEMPLATE_PATH)));
  const output = { ...template };
  let generatedXml = strFromU8(generated['word/document.xml']);
  const templateXml = strFromU8(template['word/document.xml']);
  const templateSections = [...templateXml.matchAll(/<w:sectPr[\s\S]*?<\/w:sectPr>/g)].map(match => match[0]);
  const selected = answerPosition === 'end' ? templateSections.slice(-2) : templateSections.slice(0, 1);
  let sectionIndex = 0;
  generatedXml = generatedXml.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/g, () => {
    return selected[Math.min(sectionIndex++, selected.length - 1)] || '';
  });
  let generatedBody = generatedXml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1];
  if (!generatedBody) throw new Error('generated DOCX body is missing');

  let templateRels = strFromU8(template['word/_rels/document.xml.rels']);
  const generatedRels = strFromU8(generated['word/_rels/document.xml.rels']);
  const relationshipRows = [...generatedRels.matchAll(/<Relationship\b[^>]+\/>/g)].map(match => match[0]);
  const addedRelationships = [];
  relationshipRows.forEach((row, index) => {
    const oldId = row.match(/Id="([^"]+)"/)?.[1];
    if (!oldId) return;
    if (!new RegExp(`r:(?:id|embed|link)="${oldId}"`).test(generatedBody)) return;
    const newId = `rIdGenerated${index + 1}`;
    let updated = row.replace(`Id="${oldId}"`, `Id="${newId}"`);
    const target = row.match(/Target="([^"]+)"/)?.[1] || '';
    if (target.startsWith('media/')) {
      const oldPart = `word/${target}`;
      const newTarget = `media/generated-${index + 1}-${path.posix.basename(target)}`;
      if (!generated[oldPart]) throw new Error(`generated media relationship is missing: ${oldPart}`);
      output[`word/${newTarget}`] = generated[oldPart];
      updated = updated.replace(`Target="${target}"`, `Target="${newTarget}"`);
    }
    generatedBody = generatedBody.replace(new RegExp(`r:(?:id|embed|link)="${oldId}"`, 'g'), match => match.replace(oldId, newId));
    addedRelationships.push(updated);
  });
  templateRels = templateRels.replace('</Relationships>', `${addedRelationships.join('')}</Relationships>`);
  output['word/_rels/document.xml.rels'] = strToU8(templateRels);
  output['word/document.xml'] = strToU8(templateXml.replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body>${generatedBody}</w:body>`));

  const headerFooterNames = Object.keys(template).filter(name => /^word\/(?:footer|header)\d+\.xml$/.test(name));
  for (const name of headerFooterNames) {
    let part = strFromU8(template[name]);
    part = part.replace(new RegExp(`<w:p(?:(?!<\\/w:p>)[\\s\\S])*?\\u6797\\u8001\\u5e08(?:(?!<\\/w:p>)[\\s\\S])*?<\\/w:p>`, 'g'), '');
    output[name] = strToU8(part);
  }
  let types = strFromU8(template['[Content_Types].xml']);
  const generatedTypes = strFromU8(generated['[Content_Types].xml']);
  for (const row of generatedTypes.match(/<(?:Default|Override)\b[^>]+\/>/g) || []) {
    const extension = row.match(/Extension="([^"]+)"/)?.[1];
    const partName = row.match(/PartName="([^"]+)"/)?.[1];
    if ((extension && !new RegExp(`Extension="${extension}"`, 'i').test(types)) || (partName && !types.includes(`PartName="${partName}"`))) types = types.replace('</Types>', `${row}</Types>`);
  }
  output['[Content_Types].xml'] = strToU8(types);
  return Buffer.from(zipSync(output, { level: 6 }));
}

function hasContent(segments) { return segments.some(item => item.text || item.latex || item.src); }
function plainText(segments) { return segments.map(item => item.text || (item.latex ? `[${item.latex}]` : '')).join('').trim(); }
function sectionTitle(type, index) {
  const labels = { '\u5355\u9009\u9898': '\u5355\u9009\u9898', '\u591a\u9009\u9898': '\u591a\u9009\u9898', '\u5224\u65ad\u9898': '\u5224\u65ad\u9898', '\u5b9e\u9a8c\u9898': '\u5b9e\u9a8c\u9898', '\u89e3\u7b54\u9898': '\u89e3\u7b54\u9898' };
  const numerals = ['\u4e00', '\u4e8c', '\u4e09', '\u56db', '\u4e94', '\u516d'];
  return `${numerals[index] || index + 1}\u3001${labels[type] || type || '\u7efc\u5408\u9898'}`;
}
function chunks(rows, size = 10) { const result = []; for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size)); return result; }

async function writeDocx(filePath, payload, sourceQuestions, options = {}) {
  const questions = sourceQuestions.map(normalizedQuestion);
  await resolveImageSegments(questions, options);
  const answerPosition = normalizeAnswerPosition(payload.answerPosition || payload.answer_position, payload.includeAnswers);
  const formulaMode = resolveFormulaMode(payload.formulaMode || payload.formula_mode);
  const formulas = await prepareFormulaRows(formulaRows(questions), formulaMode);
  const questionChildren = [
    new Paragraph({ alignment: 'center', children: [new TextRun({ text: payload.title || LABELS.defaultTitle, bold: true, size: 34, font: 'SimSun' })] }),
    new Paragraph({ alignment: 'center', children: [new TextRun({ text: '\u5b66\u6821:___________\u59d3\u540d\uff1a___________\u73ed\u7ea7\uff1a___________\u8003\u53f7\uff1a___________', font: 'SimSun', size: 20 })] }),
  ];
  const addQuestionSegments = (prefix, segments, bold = false) => questionChildren.push(new Paragraph({ spacing: { after: 100, line: 360 }, children: [new TextRun({ text: prefix, bold, font: 'SimSun', size: 22 }), ...runsForSegments(segments, formulas)] }));
  let previousType = null; let typeIndex = -1;
  questions.forEach(question => {
    if (question.type !== previousType) {
      previousType = question.type; typeIndex += 1;
      questionChildren.push(new Paragraph({ spacing: { before: 140, after: 100 }, children: [new TextRun({ text: sectionTitle(question.type, typeIndex), bold: true, font: 'SimSun', size: 24 })] }));
    }
    addQuestionSegments(`${question.number}. `, question.stem, true);
    question.options.forEach(option => addQuestionSegments(`${option.label}. `, option.content));
    question.subs.forEach(sub => addQuestionSegments(`${sub.label} `, sub.content, true));
    if (answerPosition === 'after-each') {
      addQuestionSegments('\u7b54\u6848\uff1a', question.answer, true);
      addQuestionSegments('\u3010\u77e5\u8bc6\u70b9\u3011', hasContent(question.knowledge) ? question.knowledge : legacySegments('\u672a\u586b\u5199'));
      addQuestionSegments('\u3010\u89e3\u6790\u3011', hasContent(question.analysis) ? question.analysis : legacySegments('\u672a\u586b\u5199'));
    }
  });
  const sections = [{ properties: {}, children: questionChildren }];
  if (answerPosition === 'end') {
    const answerChildren = [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `\u300a${payload.title || LABELS.defaultTitle}\u300b\u53c2\u8003\u7b54\u6848`, bold: true, size: 30, font: 'SimSun' })] })];
    const choice = questions.filter(question => CHOICE_TYPES.has(question.type));
    if (choice.length) answerChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: chunks(choice).flatMap(group => [
      new TableRow({ children: [new TableCell({ children: [new Paragraph('\u9898\u53f7')] }), ...group.map(question => new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, text: String(question.number) })] }))] }),
      new TableRow({ children: [new TableCell({ children: [new Paragraph('\u7b54\u6848')] }), ...group.map(question => new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, text: plainText(question.answer) || '\u672a\u586b\u5199' })] }))] }),
    ]) }));
    const addAnswerSegments = (prefix, segments, bold = false) => answerChildren.push(new Paragraph({ spacing: { after: 100, line: 360 }, children: [new TextRun({ text: prefix, bold, font: 'SimSun', size: 22 }), ...runsForSegments(segments, formulas)] }));
    questions.forEach(question => {
      addAnswerSegments(`${question.number}\uff0e`, question.answer, true);
      addAnswerSegments('\u3010\u77e5\u8bc6\u70b9\u3011', hasContent(question.knowledge) ? question.knowledge : legacySegments('\u672a\u586b\u5199'));
      addAnswerSegments('\u3010\u89e3\u6790\u3011', hasContent(question.analysis) ? question.analysis : legacySegments('\u672a\u586b\u5199'));
    });
    sections.push({ properties: { type: SectionType.NEXT_PAGE }, children: answerChildren });
  }
  const document = new Document({ creator: 'Gewu Workshop', description: `formula-mode:${formulaMode}`, sections });
  const packed = await Packer.toBuffer(document);
  const formulaPackage = replaceFormulaPlaceholders(packed, formulas);
  if (formulas.some(item => item.omml)) {
    fs.writeFileSync(filePath, formulaPackage);
    normalizeDocxPackage(filePath);
    fs.writeFileSync(filePath, templateDerivedPackage(fs.readFileSync(filePath), answerPosition));
  } else {
    fs.writeFileSync(filePath, templateDerivedPackage(formulaPackage, answerPosition));
  }
  return { requestedFormulaMode: formulaMode, effectiveFormulaModes: [...new Set(formulas.map(item => item.effectiveMode))], fallbackCount: formulas.filter(item => item.fallbackUsed).length, formulaCount: formulas.length };
}

function cjkFontPath() { return [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'simhei.ttf'), path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'Deng.ttf')].find(fs.existsSync); }
async function writePdf(filePath, payload, sourceQuestions, options = {}) {
  const questions = sourceQuestions.map(normalizedQuestion); const formulas = await prepareFormulaRows(formulaRows(questions), 'latex-vector');
  await resolveImageSegments(questions, options);
  const answerPosition = normalizeAnswerPosition(payload.answerPosition || payload.answer_position, payload.includeAnswers);
  const semantic = [];
  let pageCount = 0;
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, left: 52, right: 52, bottom: 50 }, bufferPages: true });
    let answerPageStart = null;
    const output = fs.createWriteStream(filePath); doc.pipe(output); output.on('finish', resolve); output.on('error', reject);
    const font = cjkFontPath(); if (font) doc.font(font); doc.fontSize(18).text(payload.title || LABELS.defaultTitle, { align: 'center' }); doc.moveDown(.5);
    doc.fontSize(10).text('\u5b66\u6821:___________  \u59d3\u540d\uff1a___________  \u73ed\u7ea7\uff1a___________  \u8003\u53f7\uff1a___________', { align: 'center' });
    doc.fontSize(10).text(`${LABELS.count}${questions.length}`, { align: 'center' }); doc.moveDown();
    const draw = (prefix, segments) => {
      semantic.push(`${prefix}${plainText(segments)}`);
      let pendingText = prefix;
      const flushText = () => { if (pendingText.trim()) doc.fontSize(11).text(pendingText); pendingText = ''; };
      segments.forEach(segment => {
        if (segment.type === 'text') { pendingText += segment.text; return; }
        if (segment.type === 'image') {
          flushText(); const image = imageBytes(segment); if (!image) return;
          const width = Math.min(420, Math.max(40, Number(segment.width || 320)));
          if (doc.y + width * 0.6 + 12 > doc.page.height - doc.page.margins.bottom - 24) doc.addPage();
          doc.image(image.data, doc.x + 16, doc.y, { fit: [width, width * 0.6] }); doc.y += width * 0.6 + 8; return;
        }
        if (segment.type !== 'formula') return;
        flushText();
        const formula = formulas[segment.formulaIndex];
        if (doc.y + formula.height + 12 > doc.page.height - doc.page.margins.bottom - 24) doc.addPage();
        SVGtoPDF(doc, formula.svg, doc.x + 16, doc.y, { width: formula.width, height: formula.height });
        doc.y += formula.height + 8;
      });
      flushText();
      doc.moveDown(.35);
    };
    let previousType = null; let typeIndex = -1;
    questions.forEach(question => {
      if (doc.y + 110 > doc.page.height - doc.page.margins.bottom - 24) doc.addPage();
      if (question.type !== previousType) { previousType = question.type; typeIndex += 1; doc.moveDown(.2); doc.fontSize(13).text(sectionTitle(question.type, typeIndex), { underline: false }); doc.moveDown(.25); semantic.push(sectionTitle(question.type, typeIndex)); }
      draw(`${question.number}. `, question.stem);
      question.options.forEach(option => draw(`${option.label}. `, option.content));
      question.subs.forEach(sub => draw(`${sub.label} `, sub.content));
      if (answerPosition === 'after-each') {
        draw('\u7b54\u6848\uff1a', question.answer);
        draw('\u3010\u77e5\u8bc6\u70b9\u3011', hasContent(question.knowledge) ? question.knowledge : legacySegments('\u672a\u586b\u5199'));
        draw('\u3010\u89e3\u6790\u3011', hasContent(question.analysis) ? question.analysis : legacySegments('\u672a\u586b\u5199'));
      }
      doc.moveDown(.5);
    });
    if (answerPosition === 'end') {
      doc.addPage();
      answerPageStart = doc.bufferedPageRange().count - 1;
      doc.fontSize(16).text(`\u300a${payload.title || LABELS.defaultTitle}\u300b\u53c2\u8003\u7b54\u6848`, { align: 'center' });
      semantic.push('\u53c2\u8003\u7b54\u6848');
      const choice = questions.filter(question => CHOICE_TYPES.has(question.type));
      if (choice.length) {
        const numberRow = `\u9898\u53f7 ${choice.map(question => question.number).join(' ')}`;
        const answerRow = `\u7b54\u6848 ${choice.map(question => plainText(question.answer) || '\u672a\u586b\u5199').join(' ')}`;
        const left = doc.page.margins.left; const width = doc.page.width - doc.page.margins.left - doc.page.margins.right; const cellHeight = 24;
        let tableY = doc.y + 8;
        for (const group of chunks(choice)) {
          if (tableY + cellHeight * 2 > doc.page.height - doc.page.margins.bottom - 24) { doc.addPage(); tableY = doc.y; }
          const columns = group.length + 1; const cellWidth = width / columns;
          const rows = [['\u9898\u53f7', ...group.map(question => String(question.number))], ['\u7b54\u6848', ...group.map(question => plainText(question.answer) || '\u672a\u586b\u5199')]];
          rows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
            const y = tableY + rowIndex * cellHeight;
            doc.rect(left + columnIndex * cellWidth, y, cellWidth, cellHeight).stroke('#666666');
            doc.fontSize(10).text(value, left + columnIndex * cellWidth + 3, y + 7, { width: cellWidth - 6, align: 'center', lineBreak: false });
          }));
          tableY += cellHeight * 2;
        }
        doc.x = left; doc.y = tableY + 12; semantic.push(numberRow, answerRow);
      }
      questions.forEach(question => {
        draw(`${question.number}\uff0e`, question.answer);
        draw('\u3010\u77e5\u8bc6\u70b9\u3011', hasContent(question.knowledge) ? question.knowledge : legacySegments('\u672a\u586b\u5199'));
        draw('\u3010\u89e3\u6790\u3011', hasContent(question.analysis) ? question.analysis : legacySegments('\u672a\u586b\u5199'));
      });
    }
    const pageRange = doc.bufferedPageRange();
    pageCount = pageRange.count;
    for (let pageIndex = pageRange.start; pageIndex < pageRange.start + pageRange.count; pageIndex += 1) {
      doc.switchToPage(pageIndex);
      const isAnswerPage = answerPageStart !== null && pageIndex >= answerPageStart;
      const sectionPage = isAnswerPage ? pageIndex - answerPageStart + 1 : pageIndex + 1;
      const sectionPages = isAnswerPage ? pageRange.count - answerPageStart : (answerPageStart === null ? pageRange.count : answerPageStart);
      const role = isAnswerPage ? '\u53c2\u8003\u7b54\u6848' : '\u8bd5\u9898';
      doc.fontSize(8).fillColor('#666666').text(`${role}  \u7b2c ${sectionPage} / ${sectionPages} \u9875  \u00b7  \u683c\u7269\u5de5\u574a`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 14, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center', lineBreak: false });
      doc.fillColor('#000000');
    }
    doc.end();
  });
  return { requestedFormulaMode: resolveFormulaMode(payload.formulaMode || payload.formula_mode), effectiveFormulaModes: ['latex-vector'], fallbackCount: 0, formulaCount: formulas.length, semanticText: semantic.join('\n'), pageCount };
}

async function writePaperArtifact(format, payload = {}, questions = [], options = {}) {
  const normalizedFormat = format === 'pdf' ? 'pdf' : 'word'; const extension = normalizedFormat === 'pdf' ? 'pdf' : 'docx';
  const fileName = `${Date.now().toString(36)}_${safeFileName(payload.title || LABELS.defaultTitle)}.${extension}`; const root = exportRoot(options); const filePath = resolveQuestionAssetPath(root, 'exports', fileName);
  const report = normalizedFormat === 'pdf' ? await writePdf(filePath, payload, questions, options) : await writeDocx(filePath, payload, questions, options);
  return { fileName, filePath, fileUrl: artifactUrl(fileName, options), answerPosition: normalizeAnswerPosition(payload.answerPosition || payload.answer_position, payload.includeAnswers), ...report };
}

module.exports = { createLocalQuestionImageResolver, normalizeAnswerPosition, normalizedQuestion, writePaperArtifact };
