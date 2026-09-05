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
  createDesktopIdentityVault,
  recoverUnreadableDesktopIdentityVault,
} = require('./desktopIdentityVault');
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

function signOfflineLease(lease, keyPair = offlineLeaseSigningKeyPair) {
  const unsigned = { ...lease };
  delete unsigned.signature;
  return {
    ...unsigned,
    signature: crypto.sign(null, Buffer.from(offlineLeaseSignaturePayload(unsigned), 'utf8'), keyPair.privateKey).toString('base64url'),
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

function identityKeyMaterial(deviceKind, deviceId) {
  const keyPair = crypto.generateKeyPairSync('ed25519');
  const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keyFingerprint = crypto.createHash('sha256')
    .update(keyPair.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
  const publicIdentity = {
    deviceId,
    deviceName: 'Retired primary host',
    deviceKind,
    publicKey,
    keyFingerprint,
  };
  return { keyPair, publicIdentity };
}

function historicalV2EncryptedIdentityFixture(safeStorage) {
  // This is the password-encrypted VAULT_VERSION=2 format from 908145e8^.
  const password = 'historical-primary-host-password';
  const { keyPair, publicIdentity } = identityKeyMaterial('primary-host', 'retired-primary-host');
  const kdf = {
    algorithm: 'scrypt',
    salt: crypto.randomBytes(16).toString('base64'),
    N: 16384,
    r: 8,
    p: 1,
    keyLength: 32,
  };
  const payload = {
    version: 1,
    publicIdentity,
    privateKey: keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    authorization: {
      id: 'authorization-retired-primary-host',
      deviceId: publicIdentity.deviceId,
      deviceName: publicIdentity.deviceName,
      deviceKind: publicIdentity.deviceKind,
      userId: 'canonical-human',
      keyFingerprint: publicIdentity.keyFingerprint,
      status: 'active',
      authorizationSource: 'single_user_local_bootstrap',
      credentialVersion: 1,
      lastPhoneVerifiedAt: '2026-07-17T10:00:00.000Z',
      phoneReverifyDueAt: '2026-08-16T10:00:00.000Z',
    },
    profile: {
      userId: 'canonical-human',
      user: { id: 'canonical-human', name: 'Historical primary host owner' },
      eligibleRoles: ['super_admin'],
      activeRole: 'super_admin',
      teacherId: null,
      studentId: null,
    },
    offlineLease: null,
    authorityContext: null,
    sealedAt: '2026-07-17T10:00:00.000Z',
  };
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(Buffer.from(password, 'utf8'), Buffer.from(kdf.salt, 'base64'), 32, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 64 * 1024 * 1024,
  });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify({ version: 2, publicIdentity, kdf }), 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);
  const envelope = {
    version: 2,
    publicIdentity,
    kdf,
    cipher: {
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    },
  };
  key.fill(0);
  return {
    protectedBytes: safeStorage.encryptString(JSON.stringify(envelope)),
    publicIdentity,
    decryptPrivatePayload() {
      const protectedEnvelope = JSON.parse(safeStorage.decryptString(this.protectedBytes));
      const decryptKey = crypto.scryptSync(
        Buffer.from(password, 'utf8'),
        Buffer.from(protectedEnvelope.kdf.salt, 'base64'),
        32,
        { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      );
      try {
        const decipher = crypto.createDecipheriv(
          'aes-256-gcm',
          decryptKey,
          Buffer.from(protectedEnvelope.cipher.iv, 'base64'),
        );
        decipher.setAAD(Buffer.from(JSON.stringify({
          version: 2,
          publicIdentity: protectedEnvelope.publicIdentity,
          kdf: protectedEnvelope.kdf,
        }), 'utf8'));
        decipher.setAuthTag(Buffer.from(protectedEnvelope.cipher.tag, 'base64'));
        return JSON.parse(Buffer.concat([
          decipher.update(Buffer.from(protectedEnvelope.cipher.ciphertext, 'base64')),
          decipher.final(),
        ]).toString('utf8'));
      } finally {
        decryptKey.fill(0);
      }
    },
  };
}

function currentEncryptedIdentityFixture(safeStorage, deviceKind, deviceId) {
  const { keyPair, publicIdentity } = identityKeyMaterial(deviceKind, deviceId);
  return safeStorage.encryptString(JSON.stringify({
    version: 3,
    publicIdentity,
    payload: {
      version: 1,
      publicIdentity,
      privateKey: keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      authorization: {
        id: `authorization-${deviceId}`,
        deviceId,
        deviceName: publicIdentity.deviceName,
        deviceKind,
        userId: 'canonical-human',
        keyFingerprint: publicIdentity.keyFingerprint,
        status: 'active',
        authorizationSource: 'wechat_phone',
        credentialVersion: 1,
        lastPhoneVerifiedAt: '2026-07-17T10:00:00.000Z',
        phoneReverifyDueAt: '2026-08-16T10:00:00.000Z',
      },
      profile: {
        userId: 'canonical-human',
        user: { id: 'canonical-human', name: 'Current identity owner' },
        eligibleRoles: ['super_admin'],
        activeRole: 'super_admin',
        teacherId: null,
        studentId: null,
      },
      offlineLease: null,
      authorityContext: null,
      sealedAt: '2026-07-17T10:00:00.000Z',
    },
  }));
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

function offlineLease(deviceId = 'device-2', keyPair = offlineLeaseSigningKeyPair) {
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
  return signOfflineLease(lease, keyPair);
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
  const unreadableVaultPath = path.join(workspace, 'desktop-identity-unreadable.bin');
  fs.writeFileSync(unreadableVaultPath, 'unreadable-encrypted-identity');
  const unreadableVaultBackup = recoverUnreadableDesktopIdentityVault({
    filePath: unreadableVaultPath,
    now: () => new Date('2026-08-29T01:55:00.000Z'),
  });
  assert.ok(unreadableVaultBackup && fs.existsSync(unreadableVaultBackup),
    'an unreadable identity vault must be preserved before the login flow starts over');
  assert.strictEqual(fs.existsSync(unreadableVaultPath), false,
    'the active unreadable vault path must be released for a fresh cloud login');
  assert.strictEqual(fs.readFileSync(unreadableVaultBackup, 'utf8'), 'unreadable-encrypted-identity');
  assert.strictEqual(fs.readFileSync(businessFile, 'utf8'), 'business-data-must-survive',
    'identity recovery must not alter local business caches');
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

  for (const invalidIdentity of [
    { deviceKind: 'primary-host', deviceId: 'damaged-current-primary-host' },
    { deviceKind: 'future-desktop-client', deviceId: 'future-device-kind' },
  ]) {
    const invalidIdentityPath = path.join(workspace, `${invalidIdentity.deviceId}.bin`);
    fs.writeFileSync(
      invalidIdentityPath,
      currentEncryptedIdentityFixture(safeStorage, invalidIdentity.deviceKind, invalidIdentity.deviceId),
    );
    const invalidIdentityBytes = fs.readFileSync(invalidIdentityPath);
    const invalidIdentityVault = createDesktopIdentityVault({
      filePath: invalidIdentityPath,
      safeStorage,
      offlineLeasePublicKey,
      now: () => new Date(clock),
    });
    assert.throws(
      () => invalidIdentityVault.status(),
      error => error?.code === 'DESKTOP_IDENTITY_DEVICE_KIND_INVALID',
      `a current vault with ${invalidIdentity.deviceKind} must remain a hard identity error`,
    );
    assert.throws(
      () => invalidIdentityVault.beginUnifiedOnlineRegistration({ deviceName: 'Must not replace identity' }),
      error => error?.code === 'DESKTOP_IDENTITY_DEVICE_KIND_INVALID',
      `registration must not reinterpret ${invalidIdentity.deviceKind} as a historical host`,
    );
    assert.deepStrictEqual(fs.readFileSync(invalidIdentityPath), invalidIdentityBytes);
  }

  const incompleteV2Path = path.join(workspace, 'incomplete-v2-primary-host.bin');
  const incompleteV2Identity = identityKeyMaterial('primary-host', 'incomplete-v2-primary-host').publicIdentity;
  fs.writeFileSync(incompleteV2Path, safeStorage.encryptString(JSON.stringify({
    version: 2,
    publicIdentity: incompleteV2Identity,
  })));
  const incompleteV2Vault = createDesktopIdentityVault({
    filePath: incompleteV2Path,
    safeStorage,
    offlineLeasePublicKey,
    now: () => new Date(clock),
  });
  assert.throws(
    () => incompleteV2Vault.status(),
    error => error?.code === 'DESKTOP_IDENTITY_VAULT_ENVELOPE_INVALID',
    'a version marker and retired kind alone must not masquerade as a real historical encrypted vault',
  );

  const retiredDeviceKindPath = path.join(workspace, 'retired-device-kind.bin');
  const historicalV2Fixture = historicalV2EncryptedIdentityFixture(safeStorage);
  assert.strictEqual(
    historicalV2Fixture.decryptPrivatePayload().publicIdentity.deviceKind,
    'primary-host',
    'the historical fixture must authenticate and decrypt to a primary-host private identity',
  );
  fs.writeFileSync(retiredDeviceKindPath, historicalV2Fixture.protectedBytes);
  const retiredDeviceVault = createDesktopIdentityVault({
    filePath: retiredDeviceKindPath,
    safeStorage,
    offlineLeasePublicKey,
    now: () => new Date(clock),
  });
  assert.deepStrictEqual(retiredDeviceVault.status(), {
    state: 'legacy_upgrade_required',
    sealed: false,
    unlocked: false,
    legacyUpgradeRequired: true,
    deviceName: historicalV2Fixture.publicIdentity.deviceName,
  }, 'a real historical v2 primary host must enter cloud re-registration');
  const preservedRetiredEnvelope = fs.readFileSync(retiredDeviceKindPath);
  const replacementIdentity = retiredDeviceVault.beginUnifiedOnlineRegistration({ deviceName: 'Replacement desktop' });
  assert.strictEqual(replacementIdentity.deviceKind, 'desktop-client');
  assert.deepStrictEqual(fs.readFileSync(retiredDeviceKindPath), preservedRetiredEnvelope,
    'the retired encrypted identity must remain recoverable until cloud login succeeds');
  const replacementProof = retiredDeviceVault.signChallenge({
    purpose: 'unified-online-registration',
    challenge: 'historical-v2-replacement-proof',
  });
  assert.ok(verifySignature(
    replacementIdentity.publicKey,
    'historical-v2-replacement-proof',
    replacementProof.signature,
  ));
  const replacementAuthorization = approvedAuthorization(replacementIdentity);
  const replacementCompleted = retiredDeviceVault.completeRegistration({
    authorization: replacementAuthorization,
    profile: approvedProfile(),
    offlineLease: offlineLease(replacementIdentity.deviceId),
    authorityContext: authorityContext(replacementIdentity.publicKey, replacementIdentity.deviceId),
  });
  assert.strictEqual(replacementCompleted.state, 'unlocked');
  assert.strictEqual(replacementCompleted.deviceId, replacementIdentity.deviceId);
  assert.notDeepStrictEqual(fs.readFileSync(retiredDeviceKindPath), preservedRetiredEnvelope,
    'the historical vault may be replaced only after cloud registration completes');
  retiredDeviceVault.lock();
  const replacementResumed = await retiredDeviceVault.resume();
  assert.strictEqual(replacementResumed.state, 'unlocked');
  assert.strictEqual(replacementResumed.deviceId, replacementIdentity.deviceId);
  assert.strictEqual(replacementResumed.deviceKind, 'desktop-client');

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
  const extendedLease = offlineLease(publicIdentity.deviceId);
  extendedLease.unsignedPrivilege = 'super_admin';
  assert.throws(
    () => vault.completeRegistration({
      authorization,
      profile: approvedProfile(),
      offlineLease: extendedLease,
    }),
    /DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID/,
    'unsigned extension fields must not survive outside the signed lease schema',
  );
  const rotationSigningKeyPair = crypto.generateKeyPairSync('ed25519');
  const rotationVault = createDesktopIdentityVault({
    filePath: path.join(workspace, 'rotated-offline-lease-identity.bin'),
    safeStorage,
    offlineLeasePublicKey: [rotationSigningKeyPair.publicKey, offlineLeasePublicKey],
    now: () => new Date(clock),
  });
  const rotationIdentity = rotationVault.beginUnifiedOnlineRegistration({
    deviceName: 'Rotated offline lease desktop',
  });
  const rotationCompleted = rotationVault.completeRegistration({
    authorization: approvedAuthorization(rotationIdentity),
    profile: approvedProfile(),
    offlineLease: offlineLease(rotationIdentity.deviceId, rotationSigningKeyPair),
  });
  assert.strictEqual(rotationCompleted.state, 'unlocked',
    'the vault must accept a lease signed by any explicitly trusted rotation key');
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

  const reauthenticationPath = path.join(workspace, 'reauthentication-desktop-identity-v2.bin');
  const reauthenticationVault = createDesktopIdentityVault({
    filePath: reauthenticationPath,
    safeStorage,
    offlineLeasePublicKey,
    now: () => new Date(clock),
  });
  const originalReauthenticationIdentity = reauthenticationVault.beginUnifiedOnlineRegistration({
    deviceName: 'Existing desktop',
  });
  reauthenticationVault.completeRegistration({
    authorization: approvedAuthorization(originalReauthenticationIdentity),
    profile: approvedProfile(),
    offlineLease: offlineLease(originalReauthenticationIdentity.deviceId),
  });
  reauthenticationVault.lock();
  const preservedReauthenticationEnvelope = fs.readFileSync(reauthenticationPath);
  const replacementReauthenticationIdentity = reauthenticationVault.beginUnifiedOnlineRegistration({
    deviceName: 'Existing desktop',
  });
  assert.strictEqual(reauthenticationVault.status().state, 'unified_online_recovery_pending');
  assert.notStrictEqual(
    replacementReauthenticationIdentity.deviceId,
    originalReauthenticationIdentity.deviceId,
    'online reauthentication must use a fresh installation proof',
  );
  assert.deepStrictEqual(
    fs.readFileSync(reauthenticationPath),
    preservedReauthenticationEnvelope,
    'a failed or interrupted login must preserve the prior encrypted identity until cloud registration succeeds',
  );
  const replacementReauthenticationProof = reauthenticationVault.signChallenge({
    purpose: 'unified-online-registration',
    challenge: 'reauthentication-cloud-challenge',
  });
  assert.ok(verifySignature(
    replacementReauthenticationIdentity.publicKey,
    'reauthentication-cloud-challenge',
    replacementReauthenticationProof.signature,
  ));
  assert.throws(
    () => reauthenticationVault.completeRegistration({
      authorization: approvedAuthorization(replacementReauthenticationIdentity),
      profile: approvedProfile(),
      offlineLease: null,
    }),
    error => error?.code === 'DESKTOP_IDENTITY_OFFLINE_LEASE_REQUIRED',
    'renderer IPC must not overwrite an existing vault without a cloud-signed lease',
  );
  assert.deepStrictEqual(
    fs.readFileSync(reauthenticationPath),
    preservedReauthenticationEnvelope,
    'a rejected recovery completion must preserve every byte of the old vault',
  );
  reauthenticationVault.completeRegistration({
    authorization: approvedAuthorization(replacementReauthenticationIdentity),
    profile: approvedProfile(),
    offlineLease: offlineLease(replacementReauthenticationIdentity.deviceId),
  });
  assert.notDeepStrictEqual(
    fs.readFileSync(reauthenticationPath),
    preservedReauthenticationEnvelope,
    'the prior identity may be replaced only after verified cloud registration completes',
  );

  const legacyRoleVault = createDesktopIdentityVault({
    filePath: path.join(workspace, 'legacy-role-desktop-identity-v2.bin'),
    safeStorage,
    offlineLeasePublicKey,
    now: () => new Date(clock),
  });
  const legacyIdentity = legacyRoleVault.beginUnifiedOnlineRegistration({
    deviceName: 'Legacy role desktop',
  });
  const legacyAuthorization = approvedAuthorization(legacyIdentity);
  legacyAuthorization.id = 'authorization-legacy-role-device';
  const legacyProfile = {
    userId: legacyAuthorization.userId,
    user: { id: legacyAuthorization.userId, name: 'Legacy role account' },
    eligibleRoles: ['admin'],
    activeRole: 'admin',
    teacherId: null,
    studentId: null,
  };
  const legacyLease = offlineLease();
  legacyLease.id = 'lease-legacy-role-device';
  legacyLease.deviceId = legacyIdentity.deviceId;
  legacyLease.authorizationId = legacyAuthorization.id;
  legacyLease.eligibleRoles = ['admin'];
  legacyLease.activeRole = 'admin';
  legacyLease.teacherId = null;
  legacyLease.studentId = null;
  legacyLease.scope = { kind: 'admin' };
  assert.throws(() => legacyRoleVault.completeRegistration({
    password: 'legacy-local-password',
    authorization: legacyAuthorization,
    profile: legacyProfile,
    offlineLease: signOfflineLease(legacyLease),
  }), error => error?.code === 'DESKTOP_IDENTITY_PROFILE_INVALID');
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
  const refreshedSession = {
    id: 'authorization-device-2-refreshed',
    userId: 'canonical-human',
    deviceId: publicIdentity.deviceId,
    eligibleRoles: ['super_admin', 'teacher'],
    activeRole: 'teacher',
    teacherId: 'teacher-self',
    studentId: null,
    expiresAt: '2026-07-20T09:00:00.000Z',
    rowVersion: 1,
  };
  const refreshed = await vault.acceptIssuedSession({
    session: refreshedSession,
    profile: approvedProfile(),
    offlineLease: signOfflineLease({
      ...offlineLease(publicIdentity.deviceId),
      id: 'lease-device-2-refreshed',
      authorizationId: refreshedSession.id,
      issuedAt: '2026-07-17T10:00:01.000Z',
      expiresAt: refreshedSession.expiresAt,
    }),
  });
  assert.strictEqual(refreshed.offlineLease.id, 'lease-device-2-refreshed');
  assert.strictEqual(refreshed.authorizationId, refreshedSession.id);
  const replayableAdminSession = {
    ...refreshedSession,
    id: 'authorization-device-2-admin',
    activeRole: 'super_admin',
    teacherId: null,
    expiresAt: '2026-07-20T09:30:00.000Z',
  };
  const replayableAdminProfile = {
    ...approvedProfile(),
    activeRole: 'super_admin',
    teacherId: null,
  };
  const replayableAdminLease = signOfflineLease({
    ...offlineLease(publicIdentity.deviceId),
    id: 'lease-device-2-admin',
    authorizationId: replayableAdminSession.id,
    issuedAt: '2026-07-17T10:00:02.000Z',
    expiresAt: replayableAdminSession.expiresAt,
    activeRole: 'super_admin',
    teacherId: null,
    scope: { kind: 'super_admin' },
  });
  const replayableAdminInput = {
    session: replayableAdminSession,
    profile: replayableAdminProfile,
    offlineLease: replayableAdminLease,
  };
  await vault.acceptIssuedSession(replayableAdminInput);
  const downgradedTeacherSession = {
    ...refreshedSession,
    id: 'authorization-device-2-downgraded-teacher',
    expiresAt: '2026-07-20T09:45:00.000Z',
  };
  await vault.acceptIssuedSession({
    session: downgradedTeacherSession,
    profile: approvedProfile(),
    offlineLease: signOfflineLease({
      ...offlineLease(publicIdentity.deviceId),
      id: 'lease-device-2-downgraded-teacher',
      authorizationId: downgradedTeacherSession.id,
      issuedAt: '2026-07-17T10:00:03.000Z',
      expiresAt: downgradedTeacherSession.expiresAt,
    }),
  });
  const downgradedVaultBytes = fs.readFileSync(filePath);
  await assert.rejects(
    vault.acceptIssuedSession(replayableAdminInput),
    error => error?.code === 'DESKTOP_IDENTITY_ISSUED_SESSION_STALE',
    'an older signed administrator lease must not roll back a later teacher downgrade',
  );
  assert.deepStrictEqual(fs.readFileSync(filePath), downgradedVaultBytes,
    'rejecting a stale signed lease must preserve the downgraded vault bytes');
  assert.strictEqual(vault.status().activeRole, 'teacher');
  await assert.rejects(
    vault.acceptIssuedSession({
      session: {
        ...refreshedSession,
        id: 'authorization-device-2-too-long',
        expiresAt: '2026-07-31T10:00:00.001Z',
      },
      profile: approvedProfile(),
      offlineLease: signOfflineLease({
        ...offlineLease(publicIdentity.deviceId),
        id: 'lease-device-2-too-long',
        authorizationId: 'authorization-device-2-too-long',
        expiresAt: '2026-07-31T10:00:00.001Z',
      }),
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
  assert.throws(
    () => vault.signChallenge({
      purpose: 'role-elevation',
      sessionId: 'desktop-session-teacher-2',
      activeRole: 'super_admin',
      sessionVersion: 1,
    }),
    /DESKTOP_IDENTITY_RECENT_UNLOCK_REQUIRED/,
    'passive resume must not refresh the user-presence window for privileged role elevation',
  );

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
  atomicVault.seal({
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
      'acceptIssuedSession', 'beginUnifiedOnlineRegistration',
      'completeRegistration', 'lock', 'resume', 'signChallenge', 'status',
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
    'desktop-identity:accept-issued-session',
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
