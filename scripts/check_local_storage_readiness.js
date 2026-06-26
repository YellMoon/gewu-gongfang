#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  findQuestionBankStore,
  inspectQuestionBankStore,
} = require('../backend/src/services/questionBankStorageService');
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

function main() {
  const { configPath, config, error } = readRuntimeConfig();
  if (!config) {
    console.log(JSON.stringify({ ok: false, configPath, error }, null, 2));
    process.exitCode = 1;
    return;
  }

  const QUESTION_BANK_STORE_ID = config.questionBankStoreId || process.env.QUESTION_BANK_STORE_ID || '';
  const candidates = [
    config.questionBankPath,
    ...(Array.isArray(config.questionBankCandidatePaths) ? config.questionBankCandidatePaths : []),
  ].filter(Boolean);
  const foundStore = findQuestionBankStore(candidates, { storeId: QUESTION_BANK_STORE_ID });
  const questionBank = foundStore.available
    ? inspectQuestionBankStore(foundStore.root)
    : { available: false, root: config.questionBankPath || '', reason: foundStore.reason };

  const backupTargets = inspectBackupTargets({
    localCachePath: config.localCachePath,
    nasBackupPath: config.nasBackupPath,
  });

  const ok = Boolean(questionBank.available && backupTargets.localCache.available && backupTargets.nasBackup.available);
  const report = {
    ok,
    configPath,
    nodeRole: config.nodeRole,
    deviceId: config.deviceId,
    QUESTION_BANK_STORE_ID,
    questionBank: {
      configuredRoot: config.questionBankPath,
      effectiveRoot: foundStore.root || config.questionBankPath || '',
      available: Boolean(questionBank.available),
      storeId: questionBank.manifest?.storeId || '',
      missingDirs: questionBank.missingDirs || [],
      reason: questionBank.reason || foundStore.reason || '',
    },
    backupTargets,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
}

main();
