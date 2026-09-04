'use strict';

function failure() {
  return Object.assign(new Error('STORAGE_AGENT_RUNTIME_MANIFEST_INVALID'), { code: 'STORAGE_AGENT_RUNTIME_MANIFEST_INVALID' });
}

function createStorageAgentRuntimeManifest({
  version,
  parserSha256,
  contracts = { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 },
} = {}) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)
    || typeof parserSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(parserSha256)
    || !contracts || typeof contracts !== 'object' || Array.isArray(contracts)
    || Reflect.ownKeys(contracts).length !== 3 || contracts.questionPaperExport !== 3
    || contracts.storageAgentTransport !== 3 || contracts.questionImportParserProof !== 1) throw failure();
  return Object.freeze({
    agentVersion: version,
    contracts: Object.freeze({ questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 }),
    parserSha256,
  });
}

function createStorageAgentRuntimeReporter({ parser, client, manifest } = {}) {
  if (!parser || typeof parser.assertRevision !== 'function' || !client || typeof client.reportRuntime !== 'function'
    || !manifest || typeof manifest !== 'object' || typeof manifest.parserSha256 !== 'string') throw failure();
  return () => {
    const currentRevision = parser.assertRevision();
    if (currentRevision !== manifest.parserSha256) throw failure();
    return client.reportRuntime(manifest);
  };
}

module.exports = Object.freeze({ createStorageAgentRuntimeManifest, createStorageAgentRuntimeReporter });
