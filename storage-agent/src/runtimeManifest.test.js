'use strict';

const assert = require('assert');
const { createStorageAgentRuntimeManifest } = require('./runtimeManifest');

assert.deepStrictEqual(
  createStorageAgentRuntimeManifest({ version: '8.8.0' }),
  { agentVersion: '8.8.0', contracts: { questionPaperExport: 3, storageAgentTransport: 2 } },
);
assert.throws(() => createStorageAgentRuntimeManifest({ version: 'not-a-version' }), /STORAGE_AGENT_RUNTIME_MANIFEST_INVALID/);
assert.throws(() => createStorageAgentRuntimeManifest({ version: '8.8.0', contracts: {} }), /STORAGE_AGENT_RUNTIME_MANIFEST_INVALID/);

console.log('storage agent runtime manifest checks passed');
