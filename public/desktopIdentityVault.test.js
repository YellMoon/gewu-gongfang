const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const {
  desktopRoleElevationSigningPayload,
} = require('../backend/src/services/desktopSessionService');
const {
  desktopDeviceSessionSigningPayload,
} = require('../backend/src/services/desktopDeviceChallengeService');
const {
  PHYSICAL_CONFIRMATION,
  verifyPrimaryHostLocalReceiptSignature,
} = require('../backend/src/services/primaryHostReceiptProtocol');
const {
  createDesktopIdentityVault,
} = require('./desktopIdentityVault');
const { authorityHttpSigningPayload } = require('../shared/authorityHttpAuth');
const { verifySignedAuthorityProjection } = require('../shared/authorityProjectionProtocol');
const packageJson = require('../package.json');
const offlineLeaseSigningKeyPair = crypto.generateKeyPairSync('ed25519');
const offlineLeasePublicKey = offlineLeaseSigningKeyPair.publicKey;

function offlineLeaseSignaturePayload(lease) {
  return JSON.stringify({
    v: lease.v,
    id: lease.id,
    userId: lease.userId,
    deviceId: lease.deviceId,
    authorizationId: lease.authorizationId,
    credentialVersion: lease.credentialVersion,
    eligibleRoles: lease.eligibleRoles,
    activeRole: lease.activeRole,
    teacherId: lease.teacherId,
    studentId: lease.studentId,
    issuedAt: lease.issuedAt,
    expiresAt: lease.expiresAt,
    scope: lease.scope,
  });
}

function signOfflineLease(lease) {
  const unsigned = { ...lease };
  delete unsigned.signature;
  return {
    ...unsigned,
    signature: crypto.sign(null, Buffer.from(offlineLeaseSignaturePayload(unsigned), 'utf8'), offlineLeaseSigningKeyPair.privateKey).toString('base64url'),
  };
}

function mockSafeStorage() {
  let decryptCount = 0;
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      return Buffer.from(`safe:${Buffer.from(String(value), 'utf8').toString('base64')}`, 'utf8');
    },
    decryptString(value) {
      decryptCount += 1;
      const encoded = Buffer.from(value).toString('utf8');
      if (!encoded.startsWith('safe:')) throw new Error('mock safeStorage integrity failure');
      return Buffer.from(encoded.slice(5), 'base64').toString('utf8');
    },
    stats() {
      return { decryptCount };
    },
  };
}

function approvedAuthorization(publicIdentity) {
  return {
    id: 'authorization-device-2',
    deviceId: publicIdentity.deviceId,
    deviceName: '第二台电脑',
    deviceKind: 'desktop-client',
    userId: 'canonical-human',
    keyFingerprint: publicIdentity.keyFingerprint,
    status: 'active',
    credentialVersion: 1,
    lastPhoneVerifiedAt: '2026-07-17T10:00:00.000Z',
    phoneReverifyDueAt: '2026-08-16T10:00:00.000Z',
  };
}

function approvedProfile() {
  return {
    userId: 'canonical-human',
    user: { id: 'canonical-human', name: '超级管理员老师' },
    eligibleRoles: ['super_admin', 'teacher'],
    activeRole: 'teacher',
    teacherId: 'teacher-self',
    studentId: null,
  };
}

function offlineLease(deviceId = 'device-2') {
  const lease = {
    v: 1,
    id: 'lease-device-2',
    userId: 'canonical-human',
    deviceId,
    authorizationId: 'authorization-device-2',
    credentialVersion: 1,
    eligibleRoles: ['super_admin', 'teacher'],
    teacherId: 'teacher-self',
    studentId: null,
    issuedAt: '2026-07-17T10:00:00.000Z',
    expiresAt: '2026-07-20T10:00:00.000Z',
    activeRole: 'teacher',
    scope: { kind: 'teacher', teacherId: 'teacher-self' },
  };
  return signOfflineLease(lease);
}

