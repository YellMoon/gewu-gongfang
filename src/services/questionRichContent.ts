import type { JSONContent } from '@tiptap/react';
import type { QuestionRichDocument, RichOption, RichSubQuestion } from '../types/questionRichContent';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_DEPTH = 40;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,1023}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ALLOWED_NODES = new Set([
  'doc', 'paragraph', 'text', 'hardBreak', 'heading', 'blockquote', 'bulletList', 'orderedList',
  'listItem', 'horizontalRule', 'codeBlock', 'formula', 'formulaBlock', 'image',
]);
const ALLOWED_MARKS = new Set([
  'bold', 'italic', 'underline', 'strike', 'code', 'subscript', 'superscript', 'textStyle', 'fontFamily', 'fontSize', 'highlight', 'link',
]);
const FONT_FAMILIES = new Set(['SimSun', 'Microsoft YaHei', 'KaiTi', 'FangSong', 'Arial', 'Times New Roman']);
const FONT_SIZES = new Set(['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px']);
const LINE_HEIGHTS = new Set(['1', '1.25', '1.5', '1.75', '2']);
const TEXT_ALIGNS = new Set(['left', 'center', 'right', 'justify']);
const COLOR = /^#[0-9a-f]{3,8}$/i;

function fail(message: string): never { throw new Error(`rich_content ${message}`); }
function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function allowKeys(value: Record<string, any>, allowed: string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} contains unsupported attr ${key}`);
}

function safeWebHref(value: unknown): boolean {
  return typeof value === 'string' && (/^https?:\/\//i.test(value) || /^\/(?!\/)/.test(value) || /^#[A-Za-z0-9_-]+$/.test(value));
}

function validateSafeObject(value: unknown, depth = 0): void {
  if (value === undefined) return;
  if (depth > MAX_DEPTH) fail('nesting is too deep');
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (Array.isArray(value)) { value.forEach(item => validateSafeObject(item, depth + 1)); return; }
  if (!isRecord(value)) fail('contains unsupported values');
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) fail('contains an unsafe key');
    validateSafeObject(child, depth + 1);
  }
}

function validateNode(node: unknown, depth = 0): asserts node is JSONContent {
  if (!isRecord(node) || typeof node.type !== 'string' || !ALLOWED_NODES.has(node.type)) fail('contains an unsupported node');
  if (depth > MAX_DEPTH) fail('nesting is too deep');
  if (node.type === 'doc' && node.text !== undefined) fail('doc cannot contain text');
  if (node.type === 'text' && typeof node.text !== 'string') fail('text node requires text');
  const attrs = isRecord(node.attrs) ? node.attrs : {};
  const noAttrs = ['doc', 'text', 'hardBreak', 'blockquote', 'bulletList', 'listItem', 'horizontalRule'];
  if (noAttrs.includes(node.type)) allowKeys(attrs, [], node.type);
  if (['paragraph', 'heading'].includes(node.type)) {
    allowKeys(attrs, node.type === 'heading' ? ['level', 'textAlign', 'lineHeight', 'indent'] : ['textAlign', 'lineHeight', 'indent'], node.type);
    if (attrs.textAlign != null && !TEXT_ALIGNS.has(String(attrs.textAlign))) fail(`${node.type} textAlign is invalid`);
    if (attrs.lineHeight != null && !LINE_HEIGHTS.has(String(attrs.lineHeight))) fail(`${node.type} lineHeight is invalid`);
    if (attrs.indent != null && (!Number.isInteger(attrs.indent) || attrs.indent < 0 || attrs.indent > 8)) fail(`${node.type} indent is invalid`);
    if (node.type === 'heading' && (!Number.isInteger(attrs.level) || attrs.level < 1 || attrs.level > 6)) fail('heading level is invalid');
  }
  if (node.type === 'orderedList') {
    allowKeys(attrs, ['start'], 'orderedList');
    if (attrs.start != null && (!Number.isInteger(attrs.start) || attrs.start < 1 || attrs.start > 100000)) fail('orderedList start is invalid');
  }
  if (node.type === 'codeBlock') {
    allowKeys(attrs, ['language'], 'codeBlock');
    if (attrs.language != null && !/^[A-Za-z0-9_+-]{1,40}$/.test(String(attrs.language))) fail('codeBlock language is invalid');
  }
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks)) fail('marks must be an array');
    for (const mark of node.marks) {
      if (!isRecord(mark) || typeof mark.type !== 'string' || !ALLOWED_MARKS.has(mark.type)) fail('contains an unsupported mark');
      const markAttrs = isRecord(mark.attrs) ? mark.attrs : {};
      if (['bold', 'italic', 'underline', 'strike', 'code', 'subscript', 'superscript'].includes(mark.type)) allowKeys(markAttrs, [], mark.type);
      if (mark.type === 'textStyle') {
        allowKeys(markAttrs, ['color', 'fontFamily', 'fontSize'], 'textStyle');
        if (markAttrs.color != null && !COLOR.test(String(markAttrs.color))) fail('textStyle color is invalid');
        if (markAttrs.fontFamily != null && !FONT_FAMILIES.has(String(markAttrs.fontFamily))) fail('textStyle fontFamily is invalid');
        if (markAttrs.fontSize != null && !FONT_SIZES.has(String(markAttrs.fontSize))) fail('textStyle fontSize is invalid');
      }
      if (mark.type === 'fontFamily') { allowKeys(markAttrs, ['fontFamily'], 'fontFamily'); if (!FONT_FAMILIES.has(String(markAttrs.fontFamily))) fail('fontFamily is invalid'); }
      if (mark.type === 'fontSize') { allowKeys(markAttrs, ['fontSize'], 'fontSize'); if (!FONT_SIZES.has(String(markAttrs.fontSize))) fail('fontSize is invalid'); }
      if (mark.type === 'highlight') { allowKeys(markAttrs, ['color'], 'highlight'); if (markAttrs.color != null && !COLOR.test(String(markAttrs.color))) fail('highlight color is invalid'); }
      if (mark.type === 'link') {
        allowKeys(markAttrs, ['href', 'target', 'rel', 'class'], 'link');
        if (!safeWebHref(markAttrs.href) || (markAttrs.target != null && !['_blank', '_self'].includes(markAttrs.target))) fail('link href is invalid');
        if (markAttrs.rel != null && markAttrs.rel !== 'noopener noreferrer') fail('link rel is invalid');
        if (markAttrs.class != null && !/^[A-Za-z0-9_-]{1,64}$/.test(markAttrs.class)) fail('link class is invalid');
      }
      if (mark.attrs !== undefined) validateSafeObject(mark.attrs, depth + 1);
    }
  }
  if (node.type === 'formula' || node.type === 'formulaBlock') {
    allowKeys(attrs, ['id', 'canonicalLatex', 'displayMode', 'sourceRef', 'warnings', 'conversionStatus', 'sourceFormat', 'previewRef'], 'formula');
    if (!SAFE_ID.test(String(attrs.id || ''))) fail('formula id is invalid');
    if (typeof attrs.canonicalLatex !== 'string' || !attrs.canonicalLatex.trim() || attrs.canonicalLatex.length > 10000) fail('formula canonicalLatex is invalid');
    if (!['inline', 'block'].includes(attrs.displayMode)) fail('formula displayMode is invalid');
    if (attrs.sourceRef != null && !SAFE_REF.test(String(attrs.sourceRef))) fail('formula sourceRef is invalid');
    if (attrs.previewRef != null && !SAFE_REF.test(String(attrs.previewRef))) fail('formula previewRef is invalid');
    if (attrs.conversionStatus != null && !['complete', 'approximate', 'preview_only', 'unsupported', 'failed'].includes(attrs.conversionStatus)) fail('formula conversionStatus is invalid');
    if (attrs.sourceFormat != null && !['omml', 'eq_field', 'eq', 'mathtype', 'mathml', 'latex', 'unknown'].includes(attrs.sourceFormat)) fail('formula sourceFormat is invalid');
    if (attrs.warnings != null && (!Array.isArray(attrs.warnings) || attrs.warnings.some((item: unknown) => typeof item !== 'string' || item.length > 1000))) fail('formula warnings are invalid');
  }
  if (node.type === 'image') {
    allowKeys(attrs, ['src', 'assetKey', 'alt', 'title', 'width', 'height', 'align'], 'image');
    if (!SAFE_REF.test(String(attrs.assetKey || '')) || String(attrs.assetKey).includes('..')) fail('image assetKey is invalid');
    if (attrs.src != null && attrs.src !== `question-asset://${attrs.assetKey}`) fail('image src is invalid');
    if (attrs.alt != null && (typeof attrs.alt !== 'string' || attrs.alt.length > 1000)) fail('image alt is invalid');
    if (attrs.title != null && (typeof attrs.title !== 'string' || attrs.title.length > 1000)) fail('image title is invalid');
    for (const dimension of ['width', 'height']) {
      if (attrs[dimension] != null && (!Number.isFinite(attrs[dimension]) || attrs[dimension] <= 0 || attrs[dimension] > 10000)) fail(`image ${dimension} is invalid`);
    }
    if (attrs.align !== undefined && !['left', 'center', 'right'].includes(attrs.align)) fail('image align is invalid');
  }
  if (node.attrs !== undefined) validateSafeObject(node.attrs, depth + 1);
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) fail('node content must be an array');
    node.content.forEach(child => validateNode(child, depth + 1));
  }
}

