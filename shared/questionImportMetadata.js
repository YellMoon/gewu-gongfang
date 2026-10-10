'use strict';

// The parser's source_info carries printed source labels, not taxonomy IDs.
// Explicit desktop edits (including clearing a value) always take precedence.
function importQuestionMetadata(candidate) {
  const sourceInfo = candidate?.source_info;
  const result = {};
  for (const key of ['source', 'year', 'grade', 'semester', 'exam_type', 'region', 'school']) {
    if (candidate && Object.hasOwn(candidate, key) && candidate[key] !== undefined) {
      result[key] = candidate[key];
    } else if (sourceInfo && typeof sourceInfo[key] === 'string' && sourceInfo[key].trim()) {
      result[key] = sourceInfo[key].trim();
    }
  }
  return result;
}

function plainText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10FFFF ? String.fromCodePoint(Number(n)) : '')
    .replace(/[\uFE0E\uFE0F]/g, '')
    .replace(/[\uFF21-\uFF3A]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).trim();
}

function inferImportedQuestionType(candidate) {
  const answer = plainText(candidate?.answer).replace(/^\s*(?:\u7B54\u6848|\u53C2\u8003\u7B54\u6848)\s*[:\uFF1A]\s*/, '')
    .replace(/^[\s(\uFF08\[\u3010]+|[\s)\uFF09\]\u3011.\u3002]+$/g, '');
  if (/^(?:\u5BF9|\u6B63\u786E|\u9519|\u9519\u8BEF|\u52FE|\u53C9|[\u221A\u2713\u2714\u00D7\u2715\u2716\u2717\u2718\u2705\u274C\u274E\u2611])$/.test(answer)) return '\u5224\u65AD\u9898';
  if (/^[A-Z](?:[\s,\uFF0C\u3001;/]*[A-Z])*$/.test(answer)) {
    return answer.replace(/[^A-Z]/g, '').length === 1 ? '\u5355\u9009\u9898' : '\u591A\u9009\u9898';
  }
  const stem = plainText(candidate?.content || candidate?.stem);
  return /\u5B9E\u9A8C|\u63A2\u7A76|\u6D4B\u91CF|\u6D4B\u5B9A|\u64CD\u4F5C\u6B65\u9AA4|\u6570\u636E\u5904\u7406/.test(stem) ? '\u5B9E\u9A8C\u9898' : '\u89E3\u7B54\u9898';
}

function applyImportLabels(candidate, metadata = {}, sourceType = 'lecture') {
  const labels = {};
  for (const key of ['year', 'grade', 'semester', 'exam_type', 'region', 'school']) {
    labels[key] = sourceType === 'exam' ? String(metadata[key] ?? '').trim() : '';
  }
  labels.source = sourceType === 'exam' ? String(metadata.paper_name ?? metadata.source ?? '').trim() : '';
  labels.paper_name = sourceType === 'exam' ? String(metadata.paper_name ?? '').trim() : '';
  return { ...candidate, ...labels, type: inferImportedQuestionType(candidate),
    question_types: [inferImportedQuestionType(candidate)] };
}

module.exports = { importQuestionMetadata, inferImportedQuestionType, applyImportLabels };
