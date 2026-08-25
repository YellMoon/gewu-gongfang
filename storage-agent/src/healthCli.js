'use strict';

const path = require('path');
const packageJson = require('../package.json');
const { loadEnvironmentFile } = require('./launchConfig');
const { loadStorageAgentConfig } = require('./config');
const { runStorageAgentHealthCheck } = require('./health');

async function main() {
  const configPath = path.resolve(process.argv[2] || '/nas-storage/agent.env');
  Object.assign(process.env, loadEnvironmentFile(configPath));
  const config = loadStorageAgentConfig(process.env);
  const report = await runStorageAgentHealthCheck({ config, version: packageJson.version });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main().catch(error => {
  process.stderr.write(`${String(error?.code || error?.message || 'STORAGE_AGENT_HEALTH_FAILED')}\n`);
  process.exitCode = 1;
});
