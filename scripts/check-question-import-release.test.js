'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifyImportRelease, main } = require('./check-question-import-release');

const evidence = {
  expectedVersion: '8.0.6',
  cloudHealth: { ok: true, database: 'postgresql', businessAuthority: 'cloud', version: '8.0.6' },
  storageHealth: { agentId: 'nas-agent-1', version: '8.0.6', writableAuthority: false, rootProbe: true },
  task: { taskId: 'question_import_task_abcdefgh', status: 'submitted', phase: 'submitted' },
  sourceReceipt: { receiptId: 'storage_receipt_source_abcdefgh' },
  expectedMediaCount: 1,
  derivedMediaReceipts: [{ receiptId: 'storage_receipt_media_abcdefgh' }],
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
  () => verifyImportRelease({ ...evidence, storageHealth: { ...evidence.storageHealth, writableAuthority: true } }),
  /QUESTION_IMPORT_RELEASE_INVALID/,
  'NAS must remain a storage proxy rather than a business authority',
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
