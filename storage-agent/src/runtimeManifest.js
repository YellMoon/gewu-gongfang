'use strict';

function failure() {
  return Object.assign(new Error('STORAGE_AGENT_RUNTIME_MANIFEST_INVALID'), { code: 'STORAGE_AGENT_RUNTIME_MANIFEST_INVALID' });
}

function createStorageAgentRuntimeManifest({ version, contracts = { questionPaperExport: 3, storageAgentTransport: 2 } } = {}) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)
    || !contracts || typeof contracts !== 'object' || Array.isArray(contracts)
    || Reflect.ownKeys(contracts).length !== 2 || contracts.questionPaperExport !== 3 || contracts.storageAgentTransport !== 2) throw failure();
  return Object.freeze({
    agentVersion: version,
    contracts: Object.freeze({ questionPaperExport: 3, storageAgentTransport: 2 }),
  });
}

module.exports = Object.freeze({ createStorageAgentRuntimeManifest });
