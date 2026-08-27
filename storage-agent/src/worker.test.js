'use strict';

const assert = require('assert');
const crypto = require('crypto');

const { createStorageWorker } = require('./worker');
const { sealForAgent } = require('../../shared/encryptedNasRelay');

async function main() {
  const events = [];
  const pair = crypto.generateKeyPairSync('x25519');
  const agentPublicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const agentPrivateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url');
  const plaintext = Buffer.from('media');
  const expectedSha256 = crypto.createHash('sha256').update(plaintext).digest('hex');
  const task = { taskId: 'task_12345678', objectId: 'obj_1', objectVersion: 1, expectedSha256, expectedBytes: plaintext.length, leaseToken: 'lease-token-test-value', kind: 'relay' };
  const relay = sealForAgent({ agentPublicKey, binding: 'task_12345678:obj_1:1', plaintext });
  const sourceBytes = Buffer.from('word-source');
  const sourceHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  const sourceTask = {
    taskId: 'task_source_12345678', objectId: 'obj_source_1', objectVersion: 1, expectedSha256: sourceHash, expectedBytes: sourceBytes.length,
    leaseToken: 'lease-token-source-value', kind: 'question_import_source', importTaskId: 'question_import_task_1', sourceType: 'lecture', sourceFileName: 'source.docx',
  };
  const sourceRelay = sealForAgent({ agentPublicKey, binding: 'task_source_12345678:obj_source_1:1', plaintext: sourceBytes });
  const mediaBytes = Buffer.from('derived-image');
  const mediaHash = crypto.createHash('sha256').update(mediaBytes).digest('hex');
  const mediaTask = {
    taskId: 'task_media_12345678', objectId: 'obj_media_1', objectVersion: 1, expectedSha256: mediaHash, expectedBytes: mediaBytes.length,
    leaseToken: 'lease-token-media-value', kind: 'question_import_media', itemIndex: 0, assetIndex: 0,
    source: { objectId: 'obj_source_1', objectVersion: 1, sha256: sourceHash, bytes: sourceBytes.length,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sourceType: 'lecture', sourceFileName: 'source.docx' },
  };
  const leases = [null, task, sourceTask, mediaTask];
  const worker = createStorageWorker({
    agentPrivateKey,
    objectStore: {
      async putVerified(descriptor, bytes) {
        events.push('putVerified');
        if (descriptor.objectId === 'obj_1') {
          assert.deepStrictEqual(descriptor, { objectId: 'obj_1', version: 1, sha256: expectedSha256, bytes: plaintext.length });
          assert.deepStrictEqual(bytes, plaintext);
        } else if (descriptor.objectId === 'obj_source_1') {
          assert.deepStrictEqual(descriptor, { objectId: 'obj_source_1', version: 1, sha256: sourceHash, bytes: sourceBytes.length });
          assert.deepStrictEqual(bytes, sourceBytes);
        } else {
          assert.deepStrictEqual(descriptor, { objectId: 'obj_media_1', version: 1, sha256: mediaHash, bytes: mediaBytes.length });
          assert.deepStrictEqual(bytes, mediaBytes);
        }
      },
      async readVerified(descriptor) {
        events.push('readVerified');
        assert.deepStrictEqual(descriptor, { objectId: 'obj_source_1', version: 1, sha256: sourceHash, bytes: sourceBytes.length });
        return sourceBytes;
      },
    },
    client: {
      async lease() {
        events.push('lease');
        return leases.shift();
      },
      async download(input) {
        events.push('download');
        return input === task ? relay : sourceRelay;
      },
      async complete(input) {
        events.push('complete');
        if (input.taskId === task.taskId) {
          assert.deepStrictEqual(input, { taskId: task.taskId, leaseToken: task.leaseToken, observedSha256: expectedSha256, observedBytes: plaintext.length });
        } else {
          assert.deepStrictEqual(input, { taskId: mediaTask.taskId, leaseToken: mediaTask.leaseToken, observedSha256: mediaHash, observedBytes: mediaBytes.length });
        }
        return { taskId: input.taskId, state: 'verified' };
      },
      async reportSourceCandidates(input) {
        events.push('reportSourceCandidates');
        assert.deepStrictEqual(input, {
          taskId: 'question_import_task_1', leaseToken: sourceTask.leaseToken, observedSha256: sourceHash, observedBytes: sourceBytes.length,
          candidates: [{ contentHash: 'b'.repeat(64), candidate: { stem: 'parsed' }, validation: { status: 'accepted' }, mediaManifest: [] }],
        });
        return { taskId: input.taskId, status: 'candidates_ready' };
      },
    },
    questionImportParser: {
      async parse(input) {
        events.push('parse');
        assert.deepStrictEqual(input, { sourceType: 'lecture', sourceFileName: 'source.docx', bytes: sourceBytes });
        return { candidates: [{ contentHash: 'b'.repeat(64), candidate: { stem: 'parsed' }, validation: { status: 'accepted' }, mediaManifest: [] }], mediaBytes: [[mediaBytes]] };
      },
    },
  });

  assert.deepStrictEqual(await worker.runOnce(), { state: 'idle' });
  assert.deepStrictEqual(await worker.runOnce(), { state: 'verified', taskId: 'task_12345678' });
  assert.deepStrictEqual(await worker.runOnce(), { state: 'candidates_ready', taskId: 'task_source_12345678', importTaskId: 'question_import_task_1' });
  assert.deepStrictEqual(await worker.runOnce(), { state: 'verified', taskId: 'task_media_12345678' });
  assert.deepStrictEqual(events, ['lease', 'lease', 'download', 'putVerified', 'complete', 'lease', 'download', 'putVerified', 'parse', 'reportSourceCandidates', 'lease', 'putVerified', 'complete'],
    'derived media must reuse the just-verified source parse instead of parsing the same Word file again');

  const fallbackEvents = [];
  const stalePositionWorker = createStorageWorker({
    agentPrivateKey,
    objectStore: {
      async readVerified() { fallbackEvents.push('readVerified'); return sourceBytes; },
      async putVerified(descriptor, bytes) {
        fallbackEvents.push('putVerified');
        assert.deepStrictEqual(descriptor, { objectId: 'obj_media_1', version: 1, sha256: mediaHash, bytes: mediaBytes.length });
        assert.deepStrictEqual(bytes, mediaBytes);
      },
    },
    client: {
      async lease() { fallbackEvents.push('lease'); return mediaTask; },
      async download() { throw new Error('not used'); },
      async complete(input) { fallbackEvents.push('complete'); assert.strictEqual(input.taskId, mediaTask.taskId); },
      async reportSourceCandidates() { throw new Error('not used'); },
    },
    questionImportParser: {
      async parse() {
        fallbackEvents.push('parse');
        return { candidates: [], mediaBytes: [[Buffer.from('different')], [mediaBytes]] };
      },
    },
  });
  assert.deepStrictEqual(await stalePositionWorker.runOnce(), { state: 'verified', taskId: mediaTask.taskId },
    'a checksum-identified imported asset must remain recoverable when a legacy parser emitted a different positional ordering');
  assert.deepStrictEqual(fallbackEvents, ['lease', 'readVerified', 'parse', 'putVerified', 'complete']);

  const rejectedEvents = [];
  const tamperedWorker = createStorageWorker({
    agentPrivateKey,
    questionImportParser: { async parse() { throw new Error('not called'); } },
    objectStore: { async putVerified() { rejectedEvents.push('putVerified'); }, async readVerified() { rejectedEvents.push('readVerified'); } },
    client: {
      async lease() { rejectedEvents.push('lease'); return task; },
      async download() { rejectedEvents.push('download'); return { ...relay, ciphertext: Buffer.concat([relay.ciphertext, Buffer.from([0])]) }; },
      async complete() { rejectedEvents.push('complete'); },
      async reportSourceCandidates() { rejectedEvents.push('reportSourceCandidates'); },
    },
  });
  await assert.rejects(() => tamperedWorker.runOnce(), /RELAY_ENVELOPE_AUTH_FAILED/);
  assert.deepStrictEqual(rejectedEvents, ['lease', 'download'], 'a rejected relay must not write NAS bytes or submit a receipt');
  assert.throws(() => createStorageWorker({ client: {} }), /STORAGE_WORKER_CONFIG_INVALID/);
}

main().then(() => console.log('storage agent worker checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
