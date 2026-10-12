'use strict';

const LABEL_FIELDS = ['source', 'year', 'grade', 'semester', 'exam_type', 'region', 'organization_type', 'school'];
const DEFAULT_SIMILARITY_THRESHOLD = 90;
const ORGANIZATION_TYPES = ['校考','联盟联考','市级统考','多市联考','省级统考','全国统考','其他'];
const clean = value => String(value ?? '').replace(/\s+/g, '').trim();

// Ignore presentation and import-local IDs, retain mathematical and media identity.
function nodeIdentity(node) {
  if (!node) return '';
  if (node.type === 'text') {
    const semantic = (node.marks || []).filter(mark => ['subscript', 'superscript'].includes(mark.type)).map(mark => mark.type).sort();
    return semantic.length ? `<${semantic.join(',')}>${clean(node.text)}</${semantic.join(',')}>` : clean(node.text);
  }
  if (['formula', 'formulaBlock'].includes(node.type)) return `<formula>${clean(node.attrs?.canonicalLatex)}</formula>`;
  if (node.type === 'image') {
    const ref = node.attrs?.assetKey || node.attrs?.src || '';
    const hash = String(ref).match(/[0-9a-f]{64}/i)?.[0];
    return `<image>${hash || ref}</image>`;
  }
  const children = (node.content || []).map(nodeIdentity).join('');
  if (['table', 'tableRow', 'tableCell', 'tableHeader'].includes(node.type)) {
    return `<${node.type}:${node.attrs?.colspan || 1}:${node.attrs?.rowspan || 1}>${children}</${node.type}>`;
  }
  return children;
}

