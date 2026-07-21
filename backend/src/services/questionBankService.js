const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const sanitizeHtml = require('sanitize-html');
const cache = require('./cacheService');
const eventBus = require('./eventBus');
const { canDeleteQuestion, committedDeleteError } = require('./questionDeletionPolicy');
const { projectRichContent: projectCanonicalRichContent } = require('./questionRichContentProjection');

function now() {
  return new Date().toISOString();
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function escapeLikePattern(value) {
  return String(value || '').replace(/[\\%_]/g, match => `\\${match}`);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

const RICH_CONTENT_MAX_BYTES = 4 * 1024 * 1024;
const RICH_CONTENT_MAX_DEPTH = 40;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const RICH_CONTENT_NODE_TYPES = new Set([
  'doc', 'paragraph', 'text', 'hardBreak', 'heading', 'blockquote', 'bulletList', 'orderedList',
    'listItem', 'horizontalRule', 'codeBlock', 'formula', 'formulaBlock', 'image',
]);
const RICH_CONTENT_MARK_TYPES = new Set([
  'bold', 'italic', 'underline', 'strike', 'code', 'subscript', 'superscript', 'textStyle', 'fontFamily', 'fontSize', 'highlight', 'link',
]);
const SAFE_RICH_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_RICH_REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,1023}$/;
const RICH_FONT_FAMILIES = new Set(['SimSun', 'Microsoft YaHei', 'KaiTi', 'FangSong', 'Arial', 'Times New Roman']);
const RICH_FONT_SIZES = new Set(['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px']);
const RICH_LINE_HEIGHTS = new Set(['1', '1.25', '1.5', '1.75', '2']);
const RICH_TEXT_ALIGNS = new Set(['left', 'center', 'right', 'justify']);
const RICH_COLOR = /^#[0-9a-f]{3,8}$/i;

function normalizeRichContent(value) {
  if (value === undefined || value === null || value === '') return null;
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch (_error) { throw new Error('rich_content must be valid JSON'); }
  }
  parsed = JSON.parse(JSON.stringify(parsed));
  const stripOptionalNulls = node => {
    if (!node || typeof node !== 'object') return;
    if (node.attrs && (node.type === 'formula' || node.type === 'formulaBlock')) {
      for (const key of ['sourceRef', 'warnings', 'conversionStatus', 'sourceFormat', 'previewRef']) if (node.attrs[key] == null) delete node.attrs[key];
    }
    if (node.attrs && node.type === 'image') {
      for (const key of ['src', 'alt', 'title', 'width', 'height', 'align']) if (node.attrs[key] == null) delete node.attrs[key];
    }
    for (const child of Object.values(node)) if (child && typeof child === 'object') Array.isArray(child) ? child.forEach(stripOptionalNulls) : stripOptionalNulls(child);
  };
  stripOptionalNulls(parsed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('rich_content must be an object');
  }
  if (parsed.version !== 1 || parsed.type !== 'question-document' || !parsed.sections || typeof parsed.sections !== 'object') {
    throw new Error('rich_content must be a version 1 question-document');
  }
  const visit = (node, depth = 0) => {
    if (depth > RICH_CONTENT_MAX_DEPTH) throw new Error('rich_content nesting is too deep');
    if (node === null || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return;
    if (typeof node !== 'object') throw new Error('rich_content contains unsupported values');
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (UNSAFE_OBJECT_KEYS.has(key)) throw new Error('rich_content contains an unsafe key');
      visit(child, depth + 1);
    }
  };
  visit(parsed);
  const allowKeys = (attrs, allowed, label) => {
    for (const key of Object.keys(attrs || {})) if (!allowed.includes(key)) throw new Error(`rich_content ${label} contains unsupported attr ${key}`);
  };
  const validateNode = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || !RICH_CONTENT_NODE_TYPES.has(node.type)) {
      throw new Error('rich_content contains an unsupported node');
    }
    if (depth > RICH_CONTENT_MAX_DEPTH) throw new Error('rich_content nesting is too deep');
    if (node.type === 'text' && typeof node.text !== 'string') throw new Error('rich_content text node requires text');
    const attrs = node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs) ? node.attrs : {};
    if (['doc', 'text', 'hardBreak', 'blockquote', 'bulletList', 'listItem', 'horizontalRule'].includes(node.type)) allowKeys(attrs, [], node.type);
    if (['paragraph', 'heading'].includes(node.type)) {
      allowKeys(attrs, node.type === 'heading' ? ['level', 'textAlign', 'lineHeight', 'indent'] : ['textAlign', 'lineHeight', 'indent'], node.type);
      if (attrs.textAlign != null && !RICH_TEXT_ALIGNS.has(String(attrs.textAlign))) throw new Error(`rich_content ${node.type} textAlign is invalid`);
      if (attrs.lineHeight != null && !RICH_LINE_HEIGHTS.has(String(attrs.lineHeight))) throw new Error(`rich_content ${node.type} lineHeight is invalid`);
      if (attrs.indent != null && (!Number.isInteger(attrs.indent) || attrs.indent < 0 || attrs.indent > 8)) throw new Error(`rich_content ${node.type} indent is invalid`);
      if (node.type === 'heading' && (!Number.isInteger(attrs.level) || attrs.level < 1 || attrs.level > 6)) throw new Error('rich_content heading level is invalid');
    }
    if (node.type === 'orderedList') {
      allowKeys(attrs, ['start'], 'orderedList');
      if (attrs.start != null && (!Number.isInteger(attrs.start) || attrs.start < 1 || attrs.start > 100000)) throw new Error('rich_content orderedList start is invalid');
    }
    if (node.type === 'codeBlock') {
      allowKeys(attrs, ['language'], 'codeBlock');
      if (attrs.language != null && !/^[A-Za-z0-9_+-]{1,40}$/.test(String(attrs.language))) throw new Error('rich_content codeBlock language is invalid');
    }
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks) || node.marks.some(mark => !mark || !RICH_CONTENT_MARK_TYPES.has(mark.type))) {
        throw new Error('rich_content contains an unsupported mark');
      }
      for (const mark of node.marks) {
        const markAttrs = mark.attrs && typeof mark.attrs === 'object' && !Array.isArray(mark.attrs) ? mark.attrs : {};
        if (['bold', 'italic', 'underline', 'strike', 'code', 'subscript', 'superscript'].includes(mark.type)) allowKeys(markAttrs, [], mark.type);
        if (mark.type === 'textStyle') {
          allowKeys(markAttrs, ['color', 'fontFamily', 'fontSize'], 'textStyle');
          if (markAttrs.color != null && !RICH_COLOR.test(String(markAttrs.color))) throw new Error('rich_content textStyle color is invalid');
          if (markAttrs.fontFamily != null && !RICH_FONT_FAMILIES.has(String(markAttrs.fontFamily))) throw new Error('rich_content textStyle fontFamily is invalid');
          if (markAttrs.fontSize != null && !RICH_FONT_SIZES.has(String(markAttrs.fontSize))) throw new Error('rich_content textStyle fontSize is invalid');
        }
        if (mark.type === 'fontFamily') { allowKeys(markAttrs, ['fontFamily'], 'fontFamily'); if (!RICH_FONT_FAMILIES.has(String(markAttrs.fontFamily))) throw new Error('rich_content fontFamily is invalid'); }
        if (mark.type === 'fontSize') { allowKeys(markAttrs, ['fontSize'], 'fontSize'); if (!RICH_FONT_SIZES.has(String(markAttrs.fontSize))) throw new Error('rich_content fontSize is invalid'); }
        if (mark.type === 'highlight') { allowKeys(markAttrs, ['color'], 'highlight'); if (markAttrs.color != null && !RICH_COLOR.test(String(markAttrs.color))) throw new Error('rich_content highlight color is invalid'); }
        if (mark.type === 'link') {
          allowKeys(markAttrs, ['href', 'target', 'rel', 'class'], 'link');
          if (typeof markAttrs.href !== 'string' || !(/^https?:\/\//i.test(markAttrs.href) || /^\/(?!\/)/.test(markAttrs.href) || /^#[A-Za-z0-9_-]+$/.test(markAttrs.href))) throw new Error('rich_content link href is invalid');
          if (markAttrs.target != null && !['_blank', '_self'].includes(markAttrs.target)) throw new Error('rich_content link target is invalid');
          if (markAttrs.rel != null && markAttrs.rel !== 'noopener noreferrer') throw new Error('rich_content link rel is invalid');
          if (markAttrs.class != null && !/^[A-Za-z0-9_-]{1,64}$/.test(markAttrs.class)) throw new Error('rich_content link class is invalid');
        }
      }
    }
    if (node.type === 'formula' || node.type === 'formulaBlock') {
      allowKeys(attrs, ['id', 'canonicalLatex', 'displayMode', 'sourceRef', 'warnings', 'conversionStatus', 'sourceFormat', 'previewRef'], 'formula');
      if (!SAFE_RICH_ID.test(String(attrs.id || '')) || typeof attrs.canonicalLatex !== 'string' || !attrs.canonicalLatex.trim()
        || attrs.canonicalLatex.length > 10000 || !['inline', 'block'].includes(attrs.displayMode)) {
        throw new Error('rich_content formula node is invalid');
      }
      if (attrs.sourceRef != null && !SAFE_RICH_REF.test(String(attrs.sourceRef))) throw new Error('rich_content formula sourceRef is invalid');
      if (attrs.previewRef != null && !SAFE_RICH_REF.test(String(attrs.previewRef))) throw new Error('rich_content formula previewRef is invalid');
      if (attrs.conversionStatus != null && !['complete', 'approximate', 'preview_only', 'unsupported', 'failed'].includes(attrs.conversionStatus)) throw new Error('rich_content formula conversionStatus is invalid');
      if (attrs.sourceFormat != null && !['omml', 'eq', 'mathtype', 'mathml', 'latex', 'unknown'].includes(attrs.sourceFormat)) throw new Error('rich_content formula sourceFormat is invalid');
      if (attrs.warnings != null && (!Array.isArray(attrs.warnings) || attrs.warnings.some(item => typeof item !== 'string' || item.length > 1000))) throw new Error('rich_content formula warnings are invalid');
    }
    if (node.type === 'image') {
      allowKeys(attrs, ['src', 'assetKey', 'alt', 'title', 'width', 'height', 'align'], 'image');
      if (!SAFE_RICH_REF.test(String(attrs.assetKey || '')) || String(attrs.assetKey).includes('..')) throw new Error('rich_content image assetKey is invalid');
      if (attrs.src != null && attrs.src !== `question-asset://${attrs.assetKey}`) throw new Error('rich_content image src is invalid');
      if (attrs.alt != null && (typeof attrs.alt !== 'string' || attrs.alt.length > 1000)) throw new Error('rich_content image alt is invalid');
      if (attrs.title != null && (typeof attrs.title !== 'string' || attrs.title.length > 1000)) throw new Error('rich_content image title is invalid');
      for (const dimension of ['width', 'height']) if (attrs[dimension] != null && (!Number.isFinite(attrs[dimension]) || attrs[dimension] <= 0 || attrs[dimension] > 10000)) throw new Error(`rich_content image ${dimension} is invalid`);
      if (attrs.align != null && !['left', 'center', 'right'].includes(attrs.align)) throw new Error('rich_content image align is invalid');
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new Error('rich_content node content must be an array');
      node.content.forEach(child => validateNode(child, depth + 1));
    }
  };
  for (const name of ['stem', 'answer', 'analysis']) {
    validateNode(parsed.sections[name]);
    if (parsed.sections[name].type !== 'doc') throw new Error(`rich_content ${name} must be a doc`);
  }
  if (!Array.isArray(parsed.sections.options) || !Array.isArray(parsed.sections.subQuestions)) {
    throw new Error('rich_content option and subquestion sections must be arrays');
  }
  for (const option of parsed.sections.options) {
    if (!option || !SAFE_RICH_ID.test(String(option.id || '')) || typeof option.label !== 'string' || typeof option.isCorrect !== 'boolean') {
      throw new Error('rich_content option is invalid');
    }
    validateNode(option.content);
    if (option.content.type !== 'doc') throw new Error('rich_content option content must be a doc');
  }
  for (const sub of parsed.sections.subQuestions) {
    if (!sub || !SAFE_RICH_ID.test(String(sub.id || '')) || typeof sub.label !== 'string') throw new Error('rich_content subquestion is invalid');
    validateNode(sub.content);
    validateNode(sub.answer);
    if (sub.content.type !== 'doc') throw new Error('rich_content subquestion content must be a doc');
    if (sub.answer.type !== 'doc') throw new Error('rich_content subquestion answer must be a doc');
  }
  const serialized = JSON.stringify(parsed);
  if (Buffer.byteLength(serialized, 'utf8') > RICH_CONTENT_MAX_BYTES) throw new Error('rich_content is too large');
  return JSON.parse(serialized);
}

