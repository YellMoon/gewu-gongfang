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
  });
  return { registration, async close() { await Promise.all([identityPool.end(), writerPool.end()]); } };
}

const desktopRuntime = createDesktopRegistrationFromEnvironment();
const desktopPairing = desktopRuntime?.registration
  ? createDesktopPairingService({
    now: () => new Date(),
    randomId: prefix => `${prefix}-${require('crypto').randomUUID()}`,
    beginOnlineVerification: input => desktopRuntime.registration.begin(input),
  })
  : null;
const app = createCloudBusinessApp({
  query: (text, values) => pool.query(text, values),
  desktopRegistration: desktopRuntime?.registration || null,
  desktopPairing,
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
