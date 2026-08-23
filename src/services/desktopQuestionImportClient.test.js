'use strict';

const assert = require('assert');

async function main() {
  const { createDesktopQuestionImportClient } = await import('./desktopQuestionImportClient.mjs');
  const calls = [];
  const envelope = { version: 'x25519-aes-256-gcm-v1' };
  const client = createDesktopQuestionImportClient({ cloudBusinessIdentityBaseUrl: 'https://cloud.example/cloud-business' }, {
    idFactory: () => '12345678', now: () => new Date('2026-08-23T00:00:00.000Z'),
    readSession: () => ({ authorization: 'Bearer desktop-token', authContext: { deviceId: 'desktop-device-1' } }),
    seal: async input => {
      assert.strictEqual(input.storageTaskId, 'task_12345678');
      assert.deepStrictEqual(Buffer.from(input.bytes), Buffer.from('raw-document-payload'));
      return { sourceSha256: 'a'.repeat(64), sourceBytes: input.bytes.byteLength, envelope, ciphertextBase64: Buffer.from('sealed').toString('base64url') };
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/relay-key')) return { ok: true, status: 200, json: async () => ({ ok: true, agentPublicKey: 'A'.repeat(44), agentKeyFingerprint: 'b'.repeat(64) }) };
      return { ok: true, status: 202, json: async () => ({ ok: true, task: { taskId: 'question_import_task_12345678', status: 'awaiting_source_storage', phase: 'awaiting_source_storage' } }) };
    },
  });
  const task = await client.createFromWord({ sourceType: 'lecture', sourceFileName: 'word.docx', sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new Uint8Array(Buffer.from('raw-document-payload')), metadata: { subject: 'physics' } });
  assert.strictEqual(task.taskId, 'question_import_task_12345678');
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer desktop-token');
  const body = JSON.parse(calls[1].options.body);
  assert.deepStrictEqual(body.storage, { taskId: 'task_12345678', objectId: 'obj_12345678', objectVersion: 1 });
  assert.ok(!calls[1].options.body.includes('raw-document-payload'), 'plaintext Word bytes must not be sent to cloud');
  assert.strictEqual(body.relay.expiresAt, '2026-08-23T00:15:00.000Z');

  const assetCalls = [];
  const assetClient = createDesktopQuestionImportClient({ cloudBusinessIdentityBaseUrl: 'https://cloud.example/cloud-business' }, {
    idFactory: () => '87654321', now: () => new Date('2026-08-23T00:00:00.000Z'),
    readSession: () => ({ authorization: 'Bearer desktop-token', authContext: { deviceId: 'desktop-device-1' } }),
    sealAsset: async input => {
      assert.strictEqual(input.storageTaskId, 'task_87654321');
      assert.deepStrictEqual(Buffer.from(input.bytes), Buffer.from('asset-payload'));
      return { sourceSha256: 'c'.repeat(64), sourceBytes: input.bytes.byteLength, envelope, ciphertextBase64: Buffer.from('sealed-asset').toString('base64url') };
    },
    fetchImpl: async (url, options = {}) => {
      assetCalls.push({ url, options });
      if (url.endsWith('/relay-key')) return { ok: true, status: 200, json: async () => ({ ok: true, agentPublicKey: 'A'.repeat(44), agentKeyFingerprint: 'b'.repeat(64) }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, relay: { taskId: 'task_87654321', assetId: 'asset_87654321', expiresAt: '2026-08-23T00:15:00.000Z' } }) };
    },
  });
  const relay = await assetClient.relayAsset({
    questionId: 'question-1', assetId: 'asset_87654321', assetType: 'image', fileName: 'diagram.png', mimeType: 'image/png',
    bytes: new Uint8Array(Buffer.from('asset-payload')),
    storage: { taskId: 'task_87654321', objectId: 'obj_87654321', objectVersion: 1 },
  });
  assert.deepStrictEqual(relay, { taskId: 'task_87654321', assetId: 'asset_87654321', expiresAt: '2026-08-23T00:15:00.000Z' });
  assert.strictEqual(assetCalls[0].options.headers.Authorization, 'Bearer desktop-token');
  assert.ok(!assetCalls[1].options.body.includes('asset-payload'), 'plaintext asset bytes must not be sent to cloud');
  assert.strictEqual(JSON.parse(assetCalls[1].options.body).questionId, 'question-1');
}

main().then(() => console.log('desktop question import client checks passed')).catch(error => { console.error(error); process.exitCode = 1; });
