'use strict';
const assert = require('node:assert/strict');
async function main() {
  const { createDesktopQuestionImportClient } = await import('./desktopQuestionImportClient.mjs');
  const source = new Uint8Array(Buffer.from('original Word bytes'));
  const parsed = { sourceSha256: 'a'.repeat(64), parserSha256: 'c'.repeat(64), candidates: [{ contentHash: 'd'.repeat(64), candidate: { stem: 'clean', assets: [] }, validation: { status: 'accepted', codes: [] }, mediaManifest: [] }], mediaBytes: [[]], qualityReport: { image_cleanup: { removed_count: 2 } } };
  let parses = 0; const calls = [];
  const deps = {
    parse: async input => { parses++; assert.deepEqual(input.bytes, source); return parsed; },
    idFactory: () => '12345678', now: () => new Date('2026-10-06T00:00:00Z'),
    readSession: () => ({ authorization: 'Bearer session', authContext: { deviceId: 'device' } }),
    seal: async input => { assert.deepEqual(input.bytes, source, 'archive the original unchanged'); return { sourceSha256: parsed.sourceSha256, sourceBytes: source.length, envelope: {}, ciphertextBase64: 'sealed' }; },
    fetchImpl: async (url, options) => {
      assert.equal(parses, 1, 'parse/cleanup finishes before any network request'); calls.push({ url, options });
      if (url.endsWith('/relay-key')) return { ok: true, json: async () => ({ ok: true, intakeProcessing: 'desktop-v1', agentPublicKey: 'A'.repeat(44), agentKeyFingerprint: 'b'.repeat(64) }) };
      return { ok: true, json: async () => ({ ok: true, task: { taskId: 'question_import_task_12345678', status: 'candidates_ready', phase: 'awaiting_storage', mediaTargets: [] } }) };
    },
  };
  const client = createDesktopQuestionImportClient({ cloudBusinessIdentityBaseUrl: 'https://cloud.example/cloud-business' }, deps);
  await client.createFromWord({ sourceType: 'lecture', sourceFileName: 'input.docx', sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: source, metadata: {} });
  assert(calls[1].url.endsWith('/question-imports/parsed'));
  assert.deepEqual(JSON.parse(calls[1].options.body).parsed, { parserSha256: parsed.parserSha256, candidates: parsed.candidates });
  assert(!calls.some(call => JSON.stringify(call.options).includes('original Word bytes')));
  await assert.rejects(client.createFromParsed({ sourceType: 'lecture', sourceFileName: 'input.docx', sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: source, metadata: {}, parsed: { ...parsed, sourceSha256: 'e'.repeat(64) } }), /SOURCE_MISMATCH/);
  const offlineCalls = calls.length;
  await client.parseFromWord({ sourceType: 'exam', sourceFileName: 'offline.docx', bytes: source });
  assert.equal(calls.length, offlineCalls, 'local parsing needs no authorization request or fetch');
  const edited = await client.withEditedCandidates(parsed, [{ stem: 'edited text', answer: 'B', rich_content: { type: 'question-document' }, assets: [{ data_url: 'not transported' }] }]);
  assert.equal(edited.candidates[0].candidate.stem, 'edited text');
  assert.deepEqual(edited.candidates[0].candidate.assets, []);
  assert.notEqual(edited.candidates[0].contentHash, parsed.candidates[0].contentHash);
  assert.equal((await client.withEditedCandidates(parsed, [{ answer: 'B', stem: 'edited text', assets: [], rich_content: { type: 'question-document' } }])).candidates[0].contentHash, edited.candidates[0].contentHash, 'candidate hashes use canonical key order');

  const retryCalls = []; let failed = false;
  const retryClient = createDesktopQuestionImportClient({ cloudBusinessIdentityBaseUrl: 'https://cloud.example/cloud-business' }, {
    ...deps, fetchImpl: async (url, options) => {
      retryCalls.push({ url, options });
      if (url.endsWith('/relay-key')) return { ok: true, json: async () => ({ ok: true, intakeProcessing: 'desktop-v1', agentPublicKey: 'A'.repeat(44), agentKeyFingerprint: 'b'.repeat(64) }) };
      if (!failed) { failed = true; throw new Error('network lost after cloud commit'); }
      return { ok: true, json: async () => ({ ok: true, task: { taskId: 'question_import_task_12345678', status: 'candidates_ready', phase: 'awaiting_storage', mediaTargets: [] } }) };
    },
  });
  const retryInput = { sourceType: 'exam', sourceFileName: 'retry.docx', sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: source, metadata: {}, parsed };
  await assert.rejects(retryClient.createFromParsed(retryInput), /network lost/);
  await retryClient.createFromParsed(retryInput);
  assert.equal(retryCalls.length, 3);
  assert.deepEqual(retryCalls[1], retryCalls[2], 'unknown-outcome retries keep exact ciphertext and idempotency key');
  await assert.rejects(retryClient.createFromParsed({ ...retryInput, metadata: { changed: true } }), /RETRY_CHANGED/);
  const changedBytes = new Uint8Array(source); changedBytes[0] ^= 1;
  await assert.rejects(retryClient.createFromParsed({ ...retryInput, bytes: changedBytes }), /RETRY_CHANGED/, 'same-length replacement bytes must not reuse an older archive request');

  const media = new Uint8Array(Buffer.from('diagram'));
  const mediaParsed = { ...parsed, candidates: [{ ...parsed.candidates[0], candidate: { stem: 'with image', assets: [] }, mediaManifest: [{ sha256: 'f'.repeat(64), bytes: media.length, mimeType: 'image/png' }] }], mediaBytes: [[media]] };
  const mediaTask = { taskId: 'question_import_task_12345678', status: 'awaiting_media_storage', phase: 'awaiting_media_storage', mediaTargets: [{ itemIndex: 0, assetIndex: 0, sha256: 'f'.repeat(64), bytes: media.length, mimeType: 'image/png', storageTaskId: 'task_media12345678', objectId: 'obj_media12345678', objectVersion: 1, mediaId: 'question_import_media_12345678', storageState: 'queued' }] };
  const mediaCalls = [];
  const mediaClient = createDesktopQuestionImportClient({ cloudBusinessIdentityBaseUrl: 'https://cloud.example/cloud-business' }, {
    ...deps, sealAsset: async input => { assert.deepEqual(input.bytes, media); return { sourceSha256: 'f'.repeat(64), sourceBytes: media.length, envelope: {}, ciphertextBase64: 'encrypted-image' }; },
    fetchImpl: async (url, options) => { mediaCalls.push({ url, options }); return { ok: true, json: async () => ({ ok: true, intakeProcessing: 'desktop-v1', agentPublicKey: 'A'.repeat(44), agentKeyFingerprint: 'b'.repeat(64) }) }; },
  });
  await mediaClient.resumeMedia(mediaTask, mediaParsed);
  assert(mediaCalls[1].url.endsWith('/media/question_import_media_12345678/relay'));
  assert(!mediaCalls[1].options.body.includes('diagram'), 'media travels encrypted');
  await mediaClient.resumeMedia({ ...mediaTask, mediaTargets: [{ ...mediaTask.mediaTargets[0], storageState: 'verified' }] }, mediaParsed);
  assert.equal(mediaCalls.length, 2, 'verified media is not uploaded again');
  await assert.rejects(mediaClient.resumeMedia({ ...mediaTask, mediaTargets: [{ ...mediaTask.mediaTargets[0], sha256: '0'.repeat(64) }] }, mediaParsed), /MEDIA_TARGETS_INVALID/);
  const incompatible = createDesktopQuestionImportClient({ cloudBusinessIdentityBaseUrl: 'https://cloud.example/cloud-business' }, { ...deps, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true }) }) });
  await assert.rejects(incompatible.createFromParsed(retryInput), /CLOUD_UPGRADE_REQUIRED/);
  console.log('desktop intake local parse-before-network, unchanged original and cloud candidate submission passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
