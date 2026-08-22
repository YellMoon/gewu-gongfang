'use strict';

const fs = require('fs');
const path = require('path');

function failure() {
  return Object.assign(new Error('QUESTION_IMPORT_RELEASE_INVALID'), { code: 'QUESTION_IMPORT_RELEASE_INVALID' });
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function receipt(value) {
  return object(value) && typeof value.receiptId === 'string' && value.receiptId.trim().length > 0;
}

function verifyImportRelease(evidence) {
  if (!object(evidence) || typeof evidence.expectedVersion !== 'string' || !evidence.expectedVersion.trim()) throw failure();
  const { cloudHealth, storageHealth, task } = evidence;
  if (!object(cloudHealth) || cloudHealth.ok !== true || cloudHealth.database !== 'postgresql'
    || cloudHealth.businessAuthority !== 'cloud' || cloudHealth.version !== evidence.expectedVersion) throw failure();
  if (!object(storageHealth) || typeof storageHealth.agentId !== 'string' || !storageHealth.agentId.trim()
    || storageHealth.version !== evidence.expectedVersion || storageHealth.writableAuthority !== false || storageHealth.rootProbe !== true) throw failure();
  if (!object(task) || typeof task.taskId !== 'string' || !task.taskId.trim()
    || task.status !== 'submitted' || task.phase !== 'submitted') throw failure();
  if (!receipt(evidence.sourceReceipt) || !Number.isSafeInteger(evidence.expectedMediaCount) || evidence.expectedMediaCount < 0
    || !Array.isArray(evidence.derivedMediaReceipts) || evidence.derivedMediaReceipts.length !== evidence.expectedMediaCount
    || evidence.derivedMediaReceipts.some(item => !receipt(item))
    || evidence.questionWritesBeforeConfirmation !== 0 || !receipt(evidence.confirmationReceipt)) throw failure();
  return evidence;
}

function main(args = process.argv.slice(2)) {
  if (!Array.isArray(args) || args.length !== 2 || args[0] !== '--evidence' || typeof args[1] !== 'string' || !path.isAbsolute(args[1])) throw failure();
  const evidencePath = path.resolve(args[1]);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  verifyImportRelease(evidence);
  console.log('question import release evidence passed');
}

module.exports = { verifyImportRelease, main };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.code || error.message);
    process.exitCode = 1;
  }
}
