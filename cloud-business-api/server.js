'use strict';

const { Pool } = require('pg');
const { createCloudBusinessApp } = require('./src/app');
const { createCloudDesktopRegistrationService, hmacPhone } = require('./src/desktopRegistrationService');
const { createBusinessScheduleUpdate } = require('./src/businessScheduleMutationService');
const { createBusinessScheduleStudentOverride } = require('./src/businessScheduleStudentOverrideService');
const { createBusinessScheduleLifecycleMutations } = require('./src/businessScheduleLifecycleMutationService');
const { createBusinessFoundationLifecycleMutations } = require('./src/businessFoundationLifecycleMutationService');
const { createBusinessSupplementalLifecycleMutations } = require('./src/businessSupplementalLifecycleMutationService');
const { createBusinessStudentUpdate } = require('./src/businessStudentMutationService');
const { createBusinessStudentRecordUpdate } = require('./src/businessStudentRecordMutationService');
const { createBusinessStudentLifecycleMutations } = require('./src/businessStudentLifecycleMutationService');
const { createBusinessTeacherLifecycleMutations } = require('./src/businessTeacherLifecycleMutationService');
const { createBusinessRoomLifecycleMutations } = require('./src/businessRoomLifecycleMutationService');
const { createBusinessCourseLifecycleMutations } = require('./src/businessCourseLifecycleMutationService');
const { createDesktopPairingService } = require('./src/desktopPairingService');
const { createMiniappCloudAccountService } = require('./src/miniappCloudAccountService');
const { createMiniappCloudAccountRepository } = require('./src/miniappCloudAccountRepository');
const { createWechatPhoneVerifier } = require('./src/wechatPhoneVerifier');
const { createWechatIdentityVerifier } = require('./src/wechatIdentityVerifier');
const { createCanonicalAccountProvisioningService } = require('./src/canonicalAccountProvisioningService');
const { createCanonicalWechatIdentityService } = require('./src/canonicalWechatIdentityService');
const { createDesktopPasswordIdentityService } = require('./src/desktopPasswordIdentityService');
const { createDesktopPasswordAuthenticationService } = require('./src/desktopPasswordAuthenticationService');
const { createStorageAgentRuntimeFromEnvironment } = require('./src/storageAgentRuntime');
const { createQuestionAuthorityRuntime } = require('./src/questionAuthorityRuntime');
const { createQuestionImportTaskRepository } = require('./src/questionImportTaskRepository');
const { createPaperExportTaskRepository } = require('./src/paperExportTaskRepository');
const { createPaperExportArtifactRepository } = require('./src/paperExportArtifactRepository');
const { createPaperExportTaskProcessor } = require('./src/paperExportTaskProcessor');
const { createPaperExportWorkerRuntime } = require('./src/paperExportWorkerRuntime');
const { renderPaperExport } = require('./src/paperExportRenderer');
const { createEncryptedStorageRelayRepository } = require('./src/encryptedStorageRelayRepository');
const { createMiniappArtifactDeliveryRepository } = require('./src/miniappArtifactDeliveryRepository');
const { createPersonalAssetImportRepository } = require('./src/personalAssetImportRepository');
const { BOOTSTRAP_SUPER_ADMIN_PHONE, resolveBootstrapAdminAccountId } = require('./src/bootstrapAdminIdentity');
const { version } = require('./package.json');

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
async function questionCommandTransaction(work) {
  if (typeof work !== 'function') throw new TypeError('transaction work is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work((text, values) => client.query(text, values));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* Preserve the original command failure. */ }
    throw error;
  } finally {
    client.release();
  }
}
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

function createCanonicalAccountProvisioning({ records, identityPool, randomId, phonePepper, evidenceSecret }) {
  if (!Array.isArray(records) || records.length === 0 || typeof randomId !== 'function'
    || typeof phonePepper !== 'string' || phonePepper.length < 24
    || typeof evidenceSecret !== 'string' || evidenceSecret.length < 24) return null;
  const byPhoneHash = new Map();
  let authorityId = null;
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || Object.keys(record).length !== 3 || typeof record.phoneHmac !== 'string'
      || !/^[0-9a-f]{64}$/u.test(record.phoneHmac)
      || typeof record.authorityId !== 'string' || !record.authorityId.trim()
      || typeof record.accountId !== 'string' || !record.accountId.trim()
      || byPhoneHash.has(record.phoneHmac)) return null;
    if (authorityId !== null && authorityId !== record.authorityId) return null;
    authorityId = record.authorityId;
    byPhoneHash.set(record.phoneHmac, Object.freeze({ accountId: record.accountId }));
  }
  return createCanonicalAccountProvisioningService({
    phoneHash: phone => hmacPhone(phonePepper, phone),
    randomId,
    legacyAccountForPhoneHash: ({ phoneHash }) => byPhoneHash.get(phoneHash) || null,
    provisionPhoneAccount: async input => {
      const result = await identityPool.query(
        'SELECT authority_id AS "authorityId", account_id AS "accountId" FROM vnext_control_plane.vnext_provision_canonical_phone_account($1,$2,$3,$4)',
        [input.accountId, input.contactId, input.phoneHash, input.verificationEvidenceHash],
      );
      return result.rows[0] || null;
    },
  });
}

