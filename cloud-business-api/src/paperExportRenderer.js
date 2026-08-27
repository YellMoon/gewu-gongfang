'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
const sharp = require('sharp');
const { Document, ImageRun, Packer, Paragraph, TextRun } = require('docx');
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function pdfFontPath() {
  const candidates = [
    path.join(__dirname, '..', 'assets', 'fonts', 'NotoSansCJKsc-Regular.otf'),
    path.join(__dirname, '..', '..', 'backend', 'assets', 'fonts', 'NotoSansCJKsc-Regular.otf'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function stripMarkup(value) {
  return String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function isFormula(value) {
  return Boolean(value && typeof value === 'object' && /formula|math|equation/i.test(String(value.type || value.kind || '')));
}

function structuredText(value, formulaMode = 'word-native', seen = new Set()) {
  if (typeof value === 'string') return stripMarkup(value);
  if (value === null || value === undefined || typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => structuredText(item, formulaMode, seen)).filter(Boolean).join('\n');
  if (isFormula(value)) return '';
  const fields = ['text', 'content', 'stem', 'options', 'subQuestions', 'answer', 'analysis', 'explanation', 'blocks', 'children', 'nodes', 'runs', 'items', 'paragraphs', 'body', 'formula'];
  return fields.map(field => structuredText(value[field], formulaMode, seen)).filter(Boolean).join('\n');
}

function collectFormulae(value, seen = new Set(), rows = []) {
  if (value === null || value === undefined || typeof value !== 'object' || seen.has(value)) return rows;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectFormulae(item, seen, rows);
    return rows;
  }
  if (isFormula(value)) {
    const attrs = value.attrs && typeof value.attrs === 'object' && !Array.isArray(value.attrs) ? value.attrs : {};
    const latex = value.canonicalLatex || value.canonical_latex || value.latex || attrs.canonicalLatex || attrs.canonical_latex || attrs.latex;
    if (typeof latex === 'string' && latex.trim()) rows.push(latex.trim());
    return rows;
  }
  for (const field of ['text', 'content', 'sections', 'stem', 'options', 'subQuestions', 'answer', 'analysis', 'explanation', 'blocks', 'children', 'nodes', 'runs', 'items', 'paragraphs', 'body', 'formula']) {
    collectFormulae(value[field], seen, rows);
  }
  return rows;
}

function richStem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const sections = value.sections;
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) return value;
  return sections.stem || null;
}

function formulaSvg(latex) {
  try {
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const tex = new TeX({ packages: AllPackages });
    const svg = new SVG({ fontCache: 'none' });
    const document = mathjax.document('', { InputJax: tex, OutputJax: svg });
    const container = document.convert(latex, { display: true });
    return Buffer.from(adaptor.outerHTML(adaptor.firstChild(container)), 'utf8');
  } catch (_) {
    throw failure('CLOUD_PAPER_RENDER_FORMULA_INVALID');
  }
}

function optionText(value, index, formulaMode) {
  if (typeof value === 'string') return structuredText(value, formulaMode);
  if (!value || typeof value !== 'object') return '';
  const label = structuredText(value.label || value.key || value.value || String.fromCharCode(65 + index), formulaMode);
  const content = structuredText(value.content || value.text || value.title, formulaMode);
  return content ? label + '. ' + content : label;
}

function questionAssets(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw failure('CLOUD_PAPER_RENDER_INPUT_INVALID');
  return value.map(asset => {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)
      || typeof asset.assetKey !== 'string' || !/^[0-9a-f]{64}$/.test(asset.assetKey)
      || typeof asset.fileName !== 'string' || !asset.fileName.trim() || asset.fileName.length > 512
      || typeof asset.mimeType !== 'string' || !/^image\/(?:png|jpe?g)$/i.test(asset.mimeType)) {
      throw failure('CLOUD_PAPER_RENDER_MEDIA_INVALID');
    }
    const assetType = asset.assetType === undefined ? 'image' : asset.assetType;
    if (!['image', 'formula_preview'].includes(assetType)) throw failure('CLOUD_PAPER_RENDER_MEDIA_INVALID');
    return { assetKey: asset.assetKey, fileName: asset.fileName, mimeType: asset.mimeType.toLowerCase(), assetType };
  });
}

