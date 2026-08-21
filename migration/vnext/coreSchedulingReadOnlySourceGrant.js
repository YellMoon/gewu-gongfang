'use strict';

const { types } = require('util');

const ERROR_CODE = 'MIGRATION_CORE_SCHEDULING_SOURCE_GRANT_INVALID';
const SHA256 = /^[a-f0-9]{64}$/u;
const grants = new WeakMap();

function invalid() {
  return Object.assign(new Error(ERROR_CODE), { code: ERROR_CODE });
}

function exactDataObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot = {};
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw invalid();
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

function createCoreSchedulingReadOnlySourceGrant(value) {
  const input = exactDataObject(value, ['snapshotId', 'sourceIdentitySha256', 'openReadOnlyDatabase', 'readSourceIdentity']);
  if (typeof input.snapshotId !== 'string' || input.snapshotId.trim() !== input.snapshotId || input.snapshotId.length === 0
    || typeof input.sourceIdentitySha256 !== 'string' || !SHA256.test(input.sourceIdentitySha256)
    || typeof input.openReadOnlyDatabase !== 'function' || typeof input.readSourceIdentity !== 'function') throw invalid();
  const grant = Object.freeze({});
  grants.set(grant, Object.freeze({ ...input }));
  return grant;
}

function requireCoreSchedulingReadOnlySourceGrant(grant) {
  const source = grants.get(grant);
  if (!source) throw invalid();
  return source;
}

module.exports = {
  createCoreSchedulingReadOnlySourceGrant,
  requireCoreSchedulingReadOnlySourceGrant,
};
