'use strict';

const { createQuestionAuthorityService } = require('./questionAuthorityService');

function createQuestionAuthorityRuntime({ query } = {}) {
  if (typeof query !== 'function') return null;
  try {
    return createQuestionAuthorityService({ query });
  } catch (_) {
    return null;
  }
}

module.exports = Object.freeze({ createQuestionAuthorityRuntime });
