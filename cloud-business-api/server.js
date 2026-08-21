'use strict';

const { Pool } = require('pg');
const { createCloudBusinessApp } = require('./src/app');
const { createCloudDesktopRegistrationService, createOperatorPhoneLookup } = require('./src/desktopRegistrationService');
const { createDesktopPairingService } = require('./src/desktopPairingService');
const { createWechatPhoneVerifier } = require('./src/wechatPhoneVerifier');

const port = Number(process.env.PORT || 3002);
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'gewu-postgres17',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'gewu_cloud',
  user: process.env.POSTGRES_USER || 'gewu_app',
  password: process.env.POSTGRES_PASSWORD,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});
const databaseConfig = {
  host: process.env.POSTGRES_HOST || 'gewu-postgres17',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'gewu_cloud',
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
};

function parseOperatorRecords(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function createDesktopRegistrationFromEnvironment() {
  const records = parseOperatorRecords(process.env.CLOUD_OPERATOR_PHONE_HMACS);
  const secrets = [process.env.CLOUD_IDENTITY_PHONE_PEPPER, process.env.CLOUD_IDENTITY_TICKET_SECRET, process.env.WECHAT_APPSECRET, process.env.IDENTITY_VERIFIER_POSTGRES_PASSWORD, process.env.COMMAND_WRITER_POSTGRES_PASSWORD];
  if (!records || typeof process.env.WECHAT_APPID !== 'string' || !process.env.WECHAT_APPID.trim() || secrets.some(value => typeof value !== 'string' || value.length < 24)) return null;
  const identityPool = new Pool({ ...databaseConfig, user: 'vnext_pg17_identity_verifier', password: process.env.IDENTITY_VERIFIER_POSTGRES_PASSWORD });
  const writerPool = new Pool({ ...databaseConfig, user: 'vnext_pg17_writer', password: process.env.COMMAND_WRITER_POSTGRES_PASSWORD });
  const randomId = prefix => `${prefix}-${require('crypto').randomUUID()}`;
  const registration = createCloudDesktopRegistrationService({
    randomId,
    now: () => new Date(),
    phoneVerifier: createWechatPhoneVerifier({ appId: process.env.WECHAT_APPID, appSecret: process.env.WECHAT_APPSECRET }),
    lookupAccount: createOperatorPhoneLookup({ pepper: process.env.CLOUD_IDENTITY_PHONE_PEPPER, records }),
    ticketSecret: process.env.CLOUD_IDENTITY_TICKET_SECRET,
    issueAssertion: input => identityPool.query(
      'SELECT vnext_control_plane.vnext_issue_online_identity_assertion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [input.assertionId, input.authorityId, input.accountId, input.deviceId, input.installationId, input.installationPublicKey, input.keyFingerprint, input.audience, input.nonceSha256, input.canonicalRequestSha256, input.identityProofSha256, input.hardwareEvidenceSha256, input.issuedAt, input.expiresAt],
    ),
    register: async input => {
      const result = await writerPool.query(
        'SELECT receipt_id AS "receiptId", session_id AS "sessionId", replayed FROM vnext_control_plane.vnext_register_unified_desktop_online($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [input.assertionId, input.idempotencyKey, input.receiptId, input.auditEventId, input.outboxEventId, input.sessionId, input.linkId, input.sessionExpiresAt, input.canonicalResultJson, input.resultSha256, input.canonicalPayloadJson, input.payloadSha256],
      );
      return result.rows[0] || null;
    },
    readSessionContext: async input => {
      const result = await writerPool.query(
        `SELECT s.authority_id AS "authorityId", s.account_id AS "accountId", s.device_id AS "deviceId", s.installation_id AS "installationId", s.session_id AS "sessionId", s.expires_at AS "expiresAt",
          COALESCE(array_agg(DISTINCT g.role ORDER BY g.role) FILTER (WHERE g.status='active' AND g.starts_at <= transaction_timestamp() AND (g.ends_at IS NULL OR g.ends_at > transaction_timestamp())), ARRAY[]::text[]) AS roles
         FROM vnext_control_plane.vnext_sessions s
         JOIN vnext_control_plane.vnext_authorities au ON au.authority_id=s.authority_id AND au.status='active'
         JOIN vnext_control_plane.vnext_accounts ac ON ac.authority_id=s.authority_id AND ac.account_id=s.account_id AND ac.status='active'
         JOIN vnext_control_plane.vnext_trusted_devices d ON d.authority_id=s.authority_id AND d.device_id=s.device_id AND d.status='active'
         JOIN vnext_control_plane.vnext_device_installations i ON i.authority_id=s.authority_id AND i.device_id=s.device_id AND i.installation_id=s.installation_id AND i.status='active'
         JOIN vnext_control_plane.vnext_account_device_links l ON l.authority_id=s.authority_id AND l.account_id=s.account_id AND l.device_id=s.device_id AND l.installation_id=s.installation_id AND l.link_id=s.link_id AND l.status='active'
         LEFT JOIN vnext_control_plane.vnext_role_grants g ON g.authority_id=s.authority_id AND g.account_id=s.account_id
         WHERE s.authority_id=$1 AND s.account_id=$2 AND s.device_id=$3 AND s.installation_id=$4 AND s.session_id=$5 AND s.expires_at=$6::timestamptz
           AND s.status='active' AND s.session_kind='online' AND s.expires_at > transaction_timestamp()
           AND ROW(s.account_auth_version,s.account_access_version,s.account_revocation_version,s.device_credential_version,s.device_risk_version,s.installation_credential_version,s.link_auth_version,s.link_access_version,s.link_row_version)=ROW(ac.auth_version,ac.access_version,ac.revocation_version,d.credential_version,d.risk_version,i.credential_version,l.auth_version,l.access_version,l.row_version)
         GROUP BY s.authority_id,s.account_id,s.device_id,s.installation_id,s.session_id,s.expires_at`,
        [input.authorityId, input.accountId, input.deviceId, input.installationId, input.sessionId, input.expiresAt],
      );
      const row = result.rows[0];
      if (!row || !(row.expiresAt instanceof Date)) return null;
      return { ...row, expiresAt: row.expiresAt.toISOString() };
    },
  });
  return { registration, async close() { await Promise.all([identityPool.end(), writerPool.end()]); } };
}

const desktopRuntime = createDesktopRegistrationFromEnvironment();
const desktopPairing = desktopRuntime?.registration
  ? createDesktopPairingService({
    now: () => new Date(),
    randomId: prefix => `${prefix}-${require('crypto').randomUUID()}`,
    beginOnlineVerification: input => desktopRuntime.registration.begin(input),
    inspectVerificationToken: token => desktopRuntime.registration.inspectVerificationToken(token),
  })
  : null;
const app = createCloudBusinessApp({
  query: (text, values) => pool.query(text, values),
  desktopRegistration: desktopRuntime?.registration || null,
  desktopPairing,
  businessTenantId: process.env.CLOUD_BUSINESS_TENANT_ID || 'default',
});
const server = app.listen(port, '0.0.0.0', () => console.log(`cloud business API listening on ${port}`));

async function shutdown() {
  server.close(async () => {
    await pool.end();
    if (desktopRuntime) await desktopRuntime.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