function projectRichContent(richContent) {
  const flags = { hasFormula: false, hasImage: false };
  const nodeText = node => {
    if (node.type === 'text') return node.text || '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'formula') { flags.hasFormula = true; return ` ${node.attrs.canonicalLatex} `; }
    if (node.type === 'image') { flags.hasImage = true; return ` ${node.attrs.alt || ''} `; }
    const text = (node.content || []).map(nodeText).join('');
    return ['paragraph', 'heading', 'blockquote', 'listItem'].includes(node.type) ? `${text}\n` : text;
  };
  const docText = doc => nodeText(doc).replace(/\r\n?/g, '\n').replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const sections = richContent.sections;
  const stem = docText(sections.stem);
  const options = sections.options.map(option => ({ label: option.label, content: docText(option.content), is_correct: option.isCorrect }));
  const subQuestions = sections.subQuestions.map(sub => ({ label: sub.label, content: docText(sub.content), answer: docText(sub.answer) }));
  const answer = docText(sections.answer);
  const explanation = docText(sections.analysis);
  const searchText = [stem, ...options.flatMap(option => [option.label, option.content]), ...subQuestions.flatMap(sub => [sub.label, sub.content, sub.answer]), answer, explanation]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return { stem, options, subQuestions, answer, explanation, searchText, ...flags };
}

function parseRichContent(value) {
  if (!value) return null;
  try { return normalizeRichContent(value); } catch (_error) { return null; }
}

const ALLOWED_HTML_TAGS = new Set([
  'br', 'span', 'div', 'table', 'tbody', 'thead', 'tr', 'td', 'th',
  'sub', 'sup', 'i', 'b', 'strong', 'em', 'mark', 'img',
]);

