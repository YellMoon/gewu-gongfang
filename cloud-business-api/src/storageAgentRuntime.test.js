'use strict';

const assert = require('assert');

const { createStorageAgentRuntimeFromEnvironment } = require('./storageAgentRuntime');

async function main() {
  const parserSha256 = '9'.repeat(64);
  assert.strictEqual(createStorageAgentRuntimeFromEnvironment({ env: {}, query: async () => ({ rows: [] }) }), null, 'the storage API must stay disabled without explicit agent configuration');
  const calls = [];
  const runtime = createStorageAgentRuntimeFromEnvironment({
    env: {
      CLOUD_STORAGE_AGENT_ID: 'storage-agent-1',
      CLOUD_STORAGE_AGENT_TOKEN: 'storage-agent-runtime-test-token-with-sufficient-length',
    },
    query: async (text, values) => {
      calls.push({ text, values });
      if (text.includes('deleted_expired')) return { rows: [{ count: 0 }] };
      if (text.includes('storage_agent_runtime_receipts')) return { rows: [{
        receiptId: 'storage_runtime_receipt_12345678', agentId: 'storage-agent-1', agentVersion: '8.8.1',
        contracts: { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 }, parserSha256,
        observedAt: new Date('2026-08-30T00:00:00.000Z'),
      }] };
      return { rows: [] };
    },
    randomToken: () => 'lease-token-runtime-test-value',
    now: () => new Date('2026-08-22T00:00:00.000Z'),
  });
  assert.ok(runtime && typeof runtime.lease === 'function' && typeof runtime.download === 'function' && typeof runtime.complete === 'function' && typeof runtime.reportRuntime === 'function');
  const runtimeReceipt = await runtime.reportRuntime({
    agentId: 'storage-agent-1', token: 'storage-agent-runtime-test-token-with-sufficient-length', agentVersion: '8.8.1',
    contracts: { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 }, parserSha256,
  });
  assert.strictEqual(runtimeReceipt.agentVersion, '8.8.1');
  assert.strictEqual(runtimeReceipt.parserSha256, parserSha256);
  assert.strictEqual(
    await runtime.lease({ agentId: 'storage-agent-1', token: 'storage-agent-runtime-test-token-with-sufficient-length' }),
    null,
    'an enabled runtime with no task returns no task rather than a fabricated task'
  );
  assert.strictEqual(calls.length, 3);
  assert.ok(calls.some(call => call.text.includes('deleted_expired')));
  assert.ok(calls.some(call => call.text.includes('storage_agent_runtime_receipts')));
  assert.ok(calls.every(call => !call.values.includes('storage-agent-runtime-test-token-with-sufficient-length')), 'the environment token must not flow into SQL parameters');
}

main().then(() => console.log('storage agent runtime checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
