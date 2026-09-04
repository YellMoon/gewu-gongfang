'use strict';

const assert = require('assert');
const { createStorageAgentRuntimeReceiptRepository } = require('./storageAgentRuntimeReceiptRepository');

(async () => {
  const parserSha256 = '9'.repeat(64);
  const calls = [];
  const repository = createStorageAgentRuntimeReceiptRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      const contracts = JSON.parse(values[3]);
      const legacy = contracts.storageAgentTransport === 2;
      return { rows: [{
        receiptId: 'storage_runtime_receipt_12345678', agentId: 'storage-agent-1', agentVersion: '8.8.1',
        contracts, parserSha256: legacy ? null : parserSha256,
        observedAt: new Date('2026-08-30T00:00:00.000Z'),
      }] };
    },
    randomId: () => '12345678',
  });
  const receipt = await repository.record({
    agentId: 'storage-agent-1', agentVersion: '8.8.1',
    contracts: { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 }, parserSha256,
  });
  assert.deepStrictEqual(receipt, {
    receiptId: 'storage_runtime_receipt_12345678', agentId: 'storage-agent-1', agentVersion: '8.8.1',
    contracts: { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 }, parserSha256,
    observedAt: '2026-08-30T00:00:00.000Z',
  });
  assert.match(calls[0].text, /INSERT INTO business\.storage_agent_runtime_receipts/);
  assert.match(calls[0].text, /parser_sha256/);
  assert.strictEqual(calls[0].values[4], parserSha256);
  assert.ok(!calls[0].values.some(value => typeof value === 'string' && value.includes('token')));
  assert.deepStrictEqual(await repository.record({
    agentId: 'storage-agent-1', agentVersion: '8.8.1',
    contracts: { questionPaperExport: 3, storageAgentTransport: 2 },
  }), {
    receiptId: 'storage_runtime_receipt_12345678', agentId: 'storage-agent-1', agentVersion: '8.8.1',
    contracts: { questionPaperExport: 3, storageAgentTransport: 2 }, observedAt: '2026-08-30T00:00:00.000Z',
  }, 'the cloud keeps accepting an old v2 runtime receipt so the previous NAS image can restart during rollback');
  assert.strictEqual(calls[1].values[4], null, 'v2 rollback receipts must persist no parser proof');
  assert.deepStrictEqual(await repository.record({
    agentId: 'storage-agent-1', agentVersion: '8.8.1',
    contracts: { questionPaperExport: 3, storageAgentTransport: 2 }, parserSha256: null,
  }), {
    receiptId: 'storage_runtime_receipt_12345678', agentId: 'storage-agent-1', agentVersion: '8.8.1',
    contracts: { questionPaperExport: 3, storageAgentTransport: 2 }, observedAt: '2026-08-30T00:00:00.000Z',
  }, 'an explicit null parser proof remains compatible with the v2 rollback payload');
  await assert.rejects(() => repository.record({
    agentId: 'storage-agent-1', agentVersion: '8.8',
    contracts: { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 }, parserSha256,
  }), /STORAGE_AGENT_RUNTIME_RECEIPT_INVALID/);
  await assert.rejects(() => repository.record({
    agentId: 'storage-agent-1', agentVersion: '8.8.1',
    contracts: { questionPaperExport: 3, storageAgentTransport: 2 }, parserSha256,
  }), /STORAGE_AGENT_RUNTIME_RECEIPT_INVALID/);
  await assert.rejects(() => repository.record({
    agentId: 'storage-agent-1', agentVersion: '8.8.1',
    contracts: { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 },
  }), /STORAGE_AGENT_RUNTIME_RECEIPT_INVALID/);
  await assert.rejects(() => repository.record({
    agentId: 'storage-agent-1', agentVersion: '8.8.1',
    contracts: { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 }, parserSha256: 'A'.repeat(64),
  }), /STORAGE_AGENT_RUNTIME_RECEIPT_INVALID/);
  console.log('storage agent runtime receipt repository checks passed');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
