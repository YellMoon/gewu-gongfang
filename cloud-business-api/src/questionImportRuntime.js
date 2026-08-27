'use strict';

const { createQuestionImportTaskRepository } = require('./questionImportTaskRepository');

function createQuestionImportTaskRuntime({ writerQuery } = {}) {
  if (typeof writerQuery !== 'function') return null;
  return createQuestionImportTaskRepository({ query: writerQuery });
}

module.exports = Object.freeze({ createQuestionImportTaskRuntime });
