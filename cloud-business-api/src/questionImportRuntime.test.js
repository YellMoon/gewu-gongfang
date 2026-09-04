'use strict';

const assert = require('assert');
const { createQuestionImportTaskRuntime } = require('./questionImportRuntime');

async function main() {
  assert.strictEqual(createQuestionImportTaskRuntime(), null, 'question-import tasks require the dedicated cloud task query');
  assert.strictEqual(createQuestionImportTaskRuntime({ taskQuery: async () => ({ rows: [] }) }), null,
    'new import tasks must not run without the configured storage-agent identity used for trusted receipts');
  const calls = [];
  const runtime = createQuestionImportTaskRuntime({
    storageAgentId: 'storage-agent-1',
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
  const fs = require('fs');
  const path = require('path');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(serverSource, /createQuestionImportTaskRepository\(\{[\s\S]*?storageAgentId:\s*process\.env\.CLOUD_STORAGE_AGENT_ID/u,
    'production wiring must inject the configured storage-agent id instead of accepting it from a desktop payload');
  process.stdout.write('question import runtime wiring passed\n');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
