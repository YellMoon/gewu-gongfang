'use strict';

const { types } = require('util');

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

function invalid() {
  return codedError('CLOUD_CANONICAL_ACCOUNT_INVALID');
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

function exactRows(value) {
  if (!Array.isArray(value) || types.isProxy(value)) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expected = Array.from({ length: value.length }, (_, index) => String(index));
  const actual = Object.keys(descriptors).filter(key => key !== 'length').sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw invalid();
  if (actual.some(key => !Object.prototype.hasOwnProperty.call(descriptors[key], 'value'))) throw invalid();
  return expected.map(key => descriptors[key].value);
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim() === value && value !== '';
}

function createCanonicalAccountRepository(config = {}) {
  const { query, authorityId } = exact(config, ['query', 'authorityId']);
  if (typeof query !== 'function' || types.isProxy(query) || !nonBlank(authorityId)) throw invalid();
  return Object.freeze({
    async resolveVerifiedPhoneHash(input) {
      const request = exact(input, ['phoneHash']);
      if (!/^[0-9a-f]{64}$/u.test(request.phoneHash)) throw invalid();
      let result;
      try {
        result = await query(
          `SELECT c.authority_id AS "authorityId",c.account_id AS "accountId"
           FROM vnext_control_plane.vnext_verified_contacts c
           JOIN vnext_control_plane.vnext_accounts a
             ON a.authority_id=c.authority_id AND a.account_id=c.account_id
           WHERE c.authority_id=$1 AND c.contact_type='phone'
             AND c.normalized_value_hash=$2 AND c.verification_state='verified'
             AND c.verified_at IS NOT NULL AND c.revoked_at IS NULL
             AND a.status='active'
           ORDER BY c.account_id ASC
           LIMIT 2`,
          [authorityId, request.phoneHash],
        );
      } catch (error) {
        throw codedError('CLOUD_CANONICAL_ACCOUNT_UNAVAILABLE');
      }
      const rows = exactRows(exact(result, ['rows']).rows);
      if (rows.length === 0) return null;
      if (rows.length !== 1) throw codedError('CLOUD_CANONICAL_ACCOUNT_CONFLICT');
      const row = exact(rows[0], ['authorityId', 'accountId']);
      if (row.authorityId !== authorityId || !nonBlank(row.accountId)) throw invalid();
      return Object.freeze({ authorityId: row.authorityId, accountId: row.accountId });
    },
  });
}

module.exports = Object.freeze({ createCanonicalAccountRepository });
