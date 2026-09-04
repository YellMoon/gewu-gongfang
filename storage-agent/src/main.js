'use strict';

const packageJson = require('../package.json');
const { loadStorageAgentConfig } = require('./config');
const { createStorageCloudClient } = require('./cloudClient');
const { createObjectStore } = require('./objectStore');
const { createStorageWorker } = require('./worker');
const { createQuestionImportParser } = require('./questionImportParser');
const { createStorageAgentRuntime } = require('./runtime');
const { runStorageAgentHealthCheck } = require('./health');
const { createStorageAgentRuntimeManifest, createStorageAgentRuntimeReporter } = require('./runtimeManifest');

async function main() {
  const config = loadStorageAgentConfig(process.env);
  await runStorageAgentHealthCheck({ config, version: packageJson.version });
  const client = createStorageCloudClient({ cloudBaseUrl: config.cloudBaseUrl, agentId: config.agentId, token: config.token });
  const questionImportParser = createQuestionImportParser({
    nasRoot: config.nasRoot, parserPath: config.questionImportParserPath, pythonBin: config.questionImportPythonBin,
  });
  const runtimeManifest = createStorageAgentRuntimeManifest({
    version: packageJson.version,
    parserSha256: questionImportParser.revision,
  });
  const reportRuntime = createStorageAgentRuntimeReporter({ parser: questionImportParser, client, manifest: runtimeManifest });
  await reportRuntime();
  const worker = createStorageWorker({
    agentPrivateKey: config.agentPrivateKey,
    client,
    objectStore: createObjectStore({ nasRoot: config.nasRoot }),
    questionImportParser,
  });
  const runtime = createStorageAgentRuntime({
    worker,
    pollSeconds: config.pollSeconds,
    heartbeatSeconds: 300,
    heartbeat: reportRuntime,
  });
  let running = true;
  const stop = () => { running = false; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await runtime.runForever({
    shouldContinue: () => running,
    onResult: async result => {
      if (result?.state === 'verified') process.stdout.write(`storage-agent verified ${result.taskId}\n`);
      if (result?.state === 'retryable_error') process.stderr.write(`storage-agent retrying: ${result.code}\n`);
    },
  });
}

main().catch(error => {
  process.stderr.write(`storage-agent failed: ${String(error?.code || error?.message || 'UNKNOWN')}\n`);
  process.exitCode = 1;
});
