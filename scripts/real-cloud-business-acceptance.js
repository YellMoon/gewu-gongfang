'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLIC_BASE_URL = 'https://physicsedu.xyz/scheduling';
const LOCAL_BASE_URL = 'http://127.0.0.1:3002';
const MARKER_PATTERN = /^codex-e2e-[0-9]+\.[0-9]+\.[0-9]+-[a-z0-9]{4,32}$/;

function acceptanceFailure(code, details) {
  return Object.assign(new Error(code), { code, details });
}

async function runStage(code, work) {
  try {
    return await work();
  } catch (error) {
    if (error?.code === code) throw error;
    throw acceptanceFailure(code, {
      databaseCode: typeof error?.code === 'string' ? error.code : null,
    });
  }
}

async function runWithCleanup(work, cleanup) {
  let result;
  let primaryError;
  try {
    result = await work();
  } catch (error) {
    primaryError = error;
  }

  let cleanupError;
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
  }

  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return result;
}

function makeSessionToken(secret, session) {
  if (typeof secret !== 'string' || secret.length < 24 || !session || typeof session !== 'object') {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_SESSION_INVALID');
  }
  const expiresAt = Date.parse(session.expiresAt);
  const fields = ['authorityId', 'accountId', 'deviceId', 'installationId', 'sessionId'];
  if (!Number.isFinite(expiresAt) || fields.some(key => typeof session[key] !== 'string' || !session[key].trim())) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_SESSION_INVALID');
  }
  const encoded = Buffer.from(JSON.stringify({
    v: 1,
    authorityId: session.authorityId,
    accountId: session.accountId,
    deviceId: session.deviceId,
    installationId: session.installationId,
    sessionId: session.sessionId,
    expiresAt,
  }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded, 'utf8').digest('base64url');
  return `${encoded}.${signature}`;
}

function makeMiniappSessionToken(secret, accountId, now = new Date()) {
  if (typeof secret !== 'string' || secret.length < 24 || typeof accountId !== 'string' || accountId !== accountId.trim()
    || !accountId || accountId.length > 512 || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_MINIAPP_SESSION_INVALID');
  }
  const encoded = Buffer.from(JSON.stringify({
    v: 1,
    kind: 'miniapp-cloud',
    accountId,
    expiresAt: now.getTime() + 10 * 60 * 1000,
  }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded, 'utf8').digest('base64url');
  return `${encoded}.${signature}`;
}

function inspectSessionTokenWithRuntime(runtimeModules, secret, sessionToken) {
  const modulePath = path.join(path.dirname(runtimeModules.packagePath), 'src', 'desktopRegistrationService');
  const { createCloudDesktopRegistrationService } = require(modulePath);
  const service = createCloudDesktopRegistrationService({
    now: () => new Date(),
    randomId: prefix => `${prefix}-acceptance`,
    phoneVerifier: async () => '13700000000',
    lookupAccount: async () => ({ authorityId: 'unused', accountId: 'unused', phoneHmac: null }),
    ticketSecret: secret,
    leasePrivateKey: crypto.generateKeyPairSync('ed25519').privateKey,
    issueAssertion: async () => {},
    register: async () => null,
    readSessionContext: async () => null,
  });
  return service.inspectSessionToken(sessionToken);
}

function createOnlineRegistrationRequest(runtimeModules, ticketSecret, identity, randomUUID = crypto.randomUUID) {
  if (!runtimeModules || typeof runtimeModules.packagePath !== 'string' || typeof ticketSecret !== 'string' || ticketSecret.length < 24
    || !identity || typeof identity.authorityId !== 'string' || !identity.authorityId.trim()
    || typeof identity.accountId !== 'string' || !identity.accountId.trim()
    || !(identity.phoneHmac === null || /^[0-9a-f]{64}$/u.test(identity.phoneHmac)) || typeof randomUUID !== 'function') {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  }
  const suffix = String(randomUUID()).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 36);
  if (suffix.length < 4) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  const modulePath = path.join(path.dirname(runtimeModules.packagePath), 'src', 'desktopRegistrationService');
  const { createCloudDesktopRegistrationService } = require(modulePath);
  const service = createCloudDesktopRegistrationService({
    now: () => new Date(),
    randomId: prefix => `${prefix}-${suffix}`,
    phoneVerifier: async () => { throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID'); },
    lookupAccount: async () => { throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID'); },
    ticketSecret,
    leasePrivateKey: crypto.generateKeyPairSync('ed25519').privateKey,
    issueAssertion: async () => {},
    register: async () => null,
    readSessionContext: async () => null,
  });
  const verification = service.issueVerificationForVerifiedAccount(identity);
  const keys = crypto.generateKeyPairSync('ed25519');
  const installationPublicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keyFingerprint = crypto.createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  return Object.freeze({
    body: Object.freeze({
      verificationToken: verification.verificationToken,
      installationId: `acceptance-registration-${suffix}`,
      installationPublicKey,
      deviceProof: crypto.sign(null, Buffer.from(verification.deviceChallenge, 'utf8'), keys.privateKey).toString('base64url'),
      idempotencyKey: `acceptance-registration-${suffix}`,
    }),
    deviceChallenge: verification.deviceChallenge,
    deviceId: `desktop-device-${keyFingerprint.slice(0, 32)}`,
  });
}

async function runOnlineRegistrationAcceptance({
  fetchImpl,
  runtimeModules,
  ticketSecret,
  identity,
  baseUrl = PUBLIC_BASE_URL,
  randomUUID = crypto.randomUUID,
  onRegistrationPersisted = () => {},
} = {}) {
  if (typeof fetchImpl !== 'function' || baseUrl !== PUBLIC_BASE_URL || typeof onRegistrationPersisted !== 'function') {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  }
  const fixture = createOnlineRegistrationRequest(runtimeModules, ticketSecret, identity, randomUUID);
  const response = await fetchImpl(`${baseUrl}/api/desktop/online-registration`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(fixture.body),
  });
  const payload = await readJson(response);
  if (response.status !== 200 || payload?.ok !== true || typeof payload.receiptId !== 'string' || !payload.receiptId
    || typeof payload.sessionId !== 'string' || !/^[A-Za-z0-9_-]{4,256}$/u.test(payload.sessionId) || payload.replayed !== false
    || typeof payload.sessionToken !== 'string' || !payload.sessionToken
    || !payload.offlineLease || typeof payload.offlineLease !== 'object' || typeof payload.offlineLease.signature !== 'string') {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ONLINE_REGISTRATION_FAILED', {
      status: response.status,
      responseCode: payload?.code || null,
    });
  }
  const cleanupFixture = Object.freeze({
    sessionId: payload.sessionId,
    installationId: fixture.body.installationId,
    deviceId: fixture.deviceId,
  });
  onRegistrationPersisted(cleanupFixture);
  const inspected = inspectSessionTokenWithRuntime(runtimeModules, ticketSecret, payload.sessionToken);
  if (inspected.authorityId !== identity.authorityId || inspected.accountId !== identity.accountId
    || inspected.deviceId !== fixture.deviceId || inspected.installationId !== fixture.body.installationId
    || inspected.sessionId !== payload.sessionId) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ONLINE_REGISTRATION_TOKEN_INVALID');
  }
  const context = await requestJson(fetchImpl, payload.sessionToken, `${baseUrl}/api/desktop/session-context`);
  if (context.status !== 200 || context.body?.ok !== true || context.body.authorityId !== identity.authorityId
    || context.body.accountId !== identity.accountId || context.body.deviceId !== fixture.deviceId
    || context.body.installationId !== fixture.body.installationId || context.body.sessionId !== payload.sessionId
    || !Array.isArray(context.body.roles) || !context.body.roles.includes('super_admin')) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ONLINE_REGISTRATION_CONTEXT_FAILED', {
      status: context.status,
      responseCode: context.body?.code || null,
      roles: Array.isArray(context.body?.roles) ? context.body.roles.filter(role => typeof role === 'string') : [],
    });
  }
  return Object.freeze({
    sessionToken: payload.sessionToken,
    fixture: cleanupFixture,
    evidence: Object.freeze({
      onlineRegistrationStatus: response.status,
      onlineSessionContextStatus: context.status,
      onlineRegistrationReplayed: payload.replayed,
      onlineReceiptSha256: crypto.createHash('sha256').update(payload.receiptId, 'utf8').digest('hex'),
    }),
  });
}