const SAFE_STYLE_VALUE = [/^(?!.*(?:expression\s*\(|javascript\s*:|url\s*\())[^{};]*$/i];
const SAFE_STYLE_PROPERTIES = [
  'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
  'display', 'vertical-align', 'text-align', 'margin', 'margin-left', 'margin-right',
  'margin-top', 'margin-bottom', 'padding', 'padding-left', 'padding-right',
  'padding-top', 'padding-bottom', 'border', 'border-collapse', 'border-spacing',
  'font-style', 'font-weight', 'font-size', 'line-height', 'color',
  'background', 'background-color', 'white-space',
];

const SANITIZE_HTML_OPTIONS = {
  allowedTags: Array.from(ALLOWED_HTML_TAGS),
  allowedAttributes: {
    '*': ['class', 'style', 'aria-hidden'],
    span: ['class', 'style', 'data-inline-options', 'data-latex', 'aria-hidden'],
    img: ['class', 'style', 'src', 'alt', 'width', 'height'],
    table: ['class', 'style'],
    tbody: ['class', 'style'],
    thead: ['class', 'style'],
    tr: ['class', 'style'],
    td: ['class', 'style', 'colspan', 'rowspan'],
    th: ['class', 'style', 'colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'data', 'blob', 'question-asset'],
  allowedSchemesAppliedToAttributes: ['src'],
  allowProtocolRelative: false,
  parseStyleAttributes: true,
  allowedStyles: {
    '*': Object.fromEntries(SAFE_STYLE_PROPERTIES.map(property => [property, SAFE_STYLE_VALUE])),
  },
};

function sanitizeHtmlContent(value) {
  return sanitizeHtml(String(value || ''), SANITIZE_HTML_OPTIONS);
}

function legacyTextDoc(value) {
  const text = sanitizeHtml(String(value || ''), { allowedTags: [], allowedAttributes: {} })
    .replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return { type: 'doc', content: text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : [] };
}

function migrateLegacyRichContent(question = {}) {
  const options = normalizeOptions(question.options || question.options_json).map((option, index) => ({
    id: String(option?.id || `option-${index + 1}`),
    label: String(option?.label || String.fromCharCode(65 + index)),
    isCorrect: Boolean(option?.isCorrect ?? option?.is_correct),
    content: legacyTextDoc(typeof option === 'string' ? option : (option?.content ?? option?.text ?? '')),
  }));
  const legacySubs = Array.isArray(question.sub_questions) ? question.sub_questions : (Array.isArray(question.subQuestions) ? question.subQuestions : []);
  const subQuestions = legacySubs.map((sub, index) => ({
    id: String(sub?.id || `sub-${index + 1}`), label: String(sub?.label || `(${index + 1})`),
    content: legacyTextDoc(sub?.content ?? sub?.stem ?? ''), answer: legacyTextDoc(sub?.answer ?? ''),
  }));
  return normalizeRichContent({ version: 1, type: 'question-document', sections: {
    stem: legacyTextDoc(question.stem ?? question.content ?? ''), options, subQuestions,
    answer: legacyTextDoc(question.answer ?? ''), analysis: legacyTextDoc(question.explanation ?? question.analysis ?? ''),
  } });
}

function mergeLegacyRichContent(existingRich, existing, payload) {
  const existingProjection = projectCanonicalRichContent(existingRich);
  const mergedLegacy = {
    stem: payload.stem ?? payload.content ?? existing.stem,
    answer: payload.answer ?? existing.answer,
    explanation: payload.explanation ?? payload.analysis ?? existing.explanation,
    options: payload.options ?? payload.options_json ?? existing.options,
    sub_questions: payload.sub_questions ?? payload.subQuestions ?? existingProjection.subQuestions,
  };
  const migrated = migrateLegacyRichContent(mergedLegacy);
  const next = JSON.parse(JSON.stringify(existingRich));
  if (payload.stem !== undefined || payload.content !== undefined) next.sections.stem = migrated.sections.stem;
  if (payload.options !== undefined || payload.options_json !== undefined) next.sections.options = migrated.sections.options;
  if (payload.sub_questions !== undefined || payload.subQuestions !== undefined) next.sections.subQuestions = migrated.sections.subQuestions;
  if (payload.answer !== undefined) next.sections.answer = migrated.sections.answer;
  if (payload.explanation !== undefined || payload.analysis !== undefined) next.sections.analysis = migrated.sections.analysis;
  return normalizeRichContent(next);
}

function sanitizeOptionContent(option) {
  if (typeof option === 'string') return sanitizeHtmlContent(option.trim());
  if (!option) return '';
  return {
    ...option,
    label: option.label || '',
    content: sanitizeHtmlContent(option.content || option.text || ''),
    text: option.text !== undefined ? sanitizeHtmlContent(option.text || '') : option.text,
    is_correct: !!option.is_correct,
  };
}

function normalizeKnowledgePointIds(payload = {}) {
  const ids = payload.knowledge_point_ids || payload.knowledge_ids || [];
  if (Array.isArray(ids)) return ids.filter(Boolean);
  if (typeof ids === 'string') return ids.split(',').map(id => id.trim()).filter(Boolean);
  return [];
}

function normalizeKnowledgePointNames(payload = {}) {
  const names = payload.knowledge_points || payload.knowledge_point_names || [];
  const values = Array.isArray(names) ? names : typeof names === 'string' ? names.split(',') : [];
  if (payload.knowledge_point) values.push(payload.knowledge_point);
  return [...new Set(values.map(name => String(name || '').trim()).filter(Boolean))];
}

function normalizeModelPointIds(payload = {}) {
  const ids = payload.model_point_ids || payload.model_ids || [];
  if (Array.isArray(ids)) return ids.filter(Boolean);
  if (typeof ids === 'string') return ids.split(',').map(id => id.trim()).filter(Boolean);
  return [];
}

function normalizeModelPointNames(payload = {}) {
  const names = payload.model_points || payload.model_point_names || [];
  const values = Array.isArray(names) ? names : typeof names === 'string' ? names.split(',') : [];
  if (payload.model_point) values.push(payload.model_point);
  return [...new Set(values.map(name => String(name || '').trim()).filter(Boolean))];
}

function normalizeOssRef(value = {}) {
  if (!value || typeof value !== 'object') return null;
  const ossKey = value.oss_key || value.ossKey || value.key || null;
  const ossUrl = value.oss_url || value.ossUrl || value.url || null;
  if (!ossKey && !ossUrl) return null;
  return { oss_key: ossKey, oss_url: ossUrl };
}

function normalizeAsset(asset = {}, fallbackType = 'attachment') {
  const ref = normalizeOssRef(asset);
  const inlineData = asset.data_url || asset.dataUrl || asset.data || null;
  if (!ref?.oss_key && !inlineData) throw new Error('question asset oss_key is required');
  return {
    asset_type: asset.asset_type || asset.assetType || asset.type || fallbackType,
    file_name: asset.file_name || asset.fileName || asset.name || null,
    mime_type: asset.mime_type || asset.mimeType || null,
    size_bytes: Number(asset.size_bytes ?? asset.sizeBytes ?? asset.size ?? 0) || 0,
    oss_key: ref?.oss_key || `inline://${asset.file_name || asset.fileName || asset.name || uuidv4()}`,
    oss_url: ref?.oss_url || inlineData,
    content_hash: asset.content_hash || asset.contentHash || null,
  };
}

function normalizeQuestionAssets(payload = {}) {
  const assets = [];
  for (const asset of payload.assets || []) {
    assets.push(normalizeAsset(asset));
  }

  for (const formula of payload.formulas || []) {
    if (formula && typeof formula === 'object') {
      const format = formula.format || 'formula';
      const raw = JSON.stringify(formula);
      assets.push(normalizeAsset({
        asset_type: `formula_${format}`,
        file_name: `${format}-${hashText(raw).slice(0, 12)}.json`,
        mime_type: 'application/json',
        size_bytes: Buffer.byteLength(raw, 'utf8'),
        data_url: `data:application/json;base64,${Buffer.from(raw, 'utf8').toString('base64')}`,
        content_hash: hashText(raw),
      }, `formula_${format}`));
    }
  }

  const coverPayload = payload.cover || payload.cover_image || payload.title_image;
  if (normalizeOssRef(coverPayload)) {
    assets.push(normalizeAsset(coverPayload, 'cover'));
  }

  for (const attachment of payload.attachments || []) {
    assets.push(normalizeAsset(attachment, 'attachment'));
  }

  return assets;
}

const QUESTION_STATUSES = new Set(['draft', 'pending', 'published', 'offline', 'deprecated']);

function normalizeQuestionStatus(value) {
  return QUESTION_STATUSES.has(value) ? value : 'draft';
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') return ['1', 'true', 'yes'].includes(value.toLowerCase());
  return Boolean(value);
}

function questionTextParts(payload = {}) {
  const options = normalizeOptions(payload.options || payload.options_json);
  return [
    payload.stem,
    payload.content,
    payload.answer,
    payload.explanation,
    payload.analysis,
    ...(Array.isArray(options) ? options : []),
    ...(Array.isArray(payload.formulas) ? payload.formulas : []),
    payload.rich_content ? JSON.stringify(payload.rich_content) : '',
  ].map(value => String(value || ''));
}

function detectHasFormula(payload = {}) {
  if (payload.has_formula !== undefined) return boolValue(payload.has_formula);
  return questionTextParts(payload).some(text =>
    /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|<math\b|data-formula|formula/i.test(text)
  );
}

function detectHasImage(payload = {}, assets = normalizeQuestionAssets(payload)) {
  if (payload.has_image !== undefined) return boolValue(payload.has_image);
  if (assets.length > 0) return true;
  return questionTextParts(payload).some(text =>
    /<img\b|!\[[^\]]*\]\([^)]+\)|\.(png|jpe?g|gif|webp|svg)(\?|#|\s|$)/i.test(text)
  );
}

function normalizeOptions(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(option => {
      return sanitizeOptionContent(option);
    }).filter(Boolean);
  }
  return parseJsonArray(value).map(sanitizeOptionContent).filter(Boolean);
}

function normalizeImportItem(item = {}, defaults = {}) {
  const questionTypes = Array.isArray(item.question_types) ? item.question_types : [];
  const type = item.type ||
    (questionTypes.includes('single') ? 'single' :
      questionTypes.includes('multi') ? 'multi' :
        questionTypes.includes('experiment') ? 'experiment' :
          questionTypes.includes('calculation') || questionTypes.includes('problem') ? 'problem' :
            questionTypes[0]) ||
    defaults.type ||
    'fill';
  return {
    ...item,
    subject: item.subject || defaults.subject || '物理',
    subject_id: item.subject_id || defaults.subject_id || null,
    chapter_id: item.chapter_id || defaults.chapter_id || null,
    type,
    difficulty: Number(item.difficulty || defaults.difficulty || 3),
    stem: sanitizeHtmlContent(String(item.stem || item.content || '').trim()),
    answer: item.answer !== undefined ? sanitizeHtmlContent(String(item.answer || '').trim()) : '',
    explanation: sanitizeHtmlContent(item.explanation !== undefined ? item.explanation : item.analysis),
    options: normalizeOptions(item.options),
    source: item.source || defaults.source || null,
    year: item.year || defaults.year || '',
    grade: item.grade || defaults.grade || '',
    semester: item.semester || defaults.semester || '',
    exam_type: item.exam_type || defaults.exam_type || '其他',
    region: item.region || defaults.region || '',
    school: item.school || defaults.school || '',
    edit_status: item.edit_status || defaults.edit_status || '未编辑',
    status: normalizeQuestionStatus(item.status || defaults.status),
    has_image: boolValue(item.has_image, false),
    has_formula: boolValue(item.has_formula, false),
    created_by: item.created_by || defaults.created_by || '',
    knowledge_point_ids: normalizeKnowledgePointIds(item).length > 0
      ? normalizeKnowledgePointIds(item)
      : normalizeKnowledgePointIds(defaults),
    model_point_ids: normalizeModelPointIds(item).length > 0
      ? normalizeModelPointIds(item)
      : normalizeModelPointIds(defaults),
  };
}

function contentHashForQuestion(item) {
  return hashText([
    item.stem || item.content || '',
    item.answer || '',
    item.explanation !== undefined ? item.explanation : item.analysis || '',
    JSON.stringify(normalizeOptions(item.options)),
  ].join('|'));
}

function exactStemForDuplicate(item) {
  return String(item.stem || item.content || '').trim();
}

function validateImportItem(item) {
  const errors = [];
  const warnings = [];
  if (!item.stem) errors.push('missing_stem');
  if (!item.type) errors.push('missing_type');
  if (item.stem && item.stem.length < 4) warnings.push('short_stem');
  if (item.options.length > 0 && item.options.length < 2) warnings.push('few_options');
  if (!item.answer) warnings.push('missing_answer');
  if (item.difficulty < 1 || item.difficulty > 5) warnings.push('difficulty_out_of_range');
  const score = Math.max(0, Math.round((1 - errors.length * 0.45 - warnings.length * 0.12) * 100) / 100);
  return { errors, warnings, score };
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return null;
  }
}

function normalizeTaxonomyIds(value) {
  const parsed = parseJsonObject(value) || {};
  const result = {};
  for (const [systemId, nodeIds] of Object.entries(parsed)) {
    if (!systemId || !Array.isArray(nodeIds)) continue;
    result[systemId] = [...new Set(nodeIds.map(String).filter(Boolean))];
  }
  return result;
}

function importItemUiStatus(row) {
  if (row.status === 'imported') return 'imported';
  if (row.status === 'duplicate') return 'warning';
  if (row.status === 'rejected' || row.status === 'failed') return 'failed';
  const warnings = parseJsonArray(row.warnings);
  return warnings.length > 0 ? 'warning' : 'success';
}

class QuestionBankService {
  ensureTenant(db, tenantId = 'default') {
    const existing = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
    if (!existing) {
      const ts = now();
      db.prepare(
        `INSERT INTO tenants (id, name, status, plan, deleted, created_at, updated_at)
         VALUES (?, ?, 'active', 'standard', 0, ?, ?)`
      ).run(tenantId, tenantId === 'default' ? '榛樿绉熸埛' : tenantId, ts, ts);
    }
  }

  ensureTaxonomySeed(db, tenantId = 'default') {
    this.ensureTenant(db, tenantId);
    if (db.prepare('SELECT tenant_id FROM taxonomy_state WHERE tenant_id = ?').get(tenantId)) return;
    const ts = now();
    const transaction = db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO taxonomy_systems
        (id, tenant_id, subject, name, sort_order, deleted, created_at, updated_at)
        VALUES ('knowledge', ?, '\u7269\u7406', '\u77e5\u8bc6\u70b9', 1, 0, ?, ?)`)
        .run(tenantId, ts, ts);
      db.prepare(`INSERT OR IGNORE INTO taxonomy_systems
        (id, tenant_id, subject, name, sort_order, deleted, created_at, updated_at)
        VALUES ('model', ?, '\u7269\u7406', '\u6a21\u578b', 2, 0, ?, ?)`)
        .run(tenantId, ts, ts);
      db.prepare(`INSERT OR IGNORE INTO taxonomy_nodes
        (id, tenant_id, system_id, parent_id, name, sort_order, deleted, created_at, updated_at)
        SELECT id, tenant_id, 'knowledge', parent_id, name, sort_order, deleted, created_at, updated_at
        FROM knowledge_points WHERE tenant_id = ?`).run(tenantId);
      db.prepare(`INSERT OR IGNORE INTO taxonomy_nodes
        (id, tenant_id, system_id, parent_id, name, sort_order, deleted, created_at, updated_at)
        SELECT id, tenant_id, 'model', parent_id, name, sort_order, deleted, created_at, updated_at
        FROM model_points WHERE tenant_id = ?`).run(tenantId);
      db.prepare(`INSERT OR IGNORE INTO question_taxonomy_nodes
        (question_id, system_id, node_id, created_at, updated_at)
        SELECT rel.question_id, 'knowledge', rel.knowledge_point_id, rel.created_at, rel.updated_at
        FROM question_knowledge_points rel
        INNER JOIN questions q ON q.id = rel.question_id
        WHERE q.tenant_id = ?`).run(tenantId);
      db.prepare(`INSERT OR IGNORE INTO question_taxonomy_nodes
        (question_id, system_id, node_id, created_at, updated_at)
        SELECT rel.question_id, 'model', rel.model_point_id, rel.created_at, rel.updated_at
        FROM question_model_points rel
        INNER JOIN questions q ON q.id = rel.question_id
        WHERE q.tenant_id = ?`).run(tenantId);
      db.prepare('INSERT INTO taxonomy_state (tenant_id, initialized_at) VALUES (?, ?)').run(tenantId, ts);
    });
    transaction();
  }

  listTaxonomySystems(db, subject, tenantId = 'default') {
    this.ensureTaxonomySeed(db, tenantId);
    const params = [tenantId];
    let where = 'tenant_id = ? AND deleted = 0';
    if (subject) { where += ' AND subject = ?'; params.push(subject); }
    return db.prepare(`SELECT * FROM taxonomy_systems WHERE ${where} ORDER BY sort_order, name`).all(...params);
  }

  createTaxonomySystem(db, payload, tenantId = 'default') {
    this.ensureTaxonomySeed(db, tenantId);
    const name = String(payload.name || '').trim();
    const subject = String(payload.subject || '').trim();
    if (!name || !subject) throw Object.assign(new Error('taxonomy system name and subject are required'), { statusCode: 400 });
    const duplicate = db.prepare('SELECT id FROM taxonomy_systems WHERE tenant_id = ? AND subject = ? AND name = ? AND deleted = 0').get(tenantId, subject, name);
    if (duplicate) throw Object.assign(new Error('taxonomy system name already exists'), { statusCode: 409 });
    const ts = now();
    const id = payload.id || `taxonomy-${uuidv4()}`;
    db.prepare(`INSERT INTO taxonomy_systems (id, tenant_id, subject, name, sort_order, deleted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)`).run(id, tenantId, subject, name, Number(payload.sort_order || 0), ts, ts);
    return db.prepare('SELECT * FROM taxonomy_systems WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  }

  updateTaxonomySystem(db, id, payload, tenantId = 'default') {
    this.ensureTaxonomySeed(db, tenantId);
    const existing = db.prepare('SELECT * FROM taxonomy_systems WHERE id = ? AND tenant_id = ? AND deleted = 0').get(id, tenantId);
    if (!existing) return null;
    const name = payload.name === undefined ? existing.name : String(payload.name).trim();
    if (!name) throw Object.assign(new Error('taxonomy system name is required'), { statusCode: 400 });
    const duplicate = db.prepare('SELECT id FROM taxonomy_systems WHERE tenant_id = ? AND subject = ? AND name = ? AND id <> ? AND deleted = 0').get(tenantId, existing.subject, name, id);
    if (duplicate) throw Object.assign(new Error('taxonomy system name already exists'), { statusCode: 409 });
    db.prepare('UPDATE taxonomy_systems SET name = ?, sort_order = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(name, payload.sort_order === undefined ? existing.sort_order : Number(payload.sort_order), now(), id, tenantId);
    return db.prepare('SELECT * FROM taxonomy_systems WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  }

  deleteTaxonomySystem(db, id, tenantId = 'default') {
    this.ensureTaxonomySeed(db, tenantId);
    const existing = db.prepare('SELECT id FROM taxonomy_systems WHERE id = ? AND tenant_id = ? AND deleted = 0').get(id, tenantId);
    if (!existing) return false;
    const ts = now();
    const transaction = db.transaction(() => {
      const affected = db.prepare(`SELECT DISTINCT q.id, q.taxonomy_json FROM questions q
        JOIN question_taxonomy_nodes rel ON rel.question_id = q.id
        WHERE q.tenant_id = ? AND rel.system_id = ?`).all(tenantId, id);
      db.prepare('DELETE FROM question_taxonomy_nodes WHERE system_id = ?').run(id);
      db.prepare('UPDATE taxonomy_nodes SET deleted = 1, updated_at = ? WHERE tenant_id = ? AND system_id = ?').run(ts, tenantId, id);
      db.prepare('UPDATE taxonomy_systems SET deleted = 1, updated_at = ? WHERE tenant_id = ? AND id = ?').run(ts, tenantId, id);
      for (const question of affected) {
        const taxonomy = normalizeTaxonomyIds(question.taxonomy_json);
        delete taxonomy[id];
        db.prepare('UPDATE questions SET taxonomy_json = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(JSON.stringify(taxonomy), ts, question.id, tenantId);
      }
      if (id === 'knowledge') {
        db.prepare('DELETE FROM question_knowledge_points WHERE question_id IN (SELECT id FROM questions WHERE tenant_id = ?)').run(tenantId);
      }
      if (id === 'model') {
        db.prepare('DELETE FROM question_model_points WHERE question_id IN (SELECT id FROM questions WHERE tenant_id = ?)').run(tenantId);
      }
    });
    transaction();
    return true;
  }

  listTaxonomyNodes(db, systemId, tenantId = 'default') {
    this.ensureTaxonomySeed(db, tenantId);
    return db.prepare(`SELECT * FROM taxonomy_nodes WHERE tenant_id = ? AND system_id = ? AND deleted = 0
      ORDER BY sort_order, name`).all(tenantId, systemId);
  }

  createTaxonomyNode(db, systemId, payload, tenantId = 'default') {
    this.ensureTaxonomySeed(db, tenantId);
    const system = db.prepare('SELECT id FROM taxonomy_systems WHERE id = ? AND tenant_id = ? AND deleted = 0').get(systemId, tenantId);
    const name = String(payload.name || '').trim();
    if (!system) throw Object.assign(new Error('taxonomy system not found'), { statusCode: 404 });
    if (!name) throw Object.assign(new Error('taxonomy node name is required'), { statusCode: 400 });
    if (payload.parent_id) {
      const parent = db.prepare('SELECT id FROM taxonomy_nodes WHERE id = ? AND tenant_id = ? AND system_id = ? AND deleted = 0').get(payload.parent_id, tenantId, systemId);
      if (!parent) throw Object.assign(new Error('taxonomy parent node not found'), { statusCode: 400 });
    }
    const id = payload.id || `taxonomy-node-${uuidv4()}`;
    const ts = now();
    db.prepare(`INSERT INTO taxonomy_nodes (id, tenant_id, system_id, parent_id, name, sort_order, deleted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(id, tenantId, systemId, payload.parent_id || null, name, Number(payload.sort_order || 0), ts, ts);
    return db.prepare('SELECT * FROM taxonomy_nodes WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  }

  updateTaxonomyNode(db, systemId, id, payload, tenantId = 'default') {
    const existing = db.prepare('SELECT * FROM taxonomy_nodes WHERE id = ? AND tenant_id = ? AND system_id = ? AND deleted = 0').get(id, tenantId, systemId);
    if (!existing) return null;
    const name = payload.name === undefined ? existing.name : String(payload.name).trim();
    if (!name) throw Object.assign(new Error('taxonomy node name is required'), { statusCode: 400 });
    db.prepare('UPDATE taxonomy_nodes SET name = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND system_id = ?')
      .run(name, payload.parent_id === undefined ? existing.parent_id : (payload.parent_id || null), payload.sort_order === undefined ? existing.sort_order : Number(payload.sort_order), now(), id, tenantId, systemId);
    return db.prepare('SELECT * FROM taxonomy_nodes WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  }

  deleteTaxonomyNode(db, systemId, id, tenantId = 'default') {
    const root = db.prepare('SELECT id FROM taxonomy_nodes WHERE id = ? AND tenant_id = ? AND system_id = ? AND deleted = 0').get(id, tenantId, systemId);
    if (!root) return false;
    const rows = db.prepare(`WITH RECURSIVE descendants(id) AS (
      SELECT id FROM taxonomy_nodes WHERE id = ? AND tenant_id = ? AND system_id = ? AND deleted = 0
      UNION ALL SELECT node.id FROM taxonomy_nodes node JOIN descendants parent ON node.parent_id = parent.id
      WHERE node.tenant_id = ? AND node.system_id = ? AND node.deleted = 0)
      SELECT id FROM descendants`).all(id, tenantId, systemId, tenantId, systemId);
    const ids = rows.map(row => row.id);
    const placeholders = ids.map(() => '?').join(',');
    const ts = now();
    const transaction = db.transaction(() => {
      db.prepare(`DELETE FROM question_taxonomy_nodes WHERE system_id = ? AND node_id IN (${placeholders})`).run(systemId, ...ids);
      db.prepare(`UPDATE taxonomy_nodes SET deleted = 1, updated_at = ? WHERE tenant_id = ? AND id IN (${placeholders})`).run(ts, tenantId, ...ids);
      const questions = db.prepare('SELECT id, taxonomy_json FROM questions WHERE tenant_id = ? AND deleted = 0').all(tenantId);
      for (const question of questions) {
        const taxonomy = normalizeTaxonomyIds(question.taxonomy_json);
        if (!taxonomy[systemId]?.some(nodeId => ids.includes(nodeId))) continue;
        taxonomy[systemId] = taxonomy[systemId].filter(nodeId => !ids.includes(nodeId));
        db.prepare('UPDATE questions SET taxonomy_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(taxonomy), ts, question.id);
      }
    });
    transaction();
    return true;
  }

  setQuestionTaxonomyNodes(db, questionId, systemId, nodeIds, tenantId = 'default') {
    const question = db.prepare('SELECT id, taxonomy_json FROM questions WHERE id = ? AND tenant_id = ? AND deleted = 0').get(questionId, tenantId);
    if (!question) return null;
    const uniqueIds = [...new Set((nodeIds || []).map(String).filter(Boolean))];
    for (const nodeId of uniqueIds) {
      const node = db.prepare('SELECT id FROM taxonomy_nodes WHERE id = ? AND tenant_id = ? AND system_id = ? AND deleted = 0').get(nodeId, tenantId, systemId);
      if (!node) throw Object.assign(new Error('taxonomy node not found'), { statusCode: 400 });
    }
    const ts = now();
    const taxonomy = normalizeTaxonomyIds(question.taxonomy_json);
    taxonomy[systemId] = uniqueIds;
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM question_taxonomy_nodes WHERE question_id = ? AND system_id = ?').run(questionId, systemId);
      const insert = db.prepare(`INSERT INTO question_taxonomy_nodes (question_id, system_id, node_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`);
      for (const nodeId of uniqueIds) insert.run(questionId, systemId, nodeId, ts, ts);
      db.prepare('UPDATE questions SET taxonomy_json = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(JSON.stringify(taxonomy), ts, questionId, tenantId);
    });
    transaction();
    return this.getQuestion(db, questionId, tenantId);
  }

  resolveKnowledgePointIds(db, payload = {}, tenantId = 'default') {
    this.ensureTenant(db, tenantId);
    const ids = normalizeKnowledgePointIds(payload);
    const names = normalizeKnowledgePointNames(payload);
    const ts = now();
    for (const name of names) {
      let row = db.prepare(
        'SELECT id FROM knowledge_points WHERE tenant_id = ? AND name = ? AND deleted = 0 ORDER BY created_at ASC LIMIT 1'
      ).get(tenantId, name);
      if (!row) {
        row = { id: `kp_${hashText(`${tenantId}:${name}`).slice(0, 24)}` };
        db.prepare(
          `INSERT INTO knowledge_points
           (id, tenant_id, chapter_id, parent_id, name, description, sort_order, deleted, created_at, updated_at)
           VALUES (?, ?, NULL, NULL, ?, NULL, 0, 0, ?, ?)`
        ).run(row.id, tenantId, name, ts, ts);
      }
      ids.push(row.id);
    }
    return [...new Set(ids.filter(Boolean))];
  }

  resolveModelPointIds(db, payload = {}, tenantId = 'default') {
    this.ensureTenant(db, tenantId);
    const ids = normalizeModelPointIds(payload);
    const names = normalizeModelPointNames(payload);
    const ts = now();
    for (const name of names) {
      let row = db.prepare(
        'SELECT id FROM model_points WHERE tenant_id = ? AND name = ? AND deleted = 0 ORDER BY created_at ASC LIMIT 1'
      ).get(tenantId, name);
      if (!row) {
        row = { id: `mp_${hashText(`${tenantId}:${name}`).slice(0, 24)}` };
        db.prepare(
          `INSERT INTO model_points
           (id, tenant_id, parent_id, name, description, sort_order, deleted, created_at, updated_at)
           VALUES (?, ?, NULL, ?, NULL, 0, 0, ?, ?)`
        ).run(row.id, tenantId, name, ts, ts);
      }
      ids.push(row.id);
    }
    return [...new Set(ids.filter(Boolean))];
  }

  createQuestion(db, payload, tenantId = 'default', context = {}) {
    this.ensureTenant(db, tenantId);
    const ts = now();
    const questionId = payload.id || uuidv4();
    const contentId = uuidv4();
    const richContent = payload.rich_content !== undefined ? normalizeRichContent(payload.rich_content) : migrateLegacyRichContent(payload);
    const richProjection = projectCanonicalRichContent(richContent);
    const stem = sanitizeHtmlContent(payload.stem !== undefined || payload.content !== undefined ? (payload.stem ?? payload.content) : (richProjection?.stem || ''));
    const answer = sanitizeHtmlContent(payload.answer !== undefined ? payload.answer : (richProjection?.answer || ''));
    const explanation = sanitizeHtmlContent(payload.explanation !== undefined || payload.analysis !== undefined ? (payload.explanation ?? payload.analysis) : (richProjection?.explanation || ''));
    const options = normalizeOptions(payload.options !== undefined || payload.options_json !== undefined ? (payload.options ?? payload.options_json) : (richProjection?.options || []));
    const knowledgePointIds = payload.allow_tag_name_create === false
      ? normalizeKnowledgePointIds(payload)
      : this.resolveKnowledgePointIds(db, payload, tenantId);
    const modelPointIds = payload.allow_tag_name_create === false
      ? normalizeModelPointIds(payload)
      : this.resolveModelPointIds(db, payload, tenantId);
    this.ensureTaxonomySeed(db, tenantId);
    const taxonomyIds = normalizeTaxonomyIds(payload.taxonomy_ids);
    if (taxonomyIds.knowledge === undefined) taxonomyIds.knowledge = knowledgePointIds;
    if (taxonomyIds.model === undefined) taxonomyIds.model = modelPointIds;
    for (const [systemId, nodeIds] of Object.entries(taxonomyIds)) {
      const system = db.prepare('SELECT id FROM taxonomy_systems WHERE id = ? AND tenant_id = ? AND deleted = 0').get(systemId, tenantId);
      if (!system) throw Object.assign(new Error('taxonomy system not found'), { statusCode: 400 });
      for (const nodeId of nodeIds) {
        let node = db.prepare('SELECT id FROM taxonomy_nodes WHERE id = ? AND tenant_id = ? AND system_id = ? AND deleted = 0').get(nodeId, tenantId, systemId);
        if (!node && systemId === 'knowledge') {
          const legacy = db.prepare('SELECT * FROM knowledge_points WHERE id = ? AND tenant_id = ? AND deleted = 0').get(nodeId, tenantId);
          if (legacy) {
            db.prepare(`INSERT OR IGNORE INTO taxonomy_nodes (id, tenant_id, system_id, parent_id, name, sort_order, deleted, created_at, updated_at)
              VALUES (?, ?, 'knowledge', ?, ?, ?, 0, ?, ?)`).run(legacy.id, tenantId, legacy.parent_id || null, legacy.name, legacy.sort_order || 0, legacy.created_at || ts, legacy.updated_at || ts);
            node = legacy;
          }
        }
        if (!node && systemId === 'model') {
          const legacy = db.prepare('SELECT * FROM model_points WHERE id = ? AND tenant_id = ? AND deleted = 0').get(nodeId, tenantId);
          if (legacy) {
            db.prepare(`INSERT OR IGNORE INTO taxonomy_nodes (id, tenant_id, system_id, parent_id, name, sort_order, deleted, created_at, updated_at)
              VALUES (?, ?, 'model', ?, ?, ?, 0, ?, ?)`).run(legacy.id, tenantId, legacy.parent_id || null, legacy.name, legacy.sort_order || 0, legacy.created_at || ts, legacy.updated_at || ts);
            node = legacy;
          }
        }
        if (!node) throw Object.assign(new Error('taxonomy node not found'), { statusCode: 400 });
      }
    }
    const richContentJson = richContent ? JSON.stringify(richContent) : null;
    const searchText = richProjection.searchText;
    const contentHash = payload.content_hash || hashText([stem, answer, explanation, JSON.stringify(options), richContentJson || ''].join('|'));
    const contentRef = normalizeOssRef(payload);
    const assets = normalizeQuestionAssets(payload);
    const hasImage = richProjection ? richProjection.hasImage || assets.length > 0 : detectHasImage(payload, assets);
    const hasFormula = richProjection ? richProjection.hasFormula : detectHasFormula(payload);

    const transaction = db.transaction(() => {
      db.prepare(
        `INSERT INTO questions
         (id, tenant_id, subject, subject_id, chapter_id, type, difficulty, source, year, grade, semester, exam_type, region, school, edit_status, status, has_image, has_formula, created_by, storage_state, committed_at, committed_by_device_id, source_device_id, owner_user_id, taxonomy_json, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(
        questionId,
        tenantId,
        payload.subject || '物理',
        payload.subject_id || null,
        payload.chapter_id || null,
        payload.type,
        payload.difficulty || 3,
        payload.source || null,
        payload.year || '',
        payload.grade || '',
        payload.semester || '',
        payload.exam_type || '其他',
        payload.region || '',
        payload.school || '',
        payload.edit_status || '未编辑',
        normalizeQuestionStatus(payload.status),
        hasImage ? 1 : 0,
        hasFormula ? 1 : 0,
        payload.created_by || '',
        'local_draft',
        null,
        null,
        context.deviceId || null,
        context.userId || null,
        JSON.stringify(taxonomyIds),
        ts,
        ts
      );

      db.prepare(
        `INSERT INTO question_contents
         (id, tenant_id, question_id, stem, answer, explanation, options_json, rich_content_json, search_text, content_hash, version, oss_key, oss_url, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?)`
      ).run(contentId, tenantId, questionId, stem, answer || null, explanation || null, JSON.stringify(options), richContentJson, searchText, contentHash, contentRef?.oss_key || null, contentRef?.oss_url || null, ts, ts);

      for (const knowledgePointId of knowledgePointIds) {
        db.prepare(
          `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(questionId, knowledgePointId, 1, ts, ts);
      }

      for (const modelPointId of modelPointIds) {
        db.prepare(
          `INSERT OR REPLACE INTO question_model_points (question_id, model_point_id, weight, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(questionId, modelPointId, 1, ts, ts);
      }

      const insertTaxonomyRel = db.prepare(`INSERT OR REPLACE INTO question_taxonomy_nodes
        (question_id, system_id, node_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`);
      for (const [systemId, nodeIds] of Object.entries(taxonomyIds)) {
        for (const nodeId of nodeIds) insertTaxonomyRel.run(questionId, systemId, nodeId, ts, ts);
      }

      for (const asset of assets) {
        db.prepare(
          `INSERT INTO question_assets
           (id, tenant_id, question_id, asset_type, file_name, mime_type, size_bytes, oss_key, oss_url, content_hash, deleted, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        ).run(uuidv4(), tenantId, questionId, asset.asset_type, asset.file_name || null, asset.mime_type || null, asset.size_bytes || 0, asset.oss_key, asset.oss_url || null, asset.content_hash || null, ts, ts);
      }

      this.enqueueSearchJob(db, questionId, 'upsert', tenantId);
      eventBus.publish(db, 'question.changed', 'question', questionId, { action: 'create' }, tenantId);
    });

    transaction();
    return this.getQuestion(db, questionId, tenantId) || {
      id: questionId,
      content_hash: contentHash,
      status: normalizeQuestionStatus(payload.status),
      has_image: hasImage,
      has_formula: hasFormula,
      created_by: payload.created_by || '',
    };
  }

  _mapQuestion(row, assets = []) {
    if (!row) return null;
    const knowledgeIds = row.knowledge_point_ids ? String(row.knowledge_point_ids).split(',').filter(Boolean) : [];
    const knowledgeNames = row.knowledge_point_names ? String(row.knowledge_point_names).split('\u001f').filter(Boolean) : [];
    const modelIds = row.model_point_ids ? String(row.model_point_ids).split(',').filter(Boolean) : [];
    const options = parseJsonArray(row.options_json);
    return {
      ...row,
      stem: row.stem || '',
      content: row.stem || '',
      options,
      rich_content: parseRichContent(row.rich_content_json),
      search_text: row.search_text || '',
      answer: row.answer || '',
      explanation: row.explanation || '',
      analysis: row.explanation || '',
      oss_key: row.content_oss_key || null,
      oss_url: row.content_oss_url || null,
      oss: row.content_oss_key || row.content_oss_url ? {
        oss_key: row.content_oss_key || null,
        oss_url: row.content_oss_url || null,
      } : null,
      knowledge_point_ids: knowledgeIds,
      knowledge_ids: knowledgeIds,
      knowledge_point_names: knowledgeNames,
      knowledge_points: knowledgeNames,
      model_point_ids: modelIds,
      model_ids: modelIds,
      taxonomy_ids: (() => {
        const taxonomy = normalizeTaxonomyIds(row.taxonomy_json);
        if (taxonomy.knowledge === undefined) taxonomy.knowledge = knowledgeIds;
        if (taxonomy.model === undefined) taxonomy.model = modelIds;
        return taxonomy;
      })(),
      status: normalizeQuestionStatus(row.status),
      has_image: boolValue(row.has_image, false),
      has_formula: boolValue(row.has_formula, false),
      created_by: row.created_by || '',
      deleted_at: row.deleted_at || null,
      assets,
      cover: assets.find(asset => asset.asset_type === 'cover') || null,
      attachments: assets.filter(asset => asset.asset_type !== 'cover'),
    };
  }

  _questionSelectSql(whereSql) {
    return `SELECT q.*,
                   qc.id AS content_id,
                   qc.stem,
                   qc.answer,
                   qc.explanation,
                   qc.options_json,
                   qc.rich_content_json,
                   qc.search_text,
                   qc.content_hash,
                   qc.version AS content_version,
                   qc.oss_key AS content_oss_key,
                   qc.oss_url AS content_oss_url,
                   GROUP_CONCAT(DISTINCT qkp.knowledge_point_id) AS knowledge_point_ids,
                   (SELECT GROUP_CONCAT(name, char(31)) FROM (
                      SELECT DISTINCT kp.name AS name
                      FROM question_knowledge_points ordered_qkp
                      JOIN knowledge_points kp ON kp.id = ordered_qkp.knowledge_point_id
                      WHERE ordered_qkp.question_id = q.id AND kp.tenant_id = q.tenant_id AND kp.deleted = 0
                      ORDER BY kp.name ASC, kp.id ASC
                   )) AS knowledge_point_names,
                   GROUP_CONCAT(DISTINCT qmp.model_point_id) AS model_point_ids
            FROM questions q
            LEFT JOIN question_contents qc ON qc.question_id = q.id AND qc.deleted = 0
            LEFT JOIN question_knowledge_points qkp ON qkp.question_id = q.id
            LEFT JOIN question_model_points qmp ON qmp.question_id = q.id
            ${whereSql}
            GROUP BY q.id
            ORDER BY q.created_at DESC, q.updated_at DESC`;
  }

  _getAssets(db, questionId) {
    return db.prepare(
      'SELECT * FROM question_assets WHERE question_id = ? AND deleted = 0 ORDER BY created_at ASC'
    ).all(questionId);
  }

  purgeExpiredDeletedQuestions(db, tenantId = 'default', retentionDays = 7) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(
      'SELECT id FROM questions WHERE deleted = 1 AND tenant_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?'
    ).all(tenantId, cutoff);
    if (rows.length === 0) return 0;
    const ts = now();
    const transaction = db.transaction(() => {
      for (const row of rows) {
        db.prepare('UPDATE question_contents SET deleted = 1, updated_at = ? WHERE question_id = ? AND deleted = 0').run(ts, row.id);
        db.prepare('UPDATE question_assets SET deleted = 1, updated_at = ? WHERE question_id = ? AND deleted = 0').run(ts, row.id);
        db.prepare('DELETE FROM question_knowledge_points WHERE question_id = ?').run(row.id);
        db.prepare('DELETE FROM question_model_points WHERE question_id = ?').run(row.id);
        db.prepare('DELETE FROM question_taxonomy_nodes WHERE question_id = ?').run(row.id);
      }
    });
    transaction();
    return rows.length;
  }

  listQuestions(db, filters = {}, tenantId = 'default') {
    const where = ['q.deleted = 0', 'q.tenant_id = ?'];
    const params = [tenantId];
    if (filters.subject_id) {
      where.push('q.subject_id = ?');
      params.push(filters.subject_id);
    }
    if (filters.type) {
      where.push('q.type = ?');
      params.push(filters.type);
    }
    if (filters.difficulty) {
      where.push('q.difficulty = ?');
      params.push(Number(filters.difficulty));
    }
    if (filters.status) {
      where.push('q.status = ?');
      params.push(normalizeQuestionStatus(filters.status));
    }
    if (filters.has_image !== undefined) {
      where.push('q.has_image = ?');
      params.push(boolValue(filters.has_image) ? 1 : 0);
    }
    if (filters.has_formula !== undefined) {
      where.push('q.has_formula = ?');
      params.push(boolValue(filters.has_formula) ? 1 : 0);
    }
    if (filters.knowledge_point_id) {
      where.push('EXISTS (SELECT 1 FROM question_knowledge_points x WHERE x.question_id = q.id AND x.knowledge_point_id = ?)');
      params.push(filters.knowledge_point_id);
    }
    const taxonomyFilters = parseJsonObject(filters.taxonomy_filters || filters.taxonomyFilters) || {};
    for (const [systemId, filter] of Object.entries(taxonomyFilters)) {
      const includeGroups = Array.isArray(filter?.includeGroups) ? filter.includeGroups : [];
      for (const group of includeGroups) {
        const ids = [...new Set((Array.isArray(group) ? group : []).map(String).filter(Boolean))];
        if (ids.length === 0) continue;
        where.push(`EXISTS (SELECT 1 FROM question_taxonomy_nodes tax_include
          WHERE tax_include.question_id = q.id AND tax_include.system_id = ?
          AND tax_include.node_id IN (${ids.map(() => '?').join(',')}))`);
        params.push(systemId, ...ids);
      }
      const excluded = [...new Set((Array.isArray(filter?.excludeIds) ? filter.excludeIds : []).map(String).filter(Boolean))];
      if (excluded.length > 0) {
        where.push(`NOT EXISTS (SELECT 1 FROM question_taxonomy_nodes tax_exclude
          WHERE tax_exclude.question_id = q.id AND tax_exclude.system_id = ?
          AND tax_exclude.node_id IN (${excluded.map(() => '?').join(',')}))`);
        params.push(systemId, ...excluded);
      }
    }
    const searchQuery = filters.q || filters.search;
    if (searchQuery) {
      const keyword = `%${escapeLikePattern(searchQuery)}%`;
      where.push("(COALESCE(qc.search_text, qc.stem || ' ' || COALESCE(qc.options_json, '') || ' ' || COALESCE(qc.answer, '') || ' ' || COALESCE(qc.explanation, '') || ' ' || COALESCE(qc.rich_content_json, '')) LIKE ? ESCAPE '\\' OR q.source LIKE ? ESCAPE '\\')");
      params.push(keyword, keyword);
    }

    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const rows = db.prepare(`${this._questionSelectSql(`WHERE ${where.join(' AND ')}`)} LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return rows.map(row => this._mapQuestion(row, this._getAssets(db, row.id)));
  }

  getQuestion(db, id, tenantId = 'default') {
    const row = db.prepare(
      this._questionSelectSql('WHERE q.id = ? AND q.deleted = 0 AND q.tenant_id = ?')
    ).get(id, tenantId);
    return this._mapQuestion(row, row ? this._getAssets(db, id) : []);
  }

  updateQuestion(db, id, payload, tenantId = 'default') {
    const existing = this.getQuestion(db, id, tenantId);
    if (!existing) return null;

    const ts = now();
    const legacyContentKeys = ['stem', 'content', 'answer', 'explanation', 'analysis', 'options', 'options_json', 'sub_questions', 'subQuestions'];
    const hasLegacyContentMutation = payload.rich_content === undefined && legacyContentKeys.some(key => payload[key] !== undefined);
    const richContent = payload.rich_content !== undefined
      ? normalizeRichContent(payload.rich_content)
      : hasLegacyContentMutation
        ? mergeLegacyRichContent(existing.rich_content || migrateLegacyRichContent(existing), existing, payload)
        : existing.rich_content;
    const richProjection = richContent ? projectCanonicalRichContent(richContent) : null;
    const stem = sanitizeHtmlContent(payload.stem !== undefined || payload.content !== undefined ? (payload.stem ?? payload.content) : (richProjection?.stem ?? existing.stem));
    const answer = sanitizeHtmlContent(payload.answer !== undefined ? payload.answer : (richProjection?.answer ?? existing.answer));
    const explanation = sanitizeHtmlContent(payload.explanation !== undefined || payload.analysis !== undefined ? (payload.explanation ?? payload.analysis) : (richProjection?.explanation ?? existing.explanation));
    const options = normalizeOptions(payload.options !== undefined || payload.options_json !== undefined
      ? (payload.options ?? payload.options_json)
      : (richProjection?.options ?? existing.options));
    const richContentJson = richContent ? JSON.stringify(richContent) : null;
    const searchText = richProjection?.searchText || [stem, ...options.map(option => typeof option === 'string' ? option : `${option.label || ''} ${option.content || option.text || ''}`), answer, explanation].join(' ').replace(/\s+/g, ' ').trim();
    const contentHash = payload.content_hash || hashText([stem, answer, explanation, JSON.stringify(options), richContentJson || ''].join('|'));
    const contentRef = normalizeOssRef(payload) || {
      oss_key: existing.content_oss_key || existing.oss_key || null,
      oss_url: existing.content_oss_url || existing.oss_url || null,
    };
    const replacingAssets = payload.assets !== undefined || payload.cover !== undefined || payload.cover_image !== undefined || payload.title_image !== undefined || payload.attachments !== undefined;
    const nextAssets = replacingAssets ? normalizeQuestionAssets(payload) : existing.assets || [];
    const mergedForDetection = { ...existing, ...payload, stem, content: stem, answer, explanation, options };
    const hasImage = richProjection ? richProjection.hasImage || nextAssets.length > 0 : (payload.has_image !== undefined ? boolValue(payload.has_image) : detectHasImage(mergedForDetection, nextAssets));
    const hasFormula = richProjection ? richProjection.hasFormula : (payload.has_formula !== undefined ? boolValue(payload.has_formula) : detectHasFormula(mergedForDetection));

    const transaction = db.transaction(() => {
      const questionUpdates = {};
      for (const key of ['subject', 'subject_id', 'chapter_id', 'type', 'difficulty', 'source', 'year', 'grade', 'semester', 'exam_type', 'region', 'school', 'edit_status', 'created_by']) {
        if (payload[key] !== undefined) questionUpdates[key] = payload[key];
      }
      if (payload.status !== undefined) questionUpdates.status = normalizeQuestionStatus(payload.status);
      questionUpdates.has_image = hasImage ? 1 : 0;
      questionUpdates.has_formula = hasFormula ? 1 : 0;
      if (payload.exam_type === '') questionUpdates.exam_type = '其他';
      if (payload.subject === '') questionUpdates.subject = '物理';
      if (Object.keys(questionUpdates).length > 0) {
        const keys = Object.keys(questionUpdates);
        db.prepare(`UPDATE questions SET ${keys.map(key => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND deleted = 0`)
          .run(...keys.map(key => questionUpdates[key]), ts, id);
      } else {
        db.prepare('UPDATE questions SET updated_at = ? WHERE id = ? AND deleted = 0').run(ts, id);
      }

      db.prepare('UPDATE question_contents SET deleted = 1, updated_at = ? WHERE question_id = ? AND deleted = 0').run(ts, id);
      db.prepare(
        `INSERT INTO question_contents
         (id, tenant_id, question_id, stem, answer, explanation, options_json, rich_content_json, search_text, content_hash, version, oss_key, oss_url, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(uuidv4(), tenantId, id, stem, answer || null, explanation || null, JSON.stringify(options), richContentJson, searchText, contentHash, (existing.content_version || 1) + 1, contentRef.oss_key || null, contentRef.oss_url || null, ts, ts);

      if (payload.knowledge_point_ids !== undefined || payload.knowledge_ids !== undefined || payload.knowledge_points !== undefined || payload.knowledge_point_names !== undefined || payload.knowledge_point !== undefined) {
        db.prepare('DELETE FROM question_knowledge_points WHERE question_id = ?').run(id);
        for (const knowledgePointId of this.resolveKnowledgePointIds(db, payload, tenantId)) {
          db.prepare(
            `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(id, knowledgePointId, 1, ts, ts);
        }
      }

      if (payload.model_point_ids !== undefined || payload.model_ids !== undefined || payload.model_points !== undefined || payload.model_point_names !== undefined || payload.model_point !== undefined) {
        db.prepare('DELETE FROM question_model_points WHERE question_id = ?').run(id);
        for (const modelPointId of this.resolveModelPointIds(db, payload, tenantId)) {
          db.prepare(
            `INSERT OR REPLACE INTO question_model_points (question_id, model_point_id, weight, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(id, modelPointId, 1, ts, ts);
        }
      }

      const taxonomy = payload.taxonomy_ids === undefined
        ? normalizeTaxonomyIds(existing.taxonomy_ids || existing.taxonomy_json)
        : normalizeTaxonomyIds(payload.taxonomy_ids);
      const knowledgeChanged = payload.knowledge_point_ids !== undefined || payload.knowledge_ids !== undefined || payload.knowledge_points !== undefined || payload.knowledge_point_names !== undefined || payload.knowledge_point !== undefined;
      const modelChanged = payload.model_point_ids !== undefined || payload.model_ids !== undefined || payload.model_points !== undefined || payload.model_point_names !== undefined || payload.model_point !== undefined;
      if (knowledgeChanged) {
        taxonomy.knowledge = db.prepare('SELECT knowledge_point_id AS id FROM question_knowledge_points WHERE question_id = ?').all(id).map(row => row.id);
      }
      if (modelChanged) {
        taxonomy.model = db.prepare('SELECT model_point_id AS id FROM question_model_points WHERE question_id = ?').all(id).map(row => row.id);
      }
      if (payload.taxonomy_ids !== undefined) {
        db.prepare('DELETE FROM question_taxonomy_nodes WHERE question_id = ?').run(id);
        const insertTaxonomyRel = db.prepare(`INSERT INTO question_taxonomy_nodes
          (question_id, system_id, node_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`);
        for (const [systemId, nodeIds] of Object.entries(taxonomy)) {
          const system = db.prepare('SELECT id FROM taxonomy_systems WHERE id = ? AND tenant_id = ? AND deleted = 0').get(systemId, tenantId);
          if (!system) throw Object.assign(new Error('taxonomy system not found'), { statusCode: 400 });
          for (const nodeId of nodeIds) {
            const node = db.prepare('SELECT id FROM taxonomy_nodes WHERE id = ? AND tenant_id = ? AND system_id = ? AND deleted = 0').get(nodeId, tenantId, systemId);
            if (!node) throw Object.assign(new Error('taxonomy node not found'), { statusCode: 400 });
            insertTaxonomyRel.run(id, systemId, nodeId, ts, ts);
          }
        }
      } else {
        for (const systemId of ['knowledge', 'model']) {
          if ((systemId === 'knowledge' && !knowledgeChanged) || (systemId === 'model' && !modelChanged)) continue;
          db.prepare('DELETE FROM question_taxonomy_nodes WHERE question_id = ? AND system_id = ?').run(id, systemId);
          const insertTaxonomyRel = db.prepare(`INSERT OR REPLACE INTO question_taxonomy_nodes
            (question_id, system_id, node_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`);
          for (const nodeId of taxonomy[systemId] || []) insertTaxonomyRel.run(id, systemId, nodeId, ts, ts);
        }
      }
      db.prepare('UPDATE questions SET taxonomy_json = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(JSON.stringify(taxonomy), ts, id, tenantId);

      if (replacingAssets) {
        db.prepare('UPDATE question_assets SET deleted = 1, updated_at = ? WHERE question_id = ? AND deleted = 0').run(ts, id);
        for (const asset of nextAssets) {
          db.prepare(
            `INSERT INTO question_assets
             (id, tenant_id, question_id, asset_type, file_name, mime_type, size_bytes, oss_key, oss_url, content_hash, deleted, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
          ).run(uuidv4(), tenantId, id, asset.asset_type, asset.file_name || null, asset.mime_type || null, asset.size_bytes || 0, asset.oss_key, asset.oss_url || null, asset.content_hash || null, ts, ts);
        }
      }

      this.enqueueSearchJob(db, id, 'upsert', tenantId);
      eventBus.publish(db, 'question.changed', 'question', id, { action: 'update' }, tenantId);
    });

    transaction();
    return this.getQuestion(db, id, tenantId);
  }

  deleteQuestion(db, id, tenantId = 'default', context = {}) {
    const existing = this.getQuestion(db, id, tenantId);
    if (!existing) return false;
    const deletionContext = {
      ...context,
      storageState: existing.storage_state || 'host_committed',
      sourceDeviceId: existing.source_device_id || context.sourceDeviceId,
      ownerUserId: existing.owner_user_id || context.ownerUserId,
    };
    if (!canDeleteQuestion(deletionContext)) throw committedDeleteError();
    const ts = now();
    const transaction = db.transaction(() => {
      db.prepare('UPDATE questions SET deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ? AND deleted = 0').run(ts, ts, id);
      this.enqueueSearchJob(db, id, 'delete', tenantId);
      eventBus.publish(db, 'question.changed', 'question', id, { action: 'trash', deleted_at: ts }, tenantId);
    });
    transaction();
    return true;
  }

  listDeletedQuestions(db, tenantId = 'default') {
    this.purgeExpiredDeletedQuestions(db, tenantId);
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(
      this._questionSelectSql('WHERE q.deleted = 1 AND q.tenant_id = ? AND q.deleted_at >= ?')
    ).all(tenantId, cutoff);
    return rows.map(row => this._mapQuestion(row, this._getAssets(db, row.id)));
  }

  restoreQuestion(db, id, tenantId = 'default') {
    const row = db.prepare('SELECT id FROM questions WHERE id = ? AND tenant_id = ? AND deleted = 1').get(id, tenantId);
    if (!row) return null;
    const ts = now();
    db.prepare('UPDATE questions SET deleted = 0, deleted_at = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?').run(ts, id, tenantId);
    this.enqueueSearchJob(db, id, 'upsert', tenantId);
    eventBus.publish(db, 'question.changed', 'question', id, { action: 'restore' }, tenantId);
    return this.getQuestion(db, id, tenantId);
  }

  clearQuestionBankData(db, tenantId = 'default') {
    const questionIds = db.prepare('SELECT id FROM questions WHERE tenant_id = ?').all(tenantId).map(row => row.id);
    const batchIds = db.prepare('SELECT id FROM import_batches WHERE tenant_id = ?').all(tenantId).map(row => row.id);
    const result = { questions: questionIds.length, import_batches: batchIds.length };
    const transaction = db.transaction(() => {
      for (const questionId of questionIds) {
        db.prepare('DELETE FROM question_knowledge_points WHERE question_id = ?').run(questionId);
        db.prepare('DELETE FROM question_model_points WHERE question_id = ?').run(questionId);
        db.prepare('DELETE FROM question_taxonomy_nodes WHERE question_id = ?').run(questionId);
        db.prepare('DELETE FROM question_assets WHERE question_id = ?').run(questionId);
        db.prepare('DELETE FROM question_contents WHERE question_id = ?').run(questionId);
        db.prepare("DELETE FROM vector_embeddings WHERE tenant_id = ? AND entity_type = 'question' AND entity_id = ?").run(tenantId, questionId);
        db.prepare("DELETE FROM search_index_jobs WHERE tenant_id = ? AND entity_type = 'question' AND entity_id = ?").run(tenantId, questionId);
      }
      for (const batchId of batchIds) {
        db.prepare('DELETE FROM import_items WHERE batch_id = ?').run(batchId);
      }
      db.prepare('DELETE FROM import_batches WHERE tenant_id = ?').run(tenantId);
      db.prepare('DELETE FROM questions WHERE tenant_id = ?').run(tenantId);
    });
    transaction();
    return result;
  }

  listQuestionKnowledgePoints(db, id, tenantId = 'default') {
    const question = this.getQuestion(db, id, tenantId);
    if (!question) return null;
    return db.prepare(
      `SELECT qkp.question_id,
              qkp.knowledge_point_id,
              qkp.weight,
              qkp.created_at,
              qkp.updated_at,
              kp.name,
              kp.parent_id,
              kp.description
       FROM question_knowledge_points qkp
       LEFT JOIN knowledge_points kp ON kp.id = qkp.knowledge_point_id AND kp.deleted = 0
       WHERE qkp.question_id = ?
       ORDER BY qkp.created_at ASC`
    ).all(id);
  }

  _validateKnowledgePoints(db, knowledgePointIds, tenantId = 'default') {
    const uniqueIds = [...new Set((knowledgePointIds || []).filter(Boolean))];
    const missing = [];
    for (const knowledgePointId of uniqueIds) {
      const row = db.prepare(
        'SELECT id FROM knowledge_points WHERE id = ? AND tenant_id = ? AND deleted = 0'
      ).get(knowledgePointId, tenantId);
      if (!row) missing.push(knowledgePointId);
    }
    if (missing.length > 0) {
      throw new Error(`knowledge point not found: ${missing.join(',')}`);
    }
    return uniqueIds;
  }

  setQuestionKnowledgePoints(db, id, payload = {}, tenantId = 'default') {
    const existing = this.getQuestion(db, id, tenantId);
    if (!existing) return null;
    const ts = now();
    const knowledgePointIds = this._validateKnowledgePoints(db, normalizeKnowledgePointIds(payload), tenantId);
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM question_knowledge_points WHERE question_id = ?').run(id);
      for (const knowledgePointId of knowledgePointIds) {
        db.prepare(
          `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(id, knowledgePointId, 1, ts, ts);
      }
      db.prepare('UPDATE questions SET updated_at = ? WHERE id = ? AND deleted = 0').run(ts, id);
      this.enqueueSearchJob(db, id, 'upsert', tenantId);
      eventBus.publish(db, 'question.changed', 'question', id, { action: 'knowledge_update', knowledge_point_ids: knowledgePointIds }, tenantId);
    });
    transaction();
    return this.getQuestion(db, id, tenantId);
  }

  addQuestionKnowledgePoints(db, id, payload = {}, tenantId = 'default') {
    const existing = this.getQuestion(db, id, tenantId);
    if (!existing) return null;
    const current = new Set(existing.knowledge_point_ids || []);
    const additions = this._validateKnowledgePoints(db, normalizeKnowledgePointIds(payload), tenantId);
    if (additions.length === 0) return existing;
    const ts = now();
    const transaction = db.transaction(() => {
      for (const knowledgePointId of additions) {
        if (current.has(knowledgePointId)) continue;
        db.prepare(
          `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(id, knowledgePointId, 1, ts, ts);
      }
      db.prepare('UPDATE questions SET updated_at = ? WHERE id = ? AND deleted = 0').run(ts, id);
      this.enqueueSearchJob(db, id, 'upsert', tenantId);
      eventBus.publish(db, 'question.changed', 'question', id, { action: 'knowledge_add', knowledge_point_ids: additions }, tenantId);
    });
    transaction();
    return this.getQuestion(db, id, tenantId);
  }

  removeQuestionKnowledgePoints(db, id, payload = {}, tenantId = 'default') {
    const existing = this.getQuestion(db, id, tenantId);
    if (!existing) return null;
    const removalIds = [...new Set(normalizeKnowledgePointIds(payload).filter(Boolean))];
    if (removalIds.length === 0) return existing;
    const ts = now();
    const transaction = db.transaction(() => {
      for (const knowledgePointId of removalIds) {
        db.prepare('DELETE FROM question_knowledge_points WHERE question_id = ? AND knowledge_point_id = ?').run(id, knowledgePointId);
      }
      db.prepare('UPDATE questions SET updated_at = ? WHERE id = ? AND deleted = 0').run(ts, id);
      this.enqueueSearchJob(db, id, 'upsert', tenantId);
      eventBus.publish(db, 'question.changed', 'question', id, { action: 'knowledge_remove', knowledge_point_ids: removalIds }, tenantId);
    });
    transaction();
    return this.getQuestion(db, id, tenantId);
  }

  replaceQuestionKnowledgePoint(db, id, payload = {}, tenantId = 'default') {
    return this.setQuestionKnowledgePoints(db, id, payload, tenantId);
  }

  searchQuestionsFallback(db, filters = {}, tenantId = 'default') {
    return this.listQuestions(db, { ...filters, q: filters.q || filters.search, limit: filters.limit || 50 }, tenantId);
  }

  enqueueSearchJob(db, questionId, operation = 'upsert', tenantId = 'default') {
    const ts = now();
    db.prepare(
      `INSERT INTO search_index_jobs
       (id, tenant_id, entity_type, entity_id, operation, status, created_at, updated_at)
       VALUES (?, ?, 'question', ?, ?, 'pending', ?, ?)`
    ).run(uuidv4(), tenantId, questionId, operation, ts, ts);
  }


  getImportBatch(db, batchId, tenantId = 'default') {
    const batch = db.prepare(
      'SELECT * FROM import_batches WHERE id = ? AND tenant_id = ?'
    ).get(batchId, tenantId);
    if (!batch) return null;
    const items = db.prepare(
      'SELECT * FROM import_items WHERE batch_id = ? ORDER BY item_index ASC'
    ).all(batchId).map(row => ({
      ...row,
      task_id: row.batch_id,
      status: importItemUiStatus(row),
      warnings: parseJsonArray(row.warnings),
      errors: parseJsonArray(row.errors),
      payload: parseJsonObject(row.payload),
    }));
    return {
      ...batch,
      task_id: batch.id,
      success_items: Number(batch.accepted_items || 0),
      warning_items: Number(batch.warning_items || 0),
      failed_items: Number(batch.failed_items || batch.rejected_items || 0),
      quality_report: parseJsonObject(batch.quality_report),
      result_summary: parseJsonObject(batch.result_summary),
      items,
    };
  }

  listImportBatches(db, filters = {}, tenantId = 'default') {
    const limit = Math.min(Math.max(Number(filters.limit) || 20, 1), 100);
    return db.prepare(
      `SELECT * FROM import_batches
       WHERE tenant_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`
    ).all(tenantId, limit).map(row => ({
      ...row,
      task_id: row.id,
      success_items: Number(row.accepted_items || 0),
      warning_items: Number(row.warning_items || 0),
      failed_items: Number(row.failed_items || row.rejected_items || 0),
      quality_report: parseJsonObject(row.quality_report),
      result_summary: parseJsonObject(row.result_summary),
    }));
  }

  listImportTasks(db, filters = {}, tenantId = 'default') {
    return this.listImportBatches(db, filters, tenantId);
  }

  getImportTask(db, taskId, tenantId = 'default') {
    return this.getImportBatch(db, taskId, tenantId);
  }

  createImportTask(db, payload, tenantId = 'default') {
    return this.createImportBatch(db, payload, tenantId);
  }

  createImportBatch(db, payload, tenantId = 'default') {
    this.ensureTenant(db, tenantId);
    const ts = now();
    const batchId = uuidv4();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const seen = new Set();
    const seenExactStems = new Set();
    let duplicateItems = 0;
    let rejectedItems = 0;
    let acceptedItems = 0;
    let warningItems = 0;
    const duplicateSources = { in_batch: 0, existing_bank: 0 };
    const qualityBuckets = { high: 0, medium: 0, low: 0 };
    const errors = {};
    const warnings = {};

    const transaction = db.transaction(() => {
      db.prepare(
        `INSERT INTO import_batches
         (id, tenant_id, source_type, file_name, file_hash, status, total_items, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'checking', ?, ?, ?)`
      ).run(batchId, tenantId, payload.source_type || 'manual', payload.file_name || null, payload.file_hash || null, items.length, ts, ts);

      items.forEach((item, index) => {
        const normalized = normalizeImportItem(item, payload.defaults || {});
        const contentHash = contentHashForQuestion(normalized);
        const exactStem = exactStemForDuplicate(normalized);
        const quality = validateImportItem(normalized);
        const valid = quality.errors.length === 0;
        const inBatchDuplicate = valid && seen.has(contentHash);
        const inBatchExactDuplicate = valid && exactStem && seenExactStems.has(exactStem);
        const existingDuplicate = valid && !!db.prepare(
          `SELECT 1
           FROM question_contents qc
           JOIN questions q ON q.id = qc.question_id
           WHERE qc.content_hash = ?
             AND qc.deleted = 0
             AND q.deleted = 0
             AND q.tenant_id = ?`
        ).get(contentHash, tenantId);
        const existingExactDuplicate = valid && exactStem && !!db.prepare(
          `SELECT 1
           FROM question_contents qc
           JOIN questions q ON q.id = qc.question_id
           WHERE TRIM(qc.stem) = ?
             AND qc.deleted = 0
             AND q.deleted = 0
             AND q.tenant_id = ?`
        ).get(exactStem, tenantId);
        const duplicate = inBatchDuplicate || inBatchExactDuplicate || existingDuplicate || existingExactDuplicate;
        const status = !valid ? 'rejected' : duplicate ? 'duplicate' : 'accepted';
        if (!valid) {
          rejectedItems++;
        } else if (duplicate) {
          duplicateItems++;
          if (inBatchDuplicate || inBatchExactDuplicate) duplicateSources.in_batch++;
          if (existingDuplicate || existingExactDuplicate) duplicateSources.existing_bank++;
        } else {
          acceptedItems++;
        }
        if (quality.warnings.length > 0 || duplicate) warningItems++;
        if (valid) {
          seen.add(contentHash);
          if (exactStem) seenExactStems.add(exactStem);
        }
        const bucket = quality.score >= 0.8 ? 'high' : quality.score >= 0.5 ? 'medium' : 'low';
        qualityBuckets[bucket]++;
        for (const code of quality.errors) errors[code] = (errors[code] || 0) + 1;
        for (const code of quality.warnings) warnings[code] = (warnings[code] || 0) + 1;
        db.prepare(
          `INSERT INTO import_items
           (id, batch_id, item_index, content_hash, status, quality_score, warnings, errors, error_message, payload, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          uuidv4(),
          batchId,
          index,
          contentHash,
          status,
          quality.score,
          JSON.stringify(duplicate ? [...quality.warnings, 'duplicate'] : quality.warnings),
          JSON.stringify(quality.errors),
          quality.errors.length ? quality.errors.join(',') : null,
          JSON.stringify({ ...normalized, content_hash: contentHash, quality_warnings: quality.warnings }),
          ts,
          ts
        );
      });

      const qualityReport = {
        status: rejectedItems > 0 ? 'needs_review' : duplicateItems > 0 ? 'has_duplicates' : 'ready',
        total_items: items.length,
        accepted_items: acceptedItems,
        warning_items: warningItems,
        duplicate_items: duplicateItems,
        rejected_items: rejectedItems,
        failed_items: rejectedItems,
        duplicate_sources: duplicateSources,
        quality_buckets: qualityBuckets,
        errors,
        warnings,
      };
      db.prepare(
        `UPDATE import_batches
         SET status = 'checked', accepted_items = ?, warning_items = ?, failed_items = ?, duplicate_items = ?, rejected_items = ?, quality_report = ?, updated_at = ?
         WHERE id = ?`
      ).run(acceptedItems, warningItems, rejectedItems, duplicateItems, rejectedItems, JSON.stringify(qualityReport), ts, batchId);
    });

    transaction();
    return this.getImportBatch(db, batchId, tenantId);
  }

  commitImportBatch(db, batchId, tenantId = 'default', context = {}) {
    if (!context.userId || !context.deviceId) {
      const error = new Error('authorization context required for import commit'); error.code = 'AUTHORIZATION_CONTEXT_REQUIRED'; throw error;
    }
    const batch = this.getImportBatch(db, batchId, tenantId);
    if (!batch) return null;
    if (!['checked', 'partial_failed'].includes(batch.status)) {
      throw new Error(`import batch status ${batch.status} cannot be committed`);
    }
    const ts = now();
    const accepted = db.prepare(
      'SELECT * FROM import_items WHERE batch_id = ? AND status = ? ORDER BY item_index ASC'
    ).all(batchId, 'accepted').map(row => ({
      ...row,
      warnings: parseJsonArray(row.warnings),
      errors: parseJsonArray(row.errors),
      payload: parseJsonObject(row.payload),
    }));
    const result = { imported_items: 0, failed_items: 0, question_ids: [], errors: [] };

    const transaction = db.transaction(() => {
      db.prepare('UPDATE import_batches SET status = ?, updated_at = ? WHERE id = ?').run('importing', ts, batchId);
      for (const item of accepted) {
        try {
          const payload = item.payload || {};
          const created = this.createQuestion(db, { ...payload, content_hash: item.content_hash }, tenantId, context);
          db.prepare('UPDATE import_items SET status = ?, question_id = ?, updated_at = ? WHERE id = ?').run('imported', created.id, now(), item.id);
          result.imported_items++;
          result.question_ids.push(created.id);
        } catch (err) {
          result.failed_items++;
          result.errors.push({ item_index: item.item_index, error: err.message });
          db.prepare('UPDATE import_items SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
            .run('failed', err.message, now(), item.id);
        }
      }
      const finalStatus = result.failed_items > 0 ? 'partial_failed' : 'imported';
      db.prepare('UPDATE import_batches SET status = ?, failed_items = ?, result_summary = ?, updated_at = ? WHERE id = ?')
        .run(finalStatus, result.failed_items, JSON.stringify(result), now(), batchId);
    });

    transaction();
    return { ...this.getImportBatch(db, batchId, tenantId), commit_result: result };
  }

  async refreshKnowledgeRollups(db) {
    const rows = db.prepare(
      `SELECT qkp.knowledge_point_id,
              COUNT(*) AS direct_question_count,
              SUM(CASE WHEN q.difficulty <= 2 THEN 1 ELSE 0 END) AS easy_count,
              SUM(CASE WHEN q.difficulty = 3 THEN 1 ELSE 0 END) AS medium_count,
              SUM(CASE WHEN q.difficulty >= 4 THEN 1 ELSE 0 END) AS hard_count
       FROM question_knowledge_points qkp
       JOIN questions q ON q.id = qkp.question_id AND q.deleted = 0
       GROUP BY qkp.knowledge_point_id`
    ).all();
    const ts = now();
    const upsert = db.prepare(
      `INSERT OR REPLACE INTO knowledge_point_rollups
       (knowledge_point_id, direct_question_count, total_question_count, easy_count, medium_count, hard_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const transaction = db.transaction(() => {
      for (const row of rows) {
        upsert.run(row.knowledge_point_id, row.direct_question_count, row.direct_question_count, row.easy_count || 0, row.medium_count || 0, row.hard_count || 0, ts);
      }
    });
    transaction();
    await cache.setKnowledgeRollups(rows);
    return rows;
  }
}

module.exports = new QuestionBankService();
