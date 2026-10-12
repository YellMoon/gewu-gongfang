'use strict';

function invalidConfig() {
  const error = new Error('cloud desktop identity PostgreSQL repository configuration is invalid');
  error.code = 'CLOUD_DESKTOP_IDENTITY_REPOSITORY_CONFIG_INVALID';
  return error;
}

function iso(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

function integer(value) {
  if (value === null || value === undefined || value === '') return value;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
}

function normalize(row) {
  if (!row || typeof row !== 'object') return row || null;
  const result = { ...row };
  for (const key of ['credentialVersion', 'rowVersion']) {
    if (Object.prototype.hasOwnProperty.call(result, key)) result[key] = integer(result[key]);
  }
  for (const key of ['nonceIssuedAt', 'expiresAt', 'createdAt', 'updatedAt', 'lastSeenAt', 'revokedAt']) {
    if (Object.prototype.hasOwnProperty.call(result, key)) result[key] = iso(result[key]);
  }
  return Object.freeze(result);
}

function createCloudDesktopIdentityPgRepository({ writerPool } = {}) {
  if (!writerPool || typeof writerPool.query !== 'function') throw invalidConfig();

  async function one(sql, values) {
    const result = await writerPool.query(sql, values);
    return normalize(result?.rows?.[0] || null);
  }

  async function createChallenge(input) {
    try {
      return await one(
      `SELECT *
         FROM vnext_control_plane.vnext_start_desktop_session_challenge(
           $1::text, $2::text, $3::text, $4::text, $5::timestamptz, $6::timestamptz
         )`,
      [input.challengeId, input.authorizationId, input.deviceId, input.nonceSha256, input.nonceIssuedAt, input.expiresAt],
      );
    } catch (error) {
      if (error?.code !== 'P0001' || error.message !== 'VNEXT_DESKTOP_AUTHORIZATION_INVALID') throw error;
      // The control-plane function rejects both expiration and revocation.
      // Classify expiration only if every other canonical binding is current.
      const expired = await one(`SELECT true AS "expiredOnly"
        FROM vnext_control_plane.vnext_sessions s
        JOIN vnext_control_plane.vnext_authorities au ON au.authority_id=s.authority_id AND au.status='active'
        JOIN vnext_control_plane.vnext_accounts a ON a.authority_id=s.authority_id AND a.account_id=s.account_id AND a.status='active'
        JOIN vnext_control_plane.vnext_trusted_devices d ON d.authority_id=s.authority_id AND d.device_id=s.device_id AND d.status='active'
        JOIN vnext_control_plane.vnext_device_installations i ON i.authority_id=s.authority_id AND i.device_id=s.device_id AND i.installation_id=s.installation_id AND i.status='active'
        JOIN vnext_control_plane.vnext_account_device_links l ON l.authority_id=s.authority_id AND l.account_id=s.account_id AND l.device_id=s.device_id AND l.installation_id=s.installation_id AND l.link_id=s.link_id AND l.status='active'
        WHERE s.session_id=$1 AND s.device_id=$2 AND s.session_kind='online' AND s.status='active' AND s.expires_at<=$3::timestamptz
          AND ROW(s.account_auth_version,s.account_access_version,s.account_revocation_version,s.device_credential_version,s.device_risk_version,s.installation_credential_version,s.link_auth_version,s.link_access_version,s.link_row_version)
            = ROW(a.auth_version,a.access_version,a.revocation_version,d.credential_version,d.risk_version,i.credential_version,l.auth_version,l.access_version,l.row_version)`,
      [input.authorizationId, input.deviceId, input.nonceIssuedAt]);
      if (expired?.expiredOnly === true) {
        throw Object.assign(new Error('DESKTOP_ONLINE_SESSION_EXPIRED'), { code: 'DESKTOP_ONLINE_SESSION_EXPIRED' });
      }
      throw error;
    }
  }

  async function readChallenge({ challengeId }) {
    return one(
      `SELECT c.challenge_id AS "challengeId",
              c.authorization_id AS "authorizationId",
              c.authority_id AS "authorityId",
              c.account_id AS "accountId",
              c.device_id AS "deviceId",
              c.installation_id AS "installationId",
              c.link_id AS "linkId",
              c.credential_version AS "credentialVersion",
              i.installation_public_key AS "installationPublicKey",
              c.nonce_sha256 AS "nonceSha256",
              c.nonce_issued_at AS "nonceIssuedAt",
              c.expires_at AS "expiresAt",
              c.status,
              c.row_version AS "rowVersion"
         FROM vnext_control_plane.vnext_desktop_session_challenges c
         JOIN vnext_control_plane.vnext_device_installations i
           ON i.installation_id = c.installation_id
        WHERE c.challenge_id = $1::text`,
      [challengeId],
    );
  }

  async function consumeChallengeAndCreateSession(input) {
    return one(
      `SELECT *
         FROM vnext_control_plane.vnext_exchange_desktop_session_challenge(
           $1::text, $2::bigint, $3::text, $4::timestamptz,
           $5::text, $6::text, $7::text, $8::text,
           $9::text, $10::text, $11::text, $12::text, $13::text
         )`,
      [input.challengeId, input.expectedRowVersion, input.sessionId, input.sessionExpiresAt,
        input.receiptId, input.auditEventId, input.outboxEventId, input.signatureSha256,
        input.canonicalRequestSha256, input.canonicalResultJson, input.canonicalResultSha256,
        input.canonicalPayloadJson, input.canonicalPayloadSha256],
    );
  }

  async function readInstallationForSession(input) {
    return one(
      `SELECT *
         FROM vnext_control_plane.vnext_read_desktop_session_installation(
           $1::text, $2::text, $3::text
         )`,
      [input.authorityId, input.accountId, input.sessionId],
    );
  }

  async function rotateRoleSession(input) {
    return one(
      `SELECT *
         FROM vnext_control_plane.vnext_rotate_desktop_role_session(
           $1::text, $2::text, $3::text, $4::bigint, $5::text, $6::text,
           $7::text, $8::text, $9::text,
           $10::text, $11::text, $12::text, $13::text, $14::text
         )`,
      [input.authorityId, input.accountId, input.previousSessionId, input.expectedRowVersion,
        input.sessionId, input.activeRole, input.receiptId, input.auditEventId, input.outboxEventId,
        input.canonicalRequestSha256, input.canonicalResultJson, input.canonicalResultSha256,
        input.canonicalPayloadJson, input.canonicalPayloadSha256],
    );
  }

  async function listDevices(input) {
    const result = await writerPool.query(
      `SELECT *
         FROM vnext_control_plane.vnext_list_named_desktop_account_devices($1::text, $2::text)`,
      [input.authorityId, input.accountId],
    );
    return Object.freeze((result?.rows || []).map(normalize));
  }

  async function revokeDevice(input) {
    return one(
      `SELECT *
         FROM vnext_control_plane.vnext_revoke_desktop_device(
           $1::text, $2::text, $3::text, $4::text, $5::bigint, $6::text,
           $7::text, $8::text, $9::text,
           $10::text, $11::text, $12::text, $13::text, $14::text
         )`,
      [input.authorityId, input.actorAccountId, input.actorSessionId, input.deviceId,
        input.expectedRowVersion, input.reason, input.receiptId, input.auditEventId, input.outboxEventId,
        input.canonicalRequestSha256, input.canonicalResultJson, input.canonicalResultSha256,
        input.canonicalPayloadJson, input.canonicalPayloadSha256],
    );
  }

  return Object.freeze({
    createChallenge,
    readChallenge,
    consumeChallengeAndCreateSession,
    readInstallationForSession,
    rotateRoleSession,
    listDevices,
    revokeDevice,
  });
}

module.exports = Object.freeze({ createCloudDesktopIdentityPgRepository });
