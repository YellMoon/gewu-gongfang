'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
const { layoutInlineRuns } = require('./pdfInlineLayout');
const { paperOptionColumns } = require('./paperOptionLayout');
const { nativeFormulaComponent } = require('./wordNativeFormula');
const { withFormulaTagScope } = require('./formulaTagScope');
const { applyPaperTemplate, pdfTemplateProfile, questionCategory, isSolution, PAGE } = require('./paperExportTemplate');
const { isChoiceQuestionType } = require('./questionChoiceStructure');
const sharp = require('sharp');
const { Document, ImageRun, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, TableLayoutType, BorderStyle } = require('docx');
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');
const formulaAdaptor = liteAdaptor();
RegisterHTMLHandler(formulaAdaptor);

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function paperScore(value) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 1000
    && Math.round(value * 10) / 10 === value;
}

function paperScoreSuffix(value) {
  return value === null ? '' : `（${value} 分）`;
}

function pdfFontPath() {
  const candidates = [
    path.join(__dirname, '..', 'resources', 'fonts', 'NotoSerifCJKsc-Regular.otf'),
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
  if (value.type === 'image') {
    const attrs = value.attrs || {};
    if (typeof attrs.assetKey !== 'string' || !/^[0-9a-f]{64}$/.test(attrs.assetKey)) throw failure('CLOUD_PAPER_RENDER_MEDIA_INVALID');
    for (const dimension of ['width', 'height']) {
      if (attrs[dimension] != null && (!Number.isFinite(attrs[dimension]) || attrs[dimension] <= 0 || attrs[dimension] > 10000)) {
        throw failure('CLOUD_PAPER_RENDER_MEDIA_INVALID');
      }
    }
    if (attrs.align != null && !['left', 'center', 'right'].includes(attrs.align)) throw failure('CLOUD_PAPER_RENDER_MEDIA_INVALID');
    tokens.push({ kind: 'image', assetKey: attrs.assetKey, displayWidth: attrs.width, displayHeight: attrs.height, align: attrs.align || 'center' });
    return tokens;
  }
  const latex = canonicalFormula(value);
  if (latex) {
    tokens.push({ kind: 'formula', latex, displayMode: formulaDisplayMode(value) });
    return tokens;
  }
  if (value.type === 'text' && typeof value.text === 'string') {
    const text = value.text;
    const marks = Array.isArray(value.marks) ? value.marks : [];
    const verticalAlign = marks.find(mark => ['subscript', 'superscript'].includes(mark?.type))?.type;
    const emphasis = Object.fromEntries(['bold', 'italic', 'underline', 'strike'].filter(type => marks.some(mark => mark?.type === type)).map(type => [type, true]));
    if (text) tokens.push({ kind: 'text', text, ...emphasis, ...(verticalAlign ? { verticalAlign } : {}) });
    return tokens;
  }
  if (value.type === 'hardBreak') {
    tokens.push({ kind: 'break' });
    return tokens;
  }
  if (value.type === 'table') {
    if (!Array.isArray(value.content) || !value.content.length || value.content.length > 1000) throw failure('CLOUD_PAPER_RENDER_TABLE_INVALID');
    const rows = value.content.map(row => {
      if (row?.type !== 'tableRow' || (row.content !== undefined && !Array.isArray(row.content))) throw failure('CLOUD_PAPER_RENDER_TABLE_INVALID');
      return (row.content || []).map(cell => {
        if (!['tableCell', 'tableHeader'].includes(cell?.type)) throw failure('CLOUD_PAPER_RENDER_TABLE_INVALID');
        const colspan = cell.attrs?.colspan ?? 1, rowspan = cell.attrs?.rowspan ?? 1;
        return { colspan, rowspan, header: cell.type === 'tableHeader', tokens: richTokens(cell.content, seen, []) };
      });
    });
    tableGrid(rows);
    tokens.push({ kind: 'table', rows });
    return tokens;
  }
  if (value.type === 'paragraph' && tokens.length && tokens.at(-1).kind !== 'break') tokens.push({ kind: 'break' });
  for (const field of ['content', 'children', 'nodes', 'runs', 'items', 'paragraphs', 'body', 'blocks']) richTokens(value[field], seen, tokens);
  return tokens;
}

function tokensOrFallback(value, fallback) {
  const tokens = richTokens(value);
  return tokens.length ? tokens : richTokens(fallback);
}

function prefixedTokens(prefix, tokens) {
  const result = tokens.map(token => ({ ...token }));
  const firstText = result[0]?.kind === 'text' && !styledText(result[0]) ? result[0] : null;
  if (firstText) firstText.text = prefix + firstText.text;
  else if (prefix) result.unshift({ kind: 'text', text: prefix });
  return result;
}

function suffixedTokens(tokens, suffix) {
  const result = tokens.map(token => ({ ...token }));
  const lastText = result.at(-1)?.kind === 'text' && !styledText(result.at(-1)) ? result.at(-1) : null;
  if (lastText) lastText.text += suffix;
  else if (suffix) result.push({ kind: 'text', text: suffix });
  return result;
}

function styledText(token) {
  return token.verticalAlign || token.bold || token.italic || token.underline || token.strike;
}

function optionTokens(value, index) {
  if (typeof value === 'string') return prefixedTokens('', tokensOrFallback(value, ''));
  if (!value || typeof value !== 'object') return [];
  const label = structuredText(value.label || value.key || value.value || String.fromCharCode(65 + index));
  const tokens = tokensOrFallback(value.content ?? value.text ?? value.title, '');
  return prefixedTokens(label ? label + '. ' : '', tokens);
}

function normalizeOptionTokenGroups(value) {
  if (!Array.isArray(value)) return [];
  return value.map((option, index) => optionTokens(option, index)).filter(tokens => tokens.length);
}

function formulaSvg(latex) {
  try {
    return withFormulaTagScope(() => {
      const adaptor = formulaAdaptor;
      const tex = new TeX({ packages: AllPackages });
      const svg = new SVG({ fontCache: 'none' });
      const document = mathjax.document('', { InputJax: tex, OutputJax: svg });
      const container = document.convert(latex, { display: true });
      return Buffer.from(adaptor.outerHTML(adaptor.firstChild(container)), 'utf8');
    });
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
    if (layoutItem && (layoutItem.id !== item.id || typeof layoutItem.sectionTitle !== 'string' || !paperScore(layoutItem.score))) {
      throw failure('CLOUD_PAPER_RENDER_INPUT_INVALID');
    }
    const sections = richSections(item.richContent);
    const stemTokens = sections
      ? tokensOrFallback(sections.stem, item.stem)
      : richTokens(item.stem).concat(richTokens(item.richContent));
    const sourceOptions = Array.isArray(sections?.options) && sections.options.length ? sections.options : item.options;
    const optionGroups = normalizeOptionTokenGroups(sourceOptions);
    const subQuestions = Array.isArray(sections?.subQuestions) ? sections.subQuestions.map((subQuestion, subQuestionIndex) => ({
      label: structuredText(subQuestion?.label || `(${subQuestionIndex + 1})`, formulaMode),
      contentTokens: tokensOrFallback(subQuestion?.content, ''),
      answerTokens: tokensOrFallback(subQuestion?.answer, ''),
    })).filter(subQuestion => subQuestion.label || subQuestion.contentTokens.length || subQuestion.answerTokens.length) : [];
    return {
      id: item.id, number: index + 1, questionType: item.questionType, stemTokens, hasStructuredPlacement: Boolean(sections),
      options: optionGroups,
      optionColumns: paperOptionColumns(sourceOptions),
      subQuestions,
      answerTokens: tokensOrFallback(sections?.answer, item.answer),
      explanationTokens: tokensOrFallback(sections?.analysis, item.explanation),
      sectionTitle: layoutItem?.sectionTitle || '', score: layoutItem?.score ?? null,
      assets: questionAssets(item.assets),
    };
  });
}

