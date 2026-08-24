'use strict';

const { types } = require('util');

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

function invalid() {
  return codedError('CLOUD_BOOTSTRAP_ADMIN_INVALID');
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = keys.slice().sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw invalid();
  if (actual.some(key => !Object.prototype.hasOwnProperty.call(descriptors[key], 'value'))) throw invalid();
  return Object.freeze(Object.fromEntries(keys.map(key => [key, descriptors[key].value])));
}

function exactArray(value) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expected = Array.from({ length: value.length }, (_, index) => String(index));
  const actual = Object.keys(descriptors).filter(key => key !== 'length').sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw invalid();
  if (actual.some(key => !Object.prototype.hasOwnProperty.call(descriptors[key], 'value'))) throw invalid();
  return Object.freeze(expected.map(key => descriptors[key].value));
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim() === value && value !== '';
}

const BOOTSTRAP_SUPER_ADMIN_PHONE = '13732250653';

function resolveBootstrapAdminAccountId(input) {
  const request = exact(input, ['records', 'phoneHmac']);
  if (!/^[0-9a-f]{64}$/u.test(request.phoneHmac)) throw invalid();
  const records = exactArray(request.records).map(record => exact(record, ['phoneHmac', 'authorityId', 'accountId']));
  if (records.some(record => !/^[0-9a-f]{64}$/u.test(record.phoneHmac)
    || !nonBlank(record.authorityId) || !nonBlank(record.accountId))) throw invalid();
  const matches = records.filter(record => record.phoneHmac === request.phoneHmac);
  return matches.length === 1 ? matches[0].accountId : null;
}

module.exports = Object.freeze({ BOOTSTRAP_SUPER_ADMIN_PHONE, resolveBootstrapAdminAccountId });
