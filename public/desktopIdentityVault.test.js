const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const {
  desktopExchangeSigningPayload,
} = require('../backend/src/services/desktopIdentityService');
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
const packageJson = require('../package.json');

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

function offlineLease() {
  return {
    id: 'lease-device-2',
    userId: 'canonical-human',
    deviceId: 'device-2',
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
    now: () => new Date(clock),
    delay: async milliseconds => { delays.push(milliseconds); },
  });

  assert.deepStrictEqual(vault.status(), {
    state: 'empty',
    sealed: false,
    unlocked: false,
    legacyUpgradeRequired: false,
  });

  const publicIdentity = vault.beginRegistration({
    deviceId: 'device-2',
    deviceName: '第二台电脑',
    deviceKind: 'desktop-client',
  });
  assert.strictEqual(publicIdentity.deviceId, 'device-2');
  assert.strictEqual(publicIdentity.deviceName, '第二台电脑');
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

  const exchange = vault.signChallenge({
    purpose: 'exchange',
    challengeId: 'challenge-device-2',
    rowVersion: 4,
    challengeSecret: 'one-time-exchange-secret',
  });
  assert.strictEqual(exchange.purpose, 'exchange');
  assert.strictEqual(exchange.deviceId, publicIdentity.deviceId);
  assert.ok(verifySignature(
    publicIdentity.publicKey,
    desktopExchangeSigningPayload({
      challengeId: 'challenge-device-2',
      deviceId: publicIdentity.deviceId,
      rowVersion: 4,
      challengeSecret: 'one-time-exchange-secret',
    }),
    exchange.signature
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
      offlineLease: offlineLease(),
    }),
    /DESKTOP_IDENTITY_VAULT_FORBIDDEN_SECRET/
  );
  const completed = vault.completeRegistration({
    password: 'local-password-1',
    authorization,
    profile: approvedProfile(),
    offlineLease: offlineLease(),
    sessionToken: 'short-session-token',
  });
  assert.strictEqual(completed.state, 'unlocked');
  assert.strictEqual(completed.activeRole, 'teacher');
  assert.deepStrictEqual(completed.eligibleRoles, ['super_admin', 'teacher']);
  assert.strictEqual(completed.teacherId, 'teacher-self');
  assert.ok(!JSON.stringify(completed).includes('PRIVATE KEY'));
  assert.ok(!JSON.stringify(completed).includes('local-password-1'));

  const signedHostReceipt = vault.signChallenge({
    purpose: 'primary-host-receipt',
    operation: 'transfer',
    challengeId: 'host-transfer-challenge-1',
    physicalConfirmation: PHYSICAL_CONFIRMATION,
    evidence: {
      runtimeNodeRole: 'desktop-client',
      dbInstanceDigest: 'a'.repeat(64),
      schemaVersion: 3107,
      storeId: 'store-authority-1',
      dbAuthorityId: 'db-authority-1',
      quickCheck: 'ok',
    },
  });
  assert.strictEqual(signedHostReceipt.purpose, 'primary-host-receipt');
  assert.strictEqual(signedHostReceipt.receipt.userId, 'canonical-human');
  assert.strictEqual(signedHostReceipt.receipt.deviceId, 'device-2');
  assert.strictEqual(signedHostReceipt.receipt.authorizationId, authorization.id);
  assert.strictEqual(signedHostReceipt.receipt.credentialVersion, authorization.credentialVersion);
  assert.strictEqual(verifyPrimaryHostLocalReceiptSignature({
    receipt: signedHostReceipt.receipt,
    signature: signedHostReceipt.signature,
    publicKey: publicIdentity.publicKey,
  }), true);

  const rawFile = fs.readFileSync(filePath);
  const rawText = rawFile.toString('utf8');
  const safeStorageEnvelope = safeStorage.decryptString(rawFile);
  for (const secret of [
    'local-password-1',
    'one-time-exchange-secret',
    'BEGIN PRIVATE KEY',
    'short-session-token',
  ]) {
    assert.ok(!rawText.includes(secret), `raw vault file must not contain ${secret}`);
    assert.ok(!safeStorageEnvelope.includes(secret), `safeStorage envelope must not contain ${secret}`);
  }

  vault.lock();
  assert.strictEqual(vault.status().state, 'sealed');
  assert.throws(
    () => vault.signChallenge({ purpose: 'session', nonce: 'server-nonce', nonceIssuedAt: clock.toISOString() }),
    /DESKTOP_IDENTITY_VAULT_LOCKED/
  );

  await assert.rejects(
    vault.unlock({ password: 'wrong-password-1' }),
    error => error.code === 'DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED'
  );
  await assert.rejects(
    vault.unlock({ password: 'wrong-password-2' }),
    error => error.code === 'DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED'
  );
  assert.deepStrictEqual(delays, [250, 500]);
  const unlocked = await vault.unlock({ password: 'local-password-1' });
  assert.strictEqual(unlocked.state, 'unlocked');
  assert.strictEqual(unlocked.deviceId, 'device-2');
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
  await assert.rejects(
    vault.refreshOfflineLease({
      password: 'wrong-password',
      offlineLease: { ...offlineLease(), id: 'lease-refresh-wrong-password' },
    }),
    error => error.code === 'DESKTOP_IDENTITY_OFFLINE_LEASE_REFRESH_FAILED'
  );
  const refreshed = await vault.refreshOfflineLease({
    password: 'local-password-1',
    offlineLease: {
      ...offlineLease(),
      id: 'lease-device-2-refreshed',
      expiresAt: '2026-07-20T09:00:00.000Z',
    },
  });
  assert.strictEqual(refreshed.offlineLease.id, 'lease-device-2-refreshed');
  await assert.rejects(
    vault.refreshOfflineLease({
      password: 'local-password-1',
      offlineLease: {
        ...offlineLease(),
        expiresAt: '2026-07-20T10:00:00.001Z',
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
  await vault.unlock({ password: 'local-password-1' });
  assert.doesNotThrow(() => vault.signChallenge({
    purpose: 'role-elevation',
    sessionId: 'desktop-session-teacher-2',
    activeRole: 'super_admin',
    sessionVersion: 1,
  }));

  const resetFilePath = path.join(workspace, 'password-reset-vault.bin');
  const resetVault = createDesktopIdentityVault({
    filePath: resetFilePath,
    safeStorage,
    now: () => new Date('2026-07-17T10:10:00.000Z'),
    delay: async () => {},
  });
  const resetOriginalIdentity = resetVault.beginRegistration({
    deviceId: 'device-2',
    deviceName: '第二台电脑',
    deviceKind: 'desktop-client',
  });
  resetVault.completeRegistration({
    password: 'reset-old-password',
    authorization: approvedAuthorization(resetOriginalIdentity),
    profile: approvedProfile(),
    offlineLease: offlineLease(),
  });
  resetVault.lock();
  const resetOriginalEnvelope = fs.readFileSync(resetFilePath);
  const firstPendingReset = resetVault.beginPasswordReset();
  assert.strictEqual(firstPendingReset.deviceId, resetOriginalIdentity.deviceId);
  assert.strictEqual(firstPendingReset.deviceName, resetOriginalIdentity.deviceName);
  assert.notStrictEqual(firstPendingReset.keyFingerprint, resetOriginalIdentity.keyFingerprint);
  assert.strictEqual(resetVault.status().state, 'password_reset_pending');
  assert.deepStrictEqual(
    fs.readFileSync(resetFilePath),
    resetOriginalEnvelope,
    'starting password reset must preserve the committed vault'
  );
  resetVault.lock();
  assert.strictEqual(resetVault.status().state, 'sealed');
  assert.deepStrictEqual(fs.readFileSync(resetFilePath), resetOriginalEnvelope);

  const pendingReset = resetVault.beginPasswordReset();
  const resetExchange = resetVault.signChallenge({
    purpose: 'exchange',
    challengeId: 'challenge-password-reset',
    rowVersion: 4,
    challengeSecret: 'password-reset-exchange-secret',
  });
  assert.ok(verifySignature(
    pendingReset.publicKey,
    desktopExchangeSigningPayload({
      challengeId: 'challenge-password-reset',
      deviceId: pendingReset.deviceId,
      rowVersion: 4,
      challengeSecret: 'password-reset-exchange-secret',
    }),
    resetExchange.signature
  ));
  const resetAuthorization = {
    ...approvedAuthorization(pendingReset),
    credentialVersion: 2,
    lastPhoneVerifiedAt: '2026-07-17T10:10:00.000Z',
    phoneReverifyDueAt: '2026-08-16T10:10:00.000Z',
  };
  const resetLease = {
    ...offlineLease(),
    id: 'lease-device-2-after-password-reset',
    credentialVersion: 2,
    issuedAt: '2026-07-17T10:10:00.000Z',
    expiresAt: '2026-07-20T10:10:00.000Z',
  };
  const resetCompleted = resetVault.completePasswordReset({
    password: 'reset-new-password',
    authorization: resetAuthorization,
    profile: approvedProfile(),
    offlineLease: resetLease,
  });
  assert.strictEqual(resetCompleted.deviceId, resetOriginalIdentity.deviceId);
  assert.strictEqual(resetCompleted.keyFingerprint, pendingReset.keyFingerprint);
  assert.strictEqual(resetCompleted.credentialVersion, 2);
  resetVault.lock();
  await assert.rejects(
    resetVault.unlock({ password: 'reset-old-password' }),
    error => error.code === 'DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED'
  );
  const resetUnlocked = await resetVault.unlock({ password: 'reset-new-password' });
  assert.strictEqual(resetUnlocked.deviceId, resetOriginalIdentity.deviceId);
  assert.strictEqual(resetUnlocked.user.id, 'canonical-human');
  assert.strictEqual(fs.readFileSync(businessFile, 'utf8'), 'business-data-must-survive');

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
      delay: async () => {},
    });
    await assert.rejects(
      tamperedVault.unlock({ password: 'local-password-1' }),
      error => error.code === 'DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED'
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
  const atomicIdentity = atomicVault.beginRegistration({ deviceId: 'atomic-device' });
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
  await atomicVault.unlock({ password: 'atomic-old-password' });

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
      if (moduleName !== 'electron') throw new Error(`unexpected module ${moduleName}`);
      return {
        contextBridge: {
          exposeInMainWorld(name, value) { exposed[name] = value; },
        },
        ipcRenderer,
      };
    },
    process: { env: { NODE_ENV: 'test' } },
    Buffer,
    Error,
    Promise,
    Set,
  }, { filename: 'preload.js' });
  assert.deepStrictEqual(
    Array.from(Object.keys(exposed.desktopIdentity)).sort(),
    [
      'beginPasswordReset', 'beginRegistration', 'completePasswordReset', 'completeRegistration',
      'lock', 'refreshOfflineLease', 'signChallenge', 'status', 'unlock',
    ]
  );
  assert.ok(!('read' in exposed.desktopIdentity));
  assert.ok(!('write' in exposed.desktopIdentity));
  assert.ok(!('privateKey' in exposed.desktopIdentity));
  await exposed.desktopIdentity.status();
  assert.strictEqual(invoked[0][0], 'desktop-identity:status');
  await assert.rejects(exposed.api.invoke('desktop-auth:get'), /IPC channel not allowed/);

  const electronSource = fs.readFileSync(path.join(__dirname, 'electron.js'), 'utf8');
  for (const channel of [
    'desktop-identity:status',
    'desktop-identity:begin-registration',
    'desktop-identity:begin-password-reset',
    'desktop-identity:complete-registration',
    'desktop-identity:complete-password-reset',
    'desktop-identity:unlock',
    'desktop-identity:lock',
    'desktop-identity:refresh-offline-lease',
    'desktop-identity:sign-challenge',
  ]) {
    assert.ok(electronSource.includes(`ipcMain.handle('${channel}'`), `electron main process must register ${channel}`);
  }
  assert.ok(!electronSource.includes("ipcMain.handle('desktop-auth:get'"));
  assert.ok(!electronSource.includes("ipcMain.handle('desktop-auth:set'"));

  fs.rmSync(workspace, { recursive: true, force: true });
  console.log('desktop identity vault checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
