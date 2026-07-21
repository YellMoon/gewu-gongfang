const assert = require('assert');

(async () => {
  const {
    approveDesktopChallenge,
    buildApprovalBody,
    buildRejectionBody,
    buildRevocationBody,
    identityDeviceCenterAccess,
    activatePrimaryHostTransfer,
    beginPrimaryHostTransfer,
    bootstrapPrimaryHost,
    loadIdentityDeviceCenter,
    projectIdentityDeviceCenterSnapshot,
    readPrimaryHostOperationChallenge,
    recoverPrimaryHost,
    rejectDesktopChallenge,
    revokeDesktopDevice,
    startPrimaryHostOperation,
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
  const hostRuntime = { nodeRole: 'primary-host', primaryHostCapable: true, deviceId: 'device-host', hostBaseUrl: 'http://127.0.0.1:3001' };

  assert.deepStrictEqual(identityDeviceCenterAccess({ runtimeConfig: hostRuntime, session: canonicalSession }), {
    visible: true,
    canReview: true,
    canViewAllDevices: true,
    canRevoke: true,
    canManageHost: true,
    activeRole: 'super_admin',
    eligibleRoles: ['super_admin', 'teacher'],
    userId: 'canonical-user',
    deviceId: 'device-host',
    teacherId: 'teacher-self',
    isPrimaryHost: true,
    primaryHostCapable: true,
  });
  assert.strictEqual(identityDeviceCenterAccess({
    runtimeConfig: hostRuntime,
    session: { ...canonicalSession, authContext: { ...canonicalSession.authContext, activeRole: 'teacher' } },
  }).canReview, false, 'teacher active role must not review even when the same user also has super_admin');
  assert.strictEqual(identityDeviceCenterAccess({
    runtimeConfig: { ...hostRuntime, nodeRole: 'desktop-client' }, session: canonicalSession,
  }).canReview, false, 'ordinary desktop must not expose review actions');
  assert.strictEqual(identityDeviceCenterAccess({
    runtimeConfig: { ...hostRuntime, nodeRole: 'desktop-client', primaryHostCapable: false }, session: canonicalSession,
  }).canManageHost, false, 'ordinary build must not expose primary-host migration or recovery operations');
  assert.strictEqual(identityDeviceCenterAccess({
    runtimeConfig: hostRuntime,
    session: { ...canonicalSession, authContext: { ...canonicalSession.authContext, activeRole: 'admin', eligibleRoles: ['admin'] } },
  }).canReview, false, 'ordinary administrator must not review devices');

  const pendingRow = {
    challenge: {
      id: 'challenge-pending-1', deviceId: 'device-2', deviceName: '第二台电脑',
      keyFingerprint: 'a'.repeat(64), purpose: 'password_reset',
      status: 'identity_verified_pending_approval', rowVersion: 7,
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
    hostRuntimeStatus: {
      credential: {
        state: 'staged', active: false, stageId: 'bootstrap:host-challenge',
        deviceId: 'device-host', generation: 1,
      },
    },
    hostControl: {
      activeEpoch: {
        id: 'epoch-1', generation: 1, deviceId: 'device-host', userId: 'canonical-user',
        rowVersion: 3, status: 'active', activatedAt: '2026-07-18T00:00:00.000Z',
      },
      transfers: [], history: [],
    },
  });
  assert.strictEqual(snapshot.pending[0].claimant.id, 'canonical-user');
  assert.strictEqual(snapshot.pending[0].purpose, 'password_reset');
  assert.strictEqual(snapshot.pending[0].sameClaimantAndReviewer, true);
  assert.strictEqual(snapshot.mine.find(item => item.deviceId === 'device-host').isHost, true);
  assert.strictEqual(snapshot.mine.find(item => item.deviceId === 'device-host').canRevoke, false);
  assert.strictEqual(snapshot.mine.find(item => item.deviceId === 'device-2').replacedByName, '新电脑');
  assert.deepStrictEqual(snapshot.mine.find(item => item.deviceId === 'device-3').replacesDeviceIds, ['device-2']);
  assert.strictEqual(snapshot.all.length, 4);
  assert.strictEqual(snapshot.identity.teacherId, 'teacher-self');
  assert.strictEqual(snapshot.host.activeEpoch.id, 'epoch-1');
  assert.strictEqual(snapshot.host.isActiveHostDevice, true);
  assert.strictEqual(snapshot.host.canStartTransfer, true);
  assert.strictEqual(snapshot.host.requiresRuntimeAdoption, true);
  assert.strictEqual(snapshot.host.canResumeRuntimeAdoption, true);
  assert.strictEqual(snapshot.host.pendingCredentialStage.stageId, 'bootstrap:host-challenge');

  const pendingRecoveryDelivery = {
    id: 'delivery-1',
    epochId: 'epoch-1',
    factorId: 'factor-1',
    generation: 1,
    status: 'pending',
    rowVersion: 1,
    ackNonce: 'a'.repeat(64),
    recipientKeyFingerprint: 'b'.repeat(64),
    envelope: { ciphertext: 'target-device-ciphertext' },
  };
  const localRecoveryDelivery = {
    credential: {
      state: 'active',
      recoveryDelivery: { pending: true, deliveryId: 'delivery-1', epochId: 'epoch-1', rowVersion: 1 },
    },
  };
  const bootstrapBlocked = projectIdentityDeviceCenterSnapshot({
    mine,
    all: mine,
    runtimeConfig: hostRuntime,
    session: canonicalSession,
    hostRuntimeStatus: localRecoveryDelivery,
    hostControl: {
      activeEpoch: null,
      transfers: [],
      history: [],
      recoveryDeliveryPending: true,
      pendingRecoveryDelivery,
    },
  });
  assert.strictEqual(bootstrapBlocked.host.recoveryDeliveryPending, true);
  assert.strictEqual(bootstrapBlocked.host.recoveryDelivery.id, 'delivery-1');
  assert.strictEqual(bootstrapBlocked.host.hasLocalRecoveryDelivery, true);
  assert.strictEqual(bootstrapBlocked.host.blocksHighRiskOperations, true);
  assert.strictEqual(bootstrapBlocked.host.canBootstrap, false);

  const transferBlocked = projectIdentityDeviceCenterSnapshot({
    mine,
    all: mine,
    runtimeConfig: hostRuntime,
    session: canonicalSession,
    hostRuntimeStatus: localRecoveryDelivery,
    hostControl: {
      activeEpoch: snapshot.host.activeEpoch,
      transfers: [],
      history: [],
      recoveryDeliveryPending: true,
      pendingRecoveryDelivery,
    },
  });
  assert.strictEqual(transferBlocked.host.canStartTransfer, false);

  const remoteHostBlocked = projectIdentityDeviceCenterSnapshot({
    mine,
    all: mine,
    runtimeConfig: { ...hostRuntime, nodeRole: 'desktop-client' },
    session: canonicalSession,
    hostRuntimeStatus: localRecoveryDelivery,
    hostControl: {
      activeEpoch: {
        id: 'epoch-remote', generation: 2, deviceId: 'device-3', userId: 'canonical-user',
        rowVersion: 1, status: 'active', activatedAt: '2026-07-18T01:00:00.000Z',
      },
      transfers: [{
        id: 'transfer-incoming', status: 'pending_validation', targetDeviceId: 'device-host',
      }],
      history: [],
      recoveryDeliveryPending: true,
    },
  });
  assert.strictEqual(remoteHostBlocked.host.recoveryDelivery, null);
  assert.strictEqual(remoteHostBlocked.host.canActivateTransfer, false);
  assert.strictEqual(remoteHostBlocked.host.canRecover, false);

  const demotionSnapshot = projectIdentityDeviceCenterSnapshot({
    mine,
    all: mine,
    runtimeConfig: {
      ...hostRuntime,
      primaryHostEpochId: 'epoch-1',
      primaryHostGeneration: 1,
    },
    session: canonicalSession,
    hostControl: {
      activeEpoch: {
        id: 'epoch-2', generation: 2, deviceId: 'device-3', userId: 'canonical-user',
        rowVersion: 1, status: 'active', activatedAt: '2026-07-18T01:00:00.000Z',
      },
      transfers: [], history: [],
    },
  });
  assert.strictEqual(demotionSnapshot.host.isActiveHostDevice, false);
  assert.strictEqual(demotionSnapshot.host.requiresRuntimeDemotion, true,
    'a retired local host epoch must be demoted after another device becomes active');
  assert.strictEqual(demotionSnapshot.host.canRecover, false,
    'a retired local credential must be cleared before staging a recovery generation');

  assert.deepStrictEqual(buildRevocationBody(
    snapshot.mine.find(item => item.deviceId === 'device-2'),
    { reason: 'replaced', replacementDeviceId: 'device-3' }
  ), {
    deviceId: 'device-2', expectedRowVersion: 8, reason: 'replaced', replacementDeviceId: 'device-3',
  });

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/primary-host/status')) {
      return { ok: true, json: async () => ({ success: true, data: {
        activeEpoch: { id: 'epoch-1', generation: 1, deviceId: 'device-host', userId: 'canonical-user', rowVersion: 3, status: 'active' },
        transfers: [], history: [],
      } }) };
    }
    const items = String(url).endsWith('/authorizations/pending') ? [pendingRow] : mine;
    return { ok: true, json: async () => ({ success: true, data: {
      items, challenge: { id: 'host-challenge', status: 'pending_phone', rowVersion: 1 },
      authorization: {}, transfer: { id: 'transfer-1' }, epoch: { id: 'epoch-1' },
    } }) };
  };
  const loaded = await loadIdentityDeviceCenter({
    baseUrl: 'http://127.0.0.1:3001', runtimeConfig: hostRuntime, session: canonicalSession, fetchImpl,
  });
  assert.strictEqual(loaded.pending.length, 1);
  assert.strictEqual(calls.length, 4);
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

  calls.length = 0;
  await startPrimaryHostOperation({
    baseUrl: 'http://127.0.0.1:3001', session: canonicalSession,
    request: { operation: 'bootstrap', targetDeviceId: 'device-host' }, fetchImpl,
  });
  assert.ok(calls[0].url.endsWith('/api/desktop-identity/primary-host/challenges/start'));
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { operation: 'bootstrap', targetDeviceId: 'device-host' });
  calls.length = 0;
  await readPrimaryHostOperationChallenge({
    baseUrl: 'http://127.0.0.1:3001', challengeId: 'host-challenge', fetchImpl,
  });
  assert.ok(calls[0].url.endsWith('/api/desktop-identity/primary-host/challenges/host-challenge/public'));
  assert.ok(!calls[0].options.headers.Authorization);

  const operationContext = { baseUrl: 'http://127.0.0.1:3001', session: canonicalSession, fetchImpl };
  calls.length = 0;
  await bootstrapPrimaryHost({ ...operationContext, request: {
    challengeId: 'host-challenge', expectedChallengeRowVersion: 2,
    localReceipt: { receipt: { version: 2 }, signature: 'signed' },
    operationManifest: { credentialStage: { id: 'bootstrap:host-challenge' } },
  } });
  assert.ok(calls[0].url.endsWith('/api/desktop-identity/primary-host/bootstrap'));
  assert.deepStrictEqual(JSON.parse(calls[0].options.body).operationManifest, {
    credentialStage: { id: 'bootstrap:host-challenge' },
  });
  calls.length = 0;
  await beginPrimaryHostTransfer({ ...operationContext, request: {
    challengeId: 'host-challenge', expectedChallengeRowVersion: 2, expectedActiveEpochRowVersion: 3,
  } });
  assert.ok(calls[0].url.endsWith('/api/desktop-identity/primary-host/transfers'));
  calls.length = 0;
  await activatePrimaryHostTransfer({ ...operationContext, transferId: 'transfer-1', request: {
    expectedTransferRowVersion: 1, localReceipt: { receipt: {}, signature: 'signed' }, validationManifest: {},
    preflightProof: { id: 'proof-transfer', token: 'proof-token-transfer' },
  } });
  assert.ok(calls[0].url.endsWith('/api/desktop-identity/primary-host/transfers/transfer-1/activate'));
  assert.strictEqual(JSON.parse(calls[0].options.body).preflightProof.id, 'proof-transfer');
  calls.length = 0;
  await recoverPrimaryHost({ ...operationContext, request: {
    challengeId: 'host-challenge', expectedChallengeRowVersion: 2, factorId: 'factor-1',
    recoveryCode: 'recovery-code', localReceipt: { receipt: {}, signature: 'signed' }, evidence: {},
    preflightProof: { id: 'proof-recovery', token: 'proof-token-recovery' },
  } });
  assert.ok(calls[0].url.endsWith('/api/desktop-identity/primary-host/recover'));
  assert.strictEqual(JSON.parse(calls[0].options.body).preflightProof.id, 'proof-recovery');

  console.log('identity device center policy checks passed');
})().catch(error => { console.error(error); process.exit(1); });
