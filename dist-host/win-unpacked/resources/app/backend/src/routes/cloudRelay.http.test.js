const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const { issueRelayAssertion } = require('../services/relayAssertionService');

assert.ok(fs.readFileSync('package.json', 'utf8').includes('backend/src/routes/cloudRelay.http.test.js'), 'backend HTTP relay contract test must run in test:backend');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-backend-relay-http-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'backend-relay-http-secret';
process.env.GEWU_CLOUD_RELAY_HOST_TOKEN = 'backend-host-secret';
process.env.GEWU_DESKTOP_SYNC_TOKEN = 'legacy-sync-token';
process.env.DB_PATH = path.join(tempRoot, 'relay.db');
process.env.READ_DB_PATH = process.env.DB_PATH;

const { DatabaseService } = require('../database');
const service = new DatabaseService();
const now = new Date().toISOString();
for (const id of ['relay-u1', 'relay-u2', 'relay-admin']) {
  service.db.prepare(`INSERT INTO users
    (id, phone, name, role, status, login_enabled, review_status, deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 1, 'approved', 0, ?, ?)`)
    .run(id, id === 'relay-u1' ? '13900000021' : id === 'relay-u2' ? '13900000022' : '13900000023', id, id === 'relay-admin' ? 'admin' : 'student', now, now);
}
service.db.prepare(`INSERT INTO teachers (id, name, created_at, updated_at)
  VALUES ('relay-teacher-1', 'Relay Teacher', ?, ?)`).run(now, now);
service.db.prepare(`INSERT INTO users
  (id, phone, name, role, status, login_enabled, teacher_id, review_status, auth_version, deleted, created_at, updated_at)
  VALUES ('desktop-relay-u1', '13900000024', 'Desktop Relay Teacher', 'teacher', 1, 1,
    'relay-teacher-1', 'approved', 4, 0, ?, ?)`).run(now, now);
service.db.prepare(`INSERT INTO user_role_grants
  (user_id, role, subject_type, subject_id, status, source, created_at, updated_at)
  VALUES ('desktop-relay-u1', 'teacher', 'teacher', 'relay-teacher-1', 'active', 'test', ?, ?)`)
  .run(now, now);
service.db.prepare(`INSERT INTO desktop_device_authorizations
  (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
   status, source_challenge_id, last_phone_verified_at, phone_reverify_due_at,
   credential_version, row_version, created_at, updated_at)
  VALUES ('relay-authorization-1', 'relay-device-1', 'Relay PC', 'desktop-client',
    'desktop-relay-u1', 'test-public-key', ?, 'active', 'relay-challenge-1', ?, ?, 2, 1, ?, ?)`)
  .run('a'.repeat(64), now, new Date(Date.parse(now) + 30 * 24 * 60 * 60 * 1000).toISOString(), now, now);
const { createDesktopSessionService } = require('../services/desktopSessionService');
const desktopSessions = createDesktopSessionService({
  db: service.db,
  jwtSecret: process.env.JWT_SECRET,
  now: () => new Date(now),
  uuid: () => 'relay-desktop-session-1',
});
const desktopIssued = desktopSessions.issueSession({ userId: 'desktop-relay-u1', deviceId: 'relay-device-1' });
const databaseModule = require('../database');
databaseModule.getInstance = () => service;
delete require.cache[require.resolve('../app')];
const { createApp } = require('../app');

const token = id => jwt.sign({ id }, process.env.JWT_SECRET, { algorithm: 'HS256' });

