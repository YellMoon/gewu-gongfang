'use strict';

const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const MEDIA_TYPE = /^[a-z]+\/[a-z0-9.+-]+$/;
const STORAGE_CLASSES = new Set(['question_source','question_asset','import_original','export_product','backup_package']);
const STATES = new Set(['pending_upload','storage_queued','stored','verified','missing','quarantined','failed_retryable']);
const error = () => Object.assign(new Error('VNEXT_FILE_LIFECYCLE_INVALID'), { code: 'VNEXT_FILE_LIFECYCLE_INVALID' });
const freeze = value => Object.freeze(value);
const keys = value => Reflect.ownKeys(value);
function data(value, expected) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) throw error();
  const snapshot = {};
  for (const key of expected) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw error(); snapshot[key] = descriptor.value; }
  return snapshot;
}
function list(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw error();
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value') || !Number.isSafeInteger(length.value) || length.value < 0 || keys(value).length !== length.value + 1) throw error();
  const result = [];
  for (let index = 0; index < length.value; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw error(); result.push(descriptor.value); }
  return result;
}
function id(value) { if (typeof value !== 'string' || !ID.test(value)) throw error(); return value; }
function locator(value, prefix) { if (typeof value !== 'string' || !new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`).test(value)) throw error(); return value; }
function hash(value) { if (typeof value !== 'string' || !SHA256.test(value)) throw error(); return value; }
function integer(value, min) { if (typeof value !== 'number' || Object.is(value, -0) || !Number.isSafeInteger(value) || value < min) throw error(); return value; }
function equal(left, right, fields) { return fields.every(field => left[field] === right[field]); }
function stableCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function deep(value) { if (Array.isArray(value)) return freeze(value.map(deep)); if (value && typeof value === 'object') return freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deep(item)]))); return value; }
function identity(input) {
  const v = data(input, ['fileObjectId','objectVersion','expectedSha256','expectedBytes','mediaType','storageClass']);
  if (typeof v.mediaType !== 'string' || !MEDIA_TYPE.test(v.mediaType) || typeof v.storageClass !== 'string' || !STORAGE_CLASSES.has(v.storageClass)) throw error();
  return { fileObjectId: id(v.fileObjectId), objectVersion: integer(v.objectVersion, 1), expectedSha256: hash(v.expectedSha256), expectedBytes: integer(v.expectedBytes, 0), mediaType: v.mediaType, storageClass: v.storageClass };
}
function baseFromObject(v) {
  const snapshot = data(v, ['fileObjectId','objectVersion','expectedSha256','expectedBytes','mediaType','storageClass','state','activeTask','storageReceipt','verificationReceipt','failureReceipt','backupReceipts']);
  return identity({ fileObjectId: snapshot.fileObjectId, objectVersion: snapshot.objectVersion, expectedSha256: snapshot.expectedSha256, expectedBytes: snapshot.expectedBytes, mediaType: snapshot.mediaType, storageClass: snapshot.storageClass });
}
function fits(object, event) { return equal(object, event, ['fileObjectId','objectVersion','expectedSha256','expectedBytes']); }
function queueEvent(input) { const v = data(input, ['kind','taskId','fileObjectId','objectVersion','expectedSha256','expectedBytes']); if (v.kind !== 'queue') throw error(); return { taskId: id(v.taskId), fileObjectId: id(v.fileObjectId), objectVersion: integer(v.objectVersion, 1), expectedSha256: hash(v.expectedSha256), expectedBytes: integer(v.expectedBytes, 0) }; }
function storeEvent(input) { const v = data(input, ['kind','taskId','fileObjectId','objectVersion','expectedSha256','expectedBytes','storageLocationRef','observedSha256','observedBytes']); if (v.kind !== 'store') throw error(); return { taskId: id(v.taskId), fileObjectId: id(v.fileObjectId), objectVersion: integer(v.objectVersion, 1), expectedSha256: hash(v.expectedSha256), expectedBytes: integer(v.expectedBytes, 0), storageLocationRef: locator(v.storageLocationRef, 'sloc'), observedSha256: hash(v.observedSha256), observedBytes: integer(v.observedBytes, 0) }; }
function verifyEvent(input) { const v = data(input, ['kind','verificationTaskId','storageTaskId','fileObjectId','objectVersion','storageLocationRef','observedSha256','observedBytes']); if (v.kind !== 'verify') throw error(); return { verificationTaskId: id(v.verificationTaskId), storageTaskId: id(v.storageTaskId), fileObjectId: id(v.fileObjectId), objectVersion: integer(v.objectVersion, 1), storageLocationRef: locator(v.storageLocationRef, 'sloc'), observedSha256: hash(v.observedSha256), observedBytes: integer(v.observedBytes, 0) }; }
function normalizeStore(receipt, object) { const v = storeEvent({ kind: 'store', ...data(receipt, ['taskId','fileObjectId','objectVersion','expectedSha256','expectedBytes','storageLocationRef','observedSha256','observedBytes']) }); if (!fits(object, v) || v.observedSha256 !== object.expectedSha256 || v.observedBytes !== object.expectedBytes) throw error(); return v; }
function normalizeVerify(receipt, object, store) { const v = verifyEvent({ kind: 'verify', ...data(receipt, ['verificationTaskId','storageTaskId','fileObjectId','objectVersion','storageLocationRef','observedSha256','observedBytes']) }); if (!store || v.verificationTaskId === v.storageTaskId || v.fileObjectId !== object.fileObjectId || v.objectVersion !== object.objectVersion || v.storageTaskId !== store.taskId || v.storageLocationRef !== store.storageLocationRef || v.observedSha256 !== object.expectedSha256 || v.observedBytes !== object.expectedBytes) throw error(); return v; }
function normalizeFailure(receipt) { const v = data(receipt, ['taskId','taskKind','failureState','failureCode']); if (!['active_task','inspection'].includes(v.taskKind) || !['missing','quarantined','failed_retryable'].includes(v.failureState)) throw error(); return { taskId: id(v.taskId), taskKind: v.taskKind, failureState: v.failureState, failureCode: id(v.failureCode) }; }
function failureEvent(input) {
  const own = keys(input);
  const common = ['kind','fileObjectId','objectVersion','expectedSha256','expectedBytes','failureState','failureCode'];
  const taskKey = own.includes('inspectionTaskId') ? 'inspectionTaskId' : 'taskId';
  if (own.length !== common.length + 1 || common.some(key => !Object.hasOwn(input, key)) || !Object.hasOwn(input, taskKey)) throw error();
  const v = data(input, ['kind', taskKey, 'fileObjectId','objectVersion','expectedSha256','expectedBytes','failureState','failureCode']);
  if (v.kind !== 'fail') throw error();
  return { reference: queueEvent({ kind: 'queue', taskId: v[taskKey], fileObjectId: v.fileObjectId, objectVersion: v.objectVersion, expectedSha256: v.expectedSha256, expectedBytes: v.expectedBytes }), failure: normalizeFailure({ taskId: v[taskKey], taskKind: taskKey === 'inspectionTaskId' ? 'inspection' : 'active_task', failureState: v.failureState, failureCode: v.failureCode }) };
}
function normalizeBackup(receipt, object, verify) {
  const v = data(receipt, ['backupTaskId','backupVerificationTaskId','fileObjectId','objectVersion','primaryVerificationTaskId','primaryStorageLocationRef','backupLocationRef','observedSha256','observedBytes']);
  const result = { backupTaskId: id(v.backupTaskId), backupVerificationTaskId: id(v.backupVerificationTaskId), fileObjectId: id(v.fileObjectId), objectVersion: integer(v.objectVersion, 1), primaryVerificationTaskId: id(v.primaryVerificationTaskId), primaryStorageLocationRef: locator(v.primaryStorageLocationRef, 'sloc'), backupLocationRef: locator(v.backupLocationRef, 'bloc'), observedSha256: hash(v.observedSha256), observedBytes: integer(v.observedBytes, 0) };
  if (!verify || result.backupTaskId === result.backupVerificationTaskId || result.fileObjectId !== object.fileObjectId || result.objectVersion !== object.objectVersion || result.primaryVerificationTaskId !== verify.verificationTaskId || result.primaryStorageLocationRef !== verify.storageLocationRef || result.observedSha256 !== object.expectedSha256 || result.observedBytes !== object.expectedBytes) throw error();
  return result;
}
function normalize(input) {
  const raw = data(input, ['fileObjectId','objectVersion','expectedSha256','expectedBytes','mediaType','storageClass','state','activeTask','storageReceipt','verificationReceipt','failureReceipt','backupReceipts']);
  const base = baseFromObject(input); if (!STATES.has(raw.state)) throw error();
  const active = raw.activeTask === null ? null : queueEvent({ kind: 'queue', ...data(raw.activeTask, ['taskId','fileObjectId','objectVersion','expectedSha256','expectedBytes']) });
  const store = raw.storageReceipt === null ? null : normalizeStore(data(raw.storageReceipt, ['taskId','fileObjectId','objectVersion','expectedSha256','expectedBytes','storageLocationRef','observedSha256','observedBytes']), base);
  const verify = raw.verificationReceipt === null ? null : normalizeVerify(data(raw.verificationReceipt, ['verificationTaskId','storageTaskId','fileObjectId','objectVersion','storageLocationRef','observedSha256','observedBytes']), base, store);
  const failure = raw.failureReceipt === null ? null : normalizeFailure(raw.failureReceipt);
  const backups = list(raw.backupReceipts).map(item => normalizeBackup(item, base, verify));
  if (active && !fits(base, active)) throw error();
  if (active && store && active.taskId !== store.taskId) throw error();
  const taskIds = [store ? store.taskId : active && active.taskId, verify && verify.verificationTaskId, failure && failure.taskId, ...backups.flatMap(item => [item.backupTaskId, item.backupVerificationTaskId])].filter(Boolean);
  if (new Set(taskIds).size !== taskIds.length || new Set(backups.map(item => item.backupLocationRef)).size !== backups.length) throw error();
  const complete = raw.state === 'pending_upload' ? !active && !store && !verify && !failure && backups.length === 0
    : raw.state === 'storage_queued' ? !!active && !store && !verify && !failure && backups.length === 0
    : raw.state === 'stored' ? !!active && !!store && !verify && !failure && backups.length === 0
    : raw.state === 'verified' ? !!active && !!store && !!verify && !failure
    : !!failure && failure.failureState === raw.state && !active && ((!!store && !!verify && failure.taskKind === 'inspection') || (!store && !verify && failure.taskKind === 'active_task'));
  if (!complete) throw error();
  return deep({ ...base, state: raw.state, activeTask: active, storageReceipt: store, verificationReceipt: verify, failureReceipt: failure, backupReceipts: backups.sort((a, b) => stableCompare(a.backupTaskId, b.backupTaskId)) });
}
function createFileObject(input) { const b = identity(input); return deep({ ...b, state: 'pending_upload', activeTask: null, storageReceipt: null, verificationReceipt: null, failureReceipt: null, backupReceipts: [] }); }
function transition(input, event) {
  const object = normalize(input); if (!event || typeof event !== 'object') throw error(); const kind = Object.getOwnPropertyDescriptor(event, 'kind'); if (!kind || !Object.hasOwn(kind, 'value')) throw error();
  if (kind.value === 'queue') { const next = queueEvent(event); if (!fits(object, next)) throw error(); if (object.activeTask && equal(object.activeTask, next, Object.keys(next))) return object; if (!['pending_upload','missing','failed_retryable'].includes(object.state)) throw error(); const retiredTaskIds = [object.failureReceipt && object.failureReceipt.taskId, object.storageReceipt && object.storageReceipt.taskId, object.verificationReceipt && object.verificationReceipt.verificationTaskId, ...object.backupReceipts.flatMap(item => [item.backupTaskId, item.backupVerificationTaskId])]; if (retiredTaskIds.includes(next.taskId)) throw error(); return deep({ ...object, state: 'storage_queued', activeTask: next, storageReceipt: null, verificationReceipt: null, failureReceipt: null, backupReceipts: [] }); }
  if (kind.value === 'store') { const receipt = storeEvent(event); if (!fits(object, receipt) || receipt.observedSha256 !== object.expectedSha256 || receipt.observedBytes !== object.expectedBytes) throw error(); if (object.storageReceipt && equal(object.storageReceipt, receipt, Object.keys(receipt))) return object; if (object.state !== 'storage_queued' || object.activeTask.taskId !== receipt.taskId) throw error(); return deep({ ...object, state: 'stored', storageReceipt: receipt }); }
  if (kind.value === 'verify') { const receipt = verifyEvent(event); if (object.verificationReceipt && equal(object.verificationReceipt, receipt, Object.keys(receipt))) return object; if (object.state !== 'stored') throw error(); const verified = normalizeVerify(receipt, object, object.storageReceipt); return deep({ ...object, state: 'verified', verificationReceipt: verified }); }
  if (kind.value === 'fail') {
    const { reference, failure } = failureEvent(event);
    if (!fits(object, reference)) throw error();
    if (['missing','quarantined','failed_retryable'].includes(object.state)) {
      if (object.failureReceipt && equal(object.failureReceipt, failure, Object.keys(failure))) return object;
      throw error();
    }
    if (!['storage_queued','stored','verified'].includes(object.state)) throw error();
    if (object.state === 'verified') {
      const reserved = [object.activeTask.taskId, object.storageReceipt.taskId, object.verificationReceipt.verificationTaskId, ...object.backupReceipts.flatMap(item => [item.backupTaskId, item.backupVerificationTaskId])];
      if (failure.taskKind !== 'inspection' || reserved.includes(reference.taskId)) throw error();
    } else if (failure.taskKind !== 'active_task' || reference.taskId !== object.activeTask.taskId) throw error();
    return deep({ ...object, state: failure.failureState, activeTask: null, storageReceipt: object.state === 'verified' ? object.storageReceipt : null, verificationReceipt: object.state === 'verified' ? object.verificationReceipt : null, failureReceipt: failure });
  }
  throw error();
}
function recordBackup(input, event) { const object = normalize(input); if (object.state !== 'verified') throw error(); const receipt = normalizeBackup(event, object, object.verificationReceipt); if ([object.activeTask.taskId, object.storageReceipt.taskId, object.verificationReceipt.verificationTaskId].includes(receipt.backupTaskId) || [object.activeTask.taskId, object.storageReceipt.taskId, object.verificationReceipt.verificationTaskId].includes(receipt.backupVerificationTaskId)) throw error(); const existing = object.backupReceipts.find(item => item.backupTaskId === receipt.backupTaskId); if (existing) { if (equal(existing, receipt, Object.keys(receipt))) return object; throw error(); } if (object.backupReceipts.some(item => item.backupVerificationTaskId === receipt.backupVerificationTaskId || item.backupLocationRef === receipt.backupLocationRef)) throw error(); return deep({ ...object, backupReceipts: [...object.backupReceipts, receipt].sort((a, b) => stableCompare(a.backupTaskId, b.backupTaskId)) }); }
module.exports = freeze({ createFileObject, transition, recordBackup });