function pidOneEnvironmentMatches(name, expected, readFileSync = fs.readFileSync) {
  if (!/^[A-Z0-9_]+$/.test(name) || typeof expected !== 'string') return false;
  const entries = String(readFileSync('/proc/1/environ')).split('\0');
  const prefix = `${name}=`;
  const matches = entries.filter(entry => entry.startsWith(prefix));
  return matches.length === 1 && matches[0].slice(prefix.length) === expected;
}

async function verifyDesktopProjectionSources(pool) {
  const tables = [
    'students', 'student_contact_directory', 'teachers', 'courses', 'course_student_pricings', 'schedules',
    'schedule_student_overrides', 'institutions', 'schools', 'rooms', 'grades', 'payments', 'consumptions',
    'personal_asset_records', 'personal_asset_manual_records', 'personal_asset_categories',
    'personal_asset_manual_categories', 'question_taxonomy_systems', 'question_taxonomy_nodes',
  ];
  for (const table of tables) {
    await runStage(`REAL_CLOUD_ACCEPTANCE_PROJECTION_SOURCE_${table.toUpperCase()}_FAILED`, () => pool.query(`SELECT to_jsonb(source) FROM business.${table} source LIMIT 1`));
  }
  return true;
}

function makeMarker(version, randomUUID) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version) || typeof randomUUID !== 'function') {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  }
  const suffix = String(randomUUID()).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
  const marker = `codex-e2e-${version}-${suffix}`;
  if (!MARKER_PATTERN.test(marker)) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  return marker;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (_) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_RESPONSE_INVALID');
  }
}

async function requestJson(fetchImpl, sessionToken, url, { method = 'GET', body } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await readJson(response) };
}

function institutionFromProjection(payload, marker) {
  const institutions = payload?.projection?.institutions;
  if (!Array.isArray(institutions)) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_PROJECTION_INVALID');
  return institutions.find(item => item && item.id === marker) || null;
}

function observedTimestamp(record) {
  const value = record?.updatedAt || record?.updated_at;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_TIMESTAMP_INVALID');
  }
  return value;
}

function requireResponse(actual, status, code) {
  if (actual.status !== status || !actual.body || actual.body.ok !== (status >= 200 && status < 300)) {
    throw acceptanceFailure(code, { status: actual.status, responseCode: actual.body?.code || null });
  }
  return actual;
}

