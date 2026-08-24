'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  makeSessionToken,
  resolveRuntimeModules,
  runStage,
  runWithCleanup,
  runPublicAcceptance,
  createControlledAcceptanceSession,
  revokeControlledAcceptanceSession,
  ensureBusinessSuperAdmin,
  resolveOperatorIdentity,
  ensureCanonicalPhoneContact,
  createOnlineRegistrationRequest,
  runOnlineRegistrationAcceptance,
  revokeOnlineRegistrationAcceptance,
  pidOneEnvironmentMatches,
} = require('./real-cloud-business-acceptance');
const { createCloudDesktopRegistrationService } = require('../cloud-business-api/src/desktopRegistrationService');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

async function successfulAcceptance() {
  const calls = [];
  const createdAt = '2026-08-24T14:30:00.001Z';
  const updatedAt = '2026-08-24T14:30:00.101Z';
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body, authorization: options.headers?.Authorization });
    if (calls.length === 1) return response(201, { ok: true, institution: { id: 'codex-e2e-8.4.1-fixed', updatedAt: createdAt } });
    if (calls.length === 2) return response(200, { ok: true, projection: { institutions: [{ id: 'codex-e2e-8.4.1-fixed', updated_at: '2026-08-24T14:30:00.001+00:00' }] } });
    if (calls.length === 3) return response(200, { ok: true, institution: { id: 'codex-e2e-8.4.1-fixed', updatedAt } });
    if (calls.length === 4) return response(409, { ok: false, code: 'CLOUD_BUSINESS_INSTITUTION_CONFLICT' });
    if (calls.length === 5) return response(200, { ok: true, institution: { id: 'codex-e2e-8.4.1-fixed', updatedAt } });
    return response(200, { ok: true, projection: { institutions: [] } });
  };
  const result = await runPublicAcceptance({
    fetchImpl,
    sessionToken: 'payload.signature',
    baseUrl: 'https://physicsedu.xyz/scheduling',
    version: '8.4.1',
    now: () => new Date('2026-08-24T14:30:00.000Z'),
    randomUUID: () => 'fixed',
    sleep: async () => {},
  });
  assert.deepStrictEqual(result, {
    ok: true,
    version: '8.4.1',
    createStatus: 201,
    readBack: true,
    updateStatus: 200,
    staleConflictStatus: 409,
    deleteStatus: 200,
    absenceConfirmed: true,
    cleanupConfirmed: true,
    markerSha256: crypto.createHash('sha256').update('codex-e2e-8.4.1-fixed').digest('hex'),
  });
  assert.strictEqual(calls.length, 6);
  assert.ok(calls.every(call => call.authorization === 'Bearer payload.signature'));
  assert.strictEqual(calls[3].body.expectedUpdatedAt, createdAt, 'the stale write must use the original baseline');
  assert.strictEqual(calls[4].body.expectedUpdatedAt, updatedAt, 'cleanup must use the latest observed timestamp');
  assert.ok(!JSON.stringify(result).includes('payload.signature'), 'acceptance evidence must never expose a bearer token');
}

async function cleanupOnFailure() {
  const calls = [];
  const createdAt = '2026-08-24T14:30:00.001Z';
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body });
    if (calls.length === 1) return response(201, { ok: true, institution: { id: 'codex-e2e-8.4.1-fixed', updatedAt: createdAt } });
    if (calls.length === 2) throw new Error('synthetic read failure');
    if (calls.length === 3) return response(200, { ok: true, projection: { institutions: [{ id: 'codex-e2e-8.4.1-fixed', updated_at: createdAt }] } });
    if (calls.length === 4) return response(200, { ok: true, institution: { id: 'codex-e2e-8.4.1-fixed', updatedAt: createdAt } });
    return response(200, { ok: true, projection: { institutions: [] } });
  };
  await assert.rejects(
    runPublicAcceptance({
      fetchImpl,
      sessionToken: 'payload.signature',
      baseUrl: 'https://physicsedu.xyz/scheduling',
      version: '8.4.1',
      now: () => new Date('2026-08-24T14:30:00.000Z'),
      randomUUID: () => 'fixed',
      sleep: async () => {},
    }),
    /synthetic read failure/,
  );
  assert.strictEqual(calls[3].method, 'DELETE', 'a failure after create must still delete the disposable record');
  assert.strictEqual(calls[3].body.expectedUpdatedAt, createdAt);
  assert.strictEqual(calls[4].method, 'GET', 'cleanup must prove the disposable record is absent');
}

