'use strict';

const assert = require('assert');
const lifecycle = require('./vNextFileObjectLifecycleReference');

const HASH = 'a'.repeat(64);
const identity = { fileObjectId: 'file_object_1', objectVersion: 1, expectedSha256: HASH, expectedBytes: 1024, mediaType: 'application/pdf', storageClass: 'question_source' };
const queue = { kind: 'queue', taskId: 'task_queue_1', fileObjectId: 'file_object_1', objectVersion: 1, expectedSha256: HASH, expectedBytes: 1024 };
const store = { ...queue, kind: 'store', storageLocationRef: 'sloc_primary_1', observedSha256: HASH, observedBytes: 1024 };
const verify = { kind: 'verify', verificationTaskId: 'task_verify_1', storageTaskId: 'task_queue_1', fileObjectId: 'file_object_1', objectVersion: 1, storageLocationRef: 'sloc_primary_1', observedSha256: HASH, observedBytes: 1024 };
const backup = { backupTaskId: 'task_backup_1', backupVerificationTaskId: 'task_backup_verify_1', fileObjectId: 'file_object_1', objectVersion: 1, primaryVerificationTaskId: 'task_verify_1', primaryStorageLocationRef: 'sloc_primary_1', backupLocationRef: 'bloc_nas_1', observedSha256: HASH, observedBytes: 1024 };
const invalid = action => assert.throws(action, /VNEXT_FILE_LIFECYCLE_INVALID/);

const pending = lifecycle.createFileObject(identity);
assert.deepStrictEqual(pending, { ...identity, state: 'pending_upload', activeTask: null, storageReceipt: null, verificationReceipt: null, failureReceipt: null, backupReceipts: [] });
invalid(() => lifecycle.transition(pending, { kind: 'fail', taskId: 'unbound_task_1', fileObjectId: 'file_object_1', objectVersion: 1, expectedSha256: HASH, expectedBytes: 1024, failureState: 'failed_retryable', failureCode: 'unbound_failure' }));
const queued = lifecycle.transition(pending, queue);
assert.strictEqual(queued.state, 'storage_queued');
for (const field of ['fileObjectId','objectVersion','expectedSha256','expectedBytes']) {
  const wrong = field === 'fileObjectId' ? 'other_object' : field === 'objectVersion' ? 2 : field === 'expectedSha256' ? 'b'.repeat(64) : 1;
  invalid(() => lifecycle.transition({ ...queued, activeTask: { ...queued.activeTask, [field]: wrong } }, store));
}
assert.deepStrictEqual(lifecycle.transition(queued, queue), queued, 'queue exact replay is idempotent');
invalid(() => lifecycle.transition(queued, { ...queue, taskId: 'task_queue_2' }));
invalid(() => lifecycle.transition(queued, { ...queue, expectedBytes: 1 }));
const stored = lifecycle.transition(queued, store);
assert.strictEqual(stored.state, 'stored');
assert.deepStrictEqual(lifecycle.transition(stored, store), stored, 'store exact replay is idempotent');
invalid(() => lifecycle.transition(stored, { ...store, taskId: 'task_queue_2' }));
invalid(() => lifecycle.transition(
  { ...stored, storageReceipt: { ...stored.storageReceipt, taskId: 'task_queue_2' } },
  { ...verify, storageTaskId: 'task_queue_2' },
));
invalid(() => lifecycle.transition(queued, verify));
invalid(() => lifecycle.transition(stored, { ...verify, observedSha256: 'b'.repeat(64) }));
const verified = lifecycle.transition(stored, verify);
assert.strictEqual(verified.state, 'verified');
assert.ok(verified.storageReceipt && verified.verificationReceipt, 'verified needs independent store and verification receipts');
assert.deepStrictEqual(lifecycle.transition(verified, verify), verified, 'verify exact replay is idempotent');
assert.deepStrictEqual(lifecycle.transition(stored, queue), stored, 'queue replay remains idempotent after storage');
assert.deepStrictEqual(lifecycle.transition(verified, store), verified, 'store replay remains idempotent after verification');

const quarantined = lifecycle.transition(verified, { kind: 'fail', inspectionTaskId: 'task_inspect_1', fileObjectId: 'file_object_1', objectVersion: 1, expectedSha256: HASH, expectedBytes: 1024, failureState: 'quarantined', failureCode: 'inspection_quarantine' });
invalid(() => lifecycle.transition({ ...quarantined, state: 'missing' }, { ...queue, taskId: 'task_retry_after_quarantine' }));
invalid(() => lifecycle.transition({ ...quarantined, state: 'failed_retryable' }, { ...queue, taskId: 'task_retry_after_quarantine' }));
invalid(() => lifecycle.transition(verified, { kind: 'fail', inspectionTaskId: 'task_verify_1', fileObjectId: 'file_object_1', objectVersion: 1, expectedSha256: HASH, expectedBytes: 1024, failureState: 'missing', failureCode: 'reused_verification_task' }));

const sparseBackups = new Array(1);
invalid(() => lifecycle.transition({ ...verified, backupReceipts: sparseBackups }, verify));
const weirdBackups = [];
Object.setPrototypeOf(weirdBackups, { map() { throw new Error('input array map must not run'); } });
invalid(() => lifecycle.transition({ ...verified, backupReceipts: weirdBackups }, verify));

