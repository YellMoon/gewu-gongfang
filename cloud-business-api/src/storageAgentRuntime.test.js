'use strict';

const assert = require('assert');

const { createStorageAgentRuntimeFromEnvironment } = require('./storageAgentRuntime');

async function main() {
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
      return { rows: [] };
    },
    randomToken: () => 'lease-token-runtime-test-value',
    now: () => new Date('2026-08-22T00:00:00.000Z'),
  });
  assert.ok(runtime && typeof runtime.lease === 'function' && typeof runtime.download === 'function' && typeof runtime.complete === 'function');
  assert.strictEqual(
    await runtime.lease({ agentId: 'storage-agent-1', token: 'storage-agent-runtime-test-token-with-sufficient-length' }),
    null,
    'an enabled runtime with no task returns no task rather than a fabricated task'
  );
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[0].text.includes('deleted_expired'));
  assert.ok(calls.every(call => !call.values.includes('storage-agent-runtime-test-token-with-sufficient-length')), 'the environment token must not flow into SQL parameters');
}

main().then(() => console.log('storage agent runtime checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
