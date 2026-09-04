'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifyImportRelease, main } = require('./check-question-import-release');

const parserSha256 = 'f'.repeat(64);

const compatibility = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'release-compatibility.json'), 'utf8'));
assert.strictEqual(compatibility.contracts.storageAgentTransport.version, '3');
assert.deepStrictEqual(compatibility.contracts.questionImportParserProof, {
  version: '1',
  participants: ['cloud_business', 'storage_proxy'],
  rule: 'storage_proxy reports the exact parser SHA-256 and cloud_business matches it to the import task before accepting candidates',
});
assert.deepStrictEqual(compatibility.runtimeReceipts.storage_proxy, {
  approvedRuntimeVersions: ['8.8.2'],
  contracts: { questionPaperExport: '3', storageAgentTransport: '3', questionImportParserProof: '1' },
});

const evidence = {
  expectedCloudVersion: '8.9.2',
  expectedStorageRuntimeVersion: '8.8.2',
  cloudHealth: { ok: true, database: 'postgresql', businessAuthority: 'cloud', version: '8.9.2' },
  storageHealth: { agentId: 'nas-agent-1', version: '8.8.2', writableAuthority: false, rootProbe: true },
  storageRuntimeReceipt: {
    receiptId: 'storage_runtime_receipt_abcdefgh', agentId: 'nas-agent-1', agentVersion: '8.8.2',
    contracts: { questionPaperExport: '3', storageAgentTransport: '3', questionImportParserProof: '1' },
    parserSha256,
    observedAt: '2026-09-04T00:00:00.000Z',
  },
  parserProof: { version: '1', expectedSha256: parserSha256, observedSha256: parserSha256 },
  task: { taskId: 'question_import_task_abcdefgh', status: 'submitted', phase: 'submitted', parserSha256 },
  sourceReceipt: { receiptId: 'storage_receipt_source_abcdefgh', taskId: 'task_source_abcdefgh', state: 'verified', verifiedAt: '2026-08-23T00:01:00.000Z' },
  expectedMediaCount: 1,
  derivedMediaReceipts: [{ receiptId: 'storage_receipt_media_abcdefgh', taskId: 'task_media_abcdefgh', state: 'verified', verifiedAt: '2026-08-23T00:02:00.000Z' }],
  questionWritesBeforeConfirmation: 0,
  confirmationReceipt: { receiptId: 'question_command_receipt_abcdefgh' },
};

assert.deepStrictEqual(verifyImportRelease(evidence), evidence);
assert.throws(
  () => verifyImportRelease({ ...evidence, task: { ...evidence.task, status: 'candidates_ready', phase: 'candidates_ready' } }),
  /QUESTION_IMPORT_RELEASE_INVALID/,
  'candidate parsing alone must never be release evidence',
);
assert.throws(
  () => verifyImportRelease({ ...evidence, questionWritesBeforeConfirmation: 1 }),
  /QUESTION_IMPORT_RELEASE_INVALID/,
  'the release gate must reject a premature cloud question write',
);
assert.throws(
  () => verifyImportRelease({ ...evidence, derivedMediaReceipts: [] }),
  /QUESTION_IMPORT_RELEASE_INVALID/,
  'every declared derived media object requires its NAS receipt',
);
assert.throws(
  () => verifyImportRelease({ ...evidence, derivedMediaReceipts: [{ ...evidence.derivedMediaReceipts[0], state: 'queued' }] }),
  /QUESTION_IMPORT_RELEASE_INVALID/,
  'a cloud relay enqueue is not release evidence until NAS has returned a verified storage receipt',
);
assert.throws(
  () => verifyImportRelease({ ...evidence, storageHealth: { ...evidence.storageHealth, writableAuthority: true } }),
  /QUESTION_IMPORT_RELEASE_INVALID/,
  'NAS must remain a storage proxy rather than a business authority',
);
assert.throws(
  () => verifyImportRelease({ ...evidence, expectedStorageRuntimeVersion: '8.8.0', storageHealth: { ...evidence.storageHealth, version: '8.8.0' }, storageRuntimeReceipt: { ...evidence.storageRuntimeReceipt, agentVersion: '8.8.0' } }),
  /QUESTION_IMPORT_RELEASE_INVALID/,
  'an unapproved storage runtime must not satisfy the real import gate',
);
assert.throws(
  () => verifyImportRelease({ ...evidence, storageRuntimeReceipt: { ...evidence.storageRuntimeReceipt, contracts: { questionPaperExport: '3', storageAgentTransport: '2' } } }),
  /QUESTION_IMPORT_RELEASE_INVALID/,
  'a runtime receipt without transport v3 and parser-proof v1 must be rejected',
);
assert.throws(
  () => verifyImportRelease({ ...evidence, parserProof: { ...evidence.parserProof, observedSha256: 'e'.repeat(64) } }),
  /QUESTION_IMPORT_RELEASE_INVALID/,
  'candidate acceptance from different parser bytes must never be release evidence',
);
assert.throws(
  () => verifyImportRelease({ ...evidence, storageRuntimeReceipt: { ...evidence.storageRuntimeReceipt, parserSha256: 'e'.repeat(64) } }),
  /QUESTION_IMPORT_RELEASE_INVALID/,
  'the release gate must bind the persisted runtime receipt to the parser proof used by the task',
);
const { parserSha256: omittedRuntimeParserSha256, ...runtimeReceiptWithoutParserProof } = evidence.storageRuntimeReceipt;
assert.strictEqual(omittedRuntimeParserSha256, parserSha256);
assert.throws(
  () => verifyImportRelease({ ...evidence, storageRuntimeReceipt: runtimeReceiptWithoutParserProof }),
  /QUESTION_IMPORT_RELEASE_INVALID/,
  'transport v3 without its parser digest is not a complete runtime receipt',
);
assert.throws(() => main(['--evidence', 'relative-evidence.json']), /QUESTION_IMPORT_RELEASE_INVALID/);
const evidencePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-question-import-release-')), 'evidence.json');
try {
  fs.writeFileSync(evidencePath, JSON.stringify(evidence), 'utf8');
  const cli = childProcess.spawnSync(process.execPath, ['scripts/check-question-import-release.js', '--evidence', evidencePath], { encoding: 'utf8' });
  assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout);
  assert.match(cli.stdout, /question import release evidence passed/);
} finally {
  fs.rmSync(path.dirname(evidencePath), { recursive: true, force: true });
}
console.log('question import release gate checks passed');
