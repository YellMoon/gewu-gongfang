'use strict';
function validDifficultyCoefficient(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1);
}
function coefficientDifficulty(value) {
  if (typeof value !== 'number' || !validDifficultyCoefficient(value)) return null;
  return value >= 0.7 ? 2 : value >= 0.4 ? 3 : 4;
}
function difficultyLabel(coefficient) {
  const level = coefficientDifficulty(coefficient);
  if (!Number.isFinite(level)) return '\u672A\u6807\u6CE8';
  return level <= 2 ? '\u7B80\u5355' : level === 3 ? '\u4E2D\u7B49' : '\u8F83\u96BE';
}
module.exports = { validDifficultyCoefficient, coefficientDifficulty, difficultyLabel };