for (const state of ['missing','quarantined','failed_retryable']) {
  const failed = lifecycle.transition(verified, { kind: 'fail', inspectionTaskId: `task_inspect_${state}`, fileObjectId: 'file_object_1', objectVersion: 1, expectedSha256: HASH, expectedBytes: 1024, failureState: state, failureCode: 'storage_offline' });
  assert.strictEqual(failed.state, state);
  assert.deepStrictEqual(lifecycle.transition(failed, { kind: 'fail', inspectionTaskId: `task_inspect_${state}`, fileObjectId: 'file_object_1', objectVersion: 1, expectedSha256: HASH, expectedBytes: 1024, failureState: state, failureCode: 'storage_offline' }), failed, 'failure exact replay is idempotent');
  if (state === 'quarantined') invalid(() => lifecycle.transition(failed, { ...queue, taskId: 'task_retry_1' }));
  else {
    invalid(() => lifecycle.transition(failed, queue));
    assert.strictEqual(lifecycle.transition(failed, { ...queue, taskId: 'task_retry_1' }).state, 'storage_queued');
  }
}

const backedUp = lifecycle.recordBackup(verified, backup);
assert.strictEqual(backedUp.backupReceipts.length, 1);
assert.deepStrictEqual(lifecycle.recordBackup(backedUp, backup), backedUp, 'backup exact replay is idempotent');
const dualBackup = lifecycle.recordBackup(backedUp, { ...backup, backupTaskId: 'task_backup_2', backupVerificationTaskId: 'task_backup_verify_2', backupLocationRef: 'bloc_removable_1' });
assert.strictEqual(dualBackup.backupReceipts.length, 2, 'NAS and removable backup receipts coexist');
const missingWithBackups = lifecycle.transition(dualBackup, { kind: 'fail', inspectionTaskId: 'task_inspect_backup_1', fileObjectId: 'file_object_1', objectVersion: 1, expectedSha256: HASH, expectedBytes: 1024, failureState: 'missing', failureCode: 'primary_missing' });
invalid(() => lifecycle.transition({ ...missingWithBackups, failureReceipt: { ...missingWithBackups.failureReceipt, taskId: 'task_queue_1' } }, { kind: 'fail', inspectionTaskId: 'task_queue_1', fileObjectId: 'file_object_1', objectVersion: 1, expectedSha256: HASH, expectedBytes: 1024, failureState: 'missing', failureCode: 'primary_missing' }));
const retriedWithBackups = lifecycle.transition(missingWithBackups, { ...queue, taskId: 'task_retry_2' });
assert.strictEqual(retriedWithBackups.state, 'storage_queued', 'retry clears stale backup evidence from the active snapshot');
assert.strictEqual(retriedWithBackups.backupReceipts.length, 0, 'the active snapshot has no stale backup receipts after a retry');
assert.strictEqual(lifecycle.transition(retriedWithBackups, { ...store, taskId: 'task_retry_2' }).state, 'stored');
invalid(() => lifecycle.recordBackup(stored, backup));
invalid(() => lifecycle.recordBackup(verified, { ...backup, observedBytes: 1 }));
invalid(() => lifecycle.recordBackup(verified, { ...backup, backupLocationRef: 'sloc_primary_1' }));
invalid(() => lifecycle.recordBackup(verified, { ...backup, backupLocationRef: 'C:' }));
invalid(() => lifecycle.transition(stored, { ...verify, verificationTaskId: 'task_queue_1' }));
invalid(() => lifecycle.recordBackup(verified, { ...backup, backupVerificationTaskId: 'task_backup_1' }));
invalid(() => lifecycle.recordBackup(backedUp, { ...backup, backupTaskId: 'task_backup_3', backupLocationRef: 'bloc_third_1' }));

invalid(() => lifecycle.createFileObject({ ...identity, mediaType: { toString: () => 'application/pdf' } }));
invalid(() => lifecycle.createFileObject({ ...identity, expectedBytes: Number.MAX_SAFE_INTEGER + 1 }));
invalid(() => lifecycle.createFileObject({ ...identity, storageClass: 'nas:///path' }));
invalid(() => lifecycle.recordBackup({ ...verified, storageReceipt: { forged: true } }, backup));
invalid(() => lifecycle.transition({ ...verified, verificationReceipt: { forged: true } }, verify));
let nestedGetterReads = 0;
const nestedGetter = { ...verified.storageReceipt };
Object.defineProperty(nestedGetter, 'taskId', { enumerable: true, get() { nestedGetterReads += 1; return 'task_queue_1'; } });
invalid(() => lifecycle.transition({ ...verified, storageReceipt: nestedGetter }, verify));
assert.strictEqual(nestedGetterReads, 0, 'nested receipt accessors are rejected before being read');
assert.ok(Object.isFrozen(dualBackup) && Object.isFrozen(dualBackup.backupReceipts) && Object.isFrozen(dualBackup.backupReceipts[0]) && Object.isFrozen(dualBackup.storageReceipt) && Object.isFrozen(dualBackup.verificationReceipt));
console.log('vNext file object lifecycle reference checks passed');