(async () => {
  const listener = createApp().listen(0);
  const origin = `http://127.0.0.1:${listener.address().port}`;
  const base = `${origin}/api/cloud`;
  const call = (url, options = {}) => fetch(base + url, {
    ...options,
    signal: AbortSignal.timeout(3000),
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const userHeaders = id => ({ authorization: `Bearer ${token(id)}` });
  const desktopHeaders = () => ({ authorization: `Bearer ${desktopIssued.token}`, 'x-device-id': 'relay-device-1' });
  const hostHeaders = { 'x-gewu-host-token': 'backend-host-secret' };
  try {
    const pairingRowsBefore = service.db.prepare('SELECT COUNT(*) count FROM desktop_device_pairings').get().count;
    for (const [pathname, method] of [
      ['/api/desktop-pairing/start', 'POST'],
      ['/api/desktop-pairing/exchange', 'POST'],
      ['/api/desktop-pairing/pending', 'GET'],
      ['/api/desktop-pairing/legacy/approve', 'POST'],
      ['/api/desktop-pairing/code/123456/reject', 'POST'],
    ]) {
      const response = await fetch(origin + pathname, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { body: '{}' }),
      });
      assert.strictEqual(response.status, 410);
      assert.strictEqual((await response.json()).code, 'DESKTOP_PAIRING_V1_REMOVED');
    }
    assert.strictEqual(service.db.prepare('SELECT COUNT(*) count FROM desktop_device_pairings').get().count, pairingRowsBefore);
    assert.strictEqual((await call('/host/heartbeat', { method: 'POST', headers: hostHeaders, body: JSON.stringify({
      hostDeviceId: 'backend-host',
      baseUrl: 'https://host.example/base/',
      capabilities: ['identity-provisioning-v1', 'identity-provisioning-v1'],
    }) })).status, 200);
    assert.deepStrictEqual(
      JSON.parse(service.db.prepare("SELECT capabilities FROM host_heartbeats WHERE host_device_id='backend-host'").get().capabilities),
      ['identity-provisioning-v1'],
    );
    const relaySecret = 'desktop-session-request-secret';
    const relaySecretHash = crypto.createHash('sha256').update(relaySecret).digest('hex');
    const relayStartResponse = await call('/desktop-session/challenges/start', {
      method: 'POST',
      body: JSON.stringify({
        authorizationId: 'relay-authorization-1',
        deviceId: 'relay-device-1',
        requestSecretHash: relaySecretHash,
      }),
    });
    assert.strictEqual(relayStartResponse.status, 200);
    const relayStart = (await relayStartResponse.json()).request;
    const storedRelayStart = service.db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(relayStart.id);
    assert.strictEqual(storedRelayStart.task_type, 'desktop-session-challenge-start');
    assert.ok(!storedRelayStart.payload.includes(relaySecret));
    assert.strictEqual((await call(`/desktop-session/requests/${relayStart.id}`, {
      headers: { 'x-desktop-session-request-secret': 'wrong-secret' },
    })).status, 403);
    assert.strictEqual((await call(`/desktop-session/requests/${relayStart.id}`, {
      headers: { 'x-desktop-session-request-secret': relaySecret },
    })).status, 200);
    service.db.prepare(`UPDATE miniapp_tasks
      SET status='completed', result_payload=?, updated_at=?, row_version=row_version+1
      WHERE id=?`).run(JSON.stringify({
      challenge: {
        id: 'relay-challenge-1',
        authorizationId: 'relay-authorization-1',
        deviceId: 'relay-device-1',
        credentialVersion: 2,
        nonce: 'relay-nonce',
        nonceIssuedAt: now,
        rowVersion: 1,
      },
    }), now, relayStart.id);
    const relayExchangeResponse = await call('/desktop-session/challenges/relay-challenge-1/exchange', {
      method: 'POST',
      headers: { 'x-desktop-session-request-secret': relaySecret },
      body: JSON.stringify({
        startRequestId: relayStart.id,
        signature: Buffer.alloc(64, 3).toString('base64'),
        expectedRowVersion: 1,
      }),
    });
    assert.strictEqual(relayExchangeResponse.status, 200);
    const relayExchange = (await relayExchangeResponse.json()).request;
    assert.strictEqual(
      service.db.prepare('SELECT task_type FROM miniapp_tasks WHERE id=?').get(relayExchange.id).task_type,
      'desktop-session-challenge-exchange'
    );
    const relayAssertion = issueRelayAssertion({
      taskId: relayExchange.id,
      actorUserId: 'desktop-relay-u1',
      deviceId: 'relay-device-1',
      sessionId: 'relay-host-session-1',
      activeRole: 'teacher',
      teacherId: 'relay-teacher-1',
      authVersion: 4,
      credentialVersion: 2,
      issuedAt: Date.parse(now),
      expiresAt: Date.parse(now) + 8 * 60 * 60 * 1000,
    }, process.env.GEWU_CLOUD_RELAY_HOST_TOKEN);
    service.db.prepare(`UPDATE miniapp_tasks
      SET status='completed', result_payload=?, updated_at=?, row_version=row_version+1
      WHERE id=?`).run(JSON.stringify({
      session: {
        id: 'relay-host-session-1',
        userId: 'desktop-relay-u1',
        deviceId: 'relay-device-1',
        activeRole: 'teacher',
        eligibleRoles: ['teacher'],
        teacherId: 'relay-teacher-1',
        authVersion: 4,
        credentialVersion: 2,
        expiresAt: new Date(Date.parse(now) + 8 * 60 * 60 * 1000).toISOString(),
      },
      profile: {
        userId: 'desktop-relay-u1',
        user: { id: 'desktop-relay-u1', name: 'Desktop Relay Teacher' },
        activeRole: 'teacher',
        eligibleRoles: ['teacher'],
        teacherId: 'relay-teacher-1',
      },
      offlineLease: { id: 'relay-lease-1' },
      relayAssertion,
    }), now, relayExchange.id);
    const relayResultResponse = await call(`/desktop-session/requests/${relayExchange.id}`, {
      headers: { 'x-desktop-session-request-secret': relaySecret },
    });
    assert.strictEqual(relayResultResponse.status, 200);
    const relayedSessionToken = (await relayResultResponse.json()).request.result.token;
    assert.ok(relayedSessionToken);
    assert.strictEqual((await call('/host/status', {
      headers: {
        authorization: `Bearer ${relayedSessionToken}`,
        'x-device-id': 'relay-device-1',
      },
    })).status, 200);
    assert.strictEqual((await fetch(`${origin}/api/permissions/my`, {
      headers: {
        authorization: `Bearer ${relayedSessionToken}`,
        'x-device-id': 'relay-device-1',
      },
    })).status, 401, 'relay desktop sessions must be scoped to /api/cloud only');
    assert.strictEqual((await call('/host/status', { headers: userHeaders('relay-u1') })).status, 401,
      'miniapp/legacy user tokens must not be used for desktop sync discovery');
    assert.strictEqual((await call('/host/status', { headers: desktopHeaders() })).status, 200);
    assert.strictEqual((await call('/desktop-sync/devices/register', {
      method: 'POST', headers: desktopHeaders(), body: JSON.stringify({ deviceName: 'Relay PC' }),
    })).status, 200);
    const legalChanges = [{ id: 'relay-op-1', table: 'courses', action: 'update', data: { id: 'course-1' } }];
    const syncCreate = await call('/desktop-sync/requests', {
      method: 'POST', headers: desktopHeaders(), body: JSON.stringify({ pendingChanges: legalChanges }),
    });
    assert.strictEqual(syncCreate.status, 200);
    const syncRequest = (await syncCreate.json()).request;
    const storedSyncTask = service.db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(syncRequest.id);
    const storedSyncPayload = JSON.parse(storedSyncTask.payload);
    assert.deepStrictEqual({
      actorUserId: storedSyncPayload.relayAssertion.actorUserId,
      deviceId: storedSyncPayload.relayAssertion.deviceId,
      sessionId: storedSyncPayload.relayAssertion.sessionId,
      activeRole: storedSyncPayload.relayAssertion.activeRole,
      teacherId: storedSyncPayload.relayAssertion.teacherId,
      authVersion: storedSyncPayload.relayAssertion.authVersion,
      credentialVersion: storedSyncPayload.relayAssertion.credentialVersion,
    }, {
      actorUserId: 'desktop-relay-u1', deviceId: 'relay-device-1', sessionId: 'relay-desktop-session-1',
      activeRole: 'teacher', teacherId: 'relay-teacher-1', authVersion: 4, credentialVersion: 2,
    });
    assert.strictEqual((await call(`/desktop-sync/requests/${syncRequest.id}/result`, { headers: desktopHeaders() })).status, 200);
    assert.strictEqual((await call('/desktop-sync/requests', {
      method: 'POST', headers: { 'x-gewu-desktop-sync-token': 'legacy-sync-token', 'x-device-id': 'relay-device-1' },
      body: JSON.stringify({ pendingChanges: legalChanges }),
    })).status, 401, 'legacy shared sync token must not replace an online V2 desktop session');
    service.db.prepare("UPDATE desktop_device_authorizations SET status='revoked', credential_version=credential_version+1 WHERE device_id='relay-device-1'").run();
    assert.strictEqual((await call('/desktop-sync/requests', {
      method: 'POST', headers: desktopHeaders(), body: JSON.stringify({ pendingChanges: legalChanges }),
    })).status, 401, 'revoked device must not submit through the backend relay');
    service.db.prepare("UPDATE desktop_device_authorizations SET status='active', credential_version=2 WHERE device_id='relay-device-1'").run();
    const previewSnapshot = { questions: [
      { id: 'q-draft', tenant_id: 'default', type: 'fill', stem: 'draft', answer: 'secret-draft', storage_state: 'local_draft' },
      { id: 'q-visible', tenant_id: 'default', type: 'choice', stem: 'visible', answer: 'secret-answer', storage_state: 'host_committed' },
      { id: 'q-other', tenant_id: 'tenant-b', type: 'fill', stem: 'other', storage_state: 'host_committed' },
    ] };
    assert.strictEqual((await call('/snapshots/publish', { method: 'POST', headers: hostHeaders, body: JSON.stringify({ snapshotType: 'full', version: 'preview-v1', payload: previewSnapshot }) })).status, 200);
    const studentPreview = await call('/snapshots/questions', { headers: userHeaders('relay-u1') });
    assert.strictEqual(studentPreview.status, 200);
    const studentPreviewBody = await studentPreview.json();
    assert.deepStrictEqual(studentPreviewBody.questions.map(item => item.id), ['q-visible']);
    assert.deepStrictEqual([studentPreviewBody.hostAvailable, studentPreviewBody.targetHostDeviceId], [true, 'backend-host']);
    assert.strictEqual(studentPreviewBody.hostBaseUrl, 'https://host.example/base');
    assert.ok(!JSON.stringify(studentPreviewBody).includes('secret'));
    const adminPreview = await call('/snapshots/questions', { headers: userHeaders('relay-admin') });
    assert.deepStrictEqual((await adminPreview.json()).questions.map(item => item.id), ['q-draft', 'q-visible']);
    const forgedInternal = await call('/tasks', {
      method: 'POST',
      headers: { ...userHeaders('relay-admin'), 'x-idempotency-key': 'backend-internal-forbidden' },
      body: JSON.stringify({
        protocolVersion: 2,
        taskType: 'identity-provisioning',
        targetHostDeviceId: 'backend-host',
        payload: {},
      }),
    });
    assert.strictEqual(forgedInternal.status, 403);
    assert.strictEqual((await forgedInternal.json()).code, 'INTERNAL_TASK_TYPE_FORBIDDEN');
    const firstBody = { protocolVersion: 2, taskType: 'paper-export-pdf', targetHostDeviceId: 'backend-host', payload: { questionIds: ['q1'] } };
    const first = await call('/tasks', { method: 'POST', headers: { ...userHeaders('relay-u1'), 'x-idempotency-key': 'backend-idem-1' }, body: JSON.stringify(firstBody) });
    assert.strictEqual(first.status, 200);
    const firstTask = (await first.json()).task;
    const conflict = await call('/tasks', { method: 'POST', headers: { ...userHeaders('relay-u1'), 'x-idempotency-key': 'backend-idem-1' }, body: JSON.stringify({ ...firstBody, payload: { questionIds: ['q2'] } }) });
    assert.strictEqual(conflict.status, 409, 'different request bodies must reach durable idempotency hashing instead of replaying the first HTTP response');

    assert.strictEqual((await call('/tasks/missing/result', { headers: userHeaders('relay-u1') })).status, 404, 'missing task results must match gateway 404 semantics');
    assert.strictEqual((await call(`/tasks/${firstTask.id}/result`, { headers: userHeaders('relay-u2') })).status, 404, 'non-owner task results must fail closed with gateway-compatible 404 semantics');
    const claimedV2 = await (await call('/tasks/claim', { method: 'POST', headers: hostHeaders, body: JSON.stringify({ hostDeviceId: 'backend-host' }) })).json();
    const completionResult = { artifactId: 'artifact-http', accessEndpoint: '/api/cloud-relay-host/artifacts/artifact-http/access' };
    const completionHash = crypto.createHash('sha256').update(JSON.stringify({ accessEndpoint: completionResult.accessEndpoint, artifactId: completionResult.artifactId })).digest('hex');
    const completionUrl = `/tasks/${firstTask.id}/complete`;
    assert.strictEqual((await call(completionUrl, { method: 'POST', headers: hostHeaders, body: JSON.stringify({ claimToken: claimedV2.claimToken, expectedRowVersion: claimedV2.task.row_version, operationId: 'backend-complete-1', resultHash: '0'.repeat(64), result: completionResult }) })).status, 400);
    const completionBody = { claimToken: claimedV2.claimToken, expectedRowVersion: claimedV2.task.row_version, operationId: 'backend-complete-1', resultHash: completionHash, result: completionResult };
    assert.strictEqual((await call(completionUrl, { method: 'POST', headers: hostHeaders, body: JSON.stringify(completionBody) })).status, 200);
    assert.strictEqual((await call(completionUrl, { method: 'POST', headers: hostHeaders, body: JSON.stringify(completionBody) })).status, 200, 'lost completion ACK must replay idempotently');
    assert.strictEqual((await call(completionUrl, { method: 'POST', headers: hostHeaders, body: JSON.stringify({ ...completionBody, operationId: 'backend-complete-2' }) })).status, 409);

    service.db.prepare("INSERT INTO miniapp_tasks (id,task_type,status,payload,created_by,created_at,updated_at,protocol_version) VALUES ('backend-legacy-explicit','paper-export-pdf','pending_host','{}','relay-u1',?,?,1)").run(now, now);
    const explicitPoll = await call('/tasks?status=pending_host&hostDeviceId=backend-host&leaseMs=1000', { headers: hostHeaders });
    const explicitTask = (await explicitPoll.json()).tasks.find(task => task.id === 'backend-legacy-explicit');
    assert.ok(explicitTask?.claimToken);
    assert.strictEqual((await call('/tasks/backend-legacy-explicit/complete', { method: 'POST', headers: hostHeaders, body: JSON.stringify({ success: true, hostDeviceId: 'wrong-host', claimToken: explicitTask.claimToken, expectedRowVersion: explicitTask.row_version, result: {} }) })).status, 409);
    assert.strictEqual((await call('/tasks/backend-legacy-explicit/complete', { method: 'POST', headers: hostHeaders, body: JSON.stringify({ success: true, hostDeviceId: 'backend-host', claimToken: explicitTask.claimToken, expectedRowVersion: explicitTask.row_version, result: {} }) })).status, 200);

    service.db.prepare("INSERT INTO miniapp_tasks (id,task_type,status,payload,created_by,created_at,updated_at,protocol_version) VALUES ('backend-legacy-shared','paper-export-word','pending_host','{}','relay-u1',?,?,1)").run(now, now);
    const [sharedA, sharedB] = await Promise.all([
      call('/tasks?status=pending_host', { headers: hostHeaders }),
      call('/tasks?status=pending_host', { headers: hostHeaders }),
    ]);
    const appearances = [await sharedA.json(), await sharedB.json()].flatMap(body => body.tasks).filter(task => task.id === 'backend-legacy-shared');
    assert.strictEqual(appearances.length, 1);
    assert.strictEqual((await call('/tasks/backend-legacy-shared/complete', { method: 'POST', headers: hostHeaders, body: JSON.stringify({ success: true, result: {} }) })).status, 200);

    assert.strictEqual((await call('/tasks/claim', { method: 'POST', headers: { 'x-gewu-host-token': 'wrong' }, body: JSON.stringify({ hostDeviceId: 'backend-host' }) })).status, 403);
  } finally {
    await new Promise(resolve => listener.close(resolve));
    service.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('backend cloud relay HTTP contract checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