function request(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['word', 'pdf'].includes(value.format) || typeof value.title !== 'string' || !value.title.trim()) {
    throw failure('CLOUD_PAPER_RENDER_INPUT_INVALID');
  }
  const layout = value.layout && typeof value.layout === 'object' && !Array.isArray(value.layout) && Array.isArray(value.layout.items)
    ? value.layout : null;
  const formulaMode = ['word-native', 'eq-field', 'mathtype-compatible', 'latex-vector'].includes(value.formulaMode) ? value.formulaMode : 'word-native';
  return { format: value.format, title: value.title.trim(), answerPosition: value.answerPosition || 'end', formulaMode, layout };
}

function questions(value, layout, formulaMode) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) throw failure('CLOUD_PAPER_RENDER_INPUT_INVALID');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.stem !== 'string') {
      throw failure('CLOUD_PAPER_RENDER_INPUT_INVALID');
    }
    const layoutItem = layout?.items?.[index];
    if (layoutItem && (layoutItem.id !== item.id || typeof layoutItem.sectionTitle !== 'string' || !Number.isSafeInteger(layoutItem.score))) {
      throw failure('CLOUD_PAPER_RENDER_INPUT_INVALID');
    }
    const stem = stripMarkup(item.stem);
    const richContent = structuredText(richStem(item.richContent), formulaMode);
    const formulae = Array.from(new Set([
      ...collectFormulae(item.richContent),
      ...collectFormulae(item.options),
    ]));
    return {
      id: item.id, number: index + 1, stem: richContent && !richContent.includes(stem) ? [stem, richContent].filter(Boolean).join('\n') : stem || richContent,
      options: Array.isArray(item.options) ? item.options.map((option, optionIndex) => optionText(option, optionIndex, formulaMode)).filter(Boolean) : [],
      answer: stripMarkup(item.answer), explanation: stripMarkup(item.explanation),
      sectionTitle: layoutItem?.sectionTitle || '', score: layoutItem?.score ?? null,
      assets: questionAssets(item.assets),
      formulae,
    };
  });
}

async function hydrateMedia(items, resolveQuestionAsset) {
  if (items.some(item => item.assets.length) && typeof resolveQuestionAsset !== 'function') throw failure('CLOUD_PAPER_RENDER_MEDIA_RESOLVER_REQUIRED');
  return Promise.all(items.map(async item => ({
    ...item,
    media: await Promise.all(item.assets.map(async asset => {
      const bytes = await resolveQuestionAsset({ questionId: item.id, ...asset });
      if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > (64 * 1024 * 1024)) throw failure('CLOUD_PAPER_RENDER_MEDIA_INVALID');
      return { ...asset, bytes: Buffer.from(bytes), kind: 'image' };
    })).then(async media => media.concat(await Promise.all(item.formulae.map(async latex => {
      const bytes = formulaSvg(latex);
      try {
        return { kind: 'formula', bytes, fallbackBytes: await sharp(bytes).png().toBuffer() };
      } catch (_) {
        throw failure('CLOUD_PAPER_RENDER_FORMULA_INVALID');
      }
    })))),
  })));
}

function answerRows(item, prefix = '') {
  const rows = [];
  if (item.answer) rows.push(new Paragraph({ children: [new TextRun({ text: prefix + '答案：' + item.answer })] }));
  if (item.explanation) rows.push(new Paragraph({ children: [new TextRun({ text: prefix + '解析：' + item.explanation })] }));
  return rows;
}

