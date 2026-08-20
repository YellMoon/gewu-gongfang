'use strict';

const { createHash } = require('crypto');
const { types } = require('util');

const FIELD_ORDER = Object.freeze([
  'batchId',
  'sourceSnapshotSha256',
  'sourceInventoryBeforeSha256',
  'sourceInventoryAfterSha256',
  'sourceCatalogSha256',
  'sourceContractSha256',
  'sourceSchemaSha256',
  'businessManifestSha256',
  'mapperSetSha256',
  'consentSha256',
  'shadowTargetIdentitySha256',
  'createdAt',
  'batchRequestSha256',
]);
const HASH_FIELDS = new Set(FIELD_ORDER.filter(field => field.endsWith('Sha256')));
const HASH_PATTERN = /^[0-9a-f]{64}$/;

function codedError(code) {
  const error = new Error('vNext business foundation admission input is invalid');
  error.code = code;
  return error;
}

function inputInvalid() {
  return codedError('VNEXT_PG17_ADMISSION_INPUT_INVALID');
}

function sourceSnapshotChanged() {
  return codedError('VNEXT_PG17_ADMISSION_SOURCE_SNAPSHOT_CHANGED');
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function ownDataObject(value) {
  if (value === null || typeof value !== 'object' || types.isProxy(value)) throw inputInvalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw inputInvalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== FIELD_ORDER.length || keys.some(key => typeof key !== 'string') || keys.some(key => !FIELD_ORDER.includes(key))) throw inputInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const field of FIELD_ORDER) {
    const descriptor = descriptors[field];
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw inputInvalid();
  }
  return descriptors;
}

function canonicalRequest(values) {
  const canonical = {};
  for (const field of FIELD_ORDER) {
    if (field !== 'batchRequestSha256') canonical[field] = values[field];
  }
  return JSON.stringify(canonical);
}

function validateBusinessFoundationAdmissionBatchRequest(value) {
  const descriptors = ownDataObject(value);
  const snapshot = {};
  for (const field of FIELD_ORDER) {
    const fieldValue = descriptors[field].value;
    if (typeof fieldValue !== 'string') throw inputInvalid();
    snapshot[field] = fieldValue;
  }
  if (snapshot.batchId.trim() === '') throw inputInvalid();
  for (const field of HASH_FIELDS) {
    if (!HASH_PATTERN.test(snapshot[field])) throw inputInvalid();
  }
  const parsedCreatedAt = new Date(snapshot.createdAt);
  if (Number.isNaN(parsedCreatedAt.valueOf()) || parsedCreatedAt.toISOString() !== snapshot.createdAt) throw inputInvalid();
  if (snapshot.sourceInventoryBeforeSha256 !== snapshot.sourceInventoryAfterSha256) throw sourceSnapshotChanged();
  if (sha256(canonicalRequest(snapshot)) !== snapshot.batchRequestSha256) throw inputInvalid();
  return Object.freeze(snapshot);
}

module.exports = {
  validateBusinessFoundationAdmissionBatchRequest,
};