async function runPublicAcceptance({
  fetchImpl,
  sessionToken,
  baseUrl = PUBLIC_BASE_URL,
  version,
  randomUUID = crypto.randomUUID,
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
  marker: suppliedMarker,
} = {}) {
  if (typeof fetchImpl !== 'function' || typeof sessionToken !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(sessionToken)
    || baseUrl !== PUBLIC_BASE_URL || typeof sleep !== 'function') {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  }
  const marker = suppliedMarker || makeMarker(version, randomUUID);
  if (!MARKER_PATTERN.test(marker) || !marker.startsWith(`codex-e2e-${version}-`)) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  }
  const collectionUrl = `${baseUrl}/api/business/institutions`;
  const recordUrl = `${collectionUrl}/${encodeURIComponent(marker)}`;
  let created = false;
  let deleted = false;
  let latestUpdatedAt = null;
  let cleanupConfirmed = false;
  try {
    const createResult = requireResponse(await requestJson(fetchImpl, sessionToken, collectionUrl, {
      method: 'POST',
      body: {
        institutionId: marker,
        data: { name: marker, contactPerson: null, contactPhone: null, revenueShare: null, notes: 'controlled temporary acceptance' },
      },
    }), 201, 'REAL_CLOUD_ACCEPTANCE_CREATE_FAILED');
    created = true;
    const originalUpdatedAt = observedTimestamp(createResult.body.institution);
    latestUpdatedAt = originalUpdatedAt;

    const firstProjection = requireResponse(await requestJson(fetchImpl, sessionToken, `${baseUrl}/api/business/desktop-projection`), 200, 'REAL_CLOUD_ACCEPTANCE_READ_FAILED');
    const createdRecord = institutionFromProjection(firstProjection.body, marker);
    if (!createdRecord) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_READ_BACK_MISSING');
    if (Date.parse(observedTimestamp(createdRecord)) !== Date.parse(originalUpdatedAt)) {
      throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_READ_BACK_TIMESTAMP_MISMATCH');
    }

    await sleep(20);
    const updateResult = requireResponse(await requestJson(fetchImpl, sessionToken, recordUrl, {
      method: 'PUT',
      body: { expectedUpdatedAt: originalUpdatedAt, name: `${marker}-updated`, contactPerson: null, contactPhone: null, revenueShare: null, notes: 'controlled temporary acceptance updated' },
    }), 200, 'REAL_CLOUD_ACCEPTANCE_UPDATE_FAILED');
    latestUpdatedAt = observedTimestamp(updateResult.body.institution);

    const staleConflict = requireResponse(await requestJson(fetchImpl, sessionToken, recordUrl, {
      method: 'PUT',
      body: { expectedUpdatedAt: originalUpdatedAt, name: `${marker}-stale`, contactPerson: null, contactPhone: null, revenueShare: null, notes: 'stale write must conflict' },
    }), 409, 'REAL_CLOUD_ACCEPTANCE_STALE_WRITE_NOT_REJECTED');
    if (staleConflict.body.code !== 'CLOUD_BUSINESS_INSTITUTION_CONFLICT') {
      throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_STALE_WRITE_NOT_REJECTED');
    }

    const deleteResult = requireResponse(await requestJson(fetchImpl, sessionToken, recordUrl, {
      method: 'DELETE',
      body: { expectedUpdatedAt: latestUpdatedAt },
    }), 200, 'REAL_CLOUD_ACCEPTANCE_DELETE_FAILED');
    deleted = true;
    const absenceProjection = requireResponse(await requestJson(fetchImpl, sessionToken, `${baseUrl}/api/business/desktop-projection`), 200, 'REAL_CLOUD_ACCEPTANCE_ABSENCE_FAILED');
    cleanupConfirmed = institutionFromProjection(absenceProjection.body, marker) === null;
    if (!cleanupConfirmed) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ABSENCE_FAILED');

    return {
      ok: true,
      version,
      createStatus: createResult.status,
      readBack: true,
      updateStatus: updateResult.status,
      staleConflictStatus: staleConflict.status,
      deleteStatus: deleteResult.status,
      absenceConfirmed: true,
      cleanupConfirmed,
      markerSha256: crypto.createHash('sha256').update(marker, 'utf8').digest('hex'),
    };
  } finally {
    if (created && !deleted) {
      try {
        const projection = await requestJson(fetchImpl, sessionToken, `${baseUrl}/api/business/desktop-projection`);
        const current = projection.status === 200 ? institutionFromProjection(projection.body, marker) : null;
        const expectedUpdatedAt = current ? observedTimestamp(current) : latestUpdatedAt;
        if (expectedUpdatedAt) {
          const removal = await requestJson(fetchImpl, sessionToken, recordUrl, { method: 'DELETE', body: { expectedUpdatedAt } });
          deleted = removal.status === 200;
        }
        const after = await requestJson(fetchImpl, sessionToken, `${baseUrl}/api/business/desktop-projection`);
        cleanupConfirmed = after.status === 200 && institutionFromProjection(after.body, marker) === null;
      } catch (_) {
        cleanupConfirmed = false;
      }
    }
  }
}

function miniappAssetRecordMatches(record, categoryName) {
  return Boolean(record) && typeof record === 'object'
    && (record.category_name === categoryName || record.categoryName === categoryName)
    && record.note === 'controlled temporary miniapp acceptance';
}

async function runMiniappLimitedWriteAcceptance({
  fetchImpl,
  sessionToken,
  accountId,
  cleanup,
  baseUrl = PUBLIC_BASE_URL,
  version,
  marker,
} = {}) {
  if (typeof fetchImpl !== 'function' || typeof cleanup !== 'function' || typeof sessionToken !== 'string'
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(sessionToken) || typeof accountId !== 'string' || accountId !== accountId.trim()
    || !accountId || accountId.length > 512 || baseUrl !== PUBLIC_BASE_URL || !MARKER_PATTERN.test(marker)
    || typeof version !== 'string' || !marker.startsWith(`codex-e2e-${version}-`)) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  }
  const categoryName = `codex-e2e-asset-${marker.slice('codex-e2e-'.length)}`;
  const idempotencyKey = `asset-import-${marker}`;
  const fixture = { accountId, importId: null, idempotencyKey, categoryName };
  let importAttempted = false;
  let cleanupConfirmed = false;
  const requestImport = async () => {
    const response = await fetchImpl(`${baseUrl}/api/business/miniapp-personal-assets/import`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ records: [{
        date: '2026-08-25',
        type: 'income',
        amount: 0.01,
        category: categoryName,
        note: 'controlled temporary miniapp acceptance',
      }] }),
    });
    return { status: response.status, body: await readJson(response) };
  };
  try {
    importAttempted = true;
    const created = requireResponse(await requestImport(), 202, 'REAL_CLOUD_ACCEPTANCE_MINIAPP_ASSET_IMPORT_FAILED');
    const receipt = created.body.receipt;
    if (!receipt || typeof receipt.importId !== 'string' || !/^asset_import_[A-Za-z0-9_-]{8,128}$/.test(receipt.importId)
      || receipt.recordCount !== 1 || receipt.replayed !== false) {
      throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_MINIAPP_ASSET_IMPORT_FAILED');
    }
    fixture.importId = receipt.importId;
    const replayed = requireResponse(await requestImport(), 200, 'REAL_CLOUD_ACCEPTANCE_MINIAPP_ASSET_REPLAY_FAILED');
    if (replayed.body?.receipt?.importId !== fixture.importId || replayed.body?.receipt?.recordCount !== 1 || replayed.body?.receipt?.replayed !== true) {
      throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_MINIAPP_ASSET_REPLAY_FAILED');
    }
    const projection = requireResponse(await requestJson(fetchImpl, sessionToken, `${baseUrl}/api/business/miniapp-projection`), 200, 'REAL_CLOUD_ACCEPTANCE_MINIAPP_ASSET_READ_FAILED');
    if (!Array.isArray(projection.body?.projection?.assetRecords)
      || !projection.body.projection.assetRecords.some(record => miniappAssetRecordMatches(record, categoryName))) {
      throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_MINIAPP_ASSET_READ_FAILED');
    }
    cleanupConfirmed = await cleanup(Object.freeze({ ...fixture })) === true;
    if (!cleanupConfirmed) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_MINIAPP_ASSET_CLEANUP_FAILED');
    const after = requireResponse(await requestJson(fetchImpl, sessionToken, `${baseUrl}/api/business/miniapp-projection`), 200, 'REAL_CLOUD_ACCEPTANCE_MINIAPP_ASSET_CLEANUP_FAILED');
    if (!Array.isArray(after.body?.projection?.assetRecords)
      || after.body.projection.assetRecords.some(record => miniappAssetRecordMatches(record, categoryName))) {
      throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_MINIAPP_ASSET_CLEANUP_FAILED');
    }
    return Object.freeze({
      miniappAssetImportStatus: created.status,
      miniappAssetReplayStatus: replayed.status,
      miniappAssetReadBack: true,
      miniappAssetCleanupConfirmed: true,
    });
  } finally {
    if (importAttempted && !cleanupConfirmed) {
      try { cleanupConfirmed = await cleanup(Object.freeze({ ...fixture })) === true; } catch (_) { cleanupConfirmed = false; }
    }
  }
}

