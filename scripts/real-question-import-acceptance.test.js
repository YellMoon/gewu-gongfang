'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  importSource,
  waitForCandidates,
  taskEvidence,
  parserRevision,
  importIdempotencyKey,
  findReusableImport,
  createWordImport,
} = require('./real-question-import-acceptance');

assert.deepStrictEqual(importSource('exam', '/tmp/exam.docx'), {
  sourceType: 'exam',
  sourcePath: '/tmp/exam.docx',
  sourceFileName: 'exam.docx',
  sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
assert.throws(() => importSource('exam', '/tmp/not-word.pdf'), /REAL_QUESTION_IMPORT_SOURCE_INVALID/);

(async () => {
  const statuses = [
    { taskId: 'question_import_task_abcdefgh', status: 'queued_for_parse', phase: 'queued_for_parse' },
    { taskId: 'question_import_task_abcdefgh', status: 'candidates_ready', phase: 'candidates_ready', items: [{ itemId: 'question_import_item_abcdefgh', itemIndex: 0, contentHash: 'a'.repeat(64), candidate: { stem: 'x' }, validation: { status: 'accepted' }, mediaManifest: [] }] },
  ];
  const ready = await waitForCandidates({ read: async () => statuses.shift(), sleep: async () => {}, attempts: 2 });
  assert.strictEqual(ready.status, 'candidates_ready');
  assert.deepStrictEqual(taskEvidence(ready), { taskId: 'question_import_task_abcdefgh', status: 'candidates_ready', phase: 'candidates_ready', itemCount: 1, acceptedOrWarningCount: 1 });
  await assert.rejects(
    () => waitForCandidates({ read: async () => ({ taskId: 'question_import_task_abcdefgh', status: 'failed', phase: 'failed' }), sleep: async () => {}, attempts: 1 }),
    /REAL_QUESTION_IMPORT_TASK_FAILED/,
  );
  assert.strictEqual(parserRevision('A'.repeat(64)), 'a'.repeat(64));
  assert.throws(() => parserRevision('not-a-revision'), /REAL_QUESTION_IMPORT_PARSER_REVISION_INVALID/);
  const sourceHash = 'b'.repeat(64);
  const parserHash = 'c'.repeat(64);
  const marker = importIdempotencyKey('exam', sourceHash, parserHash);
  assert.strictEqual(marker, importIdempotencyKey('exam', sourceHash, parserHash));
  assert.notStrictEqual(marker, importIdempotencyKey('exam', sourceHash, 'd'.repeat(64)));

  const reuseQueries = [];
  const reusable = await findReusableImport({
    query: async (sql, values) => {
      reuseQueries.push({ sql, values });
      return { rows: [{
        taskId: 'question_import_task_reusable1', status: 'drafts_prepared', phase: 'drafts_prepared',
        itemCount: 20, acceptedOrWarningCount: 20,
      }] };
    },
    tenantId: 'default', accountId: 'account-1', sourceType: 'exam', sourceSha256: sourceHash,
    sourceBytes: 123, parserSha256: parserHash,
  });
  assert.deepStrictEqual(reusable, {
    taskId: 'question_import_task_reusable1', status: 'drafts_prepared', phase: 'drafts_prepared',
    itemCount: 20, acceptedOrWarningCount: 20,
  });
  assert.deepStrictEqual(reuseQueries[0].values, ['default', 'account-1', 'exam', sourceHash, 123, parserHash]);
  assert.match(reuseQueries[0].sql, /metadata_json->>'acceptance'='real-question-import-v2'/u);
  assert.match(reuseQueries[0].sql, /metadata_json->>'parserSha256'=\$6/u);
  assert.match(reuseQueries[0].sql, /LIMIT 2/u);
  await assert.rejects(() => findReusableImport({
    query: async () => ({ rows: [reusable, reusable] }), tenantId: 'default', accountId: 'account-1',
    sourceType: 'exam', sourceSha256: sourceHash, sourceBytes: 123, parserSha256: parserHash,
  }), /REAL_QUESTION_IMPORT_DUPLICATE_REVISION/);
  await assert.rejects(() => findReusableImport({
    query: async () => ({ rows: [{ taskId: 'question_import_task_failed123', status: 'failed', phase: 'failed', itemCount: 0, acceptedOrWarningCount: 0 }] }),
    tenantId: 'default', accountId: 'account-1', sourceType: 'exam', sourceSha256: sourceHash,
    sourceBytes: 123, parserSha256: parserHash,
  }), /REAL_QUESTION_IMPORT_FAILED_REVISION/);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-real-import-'));
  const sourcePath = path.join(temporary, 'exam.docx');
  const plaintext = Buffer.from('real import fixture');
  fs.writeFileSync(sourcePath, plaintext);
  const plaintextSha256 = crypto.createHash('sha256').update(plaintext).digest('hex');
  const calls = [];
  let preflightRequest;
  const created = await createWordImport({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      const body = url.endsWith('/relay-key')
        ? { ok: true, agentPublicKey: 'public-key', agentKeyFingerprint: 'e'.repeat(64) }
        : { ok: true, task: { taskId: 'question_import_task_created1', status: 'awaiting_source_storage', phase: 'awaiting_source_storage' } };
      return { ok: true, status: 200, json: async () => body };
    },
    sessionToken: 'session-token', deviceId: 'device-1', baseUrl: 'https://cloud.example.invalid',
    source: { sourceType: 'exam', sourcePath, sourceFileName: 'exam.docx', sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    parserSha256: parserHash,
    idFactory: () => 'abcdefgh', now: () => new Date('2026-09-04T00:00:00.000Z'),
    sealer: ({ binding, plaintext: observed }) => {
      assert.strictEqual(binding, 'task_abcdefgh:obj_abcdefgh:1');
      assert.deepStrictEqual(observed, plaintext);
      return {
        envelope: { plaintextSha256, plaintextBytes: plaintext.length, ciphertextSha256: 'f'.repeat(64), ciphertextBytes: 3 },
        ciphertext: Buffer.from('abc'),
      };
    },
    preflight: async value => { preflightRequest = value; },
  });
  assert.strictEqual(created.taskId, 'question_import_task_created1');
  const submitted = JSON.parse(calls[1].options.body);
  assert.deepStrictEqual(submitted.metadata, {
    sourceFileName: 'exam.docx', acceptance: 'real-question-import-v2', parserSha256: parserHash,
  });
  assert.strictEqual(submitted.sourceSha256, plaintextSha256);
  assert.strictEqual(calls[1].options.headers['x-idempotency-key'], importIdempotencyKey('exam', plaintextSha256, parserHash));
  assert.strictEqual(preflightRequest.metadata.parserSha256, parserHash);
  fs.rmSync(temporary, { recursive: true, force: true });
  console.log('real question import acceptance checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
