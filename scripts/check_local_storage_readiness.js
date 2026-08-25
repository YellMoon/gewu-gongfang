#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  inspectBackupTargets,
} = require('../backend/src/services/questionBankBackupTargetService');

function readRuntimeConfig() {
  const configPath = path.join(os.homedir(), 'AppData', 'Roaming', 'gewu-gongfang', 'gewugongfang.config.json');
  if (!fs.existsSync(configPath)) {
    return { configPath, config: null, error: 'runtime config file not found' };
  }
  const raw = fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, '');
  return { configPath, config: JSON.parse(raw), error: '' };
}

function buildReadinessReport({ configPath, config, error = '' }) {
  if (!config) return { ok: false, configPath, error: error || 'runtime config file not found' };
  const backupTargets = inspectBackupTargets({
    localCachePath: config.localCachePath,
    nasBackupPath: config.nasBackupPath,
  });
  return {
    ok: Boolean(backupTargets.localCache.available && backupTargets.nasBackup.available),
    configPath,
    nodeRole: config.nodeRole,
    deviceId: config.deviceId,
    retiredQuestionBankStore: {
      configuredRoot: config.questionBankPath,
      configuredStoreId: config.questionBankStoreId || '',
      required: false,
      reason: 'cloud question-bank structure is authoritative; NAS stores media and backup artifacts only',
    },
    backupTargets,
  };
}

function main() {
  const report = buildReadinessReport(readRuntimeConfig());

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = Object.freeze({ buildReadinessReport, readRuntimeConfig });