function tokenIsBoundAndOpaque() {
  const token = makeSessionToken('x'.repeat(32), {
    authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1',
    sessionId: 'session-1', expiresAt: '2026-08-24T15:00:00.000Z',
  });
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  assert.deepStrictEqual(payload, {
    v: 1,
    authorityId: 'authority-1',
    accountId: 'account-1',
    deviceId: 'device-1',
    installationId: 'installation-1',
    sessionId: 'session-1',
    expiresAt: Date.parse('2026-08-24T15:00:00.000Z'),
  });
}

function serverEnvironmentComparisonDoesNotExposeTheSecret() {
  const secret = 'sensitive-value';
  const read = () => Buffer.from(`A=1\0CLOUD_IDENTITY_TICKET_SECRET=${secret}\0B=2\0`, 'utf8');
  assert.strictEqual(pidOneEnvironmentMatches('CLOUD_IDENTITY_TICKET_SECRET', secret, read), true);
  assert.strictEqual(pidOneEnvironmentMatches('CLOUD_IDENTITY_TICKET_SECRET', 'different', read), false);
}

async function tokenIsAcceptedByDesktopSessionContract() {
  const secret = 'x'.repeat(32);
  const now = new Date('2026-08-24T15:00:00.000Z');
  const session = {
    authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1',
    sessionId: 'acceptance-session-1', expiresAt: '2026-08-24T15:10:00.000Z',
  };
  const service = createCloudDesktopRegistrationService({
    now: () => new Date(now),
    randomId: prefix => `${prefix}-fixed`,
    phoneVerifier: async () => '13700000000',
    lookupAccount: async () => ({ authorityId: session.authorityId, accountId: session.accountId, phoneHmac: null }),
    ticketSecret: secret,
    leasePrivateKey: crypto.generateKeyPairSync('ed25519').privateKey,
    issueAssertion: async () => {},
    register: async () => null,
    readSessionContext: async input => ({ ...input, roles: ['super_admin'], teacherId: null, studentId: null }),
  });
  assert.deepStrictEqual(
    await service.sessionContext({ sessionToken: makeSessionToken(secret, session) }),
    { ...session, roles: ['super_admin'], teacherId: null, studentId: null },
  );
}

function runtimeLayoutIsExplicit() {
  assert.deepStrictEqual(
    resolveRuntimeModules('C:/repo/scripts', candidate => candidate.includes('/cloud-business-api/')),
    {
      packagePath: 'C:/repo/cloud-business-api/package.json',
      pgPath: 'C:/repo/cloud-business-api/node_modules/pg',
    },
  );
  assert.deepStrictEqual(
    resolveRuntimeModules('/app', candidate => candidate === '/app/package.json' || candidate === '/app/node_modules/pg'),
    { packagePath: '/app/package.json', pgPath: '/app/node_modules/pg' },
  );
}

async function stageAndCleanupErrorsStayDiagnosable() {
  await assert.rejects(
    runStage('REAL_CLOUD_ACCEPTANCE_SESSION_LOOKUP_FAILED', async () => { throw Object.assign(new Error('denied'), { code: '42501' }); }),
    error => error.code === 'REAL_CLOUD_ACCEPTANCE_SESSION_LOOKUP_FAILED' && error.details.databaseCode === '42501',
  );
  const calls = [];
  await assert.rejects(
    runWithCleanup(
      async () => { calls.push('work'); throw Object.assign(new Error('primary'), { code: 'PRIMARY' }); },
      async () => { calls.push('cleanup'); throw Object.assign(new Error('cleanup'), { code: 'CLEANUP' }); },
    ),
    error => error.code === 'PRIMARY',
  );
  assert.deepStrictEqual(calls, ['work', 'cleanup']);
}

