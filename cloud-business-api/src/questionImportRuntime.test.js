'use strict';

const assert = require('assert');
const { createQuestionImportTaskRuntime } = require('./questionImportRuntime');

async function main() {
  assert.strictEqual(createQuestionImportTaskRuntime(), null, 'question import must not fall back to the runtime reader when its writer is unavailable');
  const calls = [];
  const runtime = createQuestionImportTaskRuntime({
    writerQuery: async (text, values) => {
      calls.push([text, values]);
      return { rows: [] };
    },
  });
  assert.ok(runtime && typeof runtime.create === 'function', 'a dedicated command-writer query must create the import runtime');
  await assert.rejects(runtime.read({
    tenantId: 'default', actor: { accountId: 'account_1', roles: ['teacher'] }, taskId: 'question_import_task_1',
  }), /CLOUD_QUESTION_IMPORT_NOT_FOUND/);
  assert.ok(calls.length > 0, 'all import repository access must use the supplied command-writer query');
  process.stdout.write('question import runtime wiring passed\n');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
