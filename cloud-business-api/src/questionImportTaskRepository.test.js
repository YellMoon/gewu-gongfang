'use strict';

const assert = require('assert');
const crypto = require('crypto');

const { createQuestionImportTaskRepository } = require('./questionImportTaskRepository');

function baseRequest() {
  const ciphertext = Buffer.from('encrypted import source');
  return {
    sourceType: 'lecture',
    sourceFileName: 'mechanics.docx',
    sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sourceSha256: 'a'.repeat(64),
    sourceBytes: 1234,
    metadata: { subject: 'physics' },
    storage: { taskId: 'task_12345678', objectId: 'obj_source_1', objectVersion: 1 },
    relay: {
      agentKeyFingerprint: 'b'.repeat(64),
      envelope: {
        version: 'x25519-aes-256-gcm-v1',
        ephemeralPublicKey: Buffer.alloc(44, 1).toString('base64url'), keyDerivationSalt: Buffer.alloc(16, 2).toString('base64url'),
        wrappedKeyNonce: Buffer.alloc(12, 3).toString('base64url'), wrappedKeyCiphertext: Buffer.alloc(32, 4).toString('base64url'),
        wrappedKeyTag: Buffer.alloc(16, 5).toString('base64url'), contentNonce: Buffer.alloc(12, 6).toString('base64url'),
        contentTag: Buffer.alloc(16, 7).toString('base64url'), ciphertextSha256: crypto.createHash('sha256').update(ciphertext).digest('hex'),
        ciphertextBytes: ciphertext.length, plaintextSha256: 'a'.repeat(64), plaintextBytes: 1234,
      },
      ciphertext,
      expiresAt: '2026-08-23T00:05:00.000Z',
    },
  };
}

async function main() {
  const calls = [];
  const repository = createQuestionImportTaskRepository({
    randomId: () => 'fixed-import-id',
    now: () => new Date('2026-08-23T00:00:00.000Z'),
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
      if (text.includes('INSERT INTO business.question_import_items')) return { rows: [{
        taskId: values[0], status: 'candidates_ready', phase: 'candidates_ready', requestHash: 'b'.repeat(64),
        createdAt: new Date('2026-08-23T00:00:00.000Z'), updatedAt: new Date('2026-08-23T00:02:00.000Z'),
      }] };
      if (text.includes("SET status='draft_prepared'")) {
        if (values[0] === 'question_import_task_unconfirmed') return { rows: [] };
        return { rows: [{
        taskId: values[0], status: 'drafts_prepared', phase: 'drafts_prepared', requestHash: 'b'.repeat(64),
        createdAt: new Date('2026-08-23T00:00:00.000Z'), updatedAt: new Date('2026-08-23T00:03:00.000Z'),
        items: [{ itemId: 'question_import_item_fixed-import-id_0', itemIndex: 0, contentHash: 'c'.repeat(64),
          candidate: { subject: 'physics', stem: 'What is force?', options: [], answer: 'mass times acceleration' },
          validation: { status: 'accepted' }, mediaManifest: [] }],
        }] };
      }
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
  assert.ok(calls.some(([text]) => text.includes('INSERT INTO business.encrypted_import_source_relays')),
    'creating an import task must atomically bind its expiring encrypted source relay');
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

  const candidates = await repository.storeCandidates({
    taskId: created.taskId,
    candidates: [{
      contentHash: 'c'.repeat(64),
      candidate: { subject: 'physics', stem: 'What is force?', options: [], answer: 'mass times acceleration' },
      validation: { status: 'accepted' },
      mediaManifest: [],
    }],
  });
  assert.strictEqual(candidates.status, 'candidates_ready');
  assert.ok(calls.some(([text]) => text.includes('INSERT INTO business.question_import_items')),
    'parsed text candidates must be persisted as cloud task items');
  assert.ok(!calls.some(([text]) => /INSERT INTO business\.questions|INSERT INTO business\.question_contents/u.test(text)),
    'candidate storage must not create a cloud question before explicit confirmation');

  const prepared = await repository.prepareDrafts({
    tenantId: 'default', actor: { accountId: 'teacher-1', roles: ['teacher'] }, taskId: created.taskId,
  });
  assert.strictEqual(prepared.status, 'drafts_prepared');
  assert.deepStrictEqual(prepared.items.map(item => item.itemId), ['question_import_item_fixed-import-id_0']);
  assert.ok(calls.some(([text, values]) => text.includes("SET status='draft_prepared'")
    && values[0] === created.taskId && values[1] === 'default' && values[2] === 'teacher-1'),
  'only the cloud task owner may prepare local pending drafts');
  assert.ok(!calls.some(([text]) => /INSERT INTO business\.questions|INSERT INTO business\.question_contents/u.test(text)),
    'preparing drafts must not write question authority tables');
  await assert.rejects(() => repository.prepareDrafts({
    tenantId: 'default', actor: { accountId: 'teacher-1', roles: ['teacher'] }, taskId: 'question_import_task_unconfirmed',
  }), /CLOUD_QUESTION_IMPORT_NOT_CONFIRMABLE/,
  'an import task without cloud-ready candidates must not create local submission drafts');

  console.log('cloud question import task repository checks passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
