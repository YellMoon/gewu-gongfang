'use strict';

const CHOICE_TYPES = new Set([
  'choice', 'single', 'single-choice', 'single_choice', 'single choice',
  'multi', 'multi-choice', 'multi_choice', 'multi choice',
  'multiple', 'multiple-choice', 'multiple_choice', 'multiple choice',
  '\u5355\u9009', '\u5355\u9009\u9898', '\u591a\u9009', '\u591a\u9009\u9898', '\u9009\u62e9', '\u9009\u62e9\u9898',
]);

const INVALID_CHOICE_STRUCTURE = 'invalid_choice_structure';

function isChoiceQuestionType(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.some(item => typeof item === 'string' && CHOICE_TYPES.has(item.trim().toLowerCase()));
}

function optionLabel(option, index) {
  if (typeof option === 'string') return index < 26 ? String.fromCharCode(65 + index) : null;
  if (!option || typeof option !== 'object' || Array.isArray(option)
    || typeof option.label !== 'string' || !/^[A-Z]$/.test(option.label)) return null;
  return option.label;
}

function answerLabels(value) {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value !== 'string' || value !== value.trim()) return null;
  let normalized = value.normalize('NFKC').replace(/<[^>]*>/gu, ' ').trim().toUpperCase();
  if (!normalized) return [];
  normalized = normalized.replace(/^(?:\u53c2\u8003\u7b54\u6848|\u7b54\u6848|ANSWER)\s*[:\uff1a]?\s*/u, '');
  const compact = normalized.replace(/[\s,\uff0c\u3001;\uff1b/|()[\]{}\uff08\uff09\u3010\u3011.:\uff1a]+/gu, '');
  if (/^[A-Z]+$/.test(compact)) return [...new Set(compact)];
  const labels = [...normalized.matchAll(/(?:^|[^A-Z])([A-Z])(?=$|[^A-Z])/gu)].map(match => match[1]);
  return labels.length ? [...new Set(labels)] : null;
}

function validateChoiceQuestionStructure({ type, options, answer } = {}) {
  if (!isChoiceQuestionType(type)) return Object.freeze({ choice: false, valid: true, code: null });
  if (!Array.isArray(options) || options.length < 2 || options.length > 26) {
    return Object.freeze({ choice: true, valid: false, code: INVALID_CHOICE_STRUCTURE });
  }
  const labels = options.map(optionLabel);
  const expected = labels.map((_, index) => String.fromCharCode(65 + index));
  if (labels.some(label => label === null) || labels.some((label, index) => label !== expected[index])) {
    return Object.freeze({ choice: true, valid: false, code: INVALID_CHOICE_STRUCTURE });
  }
  const selected = answerLabels(answer);
  if (selected === null || selected.some(label => !labels.includes(label))) {
    return Object.freeze({ choice: true, valid: false, code: INVALID_CHOICE_STRUCTURE });
  }
  return Object.freeze({ choice: true, valid: true, code: null });
}

module.exports = Object.freeze({
  INVALID_CHOICE_STRUCTURE,
  isChoiceQuestionType,
  validateChoiceQuestionStructure,
});