function postgresConfig(env, user, password) {
  if (typeof password !== 'string' || password.length < 24) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  return {
    host: env.POSTGRES_HOST || 'gewu-postgres17',
    port: Number(env.POSTGRES_PORT || 5432),
    database: env.POSTGRES_DB || 'gewu_cloud',
    user,
    password,
    max: 1,
    connectionTimeoutMillis: 5000,
  };
}

function portablePath(value) {
  return value.replace(/\\/g, '/');
}

function resolveRuntimeModules(scriptDir, existsSync = fs.existsSync) {
  if (typeof scriptDir !== 'string' || !scriptDir || typeof existsSync !== 'function') {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  }
  const resolver = scriptDir.startsWith('/') ? path.posix : path;
  const roots = [resolver.resolve(scriptDir, '../cloud-business-api'), resolver.resolve(scriptDir)];
  for (const root of roots) {
    const packagePath = portablePath(path.join(root, 'package.json'));
    const pgPath = portablePath(path.join(root, 'node_modules', 'pg'));
    if (existsSync(packagePath) && existsSync(pgPath)) return { packagePath, pgPath };
  }
  throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_RUNTIME_LAYOUT_INVALID');
}

function resolveOperatorIdentity(recordsJson, accountId) {
  let records;
  try { records = JSON.parse(String(recordsJson || '')); } catch (_) { throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ADMIN_MAPPING_INVALID'); }
  if (!Array.isArray(records) || typeof accountId !== 'string' || !accountId.trim()) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ADMIN_MAPPING_INVALID');
  const matches = records.filter(record => record && typeof record === 'object' && !Array.isArray(record)
    && record.accountId === accountId && typeof record.authorityId === 'string' && record.authorityId.trim()
    && typeof record.phoneHmac === 'string' && /^[0-9a-f]{64}$/.test(record.phoneHmac));
  if (matches.length !== 1) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ADMIN_MAPPING_INVALID');
  return { authorityId: matches[0].authorityId, accountId, phoneHmac: matches[0].phoneHmac };
}

async function loadActiveSuperAdminSession(appPool, writerPool, operatorRecordsJson) {
  const accounts = await runStage('REAL_CLOUD_ACCEPTANCE_ADMIN_LOOKUP_FAILED', () => writerPool.query(
    `SELECT DISTINCT ac.authority_id AS "authorityId", ac.account_id AS "accountId"
       FROM vnext_control_plane.vnext_accounts ac
       JOIN vnext_control_plane.vnext_role_grants g ON g.authority_id=ac.authority_id AND g.account_id=ac.account_id
      WHERE ac.status='active' AND g.status='active' AND g.role='super_admin'
      ORDER BY ac.account_id`,
  ));
  if (accounts.rows.length !== 1) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ADMIN_INVARIANT_FAILED');
  const sessions = await runStage('REAL_CLOUD_ACCEPTANCE_SESSION_LOOKUP_FAILED', () => writerPool.query(
    `SELECT s.authority_id AS "authorityId",s.account_id AS "accountId",s.device_id AS "deviceId",s.installation_id AS "installationId",s.session_id AS "sessionId",s.expires_at AS "expiresAt"
       FROM vnext_control_plane.vnext_sessions s
       JOIN vnext_control_plane.vnext_authorities au ON au.authority_id=s.authority_id AND au.status='active'
       JOIN vnext_control_plane.vnext_accounts ac ON ac.authority_id=s.authority_id AND ac.account_id=s.account_id AND ac.status='active'
       JOIN vnext_control_plane.vnext_trusted_devices d ON d.authority_id=s.authority_id AND d.device_id=s.device_id AND d.status='active'
       JOIN vnext_control_plane.vnext_device_installations i ON i.authority_id=s.authority_id AND i.device_id=s.device_id AND i.installation_id=s.installation_id AND i.status='active'
       JOIN vnext_control_plane.vnext_account_device_links l ON l.authority_id=s.authority_id AND l.account_id=s.account_id AND l.device_id=s.device_id AND l.installation_id=s.installation_id AND l.link_id=s.link_id AND l.status='active'
      WHERE s.account_id=ANY($1::text[]) AND s.status='active' AND s.session_kind='online' AND s.expires_at>transaction_timestamp()
        AND ROW(s.account_auth_version,s.account_access_version,s.account_revocation_version,s.device_credential_version,s.device_risk_version,s.installation_credential_version,s.link_auth_version,s.link_access_version,s.link_row_version)=ROW(ac.auth_version,ac.access_version,ac.revocation_version,d.credential_version,d.risk_version,i.credential_version,l.auth_version,l.access_version,l.row_version)
      ORDER BY s.expires_at DESC LIMIT 2`,
    [accounts.rows.map(row => row.accountId)],
  ));
  const identity = resolveOperatorIdentity(operatorRecordsJson, accounts.rows[0].accountId);
  if (identity.authorityId !== accounts.rows[0].authorityId) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ADMIN_MAPPING_INVALID');
  if (sessions.rows.length < 1) return { session: null, accountIds: accounts.rows.map(row => row.accountId), identity };
  const session = sessions.rows[0];
  return {
    session: { ...session, expiresAt: session.expiresAt instanceof Date ? session.expiresAt.toISOString() : String(session.expiresAt) },
    accountIds: accounts.rows.map(row => row.accountId),
    identity,
  };
}

async function revokeOnlineRegistrationAcceptance(writerPool, fixture) {
  if (!fixture || typeof fixture.sessionId !== 'string' || !/^[A-Za-z0-9_-]{4,256}$/u.test(fixture.sessionId)
    || typeof fixture.installationId !== 'string' || !/^acceptance-registration-[a-z0-9-]{4,36}$/u.test(fixture.installationId)
    || typeof fixture.deviceId !== 'string' || !/^desktop-device-[0-9a-f]{32}$/u.test(fixture.deviceId)) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  }
  const result = await withOwnerTransaction(writerPool, 'REAL_CLOUD_ACCEPTANCE_ONLINE_REGISTRATION_REVOKE_FAILED', async client => {
    const found = await client.query(
      `SELECT authority_id,account_id,device_id,installation_id,link_id,status
         FROM vnext_control_plane.vnext_sessions
        WHERE session_id=$1 AND installation_id=$2 AND device_id=$3`,
      [fixture.sessionId, fixture.installationId, fixture.deviceId],
    );
    if (found.rows.length !== 1 || found.rows[0].status !== 'active') throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ONLINE_REGISTRATION_REVOKE_FAILED');
    const row = found.rows[0];
    const session = await client.query(`UPDATE vnext_control_plane.vnext_sessions SET status='revoked',revoked_at=transaction_timestamp(),updated_at=transaction_timestamp(),row_version=row_version+1 WHERE session_id=$1 AND status='active' RETURNING status`, [fixture.sessionId]);
    const link = await client.query(`UPDATE vnext_control_plane.vnext_account_device_links SET status='revoked',revoked_at=transaction_timestamp(),auth_version=auth_version+1,access_version=access_version+1,row_version=row_version+1,updated_at=transaction_timestamp() WHERE authority_id=$1 AND link_id=$2 AND installation_id=$3 AND status='active' RETURNING status`, [row.authority_id, row.link_id, fixture.installationId]);
    const installation = await client.query(`UPDATE vnext_control_plane.vnext_device_installations SET status='revoked',revoked_at=transaction_timestamp(),credential_version=credential_version+1,row_version=row_version+1,updated_at=transaction_timestamp() WHERE authority_id=$1 AND installation_id=$2 AND device_id=$3 AND status='active' RETURNING status`, [row.authority_id, fixture.installationId, fixture.deviceId]);
    const device = await client.query(`UPDATE vnext_control_plane.vnext_trusted_devices SET status='revoked',revoked_at=transaction_timestamp(),credential_version=credential_version+1,risk_version=risk_version+1,row_version=row_version+1,updated_at=transaction_timestamp() WHERE authority_id=$1 AND device_id=$2 AND status='active' RETURNING status`, [row.authority_id, fixture.deviceId]);
    return [session, link, installation, device];
  });
  if (result.some(item => item.rows.length !== 1 || item.rows[0].status !== 'revoked')) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ONLINE_REGISTRATION_REVOKE_FAILED');
  }
  return true;
}

