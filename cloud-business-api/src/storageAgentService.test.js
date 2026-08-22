'use strict';

const assert = require('assert');

const { createStorageAgentService } = require('./storageAgentService');

async function main() {
  const calls = [];
  const service = createStorageAgentService({
    agentId: 'storage-agent-1',
    token: 'storage-agent-test-token-with-sufficient-length',
    repository: {
      leaseNext: async input => { calls.push(['lease', input]); return { taskId: 'task_12345678' }; },
      downloadRelay: async input => { calls.push(['download', input]); return { envelope: { version: 'x25519-aes-256-gcm-v1' }, ciphertext: Buffer.from('relay') }; },
      complete: async input => { calls.push(['complete', input]); return { taskId: input.taskId, state: 'verified' }; },
    },
  });
  assert.deepStrictEqual(
    await service.download({ agentId: 'storage-agent-1', token: 'storage-agent-test-token-with-sufficient-length', taskId: 'task_12345678', leaseToken: 'lease-token-test-value' }),
    { envelope: { version: 'x25519-aes-256-gcm-v1' }, ciphertext: Buffer.from('relay') },
  );
  assert.deepStrictEqual(
    await service.lease({ agentId: 'storage-agent-1', token: 'storage-agent-test-token-with-sufficient-length' }),
    { taskId: 'task_12345678' },
  );
  assert.deepStrictEqual(
    await service.authorize({ agentId: 'storage-agent-1', token: 'storage-agent-test-token-with-sufficient-length' }),
    { agentId: 'storage-agent-1' },
    'candidate reporting must reuse the storage agent token without leasing or writing a task',
  );
  assert.deepStrictEqual(
    await service.complete({ agentId: 'storage-agent-1', token: 'storage-agent-test-token-with-sufficient-length', taskId: 'task_12345678', leaseToken: 'lease-token-test-value', observedSha256: 'a'.repeat(64), observedBytes: 3 }),
    { taskId: 'task_12345678', state: 'verified' },
  );
  assert.deepStrictEqual(calls, [
    ['download', { agentId: 'storage-agent-1', taskId: 'task_12345678', leaseToken: 'lease-token-test-value' }],
    ['lease', { agentId: 'storage-agent-1' }],
    ['complete', { agentId: 'storage-agent-1', taskId: 'task_12345678', leaseToken: 'lease-token-test-value', observedSha256: 'a'.repeat(64), observedBytes: 3 }],
  ]);
  await assert.rejects(
    () => service.authorize({ agentId: 'other-agent', token: 'storage-agent-test-token-with-sufficient-length' }),
    /STORAGE_AGENT_REJECTED/,
    'the reporting authorization cannot be replayed by another agent identifier',
  );
  await assert.rejects(
    () => service.lease({ agentId: 'storage-agent-1', token: 'wrong-token' }),
    /STORAGE_AGENT_REJECTED/,
    'an invalid storage-agent token must be rejected before leasing'
  );
  await assert.rejects(
    () => service.complete({ agentId: 'other-agent', token: 'storage-agent-test-token-with-sufficient-length', taskId: 'task_12345678', leaseToken: 'lease-token-test-value', observedSha256: 'a'.repeat(64), observedBytes: 3 }),
    /STORAGE_AGENT_REJECTED/,
    'a valid token cannot be replayed under another agent identifier'
  );
}

main().then(() => console.log('storage agent service checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
