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
        return { ok: true, status: 200, json: async () => ({ ok: true, task: { taskId: 'task_12345678', objectId: 'obj_1', objectVersion: 1, expectedSha256: 'a'.repeat(64), expectedBytes: 3, mediaType: 'image/png', leaseToken: 'lease-token-test-value', leaseExpiresAt: '2026-08-22T00:05:00.000Z' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, receipt: { taskId: 'task_12345678', state: 'verified', verifiedAt: '2026-08-22T00:00:00.000Z' } }) };
    },
  });
  const task = await client.lease();
  assert.strictEqual(task.taskId, 'task_12345678');
  const receipt = await client.complete({ taskId: task.taskId, leaseToken: task.leaseToken, observedSha256: task.expectedSha256, observedBytes: task.expectedBytes });
  assert.deepStrictEqual(receipt, { taskId: 'task_12345678', state: 'verified', verifiedAt: '2026-08-22T00:00:00.000Z' });
  assert.strictEqual(calls[0].url, 'https://cloud.example.invalid/cloud-business/api/storage-agent/lease');
  assert.strictEqual(calls[0].options.headers['x-gewu-storage-agent-token'], 'storage-agent-client-test-token-with-sufficient-length');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { agentId: 'storage-agent-1' });
  assert.ok(!calls[0].options.body.includes('storage-agent-client-test-token-with-sufficient-length'));
  assert.strictEqual(calls[1].url, 'https://cloud.example.invalid/cloud-business/api/storage-agent/tasks/task_12345678/complete');
  assert.deepStrictEqual(JSON.parse(calls[1].options.body), { agentId: 'storage-agent-1', leaseToken: 'lease-token-test-value', observedSha256: 'a'.repeat(64), observedBytes: 3 });
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