async function controlledSessionIsShortLivedAndRevoked() {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push([text, values]);
      if (text.includes('SELECT l.authority_id')) return { rows: [{
        authority_id: 'authority-1', account_id: 'account-1', device_id: 'device-1', installation_id: 'installation-1', link_id: 'link-1',
        auth_version: 1, access_version: 1, revocation_version: 1, device_credential_version: 1, device_risk_version: 1,
        installation_credential_version: 1, link_auth_version: 1, link_access_version: 1, link_row_version: 1,
      }] };
      if (text.includes('INSERT INTO vnext_control_plane.vnext_sessions')) {
        return { rows: [{
          authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1',
          sessionId: 'acceptance-session-fixed-id', expiresAt: new Date('2026-08-24T15:10:00.000Z'),
        }] };
      }
      if (text.includes('UPDATE vnext_control_plane.vnext_sessions')) return { rows: [{ status: 'revoked' }] };
      return { rows: [] };
    },
    release() { calls.push(['RELEASE']); },
  };
  const pool = { async connect() { return client; } };
  const session = await createControlledAcceptanceSession(pool, ['account-1'], () => 'fixed-id');
  assert.strictEqual(session.sessionId, 'acceptance-session-fixed-id');
  assert.strictEqual(session.expiresAt, '2026-08-24T15:10:00.000Z');
  const sessionInsert = calls.find(call => String(call[0]).includes('INSERT INTO'))[0];
  assert.match(sessionInsert, /interval '10 minutes'/);
  assert.match(sessionInsert, /date_trunc\('milliseconds',transaction_timestamp\(\)\)/,
    'the disposable session timestamp must round-trip through the millisecond desktop ticket without losing equality');
  assert.ok(calls.some(call => call[0] === 'SET LOCAL ROLE vnext_pg17_owner'));
  assert.strictEqual(await revokeControlledAcceptanceSession(pool, session), true);
  assert.match(calls.find(call => String(call[0]).includes('UPDATE vnext_control_plane'))[0], /status='revoked'/);
  assert.strictEqual(calls.filter(call => call[0] === 'COMMIT').length, 2);
}

async function canonicalPhoneMappingActivatesTheExistingBusinessAccount() {
  const calls = [];
  const pool = { async query(text, values) { calls.push([text, values]); return { rows: [{ count: 1 }] }; } };
  assert.strictEqual(await ensureBusinessSuperAdmin(pool, { accountId: 'canonical-admin', phoneHmac: 'c'.repeat(64) }), true);
  assert.match(calls[0][0], /ON CONFLICT\(phone_hmac\) DO UPDATE/);
  assert.match(calls[0][0], /'super_admin','active'/);
  assert.deepStrictEqual(calls[0][1], ['canonical-admin', 'c'.repeat(64)]);
}

function operatorIdentityIsResolvedWithoutPhonePlaintext() {
  assert.deepStrictEqual(resolveOperatorIdentity(JSON.stringify([
    { phoneHmac: 'd'.repeat(64), authorityId: 'authority-1', accountId: 'canonical-admin' },
  ]), 'canonical-admin'), { authorityId: 'authority-1', accountId: 'canonical-admin', phoneHmac: 'd'.repeat(64) });
  assert.throws(() => resolveOperatorIdentity('[]', 'canonical-admin'), error => error.code === 'REAL_CLOUD_ACCEPTANCE_ADMIN_MAPPING_INVALID');
}

