'use strict';

const assert = require('assert');
const { createStorageAgentRuntimeReceiptRepository } = require('./storageAgentRuntimeReceiptRepository');

(async () => {
  const calls = [];
  const repository = createStorageAgentRuntimeReceiptRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [{ receiptId: 'storage_runtime_receipt_12345678', agentId: 'storage-agent-1', agentVersion: '8.8.0', contracts: { questionPaperExport: 3, storageAgentTransport: 2 }, observedAt: new Date('2026-08-30T00:00:00.000Z') }] };
    },
    randomId: () => '12345678',
  });
  const receipt = await repository.record({ agentId: 'storage-agent-1', agentVersion: '8.8.0', contracts: { questionPaperExport: 3, storageAgentTransport: 2 } });
  assert.deepStrictEqual(receipt, { receiptId: 'storage_runtime_receipt_12345678', agentId: 'storage-agent-1', agentVersion: '8.8.0', contracts: { questionPaperExport: 3, storageAgentTransport: 2 }, observedAt: '2026-08-30T00:00:00.000Z' });
  assert.match(calls[0].text, /INSERT INTO business\.storage_agent_runtime_receipts/);
  assert.ok(!calls[0].values.some(value => typeof value === 'string' && value.includes('token')));
  await assert.rejects(() => repository.record({ agentId: 'storage-agent-1', agentVersion: '8.8', contracts: { questionPaperExport: 3, storageAgentTransport: 2 } }), /STORAGE_AGENT_RUNTIME_RECEIPT_INVALID/);
  await assert.rejects(() => repository.record({ agentId: 'storage-agent-1', agentVersion: '8.8.0', contracts: { questionPaperExport: 3, storageAgentTransport: 2, unexpected: 1 } }), /STORAGE_AGENT_RUNTIME_RECEIPT_INVALID/);
  console.log('storage agent runtime receipt repository checks passed');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
