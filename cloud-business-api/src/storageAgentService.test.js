'use strict';

const assert = require('assert');

const { createStorageAgentService } = require('./storageAgentService');

async function main() {
  const parserSha256 = '9'.repeat(64);
  const calls = [];
  const service = createStorageAgentService({
    agentId: 'storage-agent-1',
    token: 'storage-agent-test-token-with-sufficient-length',
    repository: {
      leaseNext: async input => { calls.push(['lease', input]); return { taskId: 'task_12345678' }; },
      downloadRelay: async input => { calls.push(['download', input]); return { envelope: { version: 'x25519-aes-256-gcm-v1' }, ciphertext: Buffer.from('relay') }; },
      complete: async input => { calls.push(['complete', input]); return { taskId: input.taskId, state: 'verified' }; },
    },
    runtimeReceipts: {
      record: async input => { calls.push(['runtime', input]); return { receiptId: 'storage_runtime_receipt_12345678', ...input }; },
    },
    artifactDeliveries: {
      lease: async input => { calls.push(['lease-delivery', input]); return { deliveryId: 'delivery_12345678' }; },
      upload: async input => { calls.push(['upload-delivery', input]); return { deliveryId: input.deliveryId, status: 'ready' }; },
    },
    questionAssetDeliveries: {
      lease: async input => { calls.push(['lease-question-asset-delivery', input]); return { deliveryId: 'question_asset_delivery_12345678' }; },
      upload: async input => { calls.push(['upload-question-asset-delivery', input]); return { deliveryId: input.deliveryId, status: 'ready' }; },
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
    await service.reportRuntime({
      agentId: 'storage-agent-1', token: 'storage-agent-test-token-with-sufficient-length', agentVersion: '8.8.1',
      contracts: { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 }, parserSha256,
    }),
    {
      receiptId: 'storage_runtime_receipt_12345678', agentId: 'storage-agent-1', agentVersion: '8.8.1',
      contracts: { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 }, parserSha256,
    },
  );
  assert.deepStrictEqual(
    await service.reportRuntime({
      agentId: 'storage-agent-1', token: 'storage-agent-test-token-with-sufficient-length', agentVersion: '8.8.0',
      contracts: { questionPaperExport: 3, storageAgentTransport: 2 },
    }),
    {
      receiptId: 'storage_runtime_receipt_12345678', agentId: 'storage-agent-1', agentVersion: '8.8.0',
      contracts: { questionPaperExport: 3, storageAgentTransport: 2 },
    },
    'the authenticated v2 rollback payload remains accepted without parserSha256',
  );
  assert.deepStrictEqual(
    await service.complete({ agentId: 'storage-agent-1', token: 'storage-agent-test-token-with-sufficient-length', taskId: 'task_12345678', leaseToken: 'lease-token-test-value', observedSha256: 'a'.repeat(64), observedBytes: 3 }),
    { taskId: 'task_12345678', state: 'verified' },
  );
  assert.deepStrictEqual(
    await service.leaseArtifactDelivery({ agentId: 'storage-agent-1', token: 'storage-agent-test-token-with-sufficient-length' }),
    { deliveryId: 'delivery_12345678' },
  );
  assert.deepStrictEqual(
    await service.uploadArtifactDelivery({ agentId: 'storage-agent-1', token: 'storage-agent-test-token-with-sufficient-length', deliveryId: 'delivery_12345678', leaseToken: 'lease-token-test-value', bytes: Buffer.from('artifact-bytes') }),
    { deliveryId: 'delivery_12345678', status: 'ready' },
  );
  assert.deepStrictEqual(
    await service.leaseQuestionAssetDelivery({ agentId: 'storage-agent-1', token: 'storage-agent-test-token-with-sufficient-length' }),
    { deliveryId: 'question_asset_delivery_12345678' },
  );
  assert.deepStrictEqual(
    await service.uploadQuestionAssetDelivery({ agentId: 'storage-agent-1', token: 'storage-agent-test-token-with-sufficient-length', deliveryId: 'question_asset_delivery_12345678', leaseToken: 'lease-token-test-value', bytes: Buffer.from('image-bytes') }),
    { deliveryId: 'question_asset_delivery_12345678', status: 'ready' },
  );
  assert.deepStrictEqual(calls, [
    ['download', { agentId: 'storage-agent-1', taskId: 'task_12345678', leaseToken: 'lease-token-test-value' }],
    ['lease', { agentId: 'storage-agent-1' }],
    ['runtime', {
      agentId: 'storage-agent-1', agentVersion: '8.8.1',
      contracts: { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 }, parserSha256,
    }],
    ['runtime', {
      agentId: 'storage-agent-1', agentVersion: '8.8.0', contracts: { questionPaperExport: 3, storageAgentTransport: 2 },
    }],
    ['complete', { agentId: 'storage-agent-1', taskId: 'task_12345678', leaseToken: 'lease-token-test-value', observedSha256: 'a'.repeat(64), observedBytes: 3 }],
    ['lease-delivery', { agentId: 'storage-agent-1' }],
    ['upload-delivery', { agentId: 'storage-agent-1', deliveryId: 'delivery_12345678', leaseToken: 'lease-token-test-value', bytes: Buffer.from('artifact-bytes') }],
    ['lease-question-asset-delivery', { agentId: 'storage-agent-1' }],
    ['upload-question-asset-delivery', { agentId: 'storage-agent-1', deliveryId: 'question_asset_delivery_12345678', leaseToken: 'lease-token-test-value', bytes: Buffer.from('image-bytes') }],
  ]);
  await assert.rejects(
    () => service.reportRuntime({
      agentId: 'storage-agent-1', token: 'wrong-token', agentVersion: '8.8.1',
      contracts: { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 }, parserSha256,
    }),
    /STORAGE_AGENT_REJECTED/,
    'a runtime receipt requires the same authenticated agent identity'
  );
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
