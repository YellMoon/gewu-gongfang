'use strict';

const { types } = require('util');
const { validateBusinessFoundationAdmissionBatchRequest } = require('./businessFoundationAdmissionBatchRequest');
const {
  isVNextPg17DisposableHandleForRuntime,
  executeBusinessFoundationShadowAdmissionPlan,
  destroyBusinessFoundationShadowAdmissionTarget,
  reconcileBusinessFoundationShadowAdmission,
} = require('./disposableRuntime');
const { createBusinessFoundationCatalogBoundary } = require('./businessFoundationCatalogAssertion');
const { createBusinessFoundationAdmissionCatalogBoundary } = require('./businessFoundationAdmissionCatalog');

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalidHandle() {
  return codedError('VNEXT_PG17_HANDLE_INVALID', 'vNext PG17 disposable handle is invalid');
}

function inputInvalid() {
  return codedError('VNEXT_PG17_ADMISSION_INPUT_INVALID', 'vNext PG17 business foundation admission input is invalid');
}

function exactDataObject(value, fields) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw inputInvalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) throw inputInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot = {};
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw inputInvalid();
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

function exactArray(value) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) throw inputInvalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length))) throw inputInvalid();
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || lengthDescriptor.value !== value.length || lengthDescriptor.enumerable) throw inputInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.freeze(Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw inputInvalid();
    return descriptor.value;
  }));
}

function nonBlank(value) { return typeof value === 'string' && value.trim() !== ''; }
function finiteInstant(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}
function nullableText(value) { return value === null || typeof value === 'string'; }
function nullableInteger(value) { return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647); }
function nullableFiniteNumber(value) { return value === null || (typeof value === 'number' && Number.isFinite(value)); }

const TABLES = Object.freeze({
  tenants: Object.freeze(['id', 'name', 'legacyStatus', 'legacyPlan', 'legacyArchiveBefore', 'legacyDeleted', 'createdAt', 'updatedAt']),
  institutions: Object.freeze(['id', 'tenantId', 'name', 'contactPersonLegacy', 'contactPhoneLegacy', 'revenueShare', 'notes', 'legacyDeleted', 'createdAt', 'updatedAt']),
  schools: Object.freeze(['id', 'tenantId', 'name', 'legacyCount', 'legacyDeleted', 'createdAt', 'updatedAt']),
  rooms: Object.freeze(['id', 'tenantId', 'name', 'addressLegacy', 'legacyCount', 'legacyDeleted', 'createdAt', 'updatedAt']),
});

function snapshotRow(relation, value) {
  const row = exactDataObject(value, TABLES[relation]);
  if (!nonBlank(row.id) || !nonBlank(row.name) || typeof row.legacyDeleted !== 'boolean' || !finiteInstant(row.createdAt) || !finiteInstant(row.updatedAt) || row.updatedAt < row.createdAt) throw inputInvalid();
  if (relation !== 'tenants' && !nonBlank(row.tenantId)) throw inputInvalid();
  if (relation === 'tenants' && (!nullableText(row.legacyStatus) || !nullableText(row.legacyPlan) || !(row.legacyArchiveBefore === null || finiteInstant(row.legacyArchiveBefore)))) throw inputInvalid();
  if (relation === 'institutions' && (!nullableText(row.contactPersonLegacy) || !nullableText(row.contactPhoneLegacy) || !nullableFiniteNumber(row.revenueShare) || !nullableText(row.notes))) throw inputInvalid();
  if ((relation === 'schools' || relation === 'rooms') && !nullableInteger(row.legacyCount)) throw inputInvalid();
  if (relation === 'rooms' && !nullableText(row.addressLegacy)) throw inputInvalid();
  return Object.freeze(row);
}

function snapshotRows(relation, value) {
  const ids = new Set();
  const rows = exactArray(value).map(row => snapshotRow(relation, row));
  for (const row of rows) {
    if (ids.has(row.id)) throw inputInvalid();
    ids.add(row.id);
  }
  return Object.freeze(rows);
}

function validateBusinessFoundationShadowAdmissionFixture(value) {
  const fixture = exactDataObject(value, ['batch', 'tenants', 'institutions', 'schools', 'rooms']);
  const snapshot = { batch: validateBusinessFoundationAdmissionBatchRequest(fixture.batch) };
  for (const relation of Object.keys(TABLES)) snapshot[relation] = snapshotRows(relation, fixture[relation]);
  if (Object.keys(TABLES).every(relation => snapshot[relation].length === 0)) throw inputInvalid();
  const tenantIds = new Set(snapshot.tenants.map(row => row.id));
  for (const relation of ['institutions', 'schools', 'rooms']) {
    if (snapshot[relation].some(row => !tenantIds.has(row.tenantId))) throw inputInvalid();
  }
  return Object.freeze(snapshot);
}

function snapshotReconciliationInput(value) {
  const input = exactDataObject(value, ['batchId']);
  if (!nonBlank(input.batchId)) throw inputInvalid();
  return Object.freeze({ batchId: input.batchId });
}

function createBusinessFoundationShadowAdmissionBoundary(runtime) {
  if (!runtime || typeof runtime !== 'object' || types.isProxy(runtime)) throw invalidHandle();
  async function admit(handle, fixture) {
    if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
    const snapshot = validateBusinessFoundationShadowAdmissionFixture(fixture);
    const businessCatalog = createBusinessFoundationCatalogBoundary(runtime);
    const admissionCatalog = createBusinessFoundationAdmissionCatalogBoundary(runtime);
    await businessCatalog.assert(handle);
    await admissionCatalog.assert(handle);
    return executeBusinessFoundationShadowAdmissionPlan(runtime, handle, snapshot);
  }
  async function reconcile(handle, input) {
    if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
    const snapshot = snapshotReconciliationInput(input);
    const businessCatalog = createBusinessFoundationCatalogBoundary(runtime);
    const admissionCatalog = createBusinessFoundationAdmissionCatalogBoundary(runtime);
    await businessCatalog.assert(handle);
    await admissionCatalog.assert(handle);
    return reconcileBusinessFoundationShadowAdmission(runtime, handle, snapshot.batchId);
  }
  async function rollbackSyntheticTarget(handle) {
    if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
    return destroyBusinessFoundationShadowAdmissionTarget(runtime, handle);
  }
  return Object.freeze({ admit, reconcile, rollbackSyntheticTarget });
}

module.exports = { createBusinessFoundationShadowAdmissionBoundary, validateBusinessFoundationShadowAdmissionFixture };
