'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createStorageAgentRuntimeManifest, createStorageAgentRuntimeReporter } = require('./runtimeManifest');

const parserSha256 = '9'.repeat(64);

assert.deepStrictEqual(
  createStorageAgentRuntimeManifest({ version: '8.8.1', parserSha256 }),
  {
    agentVersion: '8.8.1',
    contracts: { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 },
    parserSha256,
  },
);
assert.throws(() => createStorageAgentRuntimeManifest({ version: 'not-a-version' }), /STORAGE_AGENT_RUNTIME_MANIFEST_INVALID/);
assert.throws(() => createStorageAgentRuntimeManifest({ version: '8.8.1' }), /STORAGE_AGENT_RUNTIME_MANIFEST_INVALID/);
assert.throws(() => createStorageAgentRuntimeManifest({ version: '8.8.1', parserSha256: 'not-a-sha256' }), /STORAGE_AGENT_RUNTIME_MANIFEST_INVALID/);
assert.throws(() => createStorageAgentRuntimeManifest({
  version: '8.8.1', parserSha256, contracts: { questionPaperExport: 3, storageAgentTransport: 2 },
}), /STORAGE_AGENT_RUNTIME_MANIFEST_INVALID/);
let reportCalls = 0;
const report = createStorageAgentRuntimeReporter({
  parser: { assertRevision: () => parserSha256 },
  client: { reportRuntime: manifest => { reportCalls += 1; return manifest; } },
  manifest: createStorageAgentRuntimeManifest({ version: '8.8.1', parserSha256 }),
});
assert.strictEqual(report().parserSha256, parserSha256);
assert.strictEqual(reportCalls, 1);
const changedHelperReport = createStorageAgentRuntimeReporter({
  parser: { assertRevision: () => { throw Object.assign(new Error('changed'), { code: 'QUESTION_IMPORT_PARSE_REVISION_MISMATCH' }); } },
  client: { reportRuntime: () => { reportCalls += 1; } },
  manifest: createStorageAgentRuntimeManifest({ version: '8.8.1', parserSha256 }),
});
assert.throws(() => changedHelperReport(), /changed/);
assert.strictEqual(reportCalls, 1, 'a changed parser helper must prevent a fresh cloud runtime receipt');

const mainSource = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const parserCreationOffset = mainSource.indexOf('const questionImportParser = createQuestionImportParser(');
const runtimeReportOffset = mainSource.indexOf('await reportRuntime();');
assert.ok(parserCreationOffset >= 0 && parserCreationOffset < runtimeReportOffset, 'the parser revision must exist before the runtime receipt is reported');
assert.match(mainSource, /parserSha256:\s*questionImportParser\.revision/u);
assert.match(mainSource, /createStorageWorker\(\{[\s\S]*?questionImportParser,[\s\S]*?\}\)/u, 'the worker must use the same parser instance whose revision was reported');
assert.match(mainSource, /heartbeatSeconds:\s*300/u, 'runtime receipts must be refreshed every five minutes while the NAS process stays up');
assert.match(mainSource, /const reportRuntime = createStorageAgentRuntimeReporter\(\{[\s\S]*?questionImportParser[\s\S]*?runtimeManifest/u);
assert.match(mainSource, /heartbeat:\s*reportRuntime/u,
  'startup and heartbeat must use the revision-checking reporter for the same immutable runtime manifest');

console.log('storage agent runtime manifest checks passed');
