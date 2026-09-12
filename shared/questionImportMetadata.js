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

module.exports = { importQuestionMetadata };