function validateSectionDoc(value: unknown, label: string): asserts value is JSONContent {
  validateNode(value);
  if ((value as JSONContent).type !== 'doc') fail(`${label} must be a doc`);
}

export function normalizeQuestionRichContent(value: unknown): QuestionRichDocument {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch (_error) { fail('must be valid JSON'); }
  }
  parsed = JSON.parse(JSON.stringify(parsed));
  const stripOptionalNulls = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (node.attrs && (node.type === 'formula' || node.type === 'formulaBlock')) for (const key of ['sourceRef', 'warnings', 'conversionStatus', 'sourceFormat', 'previewRef']) if (node.attrs[key] == null) delete node.attrs[key];
    if (node.attrs && node.type === 'image') for (const key of ['src', 'alt', 'title', 'width', 'height', 'align']) if (node.attrs[key] == null) delete node.attrs[key];
    if (Array.isArray(node.content)) node.content.forEach(stripOptionalNulls);
    if (node.answer) stripOptionalNulls(node.answer);
  };
  const sectionsForCleanup = isRecord(parsed) && isRecord(parsed.sections) ? parsed.sections : {};
  Object.values(sectionsForCleanup).forEach(section => Array.isArray(section) ? section.forEach(stripOptionalNulls) : stripOptionalNulls(section));
  if (!isRecord(parsed) || parsed.version !== 1 || parsed.type !== 'question-document') fail('must be a version 1 question-document');
  if (!isRecord(parsed.sections)) fail('sections are required');
  const sections = parsed.sections;
  validateSectionDoc(sections.stem, 'stem');
  validateSectionDoc(sections.answer, 'answer');
  validateSectionDoc(sections.analysis, 'analysis');
  if (!Array.isArray(sections.options) || !Array.isArray(sections.subQuestions)) fail('option and subquestion sections must be arrays');
  sections.options.forEach((option: unknown) => {
    if (!isRecord(option) || !SAFE_ID.test(String(option.id || '')) || typeof option.label !== 'string' || typeof option.isCorrect !== 'boolean') fail('option is invalid');
    validateSectionDoc(option.content, 'option content');
  });
  sections.subQuestions.forEach((sub: unknown) => {
    if (!isRecord(sub) || !SAFE_ID.test(String(sub.id || '')) || typeof sub.label !== 'string') fail('subquestion is invalid');
    validateSectionDoc(sub.content, 'subquestion content');
    validateSectionDoc(sub.answer, 'subquestion answer');
  });
  validateSafeObject(parsed);
  const serialized = JSON.stringify(parsed);
  if (new TextEncoder().encode(serialized).length > MAX_BYTES) fail('is too large');
  return JSON.parse(serialized) as QuestionRichDocument;
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_all, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return named[entity.toLowerCase()] || '';
  });
}