async function verifyBusinessSuperAdmin(appPool, identity) {
  if (!identity || typeof identity.accountId !== 'string' || !identity.accountId.trim()
    || typeof identity.phoneHmac !== 'string' || !/^[0-9a-f]{64}$/.test(identity.phoneHmac)) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ADMIN_MAPPING_INVALID');
  }
  const result = await runStage('REAL_CLOUD_ACCEPTANCE_ADMIN_MAPPING_FAILED', () => appPool.query(
    `SELECT ac.account_id AS "accountId"
       FROM business.miniapp_cloud_accounts ac
       JOIN business.miniapp_cloud_role_grants g ON g.account_id=ac.account_id
      WHERE ac.account_id=$1 AND ac.phone_hmac=$2 AND ac.status='active'
        AND g.role='super_admin' AND g.status='active'`,
    [identity.accountId, identity.phoneHmac],
  ));
  if (result.rows.length !== 1 || result.rows[0].accountId !== identity.accountId) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ADMIN_MAPPING_FAILED');
  }
  return true;
}

async function verifyCanonicalPhoneContact(writerPool, identity) {
  if (!identity || typeof identity.accountId !== 'string' || !identity.accountId.trim()
    || typeof identity.phoneHmac !== 'string' || !/^[0-9a-f]{64}$/.test(identity.phoneHmac)) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ADMIN_MAPPING_INVALID');
  }
  return withOwnerTransaction(writerPool, 'REAL_CLOUD_ACCEPTANCE_ADMIN_CONTACT_FAILED', async client => {
    const existing = await client.query(
      `SELECT account_id FROM vnext_control_plane.vnext_verified_contacts
        WHERE contact_type='phone' AND normalized_value_hash=$1 AND verification_state='verified' AND revoked_at IS NULL`,
      [identity.phoneHmac],
    );
    if (existing.rows.length > 1 || (existing.rows.length === 1 && existing.rows[0].account_id !== identity.accountId)) {
      throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ADMIN_CONTACT_CONFLICT');
    }
    if (existing.rows.length !== 1) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_ADMIN_CONTACT_FAILED');
    return true;
  });
}

async function withOwnerTransaction(pool, code, work) {
  const client = await runStage(code, () => pool.connect());
  try {
    await runStage(code, () => client.query('BEGIN'));
    await runStage(code, () => client.query('SET LOCAL ROLE vnext_pg17_owner'));
    const result = await runStage(code, () => work(client));
    await runStage(code, () => client.query('COMMIT'));
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve the staged failure */ }
    throw error;
  } finally {
    client.release();
  }
}

async function withTransaction(pool, code, work) {
  const client = await runStage(code, () => pool.connect());
  try {
    await runStage(code, () => client.query('BEGIN'));
    const result = await runStage(code, () => work(client));
    await runStage(code, () => client.query('COMMIT'));
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve the staged failure */ }
    throw error;
  } finally {
    client.release();
  }
}

