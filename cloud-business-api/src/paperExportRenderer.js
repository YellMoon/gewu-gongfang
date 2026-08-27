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

function richSections(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sections = value.sections;
  return sections && typeof sections === 'object' && !Array.isArray(sections) ? sections : null;
}

function richTextOrFallback(value, fallback, formulaMode) {
  return structuredText(value, formulaMode) || stripMarkup(fallback);
}

const paperLabels = Object.freeze({
  questions: String.fromCharCode(35797, 39064),
  answerSheet: String.fromCharCode(21442, 32771, 31572, 26696),
  answer: String.fromCharCode(31572, 26696, 65306),
  analysis: String.fromCharCode(35299, 26512, 65306),
});

function canonicalFormula(value) {
  if (!isFormula(value)) return '';
  const attrs = value.attrs && typeof value.attrs === 'object' && !Array.isArray(value.attrs) ? value.attrs : {};
  return String(value.canonicalLatex || value.canonical_latex || value.latex || attrs.canonicalLatex || attrs.canonical_latex || attrs.latex || '').trim();
}

function formulaDisplayMode(value) {
  const attrs = value && value.attrs && typeof value.attrs === 'object' && !Array.isArray(value.attrs) ? value.attrs : {};
  if (attrs.displayMode === 'block' || value?.displayMode === 'block') return 'block';
  if (attrs.displayMode === 'inline' || value?.displayMode === 'inline') return 'inline';
  return /(?:block|display)/i.test(String(value?.type || value?.kind || '')) ? 'block' : 'inline';
}

function richTokens(value, seen = new Set(), tokens = []) {
  if (value === null || value === undefined || seen.has(value)) return tokens;
  if (typeof value === 'string') {
    const text = stripMarkup(value);
    if (text) tokens.push({ kind: 'text', text });
    return tokens;
  }
  if (typeof value !== 'object') return tokens;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) richTokens(item, seen, tokens);
    return tokens;
  }
  const latex = canonicalFormula(value);
  if (latex) {
    tokens.push({ kind: 'formula', latex, displayMode: formulaDisplayMode(value) });
    return tokens;
  }
  if (value.type === 'text' && typeof value.text === 'string') {
    const text = stripMarkup(value.text);
    if (text) tokens.push({ kind: 'text', text });
    return tokens;
  }
  for (const field of ['content', 'children', 'nodes', 'runs', 'items', 'paragraphs', 'body', 'blocks']) richTokens(value[field], seen, tokens);
  return tokens;
}

function tokensOrFallback(value, fallback) {
  const tokens = richTokens(value);
  return tokens.length ? tokens : richTokens(fallback);
}

function prefixedTokens(prefix, tokens) {
  const result = tokens.map(token => ({ ...token }));
  const firstText = result.find(token => token.kind === 'text');
  if (firstText) firstText.text = prefix + firstText.text;
  else if (prefix) result.unshift({ kind: 'text', text: prefix });
  return result;
}

function suffixedTokens(tokens, suffix) {
  const result = tokens.map(token => ({ ...token }));
  const textTokens = result.filter(token => token.kind === 'text');
  if (textTokens.length) textTokens[textTokens.length - 1].text += suffix;
  else if (suffix) result.push({ kind: 'text', text: suffix });
  return result;
}

