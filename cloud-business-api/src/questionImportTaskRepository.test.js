'use strict';

const assert = require('assert');

const { createQuestionImportTaskRepository } = require('./questionImportTaskRepository');

function baseRequest() {
  return {
    sourceType: 'lecture',
    sourceFileName: 'mechanics.docx',
    sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sourceSha256: 'a'.repeat(64),
    sourceBytes: 1234,
    metadata: { subject: 'physics' },
    storage: { taskId: 'task_12345678', objectId: 'obj_source_1', objectVersion: 1 },
  };
}

async function main() {
  const calls = [];
  const repository = createQuestionImportTaskRepository({
    randomId: () => 'fixed-import-id',
    query: async (text, values) => {
      calls.push([text, values]);
      if (text.includes('SELECT task_id AS "taskId"') && text.includes('idempotency_key=$3')) return { rows: [] };
      if (text.includes('INSERT INTO business.question_import_tasks')) return { rows: [{
        taskId: 'question_import_task_fixed-import-id', status: 'awaiting_source_storage', phase: 'awaiting_source_storage',
        requestHash: values[10], createdAt: new Date('2026-08-23T00:00:00.000Z'), updatedAt: new Date('2026-08-23T00:00:00.000Z'),
      }] };
      if (text.includes('UPDATE business.import_source_objects')) return { rows: [{
        taskId: values[0], status: 'queued_for_parse', phase: 'queued_for_parse', requestHash: 'b'.repeat(64),
        createdAt: new Date('2026-08-23T00:00:00.000Z'), updatedAt: new Date('2026-08-23T00:01:00.000Z'),
      }] };
      throw new Error(`unexpected query: ${text}`);
    },
  });

  const created = await repository.create({
    tenantId: 'default', actor: { accountId: 'teacher-1', roles: ['teacher'] }, idempotencyKey: 'import-key-1', request: baseRequest(),
  });
  assert.deepStrictEqual(created, {
    taskId: 'question_import_task_fixed-import-id', status: 'awaiting_source_storage', phase: 'awaiting_source_storage',
    requestHash: created.requestHash, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', replayed: false,
  });
  assert.match(created.requestHash, /^[0-9a-f]{64}$/);
  assert.ok(calls.some(([text]) => text.includes('INSERT INTO business.storage_object_tasks')),
    'creating an import task must atomically reserve an immutable NAS storage task');
  assert.ok(calls.some(([text]) => text.includes('INSERT INTO business.import_source_objects')),
    'creating an import task must bind its source object to the cloud task');
  assert.ok(!calls.some(([text]) => /INSERT INTO business\.questions|INSERT INTO business\.question_contents/u.test(text)),
    'creating an import task must not create a question before explicit confirmation');

  await assert.rejects(() => repository.create({
    tenantId: 'default', actor: { accountId: 'student-1', roles: ['student'] }, idempotencyKey: 'import-key-2', request: baseRequest(),
  }), /CLOUD_QUESTION_IMPORT_ACCESS_DENIED/);

  await assert.rejects(() => repository.create({
    tenantId: 'default', actor: { accountId: 'teacher-1', roles: ['teacher'] }, idempotencyKey: 'import-key-3',
    request: { ...baseRequest(), sourceFileName: '../escape.docx' },
  }), /CLOUD_QUESTION_IMPORT_INPUT_INVALID/);

  const verified = await repository.markSourceVerified({
    taskId: created.taskId, storageTaskId: 'task_12345678',
  });
  assert.deepStrictEqual(verified, {
    taskId: created.taskId, status: 'queued_for_parse', phase: 'queued_for_parse', requestHash: 'b'.repeat(64),
    createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:01:00.000Z', replayed: false,
  });
  assert.ok(calls.some(([text, values]) => text.includes('UPDATE business.import_source_objects')
    && values[0] === created.taskId && values[1] === 'task_12345678'),
  'only the source object bound to this import task can unlock parsing');

  console.log('cloud question import task repository checks passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
