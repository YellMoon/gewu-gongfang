'use strict';

const crypto = require('crypto');
const { canonicalJson } = require('../../shared/migrationBundleProtocol');

function canonicalError(code) {
  return Object.assign(new Error(code), { code });
}

function canonicalSourceValue(value) {
  if (value === null || value === undefined) return { type: 'null' };
  if (Buffer.isBuffer(value)) {
    return {
      type: 'blob',
      bytes: value.length,
      sha256: crypto.createHash('sha256').update(value).digest('hex'),
    };
  }
  if (typeof value === 'bigint') return { type: 'integer64', value: value.toString() };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw canonicalError('MIGRATION_CANONICAL_REAL_INVALID');
    return { type: 'real', value: Object.is(value, -0) ? '-0' : String(value) };
  }
  if (typeof value === 'string') return { type: 'text', value };
  throw canonicalError('MIGRATION_CANONICAL_VALUE_UNSUPPORTED');
}

function canonicalSourceRow(row, columns = Object.keys(row).sort()) {
  const result = {};
  for (const column of columns) result[column] = canonicalSourceValue(row[column]);
  return result;
}

function hashCanonicalRecord(record) {
  return crypto.createHash('sha256').update(canonicalJson(record), 'utf8').digest('hex');
}

module.exports = { canonicalSourceRow, canonicalSourceValue, hashCanonicalRecord };