async function createControlledAcceptanceSession(appPool, accountIds, randomUUID = crypto.randomUUID) {
  if (!Array.isArray(accountIds) || accountIds.length < 1 || accountIds.some(value => typeof value !== 'string' || !value.trim())) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  }
  const suffix = String(randomUUID()).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 36);
  const fixture = {
    sessionId: `acceptance-session-${suffix}`,
    deviceId: `acceptance-device-${suffix}`,
    installationId: `acceptance-installation-${suffix}`,
    linkId: `acceptance-link-${suffix}`,
  };
  const result = await withOwnerTransaction(appPool, 'REAL_CLOUD_ACCEPTANCE_SESSION_PROVISION_FAILED', async client => {
    let candidate = (await client.query(
      `SELECT l.authority_id,l.account_id,l.device_id,l.installation_id,l.link_id,
              ac.auth_version,ac.access_version,ac.revocation_version,
              d.credential_version AS device_credential_version,d.risk_version AS device_risk_version,
              i.credential_version AS installation_credential_version,
              l.auth_version AS link_auth_version,l.access_version AS link_access_version,l.row_version AS link_row_version
         FROM vnext_control_plane.vnext_account_device_links l
         JOIN vnext_control_plane.vnext_authorities au ON au.authority_id=l.authority_id AND au.status='active'
         JOIN vnext_control_plane.vnext_accounts ac ON ac.authority_id=l.authority_id AND ac.account_id=l.account_id AND ac.status='active'
         JOIN vnext_control_plane.vnext_trusted_devices d ON d.authority_id=l.authority_id AND d.device_id=l.device_id AND d.status='active'
         JOIN vnext_control_plane.vnext_device_installations i ON i.authority_id=l.authority_id AND i.device_id=l.device_id AND i.installation_id=l.installation_id AND i.status='active'
        WHERE l.account_id=ANY($1::text[]) AND l.status='active'
        ORDER BY l.updated_at DESC LIMIT 1`,
      [accountIds],
    )).rows[0];
    let createdInfrastructure = false;
    if (!candidate) {
      const account = (await client.query(
        `SELECT ac.authority_id,ac.account_id,ac.auth_version,ac.access_version,ac.revocation_version
           FROM vnext_control_plane.vnext_accounts ac
           JOIN vnext_control_plane.vnext_authorities au ON au.authority_id=ac.authority_id AND au.status='active'
          WHERE ac.account_id=ANY($1::text[]) AND ac.status='active'
          ORDER BY ac.account_id LIMIT 1`,
        [accountIds],
      )).rows[0];
      if (!account) return { rows: [] };
      const fingerprint = crypto.createHash('sha256').update(fixture.installationId, 'utf8').digest('hex');
      const hardwareHash = crypto.createHash('sha256').update(fixture.deviceId, 'utf8').digest('hex');
      await client.query(
        `INSERT INTO vnext_control_plane.vnext_trusted_devices(device_id,authority_id,status,hardware_evidence_hash,risk_code,credential_version,risk_version,row_version,created_at,updated_at,revoked_at)
         VALUES($1,$2,'active',$3,NULL,1,1,1,transaction_timestamp(),transaction_timestamp(),NULL)`,
        [fixture.deviceId, account.authority_id, hardwareHash],
      );
      await client.query(
        `INSERT INTO vnext_control_plane.vnext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at,revoked_at)
         VALUES($1,$2,$3,'controlled-acceptance-key',$4,'active',1,1,transaction_timestamp(),transaction_timestamp(),NULL)`,
        [fixture.installationId, account.authority_id, fixture.deviceId, fingerprint],
      );
      await client.query(
        `INSERT INTO vnext_control_plane.vnext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at,revoked_at)
         VALUES($1,$2,$3,$4,$5,'active',1,1,1,transaction_timestamp(),transaction_timestamp(),NULL)`,
        [fixture.linkId, account.authority_id, account.account_id, fixture.deviceId, fixture.installationId],
      );
      candidate = {
        ...account, device_id: fixture.deviceId, installation_id: fixture.installationId, link_id: fixture.linkId,
        device_credential_version: 1, device_risk_version: 1, installation_credential_version: 1,
        link_auth_version: 1, link_access_version: 1, link_row_version: 1,
      };
      createdInfrastructure = true;
    }
    const inserted = await client.query(
      `INSERT INTO vnext_control_plane.vnext_sessions(
       session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,revoked_at,
       account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,
       installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,'online','active',transaction_timestamp(),date_trunc('milliseconds',transaction_timestamp())+interval '10 minutes',NULL,
        $7,$8,$9,$10,$11,$12,$13,$14,$15,1,transaction_timestamp(),transaction_timestamp())
      RETURNING authority_id AS "authorityId",account_id AS "accountId",device_id AS "deviceId",
                installation_id AS "installationId",session_id AS "sessionId",expires_at AS "expiresAt"`,
      [fixture.sessionId, candidate.authority_id, candidate.account_id, candidate.device_id, candidate.installation_id, candidate.link_id,
        candidate.auth_version, candidate.access_version, candidate.revocation_version, candidate.device_credential_version,
        candidate.device_risk_version, candidate.installation_credential_version, candidate.link_auth_version,
        candidate.link_access_version, candidate.link_row_version],
    );
    return { rows: inserted.rows.map(row => ({ ...row, createdInfrastructure, linkId: candidate.link_id })) };
  });
  if (result.rows.length !== 1) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_SESSION_PROVISION_UNAVAILABLE');
  const session = result.rows[0];
  return { ...session, expiresAt: session.expiresAt instanceof Date ? session.expiresAt.toISOString() : String(session.expiresAt) };
}