async function onlineRegistrationIsRealAndTokenFreeInEvidence() {
  const runtimeModules = resolveRuntimeModules(__dirname, candidate => candidate.includes('/cloud-business-api/'));
  const ticketSecret = 'registration-acceptance-secret'.repeat(2);
  const identity = { authorityId: 'authority-1', accountId: 'canonical-admin', phoneHmac: 'd'.repeat(64) };
  const fixture = createOnlineRegistrationRequest(runtimeModules, ticketSecret, identity, () => 'fixed-registration');
  assert.match(fixture.body.installationId, /^acceptance-registration-/);
  assert.strictEqual(
    crypto.verify(null, Buffer.from(fixture.deviceChallenge, 'utf8'), crypto.createPublicKey(fixture.body.installationPublicKey), Buffer.from(fixture.body.deviceProof, 'base64url')),
    true,
  );

  const calls = [];
  const sessionExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, body, authorization: options.headers?.Authorization || null });
    if (path.endsWith('/api/desktop/online-registration')) {
      const deviceId = `desktop-device-${crypto.createHash('sha256').update(crypto.createPublicKey(body.installationPublicKey).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32)}`;
      const session = {
        authorityId: identity.authorityId,
        accountId: identity.accountId,
        deviceId,
        installationId: body.installationId,
        sessionId: 'session-online-fixed',
        expiresAt: sessionExpiresAt,
      };
      return response(200, {
        ok: true,
        receiptId: 'receipt-online-fixed',
        sessionId: session.sessionId,
        replayed: false,
        sessionToken: makeSessionToken(ticketSecret, session),
        offlineLease: { id: 'offline-lease-session-online-fixed', signature: 'signed' },
      });
    }
    const registrationBody = calls[0].body;
    const deviceId = `desktop-device-${crypto.createHash('sha256').update(crypto.createPublicKey(registrationBody.installationPublicKey).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32)}`;
    return response(200, { ok: true, ...identity, deviceId, installationId: registrationBody.installationId, sessionId: 'session-online-fixed', expiresAt: sessionExpiresAt, roles: ['super_admin'], teacherId: null, studentId: null });
  };
  const accepted = await runOnlineRegistrationAcceptance({
    fetchImpl,
    runtimeModules,
    ticketSecret,
    identity,
    baseUrl: 'https://physicsedu.xyz/scheduling',
    randomUUID: () => 'fixed-registration',
  });
  assert.strictEqual(calls[0].path, '/scheduling/api/desktop/online-registration');
  assert.strictEqual(calls[0].authorization, null, 'registration must use the verification ticket, not an existing session');
  assert.strictEqual(calls[1].authorization, `Bearer ${accepted.sessionToken}`);
  assert.strictEqual(accepted.evidence.onlineRegistrationStatus, 200);
  assert.strictEqual(accepted.evidence.onlineSessionContextStatus, 200);
  assert.ok(!JSON.stringify(accepted.evidence).includes(accepted.sessionToken));
}

async function onlineRegistrationFixtureIsRevoked() {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push([text, values]);
      if (text.includes('SELECT authority_id')) return { rows: [{ authority_id: 'authority-1', account_id: 'canonical-admin', device_id: `desktop-device-${'a'.repeat(32)}`, installation_id: 'acceptance-registration-fixed', link_id: 'link-fixed', status: 'active' }] };
      return { rows: [{ status: 'revoked' }] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  assert.strictEqual(await revokeOnlineRegistrationAcceptance(pool, {
    sessionId: 'session-online-fixed', installationId: 'acceptance-registration-fixed', deviceId: `desktop-device-${'a'.repeat(32)}`,
  }), true);
  assert.ok(calls.some(([text]) => text.includes('vnext_account_device_links')));
  assert.ok(calls.some(([text]) => text.includes('vnext_device_installations')));
  assert.ok(calls.some(([text]) => text.includes('vnext_trusted_devices')));
}

async function operatorPhoneBecomesCanonicalWithoutPlaintext() {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push([text, values]);
      if (text.includes('SELECT account_id FROM vnext_control_plane.vnext_verified_contacts')) return { rows: [] };
      if (text.includes('INSERT INTO vnext_control_plane.vnext_verified_contacts')) return { rows: [{ account_id: 'canonical-admin' }] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  assert.strictEqual(await ensureCanonicalPhoneContact(pool, { accountId: 'canonical-admin', phoneHmac: 'e'.repeat(64) }), true);
  const insertion = calls.find(([text]) => text.includes('INSERT INTO vnext_control_plane.vnext_verified_contacts'));
  assert.ok(insertion);
  assert.ok(insertion[1].every(value => !String(value).includes('13732250653')));
  assert.match(insertion[1][3], /^[0-9a-f]{64}$/);
}

Promise.resolve()
  .then(tokenIsBoundAndOpaque)
  .then(serverEnvironmentComparisonDoesNotExposeTheSecret)
  .then(tokenIsAcceptedByDesktopSessionContract)
  .then(runtimeLayoutIsExplicit)
  .then(stageAndCleanupErrorsStayDiagnosable)
  .then(controlledSessionIsShortLivedAndRevoked)
  .then(canonicalPhoneMappingActivatesTheExistingBusinessAccount)
  .then(operatorIdentityIsResolvedWithoutPhonePlaintext)
  .then(operatorPhoneBecomesCanonicalWithoutPlaintext)
  .then(onlineRegistrationIsRealAndTokenFreeInEvidence)
  .then(onlineRegistrationFixtureIsRevoked)
  .then(successfulAcceptance)
  .then(cleanupOnFailure)
  .then(() => console.log('real cloud business acceptance checks passed'));
