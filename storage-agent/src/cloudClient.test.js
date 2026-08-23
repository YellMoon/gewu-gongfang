'use strict';

const assert = require('assert');

const { createStorageCloudClient } = require('./cloudClient');

async function main() {
  const calls = [];
  const client = createStorageCloudClient({
    cloudBaseUrl: 'https://cloud.example.invalid/cloud-business',
    agentId: 'storage-agent-1',
    token: 'storage-agent-client-test-token-with-sufficient-length',
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/storage-agent/lease')) {
        if (calls.filter(call => call.url.endsWith('/api/storage-agent/lease')).length > 1) {
          return { ok: true, status: 200, json: async () => ({ ok: true, task: { taskId: 'invalid' } }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, task: { taskId: 'task_12345678', objectId: 'obj_1', objectVersion: 1, expectedSha256: 'a'.repeat(64), expectedBytes: 3, mediaType: 'image/png', kind: 'relay', leaseToken: 'lease-token-test-value', leaseExpiresAt: '2026-08-22T00:05:00.000Z' } }) };
      }
      if (url.endsWith('/api/storage-agent/tasks/task_12345678/download')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, relay: {
          envelope: { version: 'x25519-aes-256-gcm-v1' }, ciphertextBase64: Buffer.from('relay-ciphertext').toString('base64url'),
        } }) };
      }
      if (url.endsWith('/api/storage-agent/question-imports/question_import_task_1/candidates')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, task: {
          taskId: 'question_import_task_1', status: 'candidates_ready', phase: 'candidates_ready', requestHash: 'b'.repeat(64),
          createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:01:00.000Z', mediaTargets: [],
        } }) };
      }
      if (url.endsWith('/api/storage-agent/artifact-deliveries/lease')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, delivery: {
          deliveryId: 'delivery_12345678', status: 'leased', artifactId: 'paper_artifact_12345678', objectId: 'obj_paper_12345678', objectVersion: 1,
          expectedSha256: 'a'.repeat(64), expectedBytes: 3, fileName: 'paper.pdf', mimeType: 'application/pdf', expiresAt: '2026-08-22T00:15:00.000Z', leaseToken: 'lease-token-test-value', leaseExpiresAt: '2026-08-22T00:05:00.000Z',
        } }) };
      }
      if (url.endsWith('/api/storage-agent/artifact-deliveries/delivery_12345678/upload')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, delivery: { deliveryId: 'delivery_12345678', status: 'ready' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, receipt: { taskId: 'task_12345678', state: 'verified', verifiedAt: '2026-08-22T00:00:00.000Z' } }) };
    },
  });
  const task = await client.lease();
  assert.strictEqual(task.taskId, 'task_12345678');
  const relay = await client.download(task);
  assert.deepStrictEqual(relay, {
    envelope: { version: 'x25519-aes-256-gcm-v1' }, ciphertext: Buffer.from('relay-ciphertext'),
  });
  const receipt = await client.complete({ taskId: task.taskId, leaseToken: task.leaseToken, observedSha256: task.expectedSha256, observedBytes: task.expectedBytes });
  assert.deepStrictEqual(receipt, { taskId: 'task_12345678', state: 'verified', verifiedAt: '2026-08-22T00:00:00.000Z' });
  const importTask = await client.reportSourceCandidates({
    taskId: 'question_import_task_1', leaseToken: task.leaseToken, observedSha256: task.expectedSha256, observedBytes: task.expectedBytes,
    candidates: [{ contentHash: 'b'.repeat(64), candidate: { stem: 'Question' }, validation: { status: 'accepted' }, mediaManifest: [] }],
  });
  assert.strictEqual(importTask.status, 'candidates_ready');
  const delivery = await client.leaseArtifactDelivery();
  assert.strictEqual(delivery.deliveryId, 'delivery_12345678');
  assert.deepStrictEqual(await client.uploadArtifactDelivery({ deliveryId: delivery.deliveryId, leaseToken: delivery.leaseToken, bytes: Buffer.from('pdf') }), { deliveryId: 'delivery_12345678', status: 'ready' });
  assert.strictEqual(calls[0].url, 'https://cloud.example.invalid/cloud-business/api/storage-agent/lease');
  assert.strictEqual(calls[0].options.headers['x-gewu-storage-agent-token'], 'storage-agent-client-test-token-with-sufficient-length');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { agentId: 'storage-agent-1' });
  assert.ok(!calls[0].options.body.includes('storage-agent-client-test-token-with-sufficient-length'));
  assert.strictEqual(calls[1].url, 'https://cloud.example.invalid/cloud-business/api/storage-agent/tasks/task_12345678/download');
  assert.deepStrictEqual(JSON.parse(calls[1].options.body), { agentId: 'storage-agent-1', leaseToken: 'lease-token-test-value' });
  assert.strictEqual(calls[2].url, 'https://cloud.example.invalid/cloud-business/api/storage-agent/tasks/task_12345678/complete');
  assert.deepStrictEqual(JSON.parse(calls[2].options.body), { agentId: 'storage-agent-1', leaseToken: 'lease-token-test-value', observedSha256: 'a'.repeat(64), observedBytes: 3 });
  assert.strictEqual(calls[3].url, 'https://cloud.example.invalid/cloud-business/api/storage-agent/question-imports/question_import_task_1/candidates');
  assert.deepStrictEqual(JSON.parse(calls[3].options.body), {
    agentId: 'storage-agent-1', leaseToken: 'lease-token-test-value', observedSha256: 'a'.repeat(64), observedBytes: 3,
    candidates: [{ contentHash: 'b'.repeat(64), candidate: { stem: 'Question' }, validation: { status: 'accepted' }, mediaManifest: [] }],
  });
  assert.strictEqual(calls[4].url, 'https://cloud.example.invalid/cloud-business/api/storage-agent/artifact-deliveries/lease');
  assert.deepStrictEqual(JSON.parse(calls[4].options.body), { agentId: 'storage-agent-1' });
  assert.strictEqual(calls[5].url, 'https://cloud.example.invalid/cloud-business/api/storage-agent/artifact-deliveries/delivery_12345678/upload');
  assert.strictEqual(calls[5].options.headers['content-type'], 'application/octet-stream');
  assert.strictEqual(calls[5].options.headers['x-gewu-storage-agent-id'], 'storage-agent-1');
  assert.strictEqual(calls[5].options.headers['x-gewu-storage-agent-lease-token'], 'lease-token-test-value');
  assert.deepStrictEqual(calls[5].options.body, Buffer.from('pdf'));
  await assert.rejects(
    () => client.lease(),
    /STORAGE_CLOUD_RESPONSE_INVALID/,
    'malformed or unexpected cloud data must not become a local storage task'
  );
}

main().then(() => console.log('storage cloud client checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