async function revokeControlledAcceptanceSession(appPool, session) {
  if (!session || typeof session.sessionId !== 'string' || !/^acceptance-session-[a-z0-9-]{4,36}$/.test(session.sessionId)) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  }
  const result = await withOwnerTransaction(appPool, 'REAL_CLOUD_ACCEPTANCE_SESSION_REVOKE_FAILED', async client => {
    const revoked = await client.query(`UPDATE vnext_control_plane.vnext_sessions
        SET status='revoked',revoked_at=transaction_timestamp(),updated_at=transaction_timestamp(),row_version=row_version+1
      WHERE session_id=$1 AND status='active'
      RETURNING status`,
    [session.sessionId]);
    if (session.createdInfrastructure) {
      await client.query(`UPDATE vnext_control_plane.vnext_account_device_links SET status='revoked',revoked_at=transaction_timestamp(),auth_version=auth_version+1,access_version=access_version+1,row_version=row_version+1,updated_at=transaction_timestamp() WHERE link_id=$1 AND status='active'`, [session.linkId]);
      await client.query(`UPDATE vnext_control_plane.vnext_device_installations SET status='revoked',revoked_at=transaction_timestamp(),credential_version=credential_version+1,row_version=row_version+1,updated_at=transaction_timestamp() WHERE installation_id=$1 AND status='active'`, [session.installationId]);
      await client.query(`UPDATE vnext_control_plane.vnext_trusted_devices SET status='revoked',revoked_at=transaction_timestamp(),credential_version=credential_version+1,risk_version=risk_version+1,row_version=row_version+1,updated_at=transaction_timestamp() WHERE device_id=$1 AND status='active'`, [session.deviceId]);
    }
    return revoked;
  });
  if (result.rows.length !== 1 || result.rows[0].status !== 'revoked') {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_SESSION_REVOKE_FAILED');
  }
  return true;
}

async function forceCleanup(appPool, writerPool, tenantId, marker) {
  if (!MARKER_PATTERN.test(marker)) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  const found = await runStage('REAL_CLOUD_ACCEPTANCE_CLEANUP_LOOKUP_FAILED', () => appPool.query(
    'SELECT to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.institutions WHERE tenant_id=$1 AND id=$2 AND legacy_deleted=false',
    [tenantId, marker],
  ));
  if (found.rows.length > 1) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CLEANUP_FAILED');
  if (found.rows.length === 1) {
    await runStage('REAL_CLOUD_ACCEPTANCE_CLEANUP_DELETE_FAILED', () => writerPool.query(
      'SELECT id FROM business.vnext_soft_delete_institution($1,$2,$3::timestamptz)',
      [tenantId, marker, found.rows[0].updatedAt],
    ));
  }
  const after = await runStage('REAL_CLOUD_ACCEPTANCE_CLEANUP_VERIFY_FAILED', () => appPool.query(
    'SELECT count(*)::int AS count FROM business.institutions WHERE tenant_id=$1 AND id=$2 AND legacy_deleted=false',
    [tenantId, marker],
  ));
  if (after.rows[0]?.count !== 0) throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CLEANUP_FAILED');
  return true;
}

async function forceMiniappAssetCleanup(appPool, writerPool, tenantId, fixture) {
  const marker = typeof fixture?.idempotencyKey === 'string' && fixture.idempotencyKey.startsWith('asset-import-')
    ? fixture.idempotencyKey.slice('asset-import-'.length)
    : '';
  const expectedCategoryName = MARKER_PATTERN.test(marker)
    ? `codex-e2e-asset-${marker.slice('codex-e2e-'.length)}`
    : '';
  if (typeof tenantId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(tenantId)
    || typeof fixture?.accountId !== 'string' || fixture.accountId !== fixture.accountId.trim()
    || !fixture.accountId || fixture.accountId.length > 512 || !MARKER_PATTERN.test(marker)
    || fixture.categoryName !== expectedCategoryName
    || (fixture.importId !== null && (typeof fixture.importId !== 'string'
      || !/^asset_import_[A-Za-z0-9_-]{8,128}$/.test(fixture.importId)))) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_CONFIG_INVALID');
  }

  await withTransaction(appPool, 'REAL_CLOUD_ACCEPTANCE_MINIAPP_ASSET_CLEANUP_FAILED', async client => {
    const found = await client.query(
      `SELECT import_id AS "importId" FROM business.personal_asset_imports
        WHERE tenant_id=$1 AND account_id=$2 AND idempotency_key=$3`,
      [tenantId, fixture.accountId, fixture.idempotencyKey],
    );
    if (found.rows.length > 1 || (fixture.importId && found.rows.length === 1 && found.rows[0].importId !== fixture.importId)) {
      throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_MINIAPP_ASSET_CLEANUP_FAILED');
    }
    const importId = found.rows[0]?.importId || fixture.importId;
    if (importId) {
      await client.query(
        'DELETE FROM business.personal_asset_records WHERE tenant_id=$1 AND account_id=$2 AND import_id=$3',
        [tenantId, fixture.accountId, importId],
      );
      await client.query(
        'DELETE FROM business.personal_asset_imports WHERE tenant_id=$1 AND account_id=$2 AND import_id=$3 AND idempotency_key=$4',
        [tenantId, fixture.accountId, importId, fixture.idempotencyKey],
      );
    }
    await client.query(
      `DELETE FROM business.personal_asset_categories category
        WHERE category.tenant_id=$1 AND category.account_id=$2 AND category.name=$3 AND category.category_type='income'
          AND NOT EXISTS (
            SELECT 1 FROM business.personal_asset_records record
             WHERE record.tenant_id=category.tenant_id AND record.account_id=category.account_id
               AND record.category_id=category.category_id
          )`,
      [tenantId, fixture.accountId, fixture.categoryName],
    );
  });

  const after = await runStage('REAL_CLOUD_ACCEPTANCE_MINIAPP_ASSET_CLEANUP_VERIFY_FAILED', () => appPool.query(
    `SELECT
       (SELECT count(*)::int FROM business.personal_asset_imports
         WHERE tenant_id=$1 AND account_id=$2 AND idempotency_key=$3) AS imports,
       (SELECT count(*)::int FROM business.personal_asset_records
         WHERE tenant_id=$1 AND account_id=$2 AND category_name=$4) AS records,
       (SELECT count(*)::int FROM business.personal_asset_categories
         WHERE tenant_id=$1 AND account_id=$2 AND name=$4 AND category_type='income') AS categories`,
    [tenantId, fixture.accountId, fixture.idempotencyKey, fixture.categoryName],
  ));
  if (after.rows.length !== 1 || after.rows[0].imports !== 0 || after.rows[0].records !== 0 || after.rows[0].categories !== 0) {
    throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_MINIAPP_ASSET_CLEANUP_FAILED');
  }
  return true;
}

