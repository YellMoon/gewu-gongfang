const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-relay-auth-'));
process.env.GATEWAY_DB_PATH = path.join(root, 'gateway.db');
process.env.GEWU_CLOUD_RELAY_HOST_TOKEN = 'test-host-secret';
const { initDatabase, closeDatabase, getDb } = require('../db/database');
const { verifyRelayAssertion } = require('../../../backend/src/services/relayAssertionService');
const taskService = require('../services/cloudRelayTaskService');
const router = require('./cloudRelay');
const pairingRouter = require('./desktopPairing');

(async () => {
  initDatabase();
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-test-user']) req.user = JSON.parse(req.headers['x-test-user']);
    if (req.headers['x-test-authz']) req.authz = JSON.parse(req.headers['x-test-authz']);
    next();
  });
  app.use('/api/cloud', router);
  app.use('/api/desktop-pairing', pairingRouter);
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/api/cloud`;
  // The full Windows suite also runs Python formula tests and several SQLite
  // migrations. Give this local in-process HTTP fixture enough headroom under
  // that transient load; this does not change any production timeout.
  const call = (url, options = {}) => fetch(base + url, { ...options, signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const pairingCall=(url,options={})=>fetch(`http://127.0.0.1:${server.address().port}/api/desktop-pairing${url}`,{
    method:options.method||'POST',headers:{'content-type':'application/json',...(options.headers||{})},
    ...(options.method==='GET'?{}:{body:JSON.stringify(options.body||{})}),
  });
  const pairingRowsBefore=getDb().prepare('SELECT COUNT(*) count FROM desktop_device_pairings').get().count;
  for (const [url,options] of [
    ['/start',{body:{deviceId:'pair-http-d1',secret:'a'.repeat(64)}}],
    ['/exchange',{body:{id:'legacy',secret:'a'.repeat(64)}}],
    ['/pending',{method:'GET'}],
    ['/legacy/approve',{body:{userId:'teacher1'}}],
    ['/code/123456/reject',{body:{}}],
  ]) {
    const response=await pairingCall(url,options);
    assert.strictEqual(response.status,410,`${url} must be tombstoned`);
    assert.strictEqual((await response.json()).code,'DESKTOP_PAIRING_V1_REMOVED');
  }
  assert.strictEqual(getDb().prepare('SELECT COUNT(*) count FROM desktop_device_pairings').get().count,pairingRowsBefore,
    'V1 tombstones must not write pairing rows');
  assert.strictEqual((await call('/snapshots/publish', { method: 'POST', body: '{}' })).status, 403);
  assert.strictEqual((await call('/tasks')).status, 403);
  assert.strictEqual((await call('/tasks/x/complete', { method: 'POST', headers: { 'x-gewu-host-token': 'wrong' }, body: '{}' })).status, 403);
  assert.strictEqual((await call('/host/heartbeat', { method: 'POST', headers: { 'x-gewu-host-token': 'test-host-secret' }, body: JSON.stringify({ hostDeviceId: 'host1', baseUrl: 'https://host.example/base/' }) })).status, 200);
  const pairingCapability = {
    protocolVersion: 'gewu-single-user-pairing/v1',
    id: 'a'.repeat(32),
    publicKey: 'x25519-public-key',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  const publishedCapability = await call('/desktop-pairing/capability', {
    method: 'POST',
    headers: { 'x-gewu-host-token': 'test-host-secret' },
    body: JSON.stringify({
      hostDeviceId: 'host1',
      epochId: 'epoch-1',
      generation: 1,
      capability: pairingCapability,
    }),
  });
  assert.strictEqual(publishedCapability.status, 200);
  const publicCapability = await call('/desktop-pairing/capability');
  assert.strictEqual(publicCapability.status, 200);
  assert.strictEqual((await publicCapability.json()).capability.id, pairingCapability.id);
  const pairingRequestSecret = 'client-only-request-secret-1';
  const pairingRequestSecretHash = crypto.createHash('sha256').update(pairingRequestSecret).digest('hex');
  const encryptedEnvelope = {
    protocolVersion: pairingCapability.protocolVersion,
    capabilityId: pairingCapability.id,
    clientEphemeralPublicKey: 'ephemeral-x25519-public-key',
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: Buffer.from('opaque-ciphertext-without-pairing-code').toString('base64'),
    tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
  };
  const submittedPairing = await call('/desktop-pairing/requests', {
    method: 'POST',
    body: JSON.stringify({ envelope: encryptedEnvelope, requestSecretHash: pairingRequestSecretHash }),
  });
  assert.strictEqual(submittedPairing.status, 200);
  const submittedPairingBody = await submittedPairing.json();
  assert.strictEqual(submittedPairingBody.request.status, 'pending_host');
  assert.ok(!JSON.stringify(submittedPairingBody).includes('0123456789ABCDEF'));
  assert.strictEqual((await call(`/desktop-pairing/requests/${submittedPairingBody.request.id}`, {
    headers: { 'x-pairing-request-secret': 'wrong-secret' },
  })).status, 404);
  const pairingClaimResponse = await call('/tasks/claim', {
    method: 'POST',
    headers: { 'x-gewu-host-token': 'test-host-secret' },
    body: JSON.stringify({ hostDeviceId: 'host1', leaseMs: 1000 }),
  });
  const pairingClaim = await pairingClaimResponse.json();
  assert.strictEqual(pairingClaim.task.task_type, 'desktop-pairing');
  assert.deepStrictEqual(pairingClaim.task.payload.envelope, encryptedEnvelope);
  const pairingResult = {
    authorization: { id: 'ordinary-authorization-1', authorizationSource: 'single_user_pairing' },
    profile: { userId: 'canonical-owner', eligibleRoles: ['super_admin'] },
    offlineLease: { id: 'offline-lease-1' },
  };
  const pairingCompletion = await call(`/tasks/${pairingClaim.task.id}/complete`, {
    method: 'POST',
    headers: { 'x-gewu-host-token': 'test-host-secret' },
    body: JSON.stringify({
      claimToken: pairingClaim.claimToken,
      expectedRowVersion: pairingClaim.task.row_version,
      operationId: 'pairing-complete-1',
      resultHash: taskService.resultHash(pairingResult),
      result: pairingResult,
    }),
  });
  assert.strictEqual(pairingCompletion.status, 200);
  const completedPairing = await call(`/desktop-pairing/requests/${submittedPairingBody.request.id}`, {
    headers: { 'x-pairing-request-secret': pairingRequestSecret },
  });
  const completedPairingBody = await completedPairing.json();
  assert.strictEqual(completedPairingBody.request.status, 'completed');
  assert.strictEqual(completedPairingBody.request.result.authorization.id, 'ordinary-authorization-1');
  const rereadPairing = await call(`/desktop-pairing/requests/${submittedPairingBody.request.id}`, {
    headers: { 'x-pairing-request-secret': pairingRequestSecret },
  });
  assert.strictEqual((await rereadPairing.json()).request.result, null, 'pairing result payload must be one-time read');
  assert.strictEqual(
    getDb().prepare('SELECT result_payload FROM desktop_pairing_relay_requests WHERE id=?').get(submittedPairingBody.request.id).result_payload,
    null
  );
  assert.strictEqual(
    getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='desktop_device_authorizations'").get(),
    undefined,
    'gateway must not contain the local desktop authorization table'
  );
  for (let attempt = 0; attempt < 19; attempt += 1) {
    const invalidRateProbe = await call('/desktop-pairing/requests', { method: 'POST', body: '{}' });
    assert.strictEqual(invalidRateProbe.status, 400);
  }
  assert.strictEqual(
    (await call('/desktop-pairing/requests', { method: 'POST', body: '{}' })).status,
    429,
    'anonymous pairing submission must be rate limited by source address'
  );
  getDb().prepare("UPDATE desktop_pairing_capabilities SET status='expired'").run();
  const offlineCapability = await call('/desktop-pairing/capability');
  assert.strictEqual(offlineCapability.status, 503);
  assert.strictEqual((await offlineCapability.json()).code, 'PAIRING_HOST_OFFLINE');
  const now = new Date().toISOString();
  getDb().prepare("INSERT INTO miniapp_tasks (id,task_type,status,payload,created_by,created_at,updated_at) VALUES ('task1','question-paper','pending_host','{}','u1',?,?)").run(now, now);
  assert.strictEqual((await call('/tasks', { headers: { 'x-gewu-host-token': 'test-host-secret' } })).status, 410);
  assert.strictEqual((await call('/tasks/task1/complete', { method: 'POST', headers: { 'x-gewu-host-token': 'test-host-secret' }, body: '{}' })).status, 410);
  const approved = id => JSON.stringify({ id, user_type: 'student', student_id: id, tenant_id: 'tenant-a', review_status: 'approved', status: 1, login_enabled: 1 });
  const approvedUnbound = id => JSON.stringify({ id, user_type: 'student', tenant_id: 'tenant-a', review_status: 'approved', status: 1, login_enabled: 1 });
  const admin = id => JSON.stringify({ id, user_type: 'admin', tenant_id: 'tenant-a', review_status: 'approved', status: 1, login_enabled: 1 });
  assert.strictEqual(
    (await call(`/tasks/${submittedPairingBody.request.id}/result`, {
      headers: { 'x-test-user': admin('pairing-admin') },
    })).status,
    404,
    'generic task result API must not expose desktop pairing results'
  );
  const previewSnapshot = { questions: [
    { id: 'q-draft', tenant_id: 'tenant-a', type: 'fill', stem: 'draft', answer: 'secret-draft', storage_state: 'local_draft' },
    { id: 'q-visible', tenant_id: 'tenant-a', type: 'choice', stem: 'visible', answer: 'secret-answer', analysis: 'secret-analysis', storage_state: 'host_committed' },
    { id: 'q-other', tenant_id: 'tenant-b', type: 'fill', stem: 'other tenant', storage_state: 'host_committed' },
  ] };
  assert.strictEqual((await call('/snapshots/publish', { method: 'POST', headers: { 'x-gewu-host-token': 'test-host-secret' }, body: JSON.stringify({ snapshotType: 'full', version: 'preview-v1', payload: previewSnapshot }) })).status, 200);
  const studentPreview = await call('/snapshots/questions', { headers: { 'x-test-user': approved('u1') } });
  assert.strictEqual(studentPreview.status, 200);
  const studentPreviewBody = await studentPreview.json();
  assert.deepStrictEqual(studentPreviewBody.questions.map(item => item.id), ['q-visible']);
  assert.deepStrictEqual([studentPreviewBody.hostAvailable, studentPreviewBody.targetHostDeviceId], [true, 'host1']);
  assert.strictEqual(studentPreviewBody.hostBaseUrl, 'https://host.example/base');
  assert.ok(!JSON.stringify(studentPreviewBody).includes('secret'));
  const adminPreview = await call('/snapshots/questions', { headers: { 'x-test-user': admin('admin1') } });
  assert.deepStrictEqual((await adminPreview.json()).questions.map(item => item.id), ['q-draft', 'q-visible']);
  const teacher = id => JSON.stringify({ id, user_type:'teacher', teacher_id:'t1', review_status:'approved', status:1, login_enabled:1 });
  const desktopAuthz = (id, deviceId, overrides={}) => JSON.stringify({
    userId:id,deviceId,activeRole:'teacher',role:'teacher',teacherId:'t1',studentId:null,
    sessionId:`sid-${id}-${deviceId}`,authVersion:4,credentialVersion:2,
    sessionExpiresAt:new Date(Date.now()+60*60*1000).toISOString(),tokenUse:'desktop-session',clientType:'desktop',
    userApproved:true,deviceActive:true,deviceTrusted:true,...overrides,
  });
  const desktopHeaders=(id,deviceId,overrides={})=>({'x-test-user':teacher(id),'x-test-authz':desktopAuthz(id,deviceId,overrides),'x-device-id':deviceId});
  const legacyDesktopSync = await call('/desktop-sync/devices/register', {
    method: 'POST', headers: desktopHeaders('teacher1', 'cloud-d1'), body: '{}',
  });
  assert.strictEqual(legacyDesktopSync.status, 410);
  assert.strictEqual((await legacyDesktopSync.json()).error.code, 'LEGACY_ARCHITECTURE_RETIRED');
  assert.strictEqual(
    getDb().prepare("SELECT COUNT(*) AS count FROM miniapp_tasks WHERE task_type='desktop-sync'").get().count,
    0,
    'legacy desktop sync must not enqueue a task before cutover',
  );
  assert.strictEqual((await call('/tasks/task1/result', { headers: { 'x-test-user': approved('u2') } })).status, 404);
  assert.strictEqual((await call('/tasks/task1/result', { headers: { 'x-test-user': approved('u1') } })).status, 200);
  const v2Body = JSON.stringify({ protocolVersion: 2, taskType: 'paper-export-pdf', targetHostDeviceId: 'host1', payload: { questionIds: ['q2', 'q1'], title: 'paper' } });
  const unboundTask = await call('/tasks', { method: 'POST', headers: { 'x-test-user': approvedUnbound('unbound-student'), 'x-idempotency-key': 'idem-http-unbound' }, body: v2Body });
  assert.strictEqual(unboundTask.status, 403, 'an unbound miniapp account must not submit subject-owned paper tasks');
  const v2Create = await call('/tasks', { method: 'POST', headers: { 'x-test-user': approved('u1'), 'x-idempotency-key': 'idem-http-1' }, body: v2Body });
  assert.strictEqual(v2Create.status, 200);
  const v2Created = await v2Create.json();
  assert.strictEqual(v2Created.task.protocol_version, 2);
  assert.strictEqual(v2Created.task.target_host_device_id, 'host1');
  const v2Replay = await call('/tasks', { method: 'POST', headers: { 'x-test-user': approved('u1'), 'x-idempotency-key': 'idem-http-1' }, body: v2Body });
  assert.strictEqual((await v2Replay.json()).task.id, v2Created.task.id, 'HTTP idempotency replay must return the original task');
  assert.strictEqual((await call('/tasks', { method: 'POST', headers: { 'x-test-user': approved('u1'), 'x-idempotency-key': 'idem-http-1' }, body: JSON.stringify({ ...JSON.parse(v2Body), payload: { questionIds: ['q1'] } }) })).status, 409);

  const legacyCreate = await call('/tasks', {
    method: 'POST',
    headers: { 'x-test-user': approved('u1') },
    body: JSON.stringify({ taskType: 'paper-export-pdf', payload: {} }),
  });
  assert.strictEqual(legacyCreate.status, 410, 'V1 task creation must be permanently retired');
  assert.strictEqual((await legacyCreate.json()).error.code, 'LEGACY_ARCHITECTURE_RETIRED');
  const legacyPending = await call('/tasks', { headers: { 'x-gewu-host-token': 'test-host-secret' } });
  assert.strictEqual(legacyPending.status, 410, 'V1 task polling must be permanently retired');
  assert.strictEqual((await legacyPending.json()).error.code, 'LEGACY_ARCHITECTURE_RETIRED');
  getDb().prepare("INSERT INTO miniapp_tasks (id,task_type,status,payload,created_by,created_at,updated_at,protocol_version) VALUES ('legacy-complete-http','paper-export-pdf','pending_host','{}','u1',?,?,1)").run(now, now);
  const legacyComplete = await call('/tasks/legacy-complete-http/complete', {
    method: 'POST',
    headers: { 'x-gewu-host-token': 'test-host-secret' },
    body: JSON.stringify({ success: true, result: {} }),
  });
  assert.strictEqual(legacyComplete.status, 410, 'V1 task completion must be permanently retired');
  assert.strictEqual((await legacyComplete.json()).error.code, 'LEGACY_ARCHITECTURE_RETIRED');
  const claimResponse = await call('/tasks/claim', { method: 'POST', headers: { 'x-gewu-host-token': 'test-host-secret' }, body: JSON.stringify({ hostDeviceId: 'host1', leaseMs: 1000 }) });
  const claimed = await claimResponse.json();
  assert.strictEqual(claimed.task.id, v2Created.task.id);
  assert.ok(claimed.claimToken);
  const duplicateClaim = await call('/tasks/claim', { method: 'POST', headers: { 'x-gewu-host-token': 'test-host-secret' }, body: JSON.stringify({ hostDeviceId: 'host1' }) });
  assert.strictEqual((await duplicateClaim.json()).task, null, 'active V2 lease must prevent duplicate claim');
  assert.strictEqual((await call(`/tasks/${v2Created.task.id}/progress`, { method: 'POST', headers: { 'x-gewu-host-token': 'test-host-secret' }, body: JSON.stringify({ claimToken: 'stale', expectedRowVersion: claimed.task.row_version, phase: 'rendering', progress: 40 }) })).status, 409);
  assert.strictEqual((await call(`/tasks/${v2Created.task.id}/progress`, { method: 'POST', headers: { 'x-gewu-host-token': 'test-host-secret' }, body: JSON.stringify({ claimToken: claimed.claimToken, expectedRowVersion: claimed.task.row_version, phase: 'made-up-phase', progress: 40 }) })).status, 400);
  const progressResponse = await call(`/tasks/${v2Created.task.id}/progress`, { method: 'POST', headers: { 'x-gewu-host-token': 'test-host-secret' }, body: JSON.stringify({ claimToken: claimed.claimToken, expectedRowVersion: claimed.task.row_version, phase: 'rendering', progress: 40 }) });
  const progressed = await progressResponse.json();
  assert.deepStrictEqual([progressed.task.phase, progressed.task.progress], ['rendering', 40]);
  const completionHash = crypto.createHash('sha256').update(JSON.stringify({ fileName: 'paper.pdf' })).digest('hex');
  assert.strictEqual((await call(`/tasks/${v2Created.task.id}/complete`, { method: 'POST', headers: { 'x-gewu-host-token': 'test-host-secret' }, body: JSON.stringify({ claimToken: claimed.claimToken, expectedRowVersion: progressed.task.row_version, operationId: 'gateway-complete-1', resultHash: '0'.repeat(64), result: { fileName: 'paper.pdf' } }) })).status, 400);
  const completionBody = { claimToken: claimed.claimToken, expectedRowVersion: progressed.task.row_version, operationId: 'gateway-complete-1', resultHash: completionHash, result: { fileName: 'paper.pdf' } };
  const completeResponse = await call(`/tasks/${v2Created.task.id}/complete`, { method: 'POST', headers: { 'x-gewu-host-token': 'test-host-secret' }, body: JSON.stringify(completionBody) });
  assert.strictEqual((await completeResponse.json()).task.status, 'completed');
  assert.strictEqual((await call(`/tasks/${v2Created.task.id}/complete`, { method: 'POST', headers: { 'x-gewu-host-token': 'test-host-secret' }, body: JSON.stringify(completionBody) })).status, 200);
  assert.strictEqual((await call(`/tasks/${v2Created.task.id}/complete`, { method: 'POST', headers: { 'x-gewu-host-token': 'test-host-secret' }, body: JSON.stringify({ ...completionBody, resultHash: 'f'.repeat(64) }) })).status, 409);

  const cancelCreate = await call('/tasks', { method: 'POST', headers: { 'x-test-user': approved('u1'), 'x-idempotency-key': 'idem-http-cancel' }, body: v2Body });
  const cancelTask = (await cancelCreate.json()).task;
  const cancelResponse = await call(`/tasks/${cancelTask.id}/cancel`, { method: 'POST', headers: { 'x-test-user': approved('u1') }, body: '{}' });
  assert.strictEqual((await cancelResponse.json()).task.status, 'cancelled');
  getDb().prepare("INSERT INTO miniapp_tasks (id,task_type,status,payload,created_by,created_at,updated_at) VALUES ('task2','question-paper','completed','{}','1',?,?)").run(now, now);
  assert.strictEqual((await call('/tasks/task2/result', { headers: { 'x-test-user': approved(1) } })).status, 200, 'owner ids are normalized as strings in SQL');
  server.close(); closeDatabase(); fs.rmSync(root, { recursive: true, force: true });
  console.log('gateway cloud relay HTTP auth checks passed');
})().catch(err => { console.error(err); process.exit(1); });
