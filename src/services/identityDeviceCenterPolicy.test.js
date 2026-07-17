const assert = require('assert');

(async () => {
  const {
    approveDesktopChallenge,
    buildApprovalBody,
    buildRejectionBody,
    buildRevocationBody,
    identityDeviceCenterAccess,
    loadIdentityDeviceCenter,
    projectIdentityDeviceCenterSnapshot,
    rejectDesktopChallenge,
    revokeDesktopDevice,
  } = await import('./identityDeviceCenterPolicy.mjs');

  const canonicalSession = {
    authorization: 'Bearer session-token',
    authContext: {
      userId: 'canonical-user',
      deviceId: 'device-host',
      activeRole: 'super_admin',
      eligibleRoles: ['super_admin', 'teacher'],
      teacherId: 'teacher-self',
    },
  };
  const hostRuntime = { nodeRole: 'primary-host', deviceId: 'device-host', hostBaseUrl: 'http://127.0.0.1:3001' };

  assert.deepStrictEqual(identityDeviceCenterAccess({ runtimeConfig: hostRuntime, session: canonicalSession }), {
    visible: true,
    canReview: true,
    canViewAllDevices: true,
    canRevoke: true,
    activeRole: 'super_admin',
    eligibleRoles: ['super_admin', 'teacher'],
    userId: 'canonical-user',
    deviceId: 'device-host',
    teacherId: 'teacher-self',
    isPrimaryHost: true,
  });
  assert.strictEqual(identityDeviceCenterAccess({
    runtimeConfig: hostRuntime,
    session: { ...canonicalSession, authContext: { ...canonicalSession.authContext, activeRole: 'teacher' } },
  }).canReview, false, 'teacher active role must not review even when the same user also has super_admin');
  assert.strictEqual(identityDeviceCenterAccess({
    runtimeConfig: { ...hostRuntime, nodeRole: 'desktop-client' }, session: canonicalSession,
  }).canReview, false, 'ordinary desktop must not expose review actions');
  assert.strictEqual(identityDeviceCenterAccess({
    runtimeConfig: hostRuntime,
    session: { ...canonicalSession, authContext: { ...canonicalSession.authContext, activeRole: 'admin', eligibleRoles: ['admin'] } },
  }).canReview, false, 'ordinary administrator must not review devices');

  const pendingRow = {
    challenge: {
      id: 'challenge-pending-1', deviceId: 'device-2', deviceName: '第二台电脑',
      keyFingerprint: 'a'.repeat(64), status: 'identity_verified_pending_approval', rowVersion: 7,
      createdAt: '2026-07-17T09:00:00.000Z', expiresAt: '2026-07-17T09:10:00.000Z',
    },
    claimant: {
      id: 'canonical-user', name: '本人', maskedPhone: '137****0653',
      eligibleRoles: ['super_admin', 'teacher'], teacherId: 'teacher-self',
    },
  };
  assert.deepStrictEqual(buildApprovalBody(pendingRow), {
    challengeId: 'challenge-pending-1', expectedRowVersion: 7,
  });
  assert.strictEqual(Object.hasOwn(buildApprovalBody(pendingRow), 'userId'), false);
  assert.deepStrictEqual(buildRejectionBody(pendingRow, '信息不符'), {
    challengeId: 'challenge-pending-1', expectedRowVersion: 7, reason: '信息不符',
  });

  const mine = [
    { deviceId: 'device-host', deviceName: '当前数据主机', userId: 'canonical-user', status: 'active', rowVersion: 2, createdAt: '2026-01-01T00:00:00.000Z' },
    { deviceId: 'device-2', deviceName: '第二台电脑', userId: 'canonical-user', status: 'replaced', replacedByDeviceId: 'device-3', rowVersion: 8, createdAt: '2026-02-01T00:00:00.000Z' },
    { deviceId: 'device-3', deviceName: '新电脑', userId: 'canonical-user', status: 'active', rowVersion: 1, createdAt: '2026-03-01T00:00:00.000Z' },
  ];
  const snapshot = projectIdentityDeviceCenterSnapshot({
    pending: [pendingRow], mine, all: [...mine, { deviceId: 'other-1', deviceName: '其他用户电脑', userId: 'other-user', status: 'active', rowVersion: 1, createdAt: '2026-04-01T00:00:00.000Z' }],
    runtimeConfig: hostRuntime, session: canonicalSession,
  });
  assert.strictEqual(snapshot.pending[0].claimant.id, 'canonical-user');
  assert.strictEqual(snapshot.pending[0].sameClaimantAndReviewer, true);
  assert.strictEqual(snapshot.mine.find(item => item.deviceId === 'device-host').isHost, true);
  assert.strictEqual(snapshot.mine.find(item => item.deviceId === 'device-host').canRevoke, false);
  assert.strictEqual(snapshot.mine.find(item => item.deviceId === 'device-2').replacedByName, '新电脑');
  assert.deepStrictEqual(snapshot.mine.find(item => item.deviceId === 'device-3').replacesDeviceIds, ['device-2']);
  assert.strictEqual(snapshot.all.length, 4);
  assert.strictEqual(snapshot.identity.teacherId, 'teacher-self');

  assert.deepStrictEqual(buildRevocationBody(
    snapshot.mine.find(item => item.deviceId === 'device-2'),
    { reason: 'replaced', replacementDeviceId: 'device-3' }
  ), {
    deviceId: 'device-2', expectedRowVersion: 8, reason: 'replaced', replacementDeviceId: 'device-3',
  });

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const items = String(url).endsWith('/authorizations/pending') ? [pendingRow] : mine;
    return { ok: true, json: async () => ({ success: true, data: { items, challenge: {}, authorization: {} } }) };
  };
  const loaded = await loadIdentityDeviceCenter({
    baseUrl: 'http://127.0.0.1:3001', runtimeConfig: hostRuntime, session: canonicalSession, fetchImpl,
  });
  assert.strictEqual(loaded.pending.length, 1);
  assert.strictEqual(calls.length, 3);
  assert.ok(calls.every(call => call.options.headers.Authorization === 'Bearer session-token'));

  calls.length = 0;
  await approveDesktopChallenge({
    baseUrl: 'http://127.0.0.1:3001', session: canonicalSession,
    request: buildApprovalBody(pendingRow), fetchImpl,
  });
  assert.ok(calls[0].url.endsWith('/api/desktop-identity/challenges/challenge-pending-1/approve'));
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { expectedRowVersion: 7 });
  assert.strictEqual(Object.hasOwn(JSON.parse(calls[0].options.body), 'userId'), false);

  calls.length = 0;
  await rejectDesktopChallenge({
    baseUrl: 'http://127.0.0.1:3001', session: canonicalSession,
    request: buildRejectionBody(pendingRow, 'mismatch'), fetchImpl,
  });
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { expectedRowVersion: 7, reason: 'mismatch' });

  calls.length = 0;
  await revokeDesktopDevice({
    baseUrl: 'http://127.0.0.1:3001', session: canonicalSession,
    request: buildRevocationBody(mine[1], { reason: 'replaced', replacementDeviceId: 'device-3' }), fetchImpl,
  });
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
    expectedRowVersion: 8, reason: 'replaced', replacementDeviceId: 'device-3',
  });

  console.log('identity device center policy checks passed');
})().catch(error => { console.error(error); process.exit(1); });