async function runFromEnvironment(env = process.env) {
  const runtimeModules = resolveRuntimeModules(__dirname);
  const version = require(runtimeModules.packagePath).version;
  const marker = makeMarker(version, crypto.randomUUID);
  const tenantId = env.CLOUD_BUSINESS_TENANT_ID || 'default';
  const { Pool } = require(runtimeModules.pgPath);
  const { resolveRuntimeDatabaseUser } = require(path.join(path.dirname(runtimeModules.packagePath), 'src', 'runtimeDatabaseRole'));
  const appPool = new Pool(postgresConfig(env, resolveRuntimeDatabaseUser(env.POSTGRES_USER), env.POSTGRES_PASSWORD));
  const writerPool = new Pool(postgresConfig(env, 'vnext_pg17_writer', env.COMMAND_WRITER_POSTGRES_PASSWORD));
  let onlineRegistration = null;
  let onlineRegistrationFixture = null;
  try {
    return await runWithCleanup(
      async () => {
        const loaded = await loadActiveSuperAdminSession(appPool, writerPool, env.CLOUD_OPERATOR_PHONE_HMACS);
        await verifyCanonicalPhoneContact(writerPool, loaded.identity);
        await verifyBusinessSuperAdmin(appPool, loaded.identity);
        if (!pidOneEnvironmentMatches('CLOUD_IDENTITY_TICKET_SECRET', env.CLOUD_IDENTITY_TICKET_SECRET)
          || !pidOneEnvironmentMatches('CLOUD_MINIAPP_TICKET_SECRET', env.CLOUD_MINIAPP_TICKET_SECRET)) {
          throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_SERVER_ENVIRONMENT_MISMATCH');
        }
        onlineRegistration = await runOnlineRegistrationAcceptance({
          fetchImpl: fetch,
          runtimeModules,
          ticketSecret: env.CLOUD_IDENTITY_TICKET_SECRET,
          identity: loaded.identity,
          baseUrl: PUBLIC_BASE_URL,
          onRegistrationPersisted: fixture => { onlineRegistrationFixture = fixture; },
        });
        const sessionToken = onlineRegistration.sessionToken;
        await verifyDesktopProjectionSources(appPool);
        const localSessionCheck = await requestJson(fetch, sessionToken, `${LOCAL_BASE_URL}/api/desktop/session-context`);
        if (localSessionCheck.status !== 200 || localSessionCheck.body?.ok !== true || !Array.isArray(localSessionCheck.body?.roles)
          || !localSessionCheck.body.roles.includes('super_admin')) {
          throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_LOCAL_SESSION_CONTEXT_FAILED', {
            status: localSessionCheck.status,
            responseCode: localSessionCheck.body?.code || null,
            roles: Array.isArray(localSessionCheck.body?.roles) ? localSessionCheck.body.roles.filter(role => typeof role === 'string') : [],
          });
        }
        const sessionCheck = await requestJson(fetch, sessionToken, `${PUBLIC_BASE_URL}/api/desktop/session-context`);
        if (sessionCheck.status !== 200 || sessionCheck.body?.ok !== true || !Array.isArray(sessionCheck.body?.roles)
          || !sessionCheck.body.roles.includes('super_admin')) {
          throw acceptanceFailure('REAL_CLOUD_ACCEPTANCE_SESSION_CONTEXT_FAILED', {
            status: sessionCheck.status,
            responseCode: sessionCheck.body?.code || null,
            roles: Array.isArray(sessionCheck.body?.roles) ? sessionCheck.body.roles.filter(role => typeof role === 'string') : [],
          });
        }
        const businessEvidence = await runPublicAcceptance({ fetchImpl: fetch, sessionToken, baseUrl: PUBLIC_BASE_URL, version, marker });
        const miniappSessionToken = makeMiniappSessionToken(env.CLOUD_MINIAPP_TICKET_SECRET, loaded.identity.accountId);
        const miniappEvidence = await runMiniappLimitedWriteAcceptance({
          fetchImpl: fetch,
          sessionToken: miniappSessionToken,
          accountId: loaded.identity.accountId,
          cleanup: fixture => forceMiniappAssetCleanup(appPool, writerPool, tenantId, fixture),
          baseUrl: PUBLIC_BASE_URL,
          version,
          marker,
        });
        return Object.freeze({ ...businessEvidence, ...onlineRegistration.evidence, ...miniappEvidence });
      },
      () => runWithCleanup(
        () => forceCleanup(appPool, writerPool, tenantId, marker),
        () => onlineRegistrationFixture ? revokeOnlineRegistrationAcceptance(writerPool, onlineRegistrationFixture) : Promise.resolve(),
      ),
    );
  } finally {
    await Promise.allSettled([appPool.end(), writerPool.end()]);
  }
}

module.exports = Object.freeze({
  PUBLIC_BASE_URL,
  runStage,
  runWithCleanup,
  withTransaction,
  makeSessionToken,
  makeMiniappSessionToken,
  inspectSessionTokenWithRuntime,
  createOnlineRegistrationRequest,
  runOnlineRegistrationAcceptance,
  pidOneEnvironmentMatches,
  verifyDesktopProjectionSources,
  makeMarker,
  resolveRuntimeModules,
  runPublicAcceptance,
  runMiniappLimitedWriteAcceptance,
  loadActiveSuperAdminSession,
  resolveOperatorIdentity,
  verifyBusinessSuperAdmin,
  verifyCanonicalPhoneContact,
  createControlledAcceptanceSession,
  revokeControlledAcceptanceSession,
  revokeOnlineRegistrationAcceptance,
  forceCleanup,
  forceMiniappAssetCleanup,
  runFromEnvironment,
});

if (require.main === module) {
  runFromEnvironment()
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => {
      process.stderr.write(`${JSON.stringify({
        ok: false,
        code: error?.code || 'REAL_CLOUD_ACCEPTANCE_FAILED',
        databaseCode: typeof error?.details?.databaseCode === 'string' ? error.details.databaseCode : null,
        status: Number.isSafeInteger(error?.details?.status) ? error.details.status : null,
        responseCode: typeof error?.details?.responseCode === 'string' ? error.details.responseCode : null,
        roles: Array.isArray(error?.details?.roles) ? error.details.roles : [],
      })}\n`);
      process.exitCode = 1;
    });
}