function authorityContext(hostPublicKey, deviceId = 'device-2') {
  return {
    userId: 'canonical-human',
    deviceId,
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    hostGeneration: 1,
    hostPublicKey,
    grant: { id: 'grant-1', version: 1 },
    lease: {
      id: 'authority-lease-1',
      activeRole: 'teacher',
      issuedAt: '2026-07-17T10:00:00.000Z',
      expiresAt: '2026-07-31T10:00:00.000Z',
    },
  };
}

function verifySignature(publicKey, payload, signature) {
  return crypto.verify(
    null,
    Buffer.from(payload, 'utf8'),
    crypto.createPublicKey(publicKey),
    Buffer.from(signature, 'base64')
  );
}

async function main() {
  assert.ok(
    packageJson.build.files.includes('public/desktopIdentityVault.js'),
    'packaged Electron app must include the V2 desktop identity vault'
  );

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-desktop-identity-vault-'));
  const filePath = path.join(workspace, 'desktop-identity-v2.bin');
  const legacyFilePath = path.join(workspace, 'desktop-session.bin');
  const businessFile = path.join(workspace, 'scheduling.db');
  fs.writeFileSync(businessFile, 'business-data-must-survive');
  const safeStorage = mockSafeStorage();
  const delays = [];
  let clock = new Date('2026-07-17T10:00:00.000Z');
  const vault = createDesktopIdentityVault({
    filePath,
    legacyFilePath,
    safeStorage,
    offlineLeasePublicKey,
    now: () => new Date(clock),
    delay: async milliseconds => { delays.push(milliseconds); },
  });

  assert.deepStrictEqual(vault.status(), {
    state: 'empty',
    sealed: false,
    unlocked: false,
    legacyUpgradeRequired: false,
  });

  const unifiedVault = createDesktopIdentityVault({
    filePath: path.join(workspace, 'unified-desktop-identity-v2.bin'),
    safeStorage,
    offlineLeasePublicKey,
    now: () => new Date(clock),
  });
  const unifiedPublicIdentity = unifiedVault.beginUnifiedOnlineRegistration({
    deviceName: 'Unified cloud desktop',
  });
  assert.strictEqual(
    unifiedPublicIdentity.deviceId,
    `desktop-device-${unifiedPublicIdentity.keyFingerprint.slice(0, 32)}`,
    'a unified desktop registration must derive its stable installation identity from its own key'
  );
  assert.strictEqual(unifiedPublicIdentity.deviceKind, 'desktop-client');
  const unifiedProof = unifiedVault.signChallenge({
    purpose: 'unified-online-registration',
    challenge: 'cloud-issued-device-proof',
  });
  assert.ok(verifySignature(
    unifiedPublicIdentity.publicKey,
    'cloud-issued-device-proof',
    unifiedProof.signature,
  ));

  const publicIdentity = vault.beginUnifiedOnlineRegistration({ deviceName: 'Desktop client' });
  assert.strictEqual(publicIdentity.deviceKind, 'desktop-client');
  assert.match(publicIdentity.publicKey, /BEGIN PUBLIC KEY/);
  assert.match(publicIdentity.keyFingerprint, /^[a-f0-9]{64}$/);
  assert.deepStrictEqual(Object.keys(publicIdentity).sort(), [
    'deviceId',
    'deviceKind',
    'deviceName',
    'keyFingerprint',
    'publicKey',
  ]);

  const cloudRegistrationProof = vault.signChallenge({
    purpose: 'unified-online-registration',
    challenge: 'cloud-once-device-proof-2',
  });
  assert.strictEqual(cloudRegistrationProof.purpose, 'unified-online-registration');
  assert.ok(verifySignature(
    publicIdentity.publicKey,
    'cloud-once-device-proof-2',
    cloudRegistrationProof.signature,
  ));
  assert.throws(
    () => vault.signChallenge({ purpose: 'raw', payload: 'sign-anything' }),
    /DESKTOP_IDENTITY_SIGNING_PURPOSE_INVALID/
  );

  const authorization = approvedAuthorization(publicIdentity);
  assert.throws(
    () => vault.completeRegistration({
      password: 'local-password-1',
      authorization: { ...authorization, privateKey: 'renderer-supplied-private-key' },
      profile: approvedProfile(),
      offlineLease: offlineLease(publicIdentity.deviceId),
    }),
    /DESKTOP_IDENTITY_VAULT_FORBIDDEN_SECRET/
  );
  const unsignedLease = offlineLease(publicIdentity.deviceId);
  delete unsignedLease.signature;
  assert.throws(
    () => vault.completeRegistration({
      password: 'local-password-1',
      authorization,
      profile: approvedProfile(),
      offlineLease: unsignedLease,
    }),
    /DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID/,
    'the vault must not accept a locally manufactured lease without the cloud signature',
  );
  const forgedLease = offlineLease(publicIdentity.deviceId);
  forgedLease.signature = 'A'.repeat(86);
  assert.throws(
    () => vault.completeRegistration({
      password: 'local-password-1',
      authorization,
      profile: approvedProfile(),
      offlineLease: forgedLease,
    }),
    /DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID/,
    'the vault must verify, not merely store, the cloud signature over lease bindings',
  );
  const completed = vault.completeRegistration({
    password: 'local-password-1',
    authorization,
    profile: approvedProfile(),
    offlineLease: offlineLease(publicIdentity.deviceId),
    authorityContext: authorityContext(publicIdentity.publicKey, publicIdentity.deviceId),
    sessionToken: 'short-session-token',
  });
  assert.strictEqual(completed.state, 'unlocked');
  assert.strictEqual(completed.activeRole, 'teacher');
  assert.deepStrictEqual(completed.eligibleRoles, ['super_admin', 'teacher']);
  assert.strictEqual(completed.teacherId, 'teacher-self');
  assert.ok(!JSON.stringify(completed).includes('PRIVATE KEY'));
  assert.ok(!JSON.stringify(completed).includes('local-password-1'));

  const pendingVault = createDesktopIdentityVault({
    filePath: path.join(workspace, 'pending-desktop-identity-v2.bin'),
    safeStorage,
    offlineLeasePublicKey,
    now: () => new Date(clock),
  });
  const pendingIdentity = pendingVault.beginUnifiedOnlineRegistration({
    deviceName: 'Pending account desktop',
  });
  const pendingAuthorization = approvedAuthorization(pendingIdentity);
  pendingAuthorization.id = 'authorization-pending-device';
  const pendingProfile = {
    userId: pendingAuthorization.userId,
    user: { id: pendingAuthorization.userId, name: 'Pending account' },
    eligibleRoles: ['pending'],
    activeRole: 'pending',
    teacherId: null,
    studentId: null,
  };
  const pendingLease = offlineLease();
  pendingLease.id = 'lease-pending-device';
  pendingLease.deviceId = pendingIdentity.deviceId;
  pendingLease.authorizationId = pendingAuthorization.id;
  pendingLease.eligibleRoles = ['pending'];
  pendingLease.activeRole = 'pending';
  pendingLease.teacherId = null;
  pendingLease.studentId = null;
  pendingLease.scope = { kind: 'pending' };
  const pendingCompleted = pendingVault.completeRegistration({
    password: 'pending-local-password',
    authorization: pendingAuthorization,
    profile: pendingProfile,
    offlineLease: signOfflineLease(pendingLease),
  });
  assert.strictEqual(pendingCompleted.activeRole, 'pending');
  assert.deepStrictEqual(pendingCompleted.eligibleRoles, ['pending']);
  const authoritySocketHandshake = vault.signAuthorityHttpRequest({
    method: 'GET',
    path: '/ws/authority',
    body: null,
  });
  assert.strictEqual(
    authoritySocketHandshake.headers['x-gewu-authority-id'],
    'authority-1',
    'a WebSocket authentication frame must identify the authority whose device grant signs it'
  );
  const authorityCommand = vault.createAuthorityCommand({
    type: 'schedule.update.v1',
    payload: { id: 'schedule-1', changes: { notes: 'safe' } },
    commandId: 'authority-command-1',
    idempotencyKey: 'authority-key-1',
  });
  assert.strictEqual(authorityCommand.envelope.authorityId, 'authority-1');
  assert.strictEqual(authorityCommand.envelope.hostEpochId, 'epoch-1');
  assert.strictEqual(authorityCommand.envelope.lease.id, 'authority-lease-1');
  assert.strictEqual(authorityCommand.envelope.actor.role, 'teacher');
  assert.ok(verifySignature(
    publicIdentity.publicKey,
    authorityHttpSigningPayload({
      method: 'POST',
      path: '/api/authority/commands',
      actor: authorityCommand.envelope.actor,
      body: authorityCommand.envelope,
    }),
    authorityCommand.requestAuth.signature
  ));
  const authorityProjection = vault.signAuthorityProjection({
    protocol: 'gewu.authority-projection.v1',
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    userId: 'canonical-human',
    role: 'teacher',
    sourceVersion: 1,
    generatedAt: clock.toISOString(),
    payload: { schedules: [], courses: [], assets: [], questionPreviews: [] },
  });
  assert.deepStrictEqual(
    verifySignedAuthorityProjection({
      projection: authorityProjection,
      publicKey: publicIdentity.publicKey,
    }),
    authorityProjection
  );
  const rawFile = fs.readFileSync(filePath);
  const rawText = rawFile.toString('utf8');
  for (const secret of [
    'local-password-1',
    'BEGIN PRIVATE KEY',
    'short-session-token',
  ]) {
    assert.ok(!rawText.includes(secret), `raw vault file must not contain ${secret}`);
  }

  vault.lock();
  assert.strictEqual(vault.status().state, 'sealed');
  assert.throws(
    () => vault.signChallenge({ purpose: 'session', nonce: 'server-nonce', nonceIssuedAt: clock.toISOString() }),
    /DESKTOP_IDENTITY_VAULT_LOCKED/
  );


  const unlocked = await vault.resume();
  assert.strictEqual(unlocked.state, 'unlocked');
  assert.strictEqual(unlocked.deviceId, publicIdentity.deviceId);
  assert.strictEqual(unlocked.user.id, 'canonical-human');
  assert.strictEqual(unlocked.activeRole, 'teacher');
  assert.strictEqual(unlocked.offlineLease.expiresAt, '2026-07-20T10:00:00.000Z');
  assert.ok(!Object.prototype.hasOwnProperty.call(unlocked, 'privateKey'));
  assert.ok(!Object.prototype.hasOwnProperty.call(unlocked, 'password'));

  const sessionSignature = vault.signChallenge({
    purpose: 'session',
    challengeId: 'daily-session-challenge-1',
    authorizationId: authorization.id,
    credentialVersion: authorization.credentialVersion,
    nonce: 'daily-session-server-nonce',
    nonceIssuedAt: '2026-07-17T09:59:30.000Z',
  });
  assert.ok(verifySignature(
    publicIdentity.publicKey,
    desktopDeviceSessionSigningPayload({
      challengeId: 'daily-session-challenge-1',
      authorizationId: authorization.id,
      deviceId: publicIdentity.deviceId,
      credentialVersion: authorization.credentialVersion,
      nonce: 'daily-session-server-nonce',
      nonceIssuedAt: '2026-07-17T09:59:30.000Z',
    }),
    sessionSignature.signature
  ));
  const refreshed = await vault.refreshOfflineLease({
    password: 'local-password-1',
    offlineLease: signOfflineLease({
      ...offlineLease(publicIdentity.deviceId),
      id: 'lease-device-2-refreshed',
      expiresAt: '2026-07-20T09:00:00.000Z',
    }),
  });
  assert.strictEqual(refreshed.offlineLease.id, 'lease-device-2-refreshed');
  await assert.rejects(
    vault.refreshOfflineLease({
      password: 'local-password-1',
      offlineLease: {
        ...offlineLease(publicIdentity.deviceId),
        expiresAt: '2026-07-31T10:00:00.001Z',
      },
    }),
    error => error.code === 'DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID'
  );

  const elevation = vault.signChallenge({
    purpose: 'role-elevation',
    sessionId: 'desktop-session-teacher',
    activeRole: 'super_admin',
    sessionVersion: 1,
  });
  assert.strictEqual(elevation.elevationIssuedAt, clock.toISOString());
  assert.ok(verifySignature(
    publicIdentity.publicKey,
    desktopRoleElevationSigningPayload({
      sessionId: 'desktop-session-teacher',
      deviceId: publicIdentity.deviceId,
      activeRole: 'super_admin',
      sessionVersion: 1,
      elevationIssuedAt: elevation.elevationIssuedAt,
    }),
    elevation.signature
  ));
  clock = new Date('2026-07-17T10:03:01.000Z');
  assert.throws(
    () => vault.signChallenge({
      purpose: 'role-elevation',
      sessionId: 'desktop-session-teacher-2',
      activeRole: 'super_admin',
      sessionVersion: 1,
    }),
    /DESKTOP_IDENTITY_RECENT_UNLOCK_REQUIRED/
  );
  await vault.resume();
  assert.doesNotThrow(() => vault.signChallenge({
    purpose: 'role-elevation',
    sessionId: 'desktop-session-teacher-2',
    activeRole: 'super_admin',
    sessionVersion: 1,
  }));

  vault.lock();
  const originalFile = fs.readFileSync(filePath);
  for (const field of ['deviceId', 'keyFingerprint']) {
    const decoded = JSON.parse(safeStorage.decryptString(originalFile));
    decoded.publicIdentity[field] = `${decoded.publicIdentity[field]}-tampered`;
    fs.writeFileSync(filePath, safeStorage.encryptString(JSON.stringify(decoded)));
    const tamperedVault = createDesktopIdentityVault({
      filePath,
      legacyFilePath,
      safeStorage,
      offlineLeasePublicKey,
      delay: async () => {},
    });
    await assert.rejects(
      tamperedVault.resume(),
      error => ['DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED', 'DESKTOP_IDENTITY_KEY_FINGERPRINT_INVALID'].includes(error.code)
    );
    fs.writeFileSync(filePath, originalFile);
  }

  let failRename = false;
  const fsProxy = Object.create(fs);
  fsProxy.renameSync = function (source, target) {
    if (failRename) throw new Error('simulated atomic rename failure');
    return fs.renameSync(source, target);
  };
  const atomicFilePath = path.join(workspace, 'atomic-vault.bin');
  const atomicVault = createDesktopIdentityVault({
    filePath: atomicFilePath,
    safeStorage,
    fsImpl: fsProxy,
    now: () => new Date('2026-07-17T11:00:00.000Z'),
    delay: async () => {},
  });
  const atomicIdentity = atomicVault.beginUnifiedOnlineRegistration({ deviceName: 'Atomic desktop' });
  const atomicAuthorization = approvedAuthorization(atomicIdentity);
  atomicAuthorization.id = 'authorization-atomic-device';
  atomicAuthorization.userId = 'atomic-user';
  const atomicProfile = {
    userId: 'atomic-user',
    user: { id: 'atomic-user', name: 'Atomic User' },
    eligibleRoles: ['teacher'],
    activeRole: 'teacher',
    teacherId: 'teacher-atomic',
  };
  atomicVault.completeRegistration({
    password: 'atomic-old-password',
    authorization: atomicAuthorization,
    profile: atomicProfile,
    offlineLease: null,
  });
  const preservedEnvelope = fs.readFileSync(atomicFilePath);
  failRename = true;
  assert.throws(
    () => atomicVault.seal({
      password: 'atomic-new-password',
      authorization: atomicAuthorization,
      profile: atomicProfile,
      offlineLease: null,
    }),
    /DESKTOP_IDENTITY_VAULT_WRITE_FAILED/
  );
  failRename = false;
  assert.deepStrictEqual(fs.readFileSync(atomicFilePath), preservedEnvelope);
  atomicVault.lock();
  await atomicVault.resume();

  vault.clear();
  assert.strictEqual(fs.existsSync(filePath), false);
  assert.strictEqual(fs.readFileSync(businessFile, 'utf8'), 'business-data-must-survive');

  fs.writeFileSync(legacyFilePath, 'legacy-encrypted-credential');
  const legacySafeStorage = mockSafeStorage();
  const legacyVault = createDesktopIdentityVault({
    filePath,
    legacyFilePath,
    safeStorage: legacySafeStorage,
  });
  assert.deepStrictEqual(legacyVault.status(), {
    state: 'legacy_upgrade_required',
    sealed: false,
    unlocked: false,
    legacyUpgradeRequired: true,
  });
  assert.strictEqual(legacySafeStorage.stats().decryptCount, 0, 'legacy token must not be decrypted or auto-upgraded');

  const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const exposed = {};
  const invoked = [];
  const ipcRenderer = {
    invoke(channel, ...args) {
      invoked.push([channel, ...args]);
      return Promise.resolve({ channel });
    },
    on() {},
    removeListener() {},
  };
  vm.runInNewContext(preloadSource, {
    require(moduleName) {
      if (moduleName === './electronDevelopmentFixture') {
        return { preloadLoginFixtureEnabled: argv => Array.isArray(argv) && argv.includes('--gewu-desktop-login-fixture=1') };
      }
      if (moduleName === 'electron') return {
        contextBridge: {
          exposeInMainWorld(name, value) { exposed[name] = value; },
        },
        ipcRenderer,
      };
      throw new Error(`unexpected module ${moduleName}`);
    },
    process: { argv: ['electron'], env: { NODE_ENV: 'test' } },
    Buffer,
    Error,
    Promise,
    Set,
  }, { filename: 'preload.js' });
  assert.deepStrictEqual(
    Array.from(Object.keys(exposed.desktopIdentity)).sort(),
    [
      'beginUnifiedOnlineRegistration', 'completeRegistration',
      'lock', 'refreshOfflineLease', 'resume', 'signChallenge', 'status',
    ]
  );
  assert.ok(!('read' in exposed.desktopIdentity));
  assert.ok(!('write' in exposed.desktopIdentity));
  assert.ok(!('privateKey' in exposed.desktopIdentity));
  assert.ok(!('signPairingEnvelope' in exposed.desktopIdentity));
  assert.ok(!('beginPasswordReset' in exposed.desktopIdentity));
  assert.ok(!('completePasswordReset' in exposed.desktopIdentity));
  assert.strictEqual(exposed.singleUserRuntime, undefined, 'ordinary preload must not expose host controls');
  await exposed.desktopIdentity.status();
  assert.strictEqual(invoked[0][0], 'desktop-identity:status');
  await exposed.desktopIdentity.beginUnifiedOnlineRegistration({ deviceName: 'Unified cloud desktop' });
  assert.strictEqual(invoked[1][0], 'desktop-identity:begin-unified-online-registration');
  await exposed.desktopIdentity.resume();
  assert.strictEqual(invoked[2][0], 'desktop-identity:resume');
  await assert.rejects(exposed.api.invoke('desktop-auth:get'), /IPC channel not allowed/);

  const electronSource = fs.readFileSync(path.join(__dirname, 'electron.js'), 'utf8');
  for (const channel of [
    'desktop-identity:status',
    'desktop-identity:begin-unified-online-registration',
    'desktop-identity:complete-registration',
    'desktop-identity:resume',
    'desktop-identity:lock',
    'desktop-identity:refresh-offline-lease',
    'desktop-identity:sign-challenge',
  ]) {
    assert.ok(electronSource.includes(`ipcMain.handle('${channel}'`), `electron main process must register ${channel}`);
  }
  assert.ok(!electronSource.includes("ipcMain.handle('desktop-auth:get'"));
  assert.ok(!electronSource.includes("ipcMain.handle('desktop-auth:set'"));
  for (const legacyMarker of [
    'beginSingleUserEnrollment', 'createPairingEnvelope', 'singleUserPairingEnvelope',
    'signPairingEnvelope', 'single-user-pairing',
  ]) assert.ok(!fs.readFileSync(path.join(__dirname, 'desktopIdentityVault.js'), 'utf8').includes(legacyMarker),
    `desktop vault must not retain legacy pairing behavior: ${legacyMarker}`);

  fs.rmSync(workspace, { recursive: true, force: true });
  console.log('desktop identity vault checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
