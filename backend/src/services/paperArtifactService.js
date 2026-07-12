const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Document, ImageRun, Packer, Paragraph, TextRun } = require('docx');
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
    else if (node.type === 'image' && node.attrs?.src) result.push({ type: 'image', src: node.attrs.src, width: Number(node.attrs.width || 320) });
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
  return {
    number: index + 1,
    stem: rich ? documentSegments(rich.stem) : legacySegments(question.stem || question.content || question.title || ''),
    options: options.map(item => ({ label: item.label || '', content: documentSegments(item.content) })),
    subs: (rich?.subQuestions || []).map(item => ({ label: item.label || '', content: documentSegments(item.content), answer: documentSegments(item.answer) })),
    answer: rich ? documentSegments(rich.answer) : legacySegments(question.answer || ''),
    analysis: rich ? documentSegments(rich.analysis) : legacySegments(question.explanation || question.analysis || ''),
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
  questions.forEach(question => { scan(question.stem); question.options.forEach(item => scan(item.content)); question.subs.forEach(item => { scan(item.content); scan(item.answer); }); scan(question.answer); scan(question.analysis); });
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

function runsForSegments(segments, prepared) {
  return segments.flatMap(segment => {
    if (segment.type === 'text') return [textRun(segment)];
    if (segment.type === 'image') return [];
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

async function writeDocx(filePath, payload, sourceQuestions) {
  const questions = sourceQuestions.map(normalizedQuestion);
  const formulaMode = resolveFormulaMode(payload.formulaMode || payload.formula_mode);
  const formulas = await prepareFormulaRows(formulaRows(questions), formulaMode);
  const children = [
    new Paragraph({ alignment: 'center', children: [new TextRun({ text: payload.title || LABELS.defaultTitle, bold: true, size: 34, font: 'SimSun' })] }),
    new Paragraph({ alignment: 'center', children: [new TextRun({ text: `${payload.subject ? LABELS.subject + payload.subject + '    ' : ''}${LABELS.count}${questions.length}`, font: 'SimSun', size: 20 })] }),
  ];
  const addSegments = (prefix, segments, bold = false) => children.push(new Paragraph({ spacing: { after: 100, line: 360 }, children: [new TextRun({ text: prefix, bold, font: 'SimSun', size: 22 }), ...runsForSegments(segments, formulas)] }));
  questions.forEach(question => {
    addSegments(`${question.number}. `, question.stem, true);
    question.options.forEach(option => addSegments(`${option.label}. `, option.content));
    question.subs.forEach(sub => { addSegments(`${sub.label} `, sub.content, true); if (payload.includeAnswers !== false) addSegments(`   ${LABELS.answer}`, sub.answer); });
    if (payload.includeAnswers !== false && question.answer.some(item => item.text || item.latex)) addSegments(LABELS.answer, question.answer, true);
    if (payload.includeAnswers !== false && question.analysis.some(item => item.text || item.latex)) addSegments(LABELS.analysis, question.analysis, true);
  });
  const document = new Document({ creator: 'Gewu Workshop', description: `formula-mode:${formulaMode}`, sections: [{ children }] });
  const packed = await Packer.toBuffer(document);
  fs.writeFileSync(filePath, replaceFormulaPlaceholders(packed, formulas));
  if (formulas.some(item => item.omml)) normalizeDocxPackage(filePath);
  return { requestedFormulaMode: formulaMode, effectiveFormulaModes: [...new Set(formulas.map(item => item.effectiveMode))], fallbackCount: formulas.filter(item => item.fallbackUsed).length, formulaCount: formulas.length };
}

function cjkFontPath() { return [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'simhei.ttf'), path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'Deng.ttf')].find(fs.existsSync); }
async function writePdf(filePath, payload, sourceQuestions) {
  const questions = sourceQuestions.map(normalizedQuestion); const formulas = await prepareFormulaRows(formulaRows(questions), 'latex-vector');
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, left: 52, right: 52, bottom: 50 }, bufferPages: true });
    const output = fs.createWriteStream(filePath); doc.pipe(output); output.on('finish', resolve); output.on('error', reject);
    const font = cjkFontPath(); if (font) doc.font(font); doc.fontSize(18).text(payload.title || LABELS.defaultTitle, { align: 'center' }); doc.moveDown(.5); doc.fontSize(10).text(`${LABELS.count}${questions.length}`, { align: 'center' }); doc.moveDown();
    const draw = (prefix, segments) => {
      let pendingText = prefix;
      const flushText = () => { if (pendingText.trim()) doc.fontSize(11).text(pendingText); pendingText = ''; };
      segments.forEach(segment => {
        if (segment.type === 'text') { pendingText += segment.text; return; }
        if (segment.type !== 'formula') return;
        flushText();
        const formula = formulas[segment.formulaIndex];
        SVGtoPDF(doc, formula.svg, doc.x + 16, doc.y, { width: formula.width, height: formula.height });
        doc.y += formula.height + 8;
      });
      flushText();
      doc.moveDown(.35);
    };
    questions.forEach(question => { draw(`${question.number}. `, question.stem); question.options.forEach(option => draw(`${option.label}. `, option.content)); question.subs.forEach(sub => draw(`${sub.label} `, sub.content)); if (payload.includeAnswers !== false) { draw(LABELS.answer, question.answer); draw(LABELS.analysis, question.analysis); } doc.moveDown(.5); });
    doc.end();
  });
  return { requestedFormulaMode: resolveFormulaMode(payload.formulaMode || payload.formula_mode), effectiveFormulaModes: ['latex-vector'], fallbackCount: 0, formulaCount: formulas.length };
}

async function writePaperArtifact(format, payload = {}, questions = [], options = {}) {
  const normalizedFormat = format === 'pdf' ? 'pdf' : 'word'; const extension = normalizedFormat === 'pdf' ? 'pdf' : 'docx';
  const fileName = `${Date.now().toString(36)}_${safeFileName(payload.title || LABELS.defaultTitle)}.${extension}`; const root = exportRoot(options); const filePath = resolveQuestionAssetPath(root, 'exports', fileName);
  const report = normalizedFormat === 'pdf' ? await writePdf(filePath, payload, questions) : await writeDocx(filePath, payload, questions);
  return { fileName, filePath, fileUrl: artifactUrl(fileName, options), ...report };
}

module.exports = { normalizedQuestion, writePaperArtifact };