function verificationEvidenceHash(secret, surface, value) {
  return require('crypto').createHmac('sha256', secret)
    .update(`${surface}:${value}`, 'utf8').digest('hex');
}

function createDesktopRegistrationFromEnvironment() {
  const records = parseOperatorRecords(process.env.CLOUD_OPERATOR_PHONE_HMACS);
  const secrets = [process.env.CLOUD_IDENTITY_PHONE_PEPPER, process.env.CLOUD_IDENTITY_TICKET_SECRET, process.env.CLOUD_MINIAPP_TICKET_SECRET, process.env.CLOUD_IDENTITY_LEASE_PRIVATE_KEY_B64, process.env.WECHAT_APPSECRET, process.env.IDENTITY_VERIFIER_POSTGRES_PASSWORD, process.env.COMMAND_WRITER_POSTGRES_PASSWORD];
  if (!records || typeof process.env.WECHAT_APPID !== 'string' || !process.env.WECHAT_APPID.trim() || secrets.some(value => typeof value !== 'string' || value.length < 24)) return null;
  let leasePrivateKey;
  try {
    leasePrivateKey = require('crypto').createPrivateKey({
      key: Buffer.from(process.env.CLOUD_IDENTITY_LEASE_PRIVATE_KEY_B64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
  } catch (_) {
    return null;
  }
  const identityPool = new Pool({ ...databaseConfig, user: 'vnext_pg17_identity_verifier', password: process.env.IDENTITY_VERIFIER_POSTGRES_PASSWORD });
  const writerPool = new Pool({ ...databaseConfig, user: 'vnext_pg17_writer', password: process.env.COMMAND_WRITER_POSTGRES_PASSWORD });
  const accountRepository = createMiniappCloudAccountRepository({
    query: (text, values) => pool.query(text, values),
    tenantId: process.env.CLOUD_BUSINESS_TENANT_ID || 'default',
  });
  const randomId = prefix => `${prefix}-${require('crypto').randomUUID()}`;
  const canonicalAccount = createCanonicalAccountProvisioning({
    records, identityPool, randomId,
    phonePepper: process.env.CLOUD_IDENTITY_PHONE_PEPPER,
    evidenceSecret: process.env.CLOUD_IDENTITY_TICKET_SECRET,
  });
  if (!canonicalAccount) {
    identityPool.end().catch(() => {});
    writerPool.end().catch(() => {});
    return null;
  }
  let bootstrapAdminAccountId;
  try {
    bootstrapAdminAccountId = resolveBootstrapAdminAccountId({
      records,
      phoneHmac: hmacPhone(process.env.CLOUD_IDENTITY_PHONE_PEPPER, BOOTSTRAP_SUPER_ADMIN_PHONE),
    });
  } catch (_) {
    identityPool.end().catch(() => {});
    writerPool.end().catch(() => {});
    return null;
  }
  if (!bootstrapAdminAccountId) {
    identityPool.end().catch(() => {});
    writerPool.end().catch(() => {});
    return null;
  }
  const registration = createCloudDesktopRegistrationService({
    randomId,
    now: () => new Date(),
    phoneVerifier: createWechatPhoneVerifier({ appId: process.env.WECHAT_APPID, appSecret: process.env.WECHAT_APPSECRET }),
    lookupAccount: async phone => {
      const canonical = await canonicalAccount.resolveOrProvision({
        verifiedPhone: phone,
        verificationEvidenceHash: verificationEvidenceHash(process.env.CLOUD_IDENTITY_TICKET_SECRET, 'wechat-desktop-phone', phone),
      });
      return { authorityId: canonical.authorityId, accountId: canonical.accountId, phoneHmac: canonical.phoneHmac };
    },
    ticketSecret: process.env.CLOUD_IDENTITY_TICKET_SECRET,
    leasePrivateKey,
    issueAssertion: input => identityPool.query(
      'SELECT vnext_control_plane.vnext_issue_online_identity_assertion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [input.assertionId, input.authorityId, input.accountId, input.deviceId, input.installationId, input.installationPublicKey, input.keyFingerprint, input.audience, input.nonceSha256, input.canonicalRequestSha256, input.identityProofSha256, input.hardwareEvidenceSha256, input.issuedAt, input.expiresAt],
    ),
    register: async input => {
      const result = await writerPool.query(
        'SELECT receipt_id AS "receiptId", session_id AS "sessionId", replayed FROM vnext_control_plane.vnext_register_unified_desktop_online($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [input.assertionId, input.idempotencyKey, input.receiptId, input.auditEventId, input.outboxEventId, input.sessionId, input.linkId, input.sessionExpiresAt, input.canonicalResultJson, input.resultSha256, input.canonicalPayloadJson, input.payloadSha256],
      );
      return result.rows[0] ? { ...result.rows[0], phoneHash } : null;
    },
    readSessionContext: async input => {
      const result = await writerPool.query(
        `SELECT s.authority_id AS "authorityId", s.account_id AS "accountId", s.device_id AS "deviceId", s.installation_id AS "installationId", s.session_id AS "sessionId", s.expires_at AS "expiresAt", NULL::text AS "teacherId", NULL::text AS "studentId",
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
      const account = await accountRepository.readContext({ accountId: input.accountId });
      if (!account || account.status !== 'active') return null;
      return {
        authorityId: row.authorityId,
        accountId: row.accountId,
        deviceId: row.deviceId,
        installationId: row.installationId,
        sessionId: row.sessionId,
        expiresAt: row.expiresAt.toISOString(),
        roles: Array.isArray(account.roles) && account.roles.length ? account.roles : ['pending'],
        teacherId: account.profile?.type === 'teacher' ? account.profile.id : null,
        studentId: account.profile?.type === 'student' ? account.profile.id : null,
      };
    },
  });
  const desktopPasswordIdentity = createDesktopPasswordIdentityService({
    phoneHash: phone => hmacPhone(process.env.CLOUD_IDENTITY_PHONE_PEPPER, phone),
    randomBytes: size => require('crypto').randomBytes(size),
    saveCredential: async input => {
      await identityPool.query(
        'SELECT authority_id AS "authorityId", account_id AS "accountId" FROM vnext_control_plane.vnext_set_desktop_password_credential($1,$2,$3,$4,$5,$6)',
        [input.authorityId, input.accountId, input.loginName, input.algorithm, input.saltB64, input.passwordHashB64],
      );
    },
    lookupByPhoneHash: async phoneHash => {
      const result = await identityPool.query(
        'SELECT authority_id AS "authorityId", account_id AS "accountId", login_name AS "loginName", password_algorithm AS "algorithm", password_salt_base64 AS "saltB64", password_hash_base64 AS "passwordHashB64" FROM vnext_control_plane.vnext_read_desktop_password_by_phone_hash($1)',
        [phoneHash],
      );
      return result.rows[0] ? { ...result.rows[0], phoneHash: null } : null;
    },
    lookupByLoginName: async loginName => {
      const result = await identityPool.query(
        'SELECT authority_id AS "authorityId", account_id AS "accountId", login_name AS "loginName", password_algorithm AS "algorithm", password_salt_base64 AS "saltB64", password_hash_base64 AS "passwordHashB64" FROM vnext_control_plane.vnext_read_desktop_password_by_login_name($1)',
        [loginName],
      );
      return result.rows[0] || null;
    },
  });
  const desktopPasswordAuthentication = createDesktopPasswordAuthenticationService({
    phoneVerifier: createWechatPhoneVerifier({ appId: process.env.WECHAT_APPID, appSecret: process.env.WECHAT_APPSECRET }),
    resolveCanonicalAccount: input => canonicalAccount.resolveOrProvision(input),
    verificationEvidenceHash: phoneCode => verificationEvidenceHash(process.env.CLOUD_IDENTITY_TICKET_SECRET, 'wechat-desktop-password-enrollment', phoneCode),
    inspectVerificationToken: token => registration.inspectVerificationToken(token),
    passwordIdentity: desktopPasswordIdentity,
    issueRegistrationTicket: input => registration.issueVerificationForVerifiedAccount(input),
  });
  const canonicalWechatIdentity = createCanonicalWechatIdentityService({
    wechatVerifier: createWechatIdentityVerifier({ appId: process.env.WECHAT_APPID, appSecret: process.env.WECHAT_APPSECRET }),
    contactHash: (type, value) => verificationEvidenceHash(process.env.CLOUD_IDENTITY_PHONE_PEPPER, `canonical-${type}`, value),
    verificationEvidenceHash: loginCode => verificationEvidenceHash(process.env.CLOUD_MINIAPP_TICKET_SECRET, 'wechat-miniapp-login-code', loginCode),
    resolveByContact: async input => {
      const result = await identityPool.query(
        'SELECT authority_id AS "authorityId", account_id AS "accountId", phone_hash AS "phoneHmac" FROM vnext_control_plane.vnext_read_canonical_account_by_verified_contact($1,$2)',
        [input.contactType, input.contactHash],
      );
      return result.rows[0] || null;
    },
    resolveCanonicalPhone: async phoneCode => {
      const phone = await createWechatPhoneVerifier({ appId: process.env.WECHAT_APPID, appSecret: process.env.WECHAT_APPSECRET })(phoneCode);
      const canonical = await canonicalAccount.resolveOrProvision({
        verifiedPhone: phone,
        verificationEvidenceHash: verificationEvidenceHash(process.env.CLOUD_MINIAPP_TICKET_SECRET, 'wechat-miniapp-phone-code', phoneCode),
      });
      return canonical;
    },
    bind: async input => {
      const result = await identityPool.query(
        'SELECT authority_id AS "authorityId", account_id AS "accountId" FROM vnext_control_plane.vnext_bind_canonical_wechat_identity($1,$2,$3,$4,$5,$6,$7)',
        [input.authorityId, input.accountId, input.openidContactId, input.openidHash, input.unionidContactId, input.unionidHash, input.verificationEvidenceHash],
      );
      return result.rows[0] || null;
    },
    randomId,
  });
  const businessScheduleUpdate = createBusinessScheduleUpdate({
    query: (text, values) => writerPool.query(text, values),
  });
  const businessScheduleStudentOverride = createBusinessScheduleStudentOverride({
    query: (text, values) => writerPool.query(text, values),
  });
  const businessScheduleLifecycleMutations = createBusinessScheduleLifecycleMutations({
    query: (text, values) => writerPool.query(text, values),
  });
  const businessFoundationLifecycleMutations = createBusinessFoundationLifecycleMutations({
    query: (text, values) => writerPool.query(text, values),
  });
  const businessSupplementalLifecycleMutations = createBusinessSupplementalLifecycleMutations({
    query: (text, values) => writerPool.query(text, values),
  });
  const businessStudentUpdate = createBusinessStudentUpdate({
    query: (text, values) => writerPool.query(text, values),
  });
  const businessStudentRecordUpdate = createBusinessStudentRecordUpdate({
    query: (text, values) => writerPool.query(text, values),
  });
  const businessStudentLifecycleMutations = createBusinessStudentLifecycleMutations({ query: (text, values) => writerPool.query(text, values) });
  const businessTeacherLifecycleMutations = createBusinessTeacherLifecycleMutations({ query: (text, values) => writerPool.query(text, values) });
  const businessRoomLifecycleMutations = createBusinessRoomLifecycleMutations({ query: (text, values) => writerPool.query(text, values) });
  const businessCourseLifecycleMutations = createBusinessCourseLifecycleMutations({ query: (text, values) => writerPool.query(text, values) });
  return {
    registration,
    desktopPasswordAuthentication,
    canonicalAccount,
    canonicalWechatIdentity,
    accountRepository,
    bootstrapAdminAccountId,
    businessScheduleUpdate,
    businessScheduleStudentOverride,
    businessScheduleLifecycleMutations,
    businessFoundationLifecycleMutations,
    businessSupplementalLifecycleMutations,
    businessStudentUpdate,
    businessStudentRecordUpdate,
    businessStudentLifecycleMutations,
    businessTeacherLifecycleMutations,
    businessRoomLifecycleMutations,
    businessCourseLifecycleMutations,
    async close() { await Promise.all([identityPool.end(), writerPool.end()]); },
  };
}

function createMiniappCloudAccountFromEnvironment(desktopRuntime) {
  const secrets = [process.env.CLOUD_IDENTITY_PHONE_PEPPER, process.env.CLOUD_MINIAPP_TICKET_SECRET, process.env.WECHAT_APPSECRET];
  if (typeof process.env.WECHAT_APPID !== 'string' || !process.env.WECHAT_APPID.trim()
    || !desktopRuntime || !desktopRuntime.canonicalWechatIdentity || typeof desktopRuntime.bootstrapAdminAccountId !== 'string' || !desktopRuntime.bootstrapAdminAccountId.trim()
    || secrets.some(value => typeof value !== 'string' || value.length < 24)) return null;
  return createMiniappCloudAccountService({
    now: () => new Date(),
    bootstrapAdminAccountId: desktopRuntime.bootstrapAdminAccountId,
    canonicalWechatIdentity: desktopRuntime.canonicalWechatIdentity,
    accountRepository: desktopRuntime.accountRepository,
    ticketSecret: process.env.CLOUD_MINIAPP_TICKET_SECRET,
  });
}

const desktopRuntime = createDesktopRegistrationFromEnvironment();
const miniappCloudAccount = createMiniappCloudAccountFromEnvironment(desktopRuntime);
const miniappArtifactDeliveries = createMiniappArtifactDeliveryRepository({
  query: (text, values) => pool.query(text, values),
});
const storageAgent = createStorageAgentRuntimeFromEnvironment({
  env: process.env,
  query: (text, values) => pool.query(text, values),
  artifactDeliveries: miniappArtifactDeliveries,
});
const questionAuthority = createQuestionAuthorityRuntime({
  query: (text, values) => pool.query(text, values),
  transaction: questionCommandTransaction,
});
const questionImportTasks = createQuestionImportTaskRepository({
  query: (text, values) => pool.query(text, values),
});
const paperExportTasks = createPaperExportTaskRepository({
  query: (text, values) => pool.query(text, values),
});
const personalAssetImports = createPersonalAssetImportRepository({ transaction: questionCommandTransaction });
function configuredStorageAgentKeyFingerprint(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4096) return null;
  const bytes = Buffer.from(value, 'base64url');
  if (!bytes.length || bytes.toString('base64url') !== value) return null;
  return require('crypto').createHash('sha256').update(bytes).digest('hex');
}
const storageAgentKeyFingerprint = configuredStorageAgentKeyFingerprint(process.env.CLOUD_STORAGE_AGENT_PUBLIC_KEY);
const encryptedStorageRelay = storageAgentKeyFingerprint
  ? createEncryptedStorageRelayRepository({ query: (text, values) => pool.query(text, values) })
  : null;
const paperExportArtifactRepository = storageAgentKeyFingerprint
  ? createPaperExportArtifactRepository({ query: (text, values) => pool.query(text, values), agentPublicKey: process.env.CLOUD_STORAGE_AGENT_PUBLIC_KEY })
  : null;
const paperExportWorker = process.env.CLOUD_PAPER_EXPORT_WORKER_ENABLED === '1' && paperExportArtifactRepository
  ? createPaperExportWorkerRuntime({
    processor: createPaperExportTaskProcessor({
      tasks: paperExportTasks,
      render: renderPaperExport,
      archiveArtifact: input => paperExportArtifactRepository.archive(input),
    }),
    log: message => console.error(message),
  })
  : null;
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
  releaseVersion: version,
  businessScheduleUpdate: desktopRuntime?.businessScheduleUpdate || null,
  businessScheduleStudentOverride: desktopRuntime?.businessScheduleStudentOverride || null,
  businessScheduleLifecycleMutations: desktopRuntime?.businessScheduleLifecycleMutations || null,
  businessFoundationLifecycleMutations: desktopRuntime?.businessFoundationLifecycleMutations || null,
  businessSupplementalLifecycleMutations: desktopRuntime?.businessSupplementalLifecycleMutations || null,
  businessStudentUpdate: desktopRuntime?.businessStudentUpdate || null,
  businessStudentRecordUpdate: desktopRuntime?.businessStudentRecordUpdate || null,
  businessStudentLifecycleMutations: desktopRuntime?.businessStudentLifecycleMutations || null,
  businessTeacherLifecycleMutations: desktopRuntime?.businessTeacherLifecycleMutations || null,
  businessRoomLifecycleMutations: desktopRuntime?.businessRoomLifecycleMutations || null,
  businessCourseLifecycleMutations: desktopRuntime?.businessCourseLifecycleMutations || null,
  desktopRegistration: desktopRuntime?.registration || null,
  desktopPasswordAuthentication: desktopRuntime?.desktopPasswordAuthentication || null,
  miniappCloudAccount,
  miniappArtifactDeliveries,
  personalAssetImports,
  storageAgent,
  questionAuthority,
  questionImportTasks,
  paperExportTasks,
  encryptedStorageRelay,
  storageAgentKeyFingerprint,
  storageAgentPublicKey: storageAgentKeyFingerprint ? process.env.CLOUD_STORAGE_AGENT_PUBLIC_KEY : null,
  desktopPairing,
  businessTenantId: process.env.CLOUD_BUSINESS_TENANT_ID || 'default',
});
const server = app.listen(port, '0.0.0.0', () => console.log(`cloud business API listening on ${port}`));
paperExportWorker?.start();

async function shutdown() {
  paperExportWorker?.stop();
  server.close(async () => {
    await pool.end();
    if (desktopRuntime) await desktopRuntime.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
