'use strict';

const { types } = require('util');

function invalid() {
  return Object.assign(new Error('desktop pairing canonical phone reader input is invalid'), { code: 'CLOUD_DESKTOP_PAIRING_REJECTED' });
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw invalid();
  return value;
}

function createDesktopPairingCanonicalPhoneReader(config) {
  const settings = exact(config, ['query']);
  if (typeof settings.query !== 'function') throw invalid();
  return async function readCanonicalByPhoneHmac(input) {
    const request = exact(input, ['phoneHmac']);
    if (typeof request.phoneHmac !== 'string' || !/^[0-9a-f]{64}$/u.test(request.phoneHmac)) throw invalid();
    const result = await settings.query(
      `SELECT p.authority_id AS "authorityId",p.account_id AS "accountId",p.normalized_value_hash AS "phoneHmac"
         FROM vnext_control_plane.vnext_verified_contacts p
         JOIN vnext_control_plane.vnext_accounts a
           ON a.authority_id=p.authority_id AND a.account_id=p.account_id
         JOIN vnext_control_plane.vnext_authorities au ON au.authority_id=p.authority_id
        WHERE p.contact_type='phone' AND p.normalized_value_hash=$1
          AND p.verification_state='verified' AND p.verified_at IS NOT NULL AND p.revoked_at IS NULL
          AND a.status='active' AND au.status='active'
        ORDER BY p.authority_id,p.account_id
        LIMIT 2`,
      [request.phoneHmac],
    );
    if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) return null;
    const row = exact(result.rows[0], ['authorityId', 'accountId', 'phoneHmac']);
    if (typeof row.authorityId !== 'string' || !row.authorityId || typeof row.accountId !== 'string' || !row.accountId
      || row.phoneHmac !== request.phoneHmac) return null;
    return Object.freeze({ authorityId: row.authorityId, accountId: row.accountId, phoneHmac: row.phoneHmac });
  };
}

module.exports = Object.freeze({ createDesktopPairingCanonicalPhoneReader });
