'use strict';

// Pure preparation only: no database, network, session, or automatic submission.
const crypto = require('node:crypto');
const { stableJson } = require('../shared/authorityProtocol');
const { changesForPublishedQuestion } = require('./real-question-import-publish');
const fail = code => { throw new Error('FORMULA_CORRECTION_' + code); };
const hash = value => crypto.createHash('sha256').update(stableJson(value)).digest('hex');
const escapeAttribute = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const decodeAttribute = value => value.replace(/&(?:amp|lt|gt|quot|apos|#39|#x27);/g, entity => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'",'&#x27;':"'"})[entity]);

function updateHtmlProjection(value, formulas) {
  if (typeof value === 'string') return value.replace(/<span\b[^>]*>/g, tag => {
    const id = tag.match(/\bdata-formula-id="([^"]*)"/);
    const replacement = id && formulas.get(decodeAttribute(id[1]));
    if (!replacement) return tag;
    const latex = tag.match(/\bdata-latex="([^"]*)"/);
    if (!latex || decodeAttribute(latex[1]) !== replacement.before) fail('STATE_CHANGED');
    return tag.replace(latex[0], () => 'data-latex="' + escapeAttribute(replacement.after) + '"');
  });
  if (Array.isArray(value)) return value.map(item => updateHtmlProjection(item, formulas));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, updateHtmlProjection(item, formulas)]));
  return value;
}

function prepareFormulaCorrection({ current, baseline, replacements, validateFormula } = {}) {
  if (typeof validateFormula !== 'function') fail('VALIDATOR_REQUIRED');
  if (!current || !baseline || !/^question-import-[a-f0-9]{40}$/.test(current.id || '')
    || !Number.isSafeInteger(current.version) || current.version < 1 || current.status !== 'published') fail('STATE_CHANGED');
  for (const key of ['id','version','status','content','options','answer','analysis','rich_content']) {
    if (!Object.hasOwn(baseline, key) || stableJson(current[key]) !== stableJson(baseline[key])) fail('STATE_CHANGED');
  }
  if (!Array.isArray(replacements) || replacements.length === 0 || replacements.length > 1000) fail('REPLACEMENTS_INVALID');
  const rich = structuredClone(current.rich_content), visited = new Set(), formulas = new Map();
  for (const replacement of replacements) {
    const path = replacement?.path;
    if (!Array.isArray(path) || path.length < 3 || path.length > 64
      || path.at(-1) !== 'canonicalLatex' || path.at(-2) !== 'attrs'
      || path.some(key => !(Number.isSafeInteger(key) && key >= 0) && !(typeof key === 'string' && /^[a-zA-Z][a-zA-Z0-9]*$/.test(key)))
      || path.some(key => ['constructor','prototype','__proto__'].includes(key))
      || visited.has(stableJson(path)) || typeof replacement.before !== 'string'
      || typeof replacement.after !== 'string' || replacement.after === replacement.before) fail('REPLACEMENTS_INVALID');
    visited.add(stableJson(path));
    let node = rich;
    for (const key of path.slice(0, -2)) {
      if (!node || typeof node !== 'object' || !Object.hasOwn(node, key)) fail('STATE_CHANGED');
      node = node[key];
    }
    if (node?.type !== 'formula' || !node.attrs || node.attrs.canonicalLatex !== replacement.before) fail('STATE_CHANGED');
    validateFormula(replacement.after);
    if (typeof node.attrs.id !== 'string' || !node.attrs.id) fail('STATE_CHANGED');
    const existing = formulas.get(node.attrs.id);
    if (existing && (existing.before !== replacement.before || existing.after !== replacement.after)) fail('STATE_CHANGED');
    formulas.set(node.attrs.id, replacement);
    node.attrs.canonicalLatex = replacement.after;
  }
  const changes = changesForPublishedQuestion({ ...current, rich_content: rich });
  for (const key of ['content', 'options', 'answer', 'analysis']) changes[key] = updateHtmlProjection(changes[key], formulas);
  const type = 'question.update.v1';
  const payload = { id: current.id, expectedVersion: current.version, changes };
  const payloadHash = hash({ type, payload });
  return { commandId: 'formula-source-correction-' + payloadHash.slice(0, 40), payloadHash, type, payload };
}

module.exports = Object.freeze({ prepareFormulaCorrection });