function bodyRows(items, answerPosition) {
  const rows = [new Paragraph({ children: [new TextRun({ text: '试题', bold: true })] })];
  let previousSection = '';
  for (const item of items) {
    if (item.sectionTitle && item.sectionTitle !== previousSection) {
      rows.push(new Paragraph({ children: [new TextRun({ text: item.sectionTitle, bold: true })] }));
      previousSection = item.sectionTitle;
    }
    const score = item.score === null ? '' : ' (' + item.score + ' pts)';
    rows.push(new Paragraph({ children: [new TextRun({ text: String(item.number) + '. ' + item.stem + score })] }));
    for (const option of item.options) rows.push(new Paragraph({ children: [new TextRun({ text: option })] }));
    for (const media of item.media || []) {
      rows.push(new Paragraph({ children: [new ImageRun({
        data: media.bytes,
        type: media.kind === 'formula' ? 'svg' : (media.mimeType === 'image/png' ? 'png' : 'jpg'),
        ...(media.kind === 'formula' ? { fallback: { data: media.fallbackBytes, type: 'png' } } : {}),
        transformation: media.kind === 'formula' ? { width: 240, height: 72 } : { width: 420, height: 280 },
      })] }));
    }
    if (answerPosition === 'after') rows.push(...answerRows(item));
  }
  if (answerPosition !== 'after') {
    rows.push(new Paragraph({ children: [new TextRun({ text: '参考答案', bold: true })] }));
    for (const item of items) rows.push(...answerRows(item, String(item.number) + '. '));
  }
  return rows;
}

async function wordBytes(input, items) {
  const document = new Document({ sections: [{ children: [
    new Paragraph({ children: [new TextRun({ text: input.title, bold: true, size: 32 })] }),
    ...bodyRows(items, input.answerPosition),
  ] }] });
  return Buffer.from(await Packer.toBuffer(document));
}

function pdfBytes(input, items) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 48, compress: false });
    const font = pdfFontPath();
    if (!font) return reject(failure('CLOUD_PAPER_RENDER_FONT_UNAVAILABLE'));
    const chunks = [];
    document.on('data', chunk => chunks.push(Buffer.from(chunk)));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.font(font);
    document.fontSize(18).text(input.title);
    document.moveDown();
    let previousSection = '';
    for (const item of items) {
      if (item.sectionTitle && item.sectionTitle !== previousSection) {
        document.fontSize(13).text(item.sectionTitle).moveDown(0.25);
        previousSection = item.sectionTitle;
      }
      const score = item.score === null ? '' : ' (' + item.score + ' pts)';
      document.fontSize(11).text(String(item.number) + '. ' + item.stem + score).moveDown(0.5);
      for (const option of item.options) document.fontSize(10).text(option).moveDown(0.25);
      for (const media of item.media || []) {
        try {
          if (media.kind === 'formula') {
            SVGtoPDF(document, media.bytes.toString('utf8'), document.x, document.y, { width: 280 });
            document.moveDown(4);
          } else document.image(media.bytes, { fit: [480, 360] }).moveDown(0.5);
        } catch (_) {
          throw failure('CLOUD_PAPER_RENDER_MEDIA_INVALID');
        }
      }
      if (input.answerPosition === 'after') {
        if (item.answer) document.fontSize(10).text('答案：' + item.answer);
        if (item.explanation) document.fontSize(10).text('解析：' + item.explanation);
      }
    }
    if (input.answerPosition !== 'after') {
      document.moveDown().fontSize(13).text('参考答案');
      for (const item of items) {
        if (item.answer) document.fontSize(10).text(String(item.number) + '. 答案：' + item.answer);
        if (item.explanation) document.fontSize(10).text(String(item.number) + '. 解析：' + item.explanation);
      }
    }
    document.end();
  });
}

async function renderPaperExport(input, { resolveQuestionAsset } = {}) {
  const current = request(input);
  const items = await hydrateMedia(questions(input.snapshot, current.layout, current.formulaMode), resolveQuestionAsset);
  const bytes = current.format === 'word' ? await wordBytes(current, items) : await pdfBytes(current, items);
  return { bytes, mimeType: current.format === 'word' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf', extension: current.format === 'word' ? 'docx' : 'pdf' };
}

module.exports = Object.freeze({ renderPaperExport });
