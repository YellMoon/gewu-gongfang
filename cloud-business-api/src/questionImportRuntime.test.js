'use strict';

const assert = require('assert');
const { createQuestionImportTaskRuntime } = require('./questionImportRuntime');

async function main() {
  assert.strictEqual(createQuestionImportTaskRuntime(), null, 'question-import tasks require the dedicated cloud task query');
  const calls = [];
  const runtime = createQuestionImportTaskRuntime({
    taskQuery: async (text, values) => {
      calls.push([text, values]);
      return { rows: [] };
    },
  });
  assert.ok(runtime && typeof runtime.read === 'function');
  await assert.rejects(runtime.read({
    tenantId: 'default', actor: { accountId: 'account_1', roles: ['teacher'] }, taskId: 'question_import_task_1',
  }), /CLOUD_QUESTION_IMPORT_NOT_FOUND/);
  assert.ok(calls.length > 0, 'repository operations must use the dedicated cloud task query');
  process.stdout.write('question import runtime wiring passed\n');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