function optionTokens(value, index) {
  if (typeof value === 'string') return prefixedTokens('', tokensOrFallback(value, ''));
  if (!value || typeof value !== 'object') return [];
  const label = structuredText(value.label || value.key || value.value || String.fromCharCode(65 + index));
  const tokens = tokensOrFallback(value.content ?? value.text ?? value.title, '');
  return prefixedTokens(label ? label + '. ' : '', tokens);
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
    const sections = richSections(item.richContent);
    const stemTokens = sections
      ? tokensOrFallback(sections.stem, item.stem)
      : richTokens(item.stem).concat(richTokens(item.richContent));
    const sourceOptions = Array.isArray(sections?.options) && sections.options.length ? sections.options : item.options;
    const subQuestions = Array.isArray(sections?.subQuestions) ? sections.subQuestions.map((subQuestion, subQuestionIndex) => ({
      label: structuredText(subQuestion?.label || `(${subQuestionIndex + 1})`, formulaMode),
      contentTokens: tokensOrFallback(subQuestion?.content, ''),
      answerTokens: tokensOrFallback(subQuestion?.answer, ''),
    })).filter(subQuestion => subQuestion.label || subQuestion.contentTokens.length || subQuestion.answerTokens.length) : [];
    return {
      id: item.id, number: index + 1, stemTokens,
      options: Array.isArray(sourceOptions) ? sourceOptions.map((option, optionIndex) => optionTokens(option, optionIndex)).filter(tokens => tokens.length) : [],
      subQuestions,
      answerTokens: tokensOrFallback(sections?.answer, item.answer),
      explanationTokens: tokensOrFallback(sections?.analysis, item.explanation),
      sectionTitle: layoutItem?.sectionTitle || '', score: layoutItem?.score ?? null,
      assets: questionAssets(item.assets),
    };
  });
}

async function hydrateMedia(items, resolveQuestionAsset) {
  if (items.some(item => item.assets.length) && typeof resolveQuestionAsset !== 'function') throw failure('CLOUD_PAPER_RENDER_MEDIA_RESOLVER_REQUIRED');
  const hydrateTokens = async tokens => Promise.all(tokens.map(async token => {
    if (token.kind !== 'formula') return token;
    const bytes = formulaSvg(token.latex);
    try {
      const fallbackBytes = await sharp(bytes).png().toBuffer();
      const metadata = await sharp(fallbackBytes).metadata();
      return { ...token, media: { kind: 'formula', bytes, fallbackBytes, width: metadata.width, height: metadata.height } };
    } catch (_) {
      throw failure('CLOUD_PAPER_RENDER_FORMULA_INVALID');
    }
  }));
  return Promise.all(items.map(async item => ({
    ...item,
    media: await Promise.all(item.assets.map(async asset => {
      const bytes = await resolveQuestionAsset({ questionId: item.id, ...asset });
      if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > (64 * 1024 * 1024)) throw failure('CLOUD_PAPER_RENDER_MEDIA_INVALID');
      try {
        const metadata = await sharp(bytes).metadata();
        return { ...asset, bytes: Buffer.from(bytes), kind: 'image', width: metadata.width, height: metadata.height };
      } catch (_) {
        throw failure('CLOUD_PAPER_RENDER_MEDIA_INVALID');
      }
    })),
    stemTokens: await hydrateTokens(item.stemTokens),
    options: await Promise.all(item.options.map(hydrateTokens)),
    subQuestions: await Promise.all(item.subQuestions.map(async subQuestion => ({
      ...subQuestion,
      contentTokens: await hydrateTokens(subQuestion.contentTokens),
      answerTokens: await hydrateTokens(subQuestion.answerTokens),
    }))),
    answerTokens: await hydrateTokens(item.answerTokens),
    explanationTokens: await hydrateTokens(item.explanationTokens),
  })));
}

function subQuestionAnswerLines(item, prefix = '') {
  const answerLabel = String.fromCharCode(31572, 26696, 65306);
  return (item.subQuestions || []).filter(subQuestion => subQuestion.answer)
    .map(subQuestion => prefix + subQuestion.label + answerLabel + subQuestion.answer);
}