function legacyText(value: unknown): string {
  return decodeEntities(String(value || '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\r\n?/g, '\n').replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function textDoc(value: unknown): JSONContent {
  const text = legacyText(value);
  return { type: 'doc', content: text ? text.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) : [] };
}

export function migrateLegacyQuestion(question: Record<string, any>): QuestionRichDocument {
  const legacyAnswer = legacyText(question.answer ?? '').toUpperCase();
  const answerLabels = new Set((legacyAnswer.match(/[A-Z]/g) || []));
  const optionValues = Array.isArray(question.options) ? question.options : [];
  const options: RichOption[] = optionValues.map((option: any, index: number) => ({
    id: String(option?.id || `option-${index + 1}`),
    label: String(option?.label || String.fromCharCode(65 + index)),
    isCorrect: Boolean(option?.isCorrect ?? option?.is_correct ?? answerLabels.has(String(option?.label || String.fromCharCode(65 + index)).toUpperCase())),
    content: textDoc(isRecord(option) ? (option.content ?? option.text ?? '') : option),
  }));
  const legacySubs = Array.isArray(question.sub_questions) ? question.sub_questions : (Array.isArray(question.subQuestions) ? question.subQuestions : []);
  const subQuestions: RichSubQuestion[] = legacySubs.map((sub: any, index: number) => ({
    id: String(sub?.id || `sub-${index + 1}`), label: String(sub?.label || `(${index + 1})`),
    content: textDoc(sub?.content ?? sub?.stem ?? ''), answer: textDoc(sub?.answer ?? ''),
  }));
  const stem = textDoc(question.stem ?? question.content ?? '');
  const legacyFormulas = Array.isArray(question.formulas) ? question.formulas : [];
  for (const [index, formula] of legacyFormulas.entries()) {
    const canonicalLatex = String(isRecord(formula) ? (formula.canonicalLatex ?? formula.latex ?? formula.content ?? '') : formula).trim().replace(/^\$+|\$+$/g, '');
    if (canonicalLatex) stem.content!.push({ type: 'formulaBlock', attrs: { id: `legacy-formula-${index + 1}`, canonicalLatex, displayMode: 'block', sourceFormat: 'latex' } });
  }
  return normalizeQuestionRichContent({ version: 1, type: 'question-document', sections: {
    stem, options, subQuestions,
    answer: textDoc(question.answer ?? ''), analysis: textDoc(question.explanation ?? question.analysis ?? ''),
  } });
}

function nodeText(node: JSONContent, flags: { formula: boolean; image: boolean }): string {
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'formula' || node.type === 'formulaBlock') { flags.formula = true; return ` ${String(node.attrs?.canonicalLatex || '')} `; }
  if (node.type === 'image') { flags.image = true; return ` ${String(node.attrs?.alt || '')} `; }
  const text = (node.content || []).map(child => nodeText(child, flags)).join('');
  return ['paragraph', 'heading', 'blockquote', 'listItem', 'codeBlock'].includes(node.type || '') ? `${text}\n` : text;
}

