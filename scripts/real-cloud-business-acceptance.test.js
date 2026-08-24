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
} = require('./real-cloud-business-acceptance');

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
    if (calls.length === 2) return response(200, { ok: true, projection: { institutions: [{ id: 'codex-e2e-8.4.1-fixed', updated_at: createdAt }] } });
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
  assert.match(calls.find(call => String(call[0]).includes('INSERT INTO'))[0], /interval '10 minutes'/);
  assert.ok(calls.some(call => call[0] === 'SET LOCAL ROLE vnext_pg17_owner'));
  assert.strictEqual(await revokeControlledAcceptanceSession(pool, session), true);
  assert.match(calls.find(call => String(call[0]).includes('UPDATE vnext_control_plane'))[0], /status='revoked'/);
  assert.strictEqual(calls.filter(call => call[0] === 'COMMIT').length, 2);
}

Promise.resolve()
  .then(tokenIsBoundAndOpaque)
  .then(runtimeLayoutIsExplicit)
  .then(stageAndCleanupErrorsStayDiagnosable)
  .then(controlledSessionIsShortLivedAndRevoked)
  .then(successfulAcceptance)
  .then(cleanupOnFailure)
  .then(() => console.log('real cloud business acceptance checks passed'));