async function hydrateInOrder(values, hydrate) {
  const hydrated = [];
  // A failed/pending asset must leave no detached work behind for the next tick.
  // Serial hydration also bounds native image decoding on small cloud hosts.
  for (const value of values) hydrated.push(await hydrate(value));
  return hydrated;
}

async function hydrateMedia(items, resolveQuestionAsset, nativeWord = false) {
  if (items.some(item => item.assets.length) && typeof resolveQuestionAsset !== 'function') throw failure('CLOUD_PAPER_RENDER_MEDIA_RESOLVER_REQUIRED');
  // Prepare all deliveries before converting any formulas. A pending asset is
  // not a fatal error: finish the bounded serial pass so NAS can fetch the rest,
  // then defer once with no detached work or repeated partial formula builds.
  let pending = null;
  const prepared = await hydrateInOrder(items, async item => ({
    ...item,
    media: await hydrateInOrder(item.assets, async asset => {
      let bytes;
      try { bytes = await resolveQuestionAsset({ questionId: item.id, ...asset }); }
      catch (error) {
        if (error?.code !== 'CLOUD_PAPER_EXPORT_MEDIA_PENDING') throw error;
        pending ||= error;
        return null;
      }
      if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > (64 * 1024 * 1024)) throw failure('CLOUD_PAPER_RENDER_MEDIA_INVALID');
      try {
        const metadata = await sharp(bytes).metadata();
        return { ...asset, bytes: Buffer.from(bytes), kind: 'image', width: metadata.width, height: metadata.height };
      } catch (_) {
        throw failure('CLOUD_PAPER_RENDER_MEDIA_INVALID');
      }
    }),
  }));
  if (pending) throw pending;
  const hydrateTokens = async (tokens, mediaByKey, placed) => hydrateInOrder(tokens, async token => {
    if (token.kind === 'table') return { ...token, rows: await hydrateInOrder(token.rows, row => hydrateInOrder(row, async cell => ({
      ...cell, tokens: await hydrateTokens(cell.tokens, mediaByKey, placed),
    }))) };
    if (token.kind === 'image') {
      const media = mediaByKey.get(token.assetKey);
      if (!media) throw failure('CLOUD_PAPER_RENDER_MEDIA_INVALID');
      placed.add(token.assetKey);
      return { ...token, media: { ...media, displayWidth: token.displayWidth, displayHeight: token.displayHeight } };
    }
    if (token.kind !== 'formula') return token;
    if (nativeWord) return { ...token, nativeFormula: nativeFormulaComponent(token.latex) };
    const bytes = formulaSvg(token.latex);
    try {
      const fallbackBytes = await sharp(bytes).png().toBuffer();
      const metadata = await sharp(fallbackBytes).metadata();
      return { ...token, media: { kind: 'formula', bytes, fallbackBytes, width: metadata.width, height: metadata.height } };
    } catch (_) {
      throw failure('CLOUD_PAPER_RENDER_FORMULA_INVALID');
    }
  });
  return hydrateInOrder(prepared, async item => {
    const mediaByKey = new Map(item.media.map(media => [media.assetKey, media]));
    const placed = new Set();
    const hydrate = tokens => hydrateTokens(tokens, mediaByKey, placed);
    const result = {
      ...item,
      stemTokens: await hydrate(item.stemTokens),
      options: await hydrateInOrder(item.options, hydrate),
      subQuestions: await hydrateInOrder(item.subQuestions, async subQuestion => ({
        ...subQuestion,
        contentTokens: await hydrate(subQuestion.contentTokens),
        answerTokens: await hydrate(subQuestion.answerTokens),
      })),
      answerTokens: await hydrate(item.answerTokens),
      explanationTokens: await hydrate(item.explanationTokens),
    };
    // A structured document defines its image occurrences, like the desktop
    // viewer. Its asset inventory also contains old formula previews; those
    // are not extra body content. Only legacy documents need implicit placement.
    result.media = item.hasStructuredPlacement ? [] : item.media.filter(media => !placed.has(media.assetKey));
    return result;
  });
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
    const score = paperScoreSuffix(item.score);
    rows.push(new Paragraph({ children: [new TextRun({ text: String(item.number) + '. ' + item.stem + score })] }));
    for (const option of item.options) rows.push(new Paragraph({ children: [new TextRun({ text: option })] }));
    for (const subQuestion of item.subQuestions || []) rows.push(new Paragraph({ children: [new TextRun({ text: subQuestion.label + subQuestion.content })] }));
    for (const media of item.media || []) {
      rows.push(new Paragraph({ children: [new ImageRun({
        data: media.bytes,
        type: media.kind === 'formula' ? 'svg' : (media.mimeType === 'image/png' ? 'png' : 'jpg'),
        ...(media.kind === 'formula' ? { fallback: { data: media.fallbackBytes, type: 'png' } } : {}),
        transformation: media.kind === 'formula' ? { width: 240, height: 72 } : wordImageTransformation(media),
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

function wordFormulaTransformation(media, displayMode = 'block') {
  const naturalWidth = Number.isFinite(media?.width) && media.width > 0 ? media.width : 120;
  const naturalHeight = Number.isFinite(media?.height) && media.height > 0 ? media.height : 36;
  const maximum = displayMode === 'inline' ? { width: 120, height: 24 } : { width: 360, height: 72 };
  const scale = Math.min(maximum.width / naturalWidth, maximum.height / naturalHeight, 1);
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

function wordImageTransformation(media) {
  const source = sourceImageSize(media);
  if (source) {
    // Match the supplied template content box, in CSS pixels (15 twips/px).
    return fitImageSize(source,
      (PAGE.width - PAGE.left - PAGE.right) / 15,
      (PAGE.height - PAGE.top - PAGE.bottom) / 15 - 24);
  }
  const width = Number.isFinite(media?.width) && media.width > 0 ? media.width : 420;
  const height = Number.isFinite(media?.height) && media.height > 0 ? media.height : 280;
  const scale = Math.min(420 / width, 280 / height, 1);
  return { width: width * scale, height: height * scale };
}

function sourceImageSize(media) {
  if (media.displayWidth == null && media.displayHeight == null) return null;
  return {
    width: media.displayWidth ?? media.displayHeight * media.width / media.height,
    height: media.displayHeight ?? media.displayWidth * media.height / media.width,
  };
}

function fitImageSize({ width, height }, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return { width: width * scale, height: height * scale };
}

function wordMediaRun(media, displayMode = 'block', maxWidth = Infinity) {
  const formula = media.kind === 'formula';
  return new ImageRun({
    // Word 2021 may select an embedded SVG formula and render it as a blank
    // placeholder even when a PNG fallback is present. Use the verified PNG
    // directly so formula content remains visible in desktop Word.
    data: formula ? media.fallbackBytes : media.bytes,
    type: formula ? 'png' : (media.mimeType === 'image/png' ? 'png' : 'jpg'),
    transformation: fitImageSize(formula ? wordFormulaTransformation(media, displayMode) : wordImageTransformation(media), maxWidth, Infinity),
  });
}

function wordMediaRow(media, displayMode = 'block', alignment, maxWidth, keepNext = false) {
  return new Paragraph({ alignment, keepNext, children: [wordMediaRun(media, displayMode, maxWidth)] });
}

function tableGrid(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw failure('CLOUD_PAPER_RENDER_TABLE_INVALID');
  const occupied = rows.map(() => []), cells = [];
  let columns = 0, area = 0;
  rows.forEach((row, y) => {
    let x = 0;
    for (const cell of row) {
      while (occupied[y][x]) x++;
      const colspan = cell.colspan ?? 1, rowspan = cell.rowspan ?? 1;
      if (![colspan, rowspan].every(n => Number.isInteger(n) && n > 0 && n <= 1000) || y + rowspan > rows.length || x + colspan > 1000) throw failure('CLOUD_PAPER_RENDER_TABLE_INVALID');
      area += colspan * rowspan;
      if (area > 20000) throw failure('CLOUD_PAPER_RENDER_TABLE_INVALID');
      for (let r = y; r < y + rowspan; r++) for (let c = x; c < x + colspan; c++) {
        if (occupied[r][c]) throw failure('CLOUD_PAPER_RENDER_TABLE_INVALID');
        occupied[r][c] = true;
      }
      cells.push({ ...cell, colspan, rowspan, row: y, column: x });
      x += colspan;
      columns = Math.max(columns, x);
    }
  });
  if (!columns || occupied.some(row => row.length !== columns || Array.from({ length: columns }, (_, i) => row[i]).some(value => !value))) throw failure('CLOUD_PAPER_RENDER_TABLE_INVALID');
  return { cells, columns };
}

function wordTable(token, maxWidth) {
  const { columns } = tableGrid(token.rows);
  const width = Math.floor(Math.min(maxWidth == null ? Infinity : maxWidth * 15, PAGE.width - PAGE.left - PAGE.right));
  const cellWidth = width / columns;
  const border = { style: BorderStyle.SINGLE, size: 4, color: '777777' };
  const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
  return new Table({ width: { size: width, type: WidthType.DXA }, columnWidths: Array(columns).fill(Math.floor(cellWidth)), layout: TableLayoutType.FIXED, borders,
    rows: token.rows.map(row => new TableRow({ cantSplit: true, children: row.map(cell => {
      const children = [];
      appendWordTokens(children, cell.tokens, '', Math.max(1, (cellWidth * cell.colspan - 160) / 15));
      if (!children.length || children.at(-1) instanceof Table) children.push(new Paragraph(''));
      return new TableCell({ columnSpan: cell.colspan, rowSpan: cell.rowspan, width: { size: Math.floor(cellWidth * cell.colspan), type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 80, right: 80 }, borders, children });
    }) })) });
}

function appendWordTokens(rows, tokens, prefix = '', maxWidth, keepWithFollowing = false) {
  // Keep only the final stem paragraph/image with the first option row. Earlier
  // paragraphs still flow normally; do not force a long question onto one page.
  const lastContentIndex = (tokens || []).findLastIndex(token => token.kind !== 'break');
  let nextPrefix = prefix;
  let children = [];
  const flush = (keepNext = false) => {
    if (children.length) rows.push(new Paragraph({ children, keepNext, widowControl: keepWithFollowing ? true : undefined }));
    children = [];
  };
  for (const [index, token] of (tokens || []).entries()) {
    if (token.kind === 'text') {
      if (nextPrefix && styledText(token)) children.push(new TextRun({ text: nextPrefix }));
      children.push(new TextRun({ text: (styledText(token) ? '' : nextPrefix) + token.text,
        bold: token.bold, italics: token.italic, underline: token.underline ? {} : undefined, strike: token.strike,
        subScript: token.verticalAlign === 'subscript', superScript: token.verticalAlign === 'superscript' }));
      nextPrefix = '';
    } else if (token.kind === 'table') {
      if (nextPrefix) children.push(new TextRun({ text: nextPrefix }));
      nextPrefix = '';
      flush(true);
      rows.push(wordTable(token, maxWidth));
    } else if (token.kind === 'break') {
      flush(tokens[index + 1]?.kind === 'image' || (keepWithFollowing && index > lastContentIndex));
    } else if (token.kind === 'image' && token.media) {
      if (nextPrefix) children.push(new TextRun({ text: nextPrefix }));
      nextPrefix = '';
      flush(true);
      rows.push(wordMediaRow(token.media, 'block', token.align, maxWidth, keepWithFollowing && index === lastContentIndex));
    } else if (token.kind === 'formula' && token.nativeFormula) {
      if (token.displayMode !== 'inline') flush();
      if (nextPrefix) children.push(new TextRun({ text: nextPrefix }));
      nextPrefix = '';
      children.push(token.nativeFormula);
      if (token.displayMode !== 'inline') flush(keepWithFollowing && index === lastContentIndex);
    } else if (token.kind === 'formula' && token.media) {
      if (token.displayMode === 'inline') {
        if (nextPrefix) children.push(new TextRun({ text: nextPrefix }));
        nextPrefix = '';
        children.push(wordMediaRun(token.media, token.displayMode, maxWidth));
        continue;
      }
      flush();
      if (nextPrefix) rows.push(new Paragraph({ children: [new TextRun({ text: nextPrefix })] }));
      nextPrefix = '';
      rows.push(wordMediaRow(token.media, token.displayMode, undefined, maxWidth, keepWithFollowing && index === lastContentIndex));
    }
  }
  if (nextPrefix) children.push(new TextRun({ text: nextPrefix }));
  flush(keepWithFollowing);
}

function orderedAnswerRows(item, prefix = '') {
  const rows = [];
  if (item.answerTokens.length) appendWordTokens(rows, item.answerTokens, prefix + paperLabels.answer);
  for (const subQuestion of item.subQuestions || []) if (subQuestion.answerTokens.length) appendWordTokens(rows, subQuestion.answerTokens, prefix + subQuestion.label + paperLabels.answer);
  if (item.explanationTokens.length) appendWordTokens(rows, item.explanationTokens, prefix + paperLabels.analysis);
  return rows;
}

function appendWordOptions(rows, options, columns) {
  if (columns === 1 || !options.length) {
    for (const [index, tokens] of options.entries()) appendWordTokens(rows, tokens, '', undefined, index < options.length - 1);
    return;
  }
  const width = PAGE.width - PAGE.left - PAGE.right;
  const cellWidth = Math.floor(width / columns);
  const border = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
  const tableRows = [];
  for (let start = 0; start < options.length; start += columns) {
    const keepNextRow = start + columns < options.length;
    tableRows.push(new TableRow({ cantSplit: true, children: Array.from({ length: columns }, (_, index) => {
      const children = [];
      appendWordTokens(children, options[start + index] || [], '', (cellWidth - 240) / 15, keepNextRow);
      return new TableCell({ width: { size: cellWidth, type: WidthType.DXA }, borders,
        margins: { top: 0, bottom: 80, left: 0, right: 240 }, children: children.length ? children : [new Paragraph({ text: '', keepNext: keepNextRow })] });
    }) }));
  }
  rows.push(new Table({ width: { size: width, type: WidthType.DXA }, columnWidths: Array(columns).fill(cellWidth),
    layout: TableLayoutType.FIXED, borders, rows: tableRows }));
}

async function wordBytes(input, items) {
  const rows = [], blocks = [];
  for (const item of items) {
    const start = rows.length;
    appendWordTokens(rows, suffixedTokens(item.stemTokens, paperScoreSuffix(item.score)), String(item.number) + '. ', undefined, item.options.length > 0);
    appendWordOptions(rows, item.options, item.optionColumns);
    for (const subQuestion of item.subQuestions || []) appendWordTokens(rows, subQuestion.contentTokens, subQuestion.label);
    for (const media of item.media || []) rows.push(wordMediaRow(media));
    if (input.answerPosition === 'after') rows.push(...orderedAnswerRows(item));
    blocks.push({ start, end: rows.length, questionType: item.questionType, sectionTitle: item.sectionTitle,
      number: item.number, choiceAnswer: item.answerTokens.filter(t => t.kind === 'text').map(t => t.text).join('') });
  }
  const bodyCount = rows.length;
  if (input.answerPosition !== 'after') for (const item of items) rows.push(...orderedAnswerRows(item, String(item.number) + '. '));
  const document = new Document({ sections: [{ children: rows }] });
  return applyPaperTemplate(await Packer.toBuffer(document), { title: input.title, answerPosition: input.answerPosition, blocks, bodyCount });
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
      const score = paperScoreSuffix(item.score);
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

function pdfMediaSize(media, maxPageWidth = 480, maxPageHeight = 360) {
  const source = media.kind === 'image' ? sourceImageSize(media) : null;
  if (source) return fitImageSize({ width: source.width * 0.75, height: source.height * 0.75 }, maxPageWidth, maxPageHeight);
  const naturalWidth = Number.isFinite(media.width) && media.width > 0 ? media.width : 280;
  const naturalHeight = Number.isFinite(media.height) && media.height > 0 ? media.height : 72;
  const maxWidth = media.kind === 'formula' ? 280 : 480;
  const maxHeight = media.kind === 'formula' ? 96 : 360;
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, maxPageWidth / naturalWidth, maxPageHeight / naturalHeight, 1);
  return { width: Math.max(1, naturalWidth * scale), height: Math.max(1, naturalHeight * scale) };
}

function ensurePdfSpace(document, height) {
  if (document._measureOnly) return;
  const bottom = document.page.height - document.page.margins.bottom;
  if (document.y + height > bottom) document.addPage();
}

function drawPdfMedia(document, media, alignment = 'left') {
  try {
    const left = document.page.margins.left;
    const pageWidth = document.page.width - left - document.page.margins.right;
    const pageHeight = document.page.height - document.page.margins.top - document.page.margins.bottom - 6;
    const { width, height } = pdfMediaSize(media, pageWidth, pageHeight);
    ensurePdfSpace(document, height + 6);
    const x = alignment === 'center' ? left + (pageWidth - width) / 2 : alignment === 'right' ? left + pageWidth - width : left;
    document.image(media.kind === 'formula' ? media.fallbackBytes : media.bytes, x, document.y, { width, height });
    document.y += height + 6;
    document.x = document.page.margins.left;
  } catch (_) {
    throw failure('CLOUD_PAPER_RENDER_MEDIA_INVALID');
  }
}

function measurePdfTokens(document, tokens, width, size) {
  const margins = { ...document.page.margins, left: 0, right: document.page.width - width };
  const probe = { x: 0, y: 0, _measureOnly: true, page: { ...document.page, margins },
    fontSize(value) { document.fontSize(value); return this; },
    currentLineHeight: () => document.currentLineHeight(true), widthOfString: text => document.widthOfString(text),
    save() { return this; }, restore() { return this; }, lineWidth() { return this; },
    text() { return this; }, image() { return this; }, rect() { return this; }, stroke() { return this; } };
  drawPdfTokens(probe, tokens, '', size, () => {});
  return probe.y;
}

function drawPdfTable(document, token, size, drawVector) {
  const { cells, columns } = tableGrid(token.rows);
  const margins = { ...document.page.margins };
  const width = document.page.width - margins.left - margins.right, unit = width / columns, padding = 4;
  if (unit <= padding * 2) throw failure('CLOUD_PAPER_RENDER_TABLE_TOO_WIDE');
  const heights = token.rows.map(() => size + padding * 2);
  const measured = cells.map(cell => ({ ...cell, height: measurePdfTokens(document, cell.tokens, unit * cell.colspan - padding * 2, size) + padding * 2 }));
  for (const cell of measured.filter(cell => cell.rowspan === 1)) heights[cell.row] = Math.max(heights[cell.row], cell.height);
  for (const cell of measured.filter(cell => cell.rowspan > 1)) {
    const available = heights.slice(cell.row, cell.row + cell.rowspan).reduce((sum, value) => sum + value, 0);
    if (cell.height > available) heights[cell.row + cell.rowspan - 1] += cell.height - available;
  }
  // Break only between independent rows, never through a merged cell. A cell
  // taller than a page fails explicitly instead of clipping or flattening it.
  for (let start = 0; start < heights.length;) {
    let end = start + 1;
    for (let row = start; row < end; row++) for (const cell of measured.filter(cell => cell.row === row)) end = Math.max(end, row + cell.rowspan);
    const height = heights.slice(start, end).reduce((sum, value) => sum + value, 0);
    if (!document._measureOnly && height > document.page.height - margins.top - margins.bottom) throw failure('CLOUD_PAPER_RENDER_TABLE_TOO_TALL');
    ensurePdfSpace(document, height);
    const top = document.y;
    try {
      for (const cell of measured.filter(cell => cell.row >= start && cell.row < end)) {
        const left = margins.left + cell.column * unit;
        const y = top + heights.slice(start, cell.row).reduce((sum, value) => sum + value, 0);
        const height = heights.slice(cell.row, cell.row + cell.rowspan).reduce((sum, value) => sum + value, 0);
        document.save().lineWidth(0.5).rect(left, y, unit * cell.colspan, height).stroke().restore();
        document.page.margins = { ...margins, left: left + padding, right: document.page.width - left - unit * cell.colspan + padding };
        document.x = left + padding;
        document.y = y + padding;
        drawPdfTokens(document, cell.tokens, '', size, drawVector);
      }
    } finally {
      document.page.margins = { ...margins };
      document.x = margins.left;
      document.y = top + height;
    }
    start = end;
  }
  document.y += 4;
}

function drawPdfTokens(document, tokens, prefix = '', size = 10.5, drawVector = SVGtoPDF) {
  let inline = prefix ? [{ kind: 'text', text: prefix }] : [];
  const flush = (followingHeight = 0) => {
    if (!inline.length) return;
    document.fontSize(size);
    const left = document.page.margins.left;
    const lineHeight = document.currentLineHeight(true);
    const lines = layoutInlineRuns({tokens:inline,size,lineHeight,
      maxWidth:document.page.width-left-document.page.margins.right,
      measureText:(text, runSize = size)=>document.fontSize(runSize).widthOfString(text)});
    for (const line of lines) {
      if (followingHeight && line === lines.at(-1)) {
        const groupHeight = line.height + 2 + size * 0.25 + followingHeight;
        if (groupHeight <= document.page.height - document.page.margins.top - document.page.margins.bottom) ensurePdfSpace(document, groupHeight);
      }
      ensurePdfSpace(document,line.height);
      const top = document.y;
      let x = left;
      for (const run of line.runs) {
        const y = top + (line.height-run.height)/2 + (run.offsetY || 0);
        if (run.kind === 'text') {
          const draw = () => document.fontSize(run.fontSize || size).text(run.text, x, y,
            { lineBreak: false, oblique: run.italic, underline: run.underline, strike: run.strike, fill: true, stroke: Boolean(run.bold) });
          if (run.bold) {
            // The bundled CJK face is regular. Use bounded synthetic emphasis
            // without substituting a font that may drop Chinese characters.
            document.save();
            try { document.lineWidth((run.fontSize || size) * 0.025); draw(); }
            finally { document.restore(); }
          } else draw();
        }
        else {
          // SVG text fallbacks select their own font. Graphics save/restore does
          // not restore PDFKit's JS font selection for the following CJK runs.
          const fontSource = document._fontSource;
          const fontFamily = document._fontFamily;
          try {
            drawVector(document,run.token.media.bytes.toString('utf8'),x,y,
              {width:run.width,height:run.height,preserveAspectRatio:'xMidYMid meet',
                // MathJax uses SVG text for upright Greek and full-width operators.
                // PDF standard serif fonts silently omit these Unicode glyphs.
                fontCallback(_family, bold, italic, options) {
                  const fallback = pdfFontPath();
                  if (!fallback) throw failure('CLOUD_PAPER_RENDER_FONT_UNAVAILABLE');
                  options.fauxBold = bold;
                  options.fauxItalic = italic;
                  return fallback;
                }});
          } catch (_) { throw failure('CLOUD_PAPER_RENDER_FORMULA_INVALID'); }
          finally {
            if (fontSource !== undefined) document.font(fontSource, fontFamily, size);
          }
        }
        x += run.width;
      }
      document.x = left;
      document.y = top + line.height + 2;
    }
    document.y += size * 0.25;
    document.fontSize(size);
    inline = [];
  };
  for (const [index, token] of (tokens || []).entries()) {
    if (token.kind === 'text') {
      inline.push(token);
    } else if (token.kind === 'table') {
      flush();
      drawPdfTable(document, token, size, drawVector);
    } else if (token.kind === 'break') {
      // Let the image flush its preceding line with a keep-together height.
      if (tokens[index + 1]?.kind !== 'image') flush();
    } else if (token.kind === 'image' && token.media) {
      const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right;
      const pageHeight = document.page.height - document.page.margins.top - document.page.margins.bottom - 6;
      flush(pdfMediaSize(token.media, pageWidth, pageHeight).height + 6);
      drawPdfMedia(document, token.media, token.align);
    } else if (token.kind === 'formula' && token.media) {
      if (token.displayMode === 'inline') {
        inline.push(token);
        continue;
      }
      flush();
      drawPdfMedia(document, token.media);
    }
  }
  flush();
}

function drawPdfAnswers(document, item, prefix = '') {
  if (item.answerTokens.length) drawPdfTokens(document, item.answerTokens, prefix + paperLabels.answer);
  for (const subQuestion of item.subQuestions || []) if (subQuestion.answerTokens.length) drawPdfTokens(document, subQuestion.answerTokens, prefix + subQuestion.label + paperLabels.answer);
  if (item.explanationTokens.length) drawPdfTokens(document, item.explanationTokens, prefix + paperLabels.analysis);
}

function drawPdfOptions(document, options, columns) {
  if (columns === 1 || !options.length) {
    for (const tokens of options) drawPdfTokens(document, tokens);
    return;
  }
  const margins = { ...document.page.margins };
  const availableWidth = document.page.width - margins.left - margins.right;
  const gap = 16;
  const width = (availableWidth - gap * (columns - 1)) / columns;
  for (let start = 0; start < options.length; start += columns) {
    const row = options.slice(start, start + columns);
    let overflow = false;
    const heights = row.map(tokens => measurePdfTokens(document, tokens, width, 10.5));
    overflow = heights.some(height => height > document.page.height - margins.top - margins.bottom);
    if (overflow) {
      // A very tall option must flow normally instead of clipping a fixed row.
      for (const tokens of row) drawPdfTokens(document, tokens);
      continue;
    }
    const height = Math.max(...heights);
    ensurePdfSpace(document, height);
    const top = document.y;
    try {
      row.forEach((tokens, index) => {
        const left = margins.left + index * (width + gap);
        document.page.margins = { ...margins, left, right: document.page.width - left - width };
        document.x = left;
        document.y = top;
        drawPdfTokens(document, tokens);
      });
    } finally {
      document.page.margins = { ...margins };
      document.x = margins.left;
      document.y = top + height;
    }
  }
}

async function orderedPdfBytes(input, items) {
  const template = await pdfTemplateProfile();
  return new Promise((resolve, reject) => {
    const margins = { top: PAGE.top / 20, left: PAGE.left / 20, right: PAGE.right / 20, bottom: PAGE.bottom / 20 };
    const document = new PDFDocument({ size: [PAGE.width / 20, PAGE.height / 20], margins, compress: false, bufferPages: true });
    const font = pdfFontPath();
    if (!font) return reject(failure('CLOUD_PAPER_RENDER_FONT_UNAVAILABLE'));
    const chunks = [];
    document.on('data', chunk => chunks.push(Buffer.from(chunk)));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.font(font);
    const contentWidth = document.page.width - margins.left - margins.right;
    document.lineWidth(template.titleSize * 0.025).fontSize(template.titleSize).text(template.title.replace('\u8bd5\u5377\u540d', input.title), { align: 'center', fill: true, stroke: true });
    document.moveDown(0.5).fontSize(template.fontSize).text(template.metadata, { align: 'center' });
    document.moveDown(2);
    let previousSection = '', sectionNumber = 0, previousSolution = false;
    for (const item of items) {
      const solution = isSolution(item), section = item.sectionTitle || questionCategory(item);
      if ((solution && item.number > 1) || previousSolution) document.addPage();
      if (section !== previousSection) {
        const label = item.sectionTitle || `${['\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d','\u4e03','\u516b','\u4e5d','\u5341'][sectionNumber] || sectionNumber + 1}\u3001${section}`;
        ensurePdfSpace(document, 48);
        document.lineWidth(template.fontSize * 0.025).fontSize(template.fontSize).text(label, { fill: true, stroke: true }).moveDown(0.3);
        previousSection = section; sectionNumber++;
      }
      const score = paperScoreSuffix(item.score);
      drawPdfTokens(document, suffixedTokens(item.stemTokens, score), String(item.number) + '. ', template.fontSize);
      drawPdfOptions(document, item.options, item.optionColumns);
      for (const subQuestion of item.subQuestions || []) drawPdfTokens(document, subQuestion.contentTokens, subQuestion.label);
      for (const media of item.media || []) drawPdfMedia(document, media);
      if (input.answerPosition === 'after') drawPdfAnswers(document, item);
      if (solution) {
        ensurePdfSpace(document, 240);
        document.y += 240;
      }
      previousSolution = solution;
    }
    let answerPage = Infinity;
    if (input.answerPosition !== 'after') {
      document.addPage();
      answerPage = document.bufferedPageRange().count - 1;
      document.lineWidth(template.fontSize * 0.025).fontSize(template.fontSize).text(template.answerTitle.replace('\u8bd5\u5377\u540d', input.title), { align: 'center', fill: true, stroke: true }).moveDown();
      const choices = items.filter(item => isChoiceQuestionType(item.questionType));
      for (let start = 0; start < choices.length; start += 10) {
        ensurePdfSpace(document, 40);
        const batch = choices.slice(start, start + 10), top = document.y, width = contentWidth / 11;
        for (let row = 0; row < 2; row++) for (let column = 0; column < 11; column++) {
          const item = batch[column - 1], x = margins.left + column * width, y = top + row * 20;
          const value = column === 0 ? (row ? '\u7b54\u6848' : '\u9898\u53f7') : item ? (row ? item.answerTokens.filter(t => t.kind === 'text').map(t => t.text).join('') : String(item.number)) : '';
          document.lineWidth(0.5).rect(x, y, width, 20).stroke();
          document.fontSize(template.fontSize).text(value, x + 2, y + 3, { width: width - 4, align: 'center', lineBreak: false });
        }
        document.x = margins.left; document.y = top + 40;
      }
      document.moveDown();
      for (const item of items) drawPdfAnswers(document, item, String(item.number) + '. ');
    }
    const total = document.bufferedPageRange().count;
    for (let index = 0; index < total; index++) {
      document.switchToPage(index);
      // Footer text sits outside the body margin; prevent PDFKit from treating
      // it as overflowing body content and creating phantom extra pages.
      document.page.margins.bottom = 0;
      const number = index >= answerPage ? index - answerPage + 1 : index + 1;
      // The reference has contact and trailing paragraphs beneath the rule.
      const ruleY = document.page.height - PAGE.footer / 20 - 30;
      document.font(font).fontSize(template.footerSize).text(`\u7b2c ${number} \u9875 \u5171 ${total} \u9875`, margins.left, ruleY - 13, { width: contentWidth, align: 'center', lineBreak: false });
      document.lineWidth(1.5).moveTo(margins.left, ruleY).lineTo(document.page.width - margins.right, ruleY).stroke();
      document.text(template.contact, margins.left, ruleY + 3, { width: contentWidth, align: 'right', lineBreak: false });
      document.page.margins.bottom = margins.bottom;
    }
    document.end();
  });
}

async function renderPaperExport(input, { resolveQuestionAsset } = {}) {
  const current = request(input);
  const items = await hydrateMedia(questions(input.snapshot, current.layout, current.formulaMode), resolveQuestionAsset, current.format === 'word' && current.formulaMode === 'word-native');
  const bytes = current.format === 'word' ? await wordBytes(current, items) : await orderedPdfBytes(current, items);
  return { bytes, mimeType: current.format === 'word' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf', extension: current.format === 'word' ? 'docx' : 'pdf' };
}

module.exports = Object.freeze({ drawPdfTokens, drawPdfOptions, normalizeOptionTokenGroups, wordFormulaTransformation, renderPaperExport });
