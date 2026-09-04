'use strict';

const { createQuestionImportTaskRepository } = require('./questionImportTaskRepository');

function createQuestionImportTaskRuntime({ taskQuery, storageAgentId, runtimeReceiptMaxAgeSeconds } = {}) {
  if (typeof taskQuery !== 'function' || typeof storageAgentId !== 'string') return null;
  return createQuestionImportTaskRepository({ query: taskQuery, storageAgentId, runtimeReceiptMaxAgeSeconds });
}

module.exports = Object.freeze({ createQuestionImportTaskRuntime });