function answerRows(item, prefix = '') {
  const rows = [];
  for (const line of subQuestionAnswerLines(item, prefix)) rows.push(new Paragraph({ children: [new TextRun({ text: line })] }));
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
    for (const subQuestion of item.subQuestions || []) rows.push(new Paragraph({ children: [new TextRun({ text: subQuestion.label + subQuestion.content })] }));
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

function wordMediaRun(media) {
  return new ImageRun({
    data: media.bytes,
    type: media.kind === 'formula' ? 'svg' : (media.mimeType === 'image/png' ? 'png' : 'jpg'),
    ...(media.kind === 'formula' ? { fallback: { data: media.fallbackBytes, type: 'png' } } : {}),
    transformation: media.kind === 'formula' ? { width: 240, height: 72 } : { width: 420, height: 280 },
  });
}

function wordMediaRow(media) {
  return new Paragraph({ children: [wordMediaRun(media)] });
}

function appendWordTokens(rows, tokens, prefix = '') {
  let nextPrefix = prefix;
  let children = [];
  const flush = () => {
    if (children.length) rows.push(new Paragraph({ children }));
    children = [];
  };
  for (const token of tokens || []) {
    if (token.kind === 'text') {
      children.push(new TextRun({ text: nextPrefix + token.text }));
      nextPrefix = '';
    } else if (token.kind === 'formula' && token.media) {
      if (token.displayMode === 'inline') {
        if (nextPrefix) children.push(new TextRun({ text: nextPrefix }));
        nextPrefix = '';
        children.push(wordMediaRun(token.media));
        continue;
      }
      flush();
      if (nextPrefix) rows.push(new Paragraph({ children: [new TextRun({ text: nextPrefix })] }));
      nextPrefix = '';
      rows.push(wordMediaRow(token.media));
    }
  }
  if (nextPrefix) children.push(new TextRun({ text: nextPrefix }));
  flush();
}

function orderedAnswerRows(item, prefix = '') {
  const rows = [];
  for (const subQuestion of item.subQuestions || []) if (subQuestion.answerTokens.length) appendWordTokens(rows, subQuestion.answerTokens, prefix + subQuestion.label + paperLabels.answer);
  if (item.answerTokens.length) appendWordTokens(rows, item.answerTokens, prefix + paperLabels.answer);
  if (item.explanationTokens.length) appendWordTokens(rows, item.explanationTokens, prefix + paperLabels.analysis);
  return rows;
}

function orderedBodyRows(items, answerPosition) {
  const rows = [new Paragraph({ children: [new TextRun({ text: paperLabels.questions, bold: true })] })];
  let previousSection = '';
  for (const item of items) {
    if (item.sectionTitle && item.sectionTitle !== previousSection) {
      rows.push(new Paragraph({ children: [new TextRun({ text: item.sectionTitle, bold: true })] }));
      previousSection = item.sectionTitle;
    }
    const score = item.score === null ? '' : ' (' + item.score + ' pts)';
    appendWordTokens(rows, suffixedTokens(item.stemTokens, score), String(item.number) + '. ');
    for (const tokens of item.options) appendWordTokens(rows, tokens);
    for (const subQuestion of item.subQuestions || []) appendWordTokens(rows, subQuestion.contentTokens, subQuestion.label);
    for (const media of item.media || []) rows.push(wordMediaRow(media));
    if (answerPosition === 'after') rows.push(...orderedAnswerRows(item));
  }
  if (answerPosition !== 'after') {
    rows.push(new Paragraph({ children: [new TextRun({ text: paperLabels.answerSheet, bold: true })] }));
    for (const item of items) rows.push(...orderedAnswerRows(item, String(item.number) + '. '));
  }
  return rows;
}

async function wordBytes(input, items) {
  const document = new Document({ sections: [{ children: [
    new Paragraph({ children: [new TextRun({ text: input.title, bold: true, size: 32 })] }),
    ...orderedBodyRows(items, input.answerPosition),
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
      for (const subQuestion of item.subQuestions || []) document.fontSize(10).text(subQuestion.label + subQuestion.content).moveDown(0.25);
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
        for (const line of subQuestionAnswerLines(item)) document.fontSize(10).text(line);
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

function pdfMediaSize(media) {
  const naturalWidth = Number.isFinite(media.width) && media.width > 0 ? media.width : 280;
  const naturalHeight = Number.isFinite(media.height) && media.height > 0 ? media.height : 72;
  const maxWidth = media.kind === 'formula' ? 280 : 480;
  const maxHeight = media.kind === 'formula' ? 96 : 360;
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);
  return { width: Math.max(1, naturalWidth * scale), height: Math.max(1, naturalHeight * scale) };
}

function ensurePdfSpace(document, height) {
  const bottom = document.page.height - document.page.margins.bottom;
  if (document.y + height > bottom) document.addPage();
}

function drawPdfMedia(document, media) {
  try {
    const { width, height } = pdfMediaSize(media);
    ensurePdfSpace(document, height + 6);
    document.image(media.kind === 'formula' ? media.fallbackBytes : media.bytes, document.x, document.y, { width, height });
    document.y += height + 6;
    document.x = document.page.margins.left;
  } catch (_) {
    throw failure('CLOUD_PAPER_RENDER_MEDIA_INVALID');
  }
}

function compactFormulaText(latex) {
  const superscripts = Object.freeze({ 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾' });
  return String(latex || '')
    .replace(/\\(?:d?frac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\(?:d?frac)\s*([A-Za-z0-9]+)\s*\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
    .replace(/\\(?:times|cdot)/g, '×')
    .replace(/\\(?:leq|le)/g, '≤')
    .replace(/\\(?:geq|ge)/g, '≥')
    .replace(/\\neq/g, '≠')
    .replace(/\\(?:mathrm|text)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\^\{([^{}]*)\}/g, (_, value) => String(value).split('').map(char => superscripts[char] || '^' + char).join(''))
    .replace(/\^([0-9])/g, (_, value) => superscripts[value] || '^' + value)
    .replace(/_\{([^{}]*)\}/g, '($1)')
    .replace(/[{}]/g, '')
    .replace(/\\([A-Za-z]+)/g, '$1');
}

function drawPdfTokens(document, tokens, prefix = '', size = 10) {
  let text = prefix;
  const flushText = () => {
    if (!text) return;
    document.fontSize(size).text(text).moveDown(0.25);
    text = '';
  };
  for (const token of tokens || []) {
    if (token.kind === 'text') {
      text += token.text;
    } else if (token.kind === 'formula' && token.media) {
      if (token.displayMode === 'inline') {
        text += compactFormulaText(token.latex);
        continue;
      }
      flushText();
      drawPdfMedia(document, token.media);
    }
  }
  flushText();
}

function drawPdfAnswers(document, item, prefix = '') {
  for (const subQuestion of item.subQuestions || []) if (subQuestion.answerTokens.length) drawPdfTokens(document, subQuestion.answerTokens, prefix + subQuestion.label + paperLabels.answer);
  if (item.answerTokens.length) drawPdfTokens(document, item.answerTokens, prefix + paperLabels.answer);
  if (item.explanationTokens.length) drawPdfTokens(document, item.explanationTokens, prefix + paperLabels.analysis);
}

function orderedPdfBytes(input, items) {
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
      drawPdfTokens(document, suffixedTokens(item.stemTokens, score), String(item.number) + '. ', 11);
      for (const tokens of item.options) drawPdfTokens(document, tokens);
      for (const subQuestion of item.subQuestions || []) drawPdfTokens(document, subQuestion.contentTokens, subQuestion.label);
      for (const media of item.media || []) drawPdfMedia(document, media);
      if (input.answerPosition === 'after') drawPdfAnswers(document, item);
    }
    if (input.answerPosition !== 'after') {
      document.moveDown().fontSize(13).text(paperLabels.answerSheet);
      for (const item of items) drawPdfAnswers(document, item, String(item.number) + '. ');
    }
    document.end();
  });
}

async function renderPaperExport(input, { resolveQuestionAsset } = {}) {
  const current = request(input);
  const items = await hydrateMedia(questions(input.snapshot, current.layout, current.formulaMode), resolveQuestionAsset);
  const bytes = current.format === 'word' ? await wordBytes(current, items) : await orderedPdfBytes(current, items);
  return { bytes, mimeType: current.format === 'word' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf', extension: current.format === 'word' ? 'docx' : 'pdf' };
}

module.exports = Object.freeze({ compactFormulaText, renderPaperExport });