function projectDoc(doc: JSONContent, flags: { formula: boolean; image: boolean }): string {
  return nodeText(doc, flags).replace(/\r\n?/g, '\n').replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function projectQuestionRichContent(input: unknown) {
  const rich = normalizeQuestionRichContent(input);
  const flags = { formula: false, image: false };
  const stem = projectDoc(rich.sections.stem, flags);
  const options = rich.sections.options.map(option => ({ label: option.label, content: projectDoc(option.content, flags), isCorrect: option.isCorrect }));
  const subQuestions = rich.sections.subQuestions.map(sub => ({ label: sub.label, content: projectDoc(sub.content, flags), answer: projectDoc(sub.answer, flags) }));
  const answer = projectDoc(rich.sections.answer, flags);
  const explanation = projectDoc(rich.sections.analysis, flags);
  const formulas: string[] = [];
  const collectFormulas = (node: JSONContent) => { if (node.type === 'formula' || node.type === 'formulaBlock') formulas.push(String(node.attrs?.canonicalLatex || '')); (node.content || []).forEach(collectFormulas); };
  collectFormulas(rich.sections.stem); rich.sections.options.forEach(option => collectFormulas(option.content)); rich.sections.subQuestions.forEach(sub => { collectFormulas(sub.content); collectFormulas(sub.answer); }); collectFormulas(rich.sections.answer); collectFormulas(rich.sections.analysis);
  const searchText = [stem, ...options.flatMap(o => [o.label, o.content]), ...subQuestions.flatMap(s => [s.label, s.content, s.answer]), answer, explanation]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return { stem, options, subQuestions, answer, explanation, formulas: formulas.filter(Boolean), searchText, hasFormula: flags.formula, hasImage: flags.image };
}

export function normalizeBrowserQuestionRecord<T extends Record<string, any>>(question: T): T & { rich_content: QuestionRichDocument; search_text: string } {
  const rich = question.rich_content ? normalizeQuestionRichContent(question.rich_content) : migrateLegacyQuestion(question);
  const projection = projectQuestionRichContent(rich);
  return {
    ...question,
    content: question.content || question.stem || projection.stem,
    stem: question.stem || question.content || projection.stem,
    answer: question.answer || projection.answer,
    analysis: question.analysis || question.explanation || projection.explanation,
    explanation: question.explanation || question.analysis || projection.explanation,
    options: Array.isArray(question.options) && question.options.length ? question.options : projection.options,
    sub_questions: Array.isArray(question.sub_questions) && question.sub_questions.length ? question.sub_questions : projection.subQuestions,
    rich_content: rich,
    has_formula: projection.hasFormula || Boolean(question.has_formula),
    has_image: projection.hasImage || Boolean(question.has_image),
    search_text: projection.searchText,
  };
}

export function applyQuestionSyncRecords(records: Map<string, any>): any[] {
  return Array.from(records.values()).map(record => {
    const { _synced, ...clean } = record || {};
    return normalizeBrowserQuestionRecord(clean);
  });
}

export function buildBrowserQuestionSearchText(question: Record<string, any>): string {
  const normalized = normalizeBrowserQuestionRecord(question);
  return [normalized.search_text, normalized.source, normalized.exam_type, normalized.region, normalized.school, normalized.year,
    ...(Array.isArray(normalized.knowledge_ids) ? normalized.knowledge_ids : []),
    ...(Array.isArray(normalized.model_ids) ? normalized.model_ids : [])]
    .filter(Boolean).join('\n').toLowerCase();
}

export function mergeBrowserQuestionUpdate(existing: Record<string, any>, updates: Record<string, any>): Record<string, any> & { rich_content: QuestionRichDocument; search_text: string } {
  const merged: Record<string, any> = { ...existing, ...updates };
  if (updates.content !== undefined && updates.stem === undefined) merged.stem = updates.content;
  if (updates.stem !== undefined && updates.content === undefined) merged.content = updates.stem;
  const legacyKeys = ['stem', 'content', 'answer', 'analysis', 'explanation', 'options', 'sub_questions', 'subQuestions'];
  if (updates.rich_content === undefined && legacyKeys.some(key => updates[key] !== undefined)) {
    const current = normalizeQuestionRichContent(existing.rich_content || migrateLegacyQuestion(existing));
    const migrated = migrateLegacyQuestion(merged);
    const next = JSON.parse(JSON.stringify(current)) as QuestionRichDocument;
    if (updates.stem !== undefined || updates.content !== undefined) next.sections.stem = migrated.sections.stem;
    if (updates.options !== undefined) next.sections.options = migrated.sections.options;
    if (updates.sub_questions !== undefined || updates.subQuestions !== undefined) next.sections.subQuestions = migrated.sections.subQuestions;
    if (updates.answer !== undefined) next.sections.answer = migrated.sections.answer;
    if (updates.analysis !== undefined || updates.explanation !== undefined) next.sections.analysis = migrated.sections.analysis;
    merged.rich_content = next;
  }
  return normalizeBrowserQuestionRecord(merged);
}