function legacyIdentity(value) {
  // UTF-8: legacy scientific markup must not lose mathematical distinctions.
  return clean(String(value ?? '').replace(/<[^>]*\bdata-latex=["']([^"']+)["'][^>]*>/gi, (_, latex) => `<formula>${latex}</formula>`)
    .replace(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi, (_, src) => `<image>${src.match(/[0-9a-f]{64}/i)?.[0] || src}</image>`)
    .replace(/<(?!\/?(?:image|formula|sup|sub|table|tr|td|th)\b)[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
}

function questionIdentity(question) {
  const document = question.rich_content || question.richContent;
  const rich = document?.sections;
  const stem = rich?.stem ? nodeIdentity(rich.stem) : legacyIdentity(question.content ?? question.stem);
  const options = rich?.options?.length ? rich.options.map((option, index) => [option.label || String.fromCharCode(65 + index), nodeIdentity(option.content)])
    : (question.options || []).map((option, index) => [option.label || String.fromCharCode(65 + index), legacyIdentity(typeof option === 'string' ? option : option.content ?? option.text)]);
  const subQuestions = rich ? (rich.subQuestions || []).map(item => nodeIdentity(item.content))
    : (question.subQuestions || []).map(item => legacyIdentity(item.content ?? item.stem));
  return { subject: question.subject || '', stem, options, subQuestions };
}

function identityKey(question) { return JSON.stringify(questionIdentity(question)); }

// Multiset Dice coefficient keeps repeated symbols/numbers represented.
function similarity(left, right) {
  const a = questionIdentity(left), b = questionIdentity(right);
  if (a.subject && b.subject && a.subject !== b.subject) return 0;
  if (!a.stem || !b.stem) return 0;
  if (JSON.stringify(a) === JSON.stringify(b)) return 100;
  const l = JSON.stringify([a.stem, a.options, a.subQuestions]), r = JSON.stringify([b.stem, b.options, b.subQuestions]);
  const grams = value => {
    const result = new Map();
    for (let index = 0; index < value.length - 1; index++) {
      const gram = value.slice(index, index + 2); result.set(gram, (result.get(gram) || 0) + 1);
    }
    return result;
  };
  const lg = grams(l), rg = grams(r);
  let overlap = 0;
  for (const [gram, count] of lg) overlap += Math.min(count, rg.get(gram) || 0);
  // Only identical identities may ever reach 100%.
  return Math.min(99.99, 200 * overlap / (l.length + r.length - 2));
}

function labelValues(question, field) {
  const scalar = (field === 'school' && (question.school_ids?.length || question.metadata_labels?.school?.length)) || (field === 'region' && question.metadata_labels?.region?.length) ? [] : [question[field]];
  return [...new Set([...(question.metadata_labels?.[field] || []), ...scalar].filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
}

function mergeQuestion(existing, incoming) {
  const result = { ...existing };
  for (const field of ['subject_id','chapter_id','difficulty_coefficient']) if (result[field] == null && incoming[field] != null) result[field] = incoming[field];
  result.has_image = Boolean(existing.has_image || incoming.has_image);
  result.has_formula = Boolean(existing.has_formula || incoming.has_formula);
  const filled = [], conflicts = [];
  // UTF-8: compare structured answer/analysis semantics, including images.
  const priorRich = existing.rich_content || existing.richContent;
  const nextRich = incoming.rich_content || incoming.richContent;
  for (const [field, alternate, section] of [['answer', 'answer', 'answer'], ['explanation', 'analysis', 'analysis']]) {
    const prior = existing[field] ?? existing[alternate];
    const next = incoming[field] ?? incoming[alternate];
    const priorIdentity = priorRich?.sections?.[section] ? nodeIdentity(priorRich.sections[section]) : legacyIdentity(prior);
    const nextIdentity = nextRich?.sections?.[section] ? nodeIdentity(nextRich.sections[section]) : legacyIdentity(next);
    if (!priorIdentity && nextIdentity) {
      result[field] = next; result[alternate] = next; filled.push(field);
      const rich = existing.rich_content || existing.richContent;
      const newRich = incoming.rich_content || incoming.richContent;
      if (rich && newRich?.sections?.[section]) {
        const base = result.rich_content || rich;
        result.rich_content = { ...base, sections: { ...base.sections, [section]: newRich.sections[section] } };
      }
    } else if (priorIdentity && nextIdentity && priorIdentity !== nextIdentity) conflicts.push(field);
  }
  if (priorRich && nextRich) {
    const subQuestions = (priorRich.sections.subQuestions || []).map((sub, index) => {
      const next = nextRich.sections.subQuestions?.[index];
      if (!next) return sub;
      if (!nodeIdentity(sub.answer) && nodeIdentity(next.answer)) { filled.push(`subQuestions.${index}.answer`); return {...sub,answer:next.answer}; }
      if (nodeIdentity(sub.answer) && nodeIdentity(next.answer) && nodeIdentity(sub.answer)!==nodeIdentity(next.answer)) conflicts.push(`subQuestions.${index}.answer`);
      return sub;
    });
    const base = result.rich_content || priorRich;
    result.rich_content = { ...base, sections: { ...base.sections, subQuestions } };
  }
  result.metadata_labels = Object.fromEntries(LABEL_FIELDS.map(field => [field, [...new Set([...labelValues(existing, field), ...labelValues(incoming, field)])]]));
  for (const field of LABEL_FIELDS) result[field] = existing[field] || incoming[field] || null;
  result.school_ids = [...new Set([...(existing.school_ids || []), ...(incoming.school_ids || [])])];
  const union = (a = [], b = []) => [...new Set([...a, ...b])];
  const oldTax = existing.taxonomy || {}, newTax = incoming.taxonomy || {};
  result.taxonomy = { ...oldTax, knowledgePointIds: union(oldTax.knowledgePointIds, newTax.knowledgePointIds), modelPointIds: union(oldTax.modelPointIds, newTax.modelPointIds),
    taxonomyIds: Object.fromEntries([...new Set([...Object.keys(oldTax.taxonomyIds || {}), ...Object.keys(newTax.taxonomyIds || {})])]
      .map(id => [id, union(oldTax.taxonomyIds?.[id], newTax.taxonomyIds?.[id])])) };
  return { question: result, filled, conflicts };
}

module.exports = { LABEL_FIELDS, DEFAULT_SIMILARITY_THRESHOLD, ORGANIZATION_TYPES, questionIdentity, identityKey, similarity, labelValues, mergeQuestion };
