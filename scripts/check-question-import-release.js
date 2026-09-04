'use strict';

const fs = require('fs');
const path = require('path');

const COMPATIBILITY_PATH = path.resolve(__dirname, '..', 'config', 'release-compatibility.json');

function failure() {
  return Object.assign(new Error('QUESTION_IMPORT_RELEASE_INVALID'), { code: 'QUESTION_IMPORT_RELEASE_INVALID' });
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function receipt(value) {
  return object(value) && typeof value.receiptId === 'string' && value.receiptId.trim().length > 0;
}

function verifiedStorageReceipt(value) {
  return receipt(value)
    && typeof value.taskId === 'string' && value.taskId.trim().length > 0
    && value.state === 'verified'
    && typeof value.verifiedAt === 'string'
    && Number.isFinite(new Date(value.verifiedAt).getTime())
    && new Date(value.verifiedAt).toISOString() === value.verifiedAt;
}

function version(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/u.test(value);
}

function sha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function isoTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function normalizedContracts(value) {
  if (!object(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([name, current]) => !name || !/^\d+$/u.test(String(current)))) return null;
  return Object.fromEntries(entries.map(([name, current]) => [name, String(current)]).sort(([left], [right]) => left.localeCompare(right)));
}

function readCompatibility() {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(COMPATIBILITY_PATH, 'utf8'));
  } catch (_) {
    throw failure();
  }
  const parserProof = value?.contracts?.questionImportParserProof;
  const transport = value?.contracts?.storageAgentTransport;
  const policy = value?.runtimeReceipts?.storage_proxy;
  if (value?.schema !== 'gewu.protocol-data-compatibility.v1' || transport?.version !== '3'
    || parserProof?.version !== '1' || !Array.isArray(policy?.approvedRuntimeVersions)
    || !policy.approvedRuntimeVersions.every(version) || normalizedContracts(policy.contracts) === null) throw failure();
  return value;
}

function verifyImportRelease(evidence) {
  const compatibility = readCompatibility();
  if (!object(evidence) || !version(evidence.expectedCloudVersion) || !version(evidence.expectedStorageRuntimeVersion)) throw failure();
  const { cloudHealth, storageHealth, storageRuntimeReceipt, parserProof, task } = evidence;
  const runtimePolicy = compatibility.runtimeReceipts.storage_proxy;
  const expectedContracts = normalizedContracts(runtimePolicy.contracts);
  if (!object(cloudHealth) || cloudHealth.ok !== true || cloudHealth.database !== 'postgresql'
    || cloudHealth.businessAuthority !== 'cloud' || cloudHealth.version !== evidence.expectedCloudVersion) throw failure();
  if (!object(storageHealth) || typeof storageHealth.agentId !== 'string' || !storageHealth.agentId.trim()
    || storageHealth.version !== evidence.expectedStorageRuntimeVersion || storageHealth.writableAuthority !== false || storageHealth.rootProbe !== true
    || !runtimePolicy.approvedRuntimeVersions.includes(evidence.expectedStorageRuntimeVersion)) throw failure();
  if (!receipt(storageRuntimeReceipt) || storageRuntimeReceipt.agentId !== storageHealth.agentId
    || storageRuntimeReceipt.agentVersion !== evidence.expectedStorageRuntimeVersion || !isoTimestamp(storageRuntimeReceipt.observedAt)
    || !sha256(storageRuntimeReceipt.parserSha256)
    || JSON.stringify(normalizedContracts(storageRuntimeReceipt.contracts)) !== JSON.stringify(expectedContracts)) throw failure();
  if (!object(parserProof) || parserProof.version !== compatibility.contracts.questionImportParserProof.version
    || !sha256(parserProof.expectedSha256) || !sha256(parserProof.observedSha256)
    || parserProof.expectedSha256 !== parserProof.observedSha256
    || storageRuntimeReceipt.parserSha256 !== parserProof.expectedSha256) throw failure();
  if (!object(task) || typeof task.taskId !== 'string' || !task.taskId.trim()
    || task.status !== 'submitted' || task.phase !== 'submitted' || task.parserSha256 !== parserProof.expectedSha256) throw failure();
  if (!verifiedStorageReceipt(evidence.sourceReceipt) || !Number.isSafeInteger(evidence.expectedMediaCount) || evidence.expectedMediaCount < 0
    || !Array.isArray(evidence.derivedMediaReceipts) || evidence.derivedMediaReceipts.length !== evidence.expectedMediaCount
    || evidence.derivedMediaReceipts.some(item => !verifiedStorageReceipt(item))
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
