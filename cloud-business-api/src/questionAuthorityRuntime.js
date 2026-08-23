'use strict';

const { createQuestionAuthorityService } = require('./questionAuthorityService');

function createQuestionAuthorityRuntime({ query, transaction } = {}) {
  if (typeof query !== 'function' || typeof transaction !== 'function') return null;
  try {
    return createQuestionAuthorityService({ query, transaction });
  } catch (_) {
    return null;
  }
}

module.exports = Object.freeze({ createQuestionAuthorityRuntime });
