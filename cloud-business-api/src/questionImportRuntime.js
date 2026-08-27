'use strict';

const { createQuestionImportTaskRepository } = require('./questionImportTaskRepository');

function createQuestionImportTaskRuntime({ taskQuery } = {}) {
  if (typeof taskQuery !== 'function') return null;
  return createQuestionImportTaskRepository({ query: taskQuery });
}

module.exports = Object.freeze({ createQuestionImportTaskRuntime });
