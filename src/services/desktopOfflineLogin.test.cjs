const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCloudDesktopRegistrationService } = require('../../cloud-business-api/src/desktopRegistrationService');
const { createDesktopIdentityVault } = require('../../public/desktopIdentityVault');

async function main() {
  const { createDesktopIdentityClient, isDesktopIdentityNetworkFailure } = await import('./desktopIdentityClient.mjs');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-offline-login-'));
  const keys = crypto.generateKeyPairSync('ed25519');
  const start = new Date('2026-10-12T00:00:00.000Z');
  let clock = new Date(start);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value, 'utf8'),
    decryptString: value => value.toString('utf8'),
  };
  const service = createCloudDesktopRegistrationService({
    now: () => new Date(clock), randomId: kind => `${kind}-test`,
    phoneVerifier: async () => '13700000000', lookupAccount: async () => ({}),
    ticketSecret: 'offline-test-secret-material-'.repeat(3), leasePrivateKey: keys.privateKey,
    issueAssertion: async () => {}, register: async input => ({ receiptId: input.receiptId, sessionId: input.sessionId, replayed: false }),
    readSessionContext: async input => ({ ...input, rowVersion: 1, roles: ['teacher'], teacherId: 'teacher-1', studentId: null }),
  });
  const filePath = path.join(workspace, 'identity.bin');
  const makeVault = () => createDesktopIdentityVault({ filePath, safeStorage, offlineLeasePublicKey: keys.publicKey, now: () => new Date(clock) });
  try {
    const vault = makeVault();
    const identity = vault.beginUnifiedOnlineRegistration({ deviceName: 'Offline regression' });
    const verified = service.issueVerificationForVerifiedAccount({ authorityId: 'authority-1', accountId: 'account-1', phoneHmac: 'a'.repeat(64) });
    const registration = await service.register({
      verificationToken: verified.verificationToken, installationId: identity.deviceId,
      installationPublicKey: identity.publicKey, idempotencyKey: 'offline-registration-test',
      deviceProof: vault.signChallenge({ purpose: 'unified-online-registration', challenge: verified.deviceChallenge }).signature,
      offlineLeaseVersion: 2,
    });
    assert.strictEqual(registration.offlineLease.v, 2);
    assert.strictEqual(Date.parse(registration.offlineLease.expiresAt) - start.getTime(), 14 * 24 * 60 * 60 * 1000);
    const sessionInput = {
      authorityId: 'authority-1', accountId: 'account-1', deviceId: identity.deviceId,
      installationId: identity.deviceId, sessionId: 'session-1', rowVersion: 1, activeRole: 'teacher',
      expiresAt: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    };
    const legacy = await service.issueSession(sessionInput);
    assert.strictEqual(legacy.offlineLease.v, 1);
    assert.strictEqual(legacy.offlineLease.expiresAt, legacy.session.expiresAt);
    const issued = await service.issueSession({ ...sessionInput, offlineLeaseVersion: 2 });
    assert.strictEqual(issued.session.expiresAt, legacy.session.expiresAt, 'online lifetime must remain one hour');
    assert.strictEqual(issued.offlineLease.v, 2);
    assert.strictEqual(Date.parse(issued.offlineLease.expiresAt) - start.getTime(), 14 * 24 * 60 * 60 * 1000);
    const authorization = {
      id: issued.session.id, deviceId: identity.deviceId, deviceName: identity.deviceName,
      deviceKind: identity.deviceKind, userId: 'account-1', keyFingerprint: identity.keyFingerprint,
      status: 'active', authorizationSource: 'wechat_phone', credentialVersion: 1,
      lastPhoneVerifiedAt: start.toISOString(), phoneReverifyDueAt: issued.session.expiresAt,
    };
    vault.completeRegistration({ authorization, profile: issued.profile, offlineLease: issued.offlineLease });
    await vault.acceptIssuedSession(issued);
    vault.lock();
    clock = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    let networkCalls = 0;
    let clearedSessions = 0;
    const restarted = makeVault();
    const client = createDesktopIdentityClient({
      desktopIdentity: restarted, now: () => new Date(clock),
      fetchImpl: async () => { networkCalls += 1; throw new Error('net::ERR_INTERNET_DISCONNECTED'); },
      sessionStore: { clear: async () => { clearedSessions += 1; }, save: async () => { throw new Error('offline must not save an online token'); } },
    });
    const resumed = await client.resume({ online: false });
    assert.strictEqual(resumed.gateState.kind, 'offline-unlocked', 'a cold-start the next day must resume the signed offline lease');
    assert.strictEqual(resumed.gateState.userId, 'account-1');
    assert.strictEqual(resumed.gateState.activeRole, 'teacher');
    assert.strictEqual(resumed.gateState.teacherId, 'teacher-1');
    assert.strictEqual(resumed.token, undefined);
    assert.strictEqual(networkCalls, 0);
    assert.strictEqual(clearedSessions, 1);
    const timeoutClient = createDesktopIdentityClient({
      desktopIdentity: restarted, now: () => new Date(clock), sessionRecoveryTimeoutMs: 10,
      fetchImpl: () => new Promise(() => {}), sessionStore: { clear: async () => {}, save: async () => {} },
    });
    await assert.rejects(() => timeoutClient.resume({ baseUrl: 'https://cloud.test', online: true }), error => isDesktopIdentityNetworkFailure(error));
    assert.strictEqual((await timeoutClient.resume({ online: false })).gateState.kind, 'offline-unlocked', 'an unresponsive cloud must allow signed offline fallback');
    const expiredOnlineClient = createDesktopIdentityClient({
      desktopIdentity: restarted, now: () => new Date(clock), sessionStore: { clear: async () => {}, save: async () => {} },
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ success: false, code: 'DESKTOP_ONLINE_SESSION_EXPIRED' }) }),
    });
    await assert.rejects(() => expiredOnlineClient.resume({ baseUrl: 'https://cloud.test', online: true }), error => error.code === 'DESKTOP_ONLINE_SESSION_EXPIRED');
    assert.strictEqual((await expiredOnlineClient.resume({ online: false })).gateState.kind, 'offline-unlocked', 'ordinary online expiry must preserve the still-valid offline lease');
    assert.throws(() => service.inspectSessionToken(issued.token), error => error.code === 'CLOUD_ONLINE_IDENTITY_REJECTED', 'offline validity cannot extend the expired online token');
    const snapshot = fs.readFileSync(filePath);
    for (const patch of [{ expiresAt: '2026-11-01T00:00:00.000Z' }, { userId: 'another-account' }, { v: 1 }]) {
      await assert.rejects(() => restarted.acceptIssuedSession({ ...issued, offlineLease: { ...issued.offlineLease, ...patch } }), /OFFLINE_LEASE_INVALID/);
      assert.deepStrictEqual(fs.readFileSync(filePath), snapshot, 'tampering must preserve the verified vault');
    }
    clock = new Date(issued.offlineLease.expiresAt);
    assert.strictEqual((await client.resume({ online: false })).gateState.kind, 'offline-blocked');
    clock = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const revokedClient = createDesktopIdentityClient({
      desktopIdentity: restarted, now: () => new Date(clock), sessionStore: { clear: async () => {}, save: async () => {} },
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ success: false, code: 'VNEXT_DESKTOP_AUTHORIZATION_INVALID' }) }),
    });
    await assert.rejects(() => revokedClient.resume({ baseUrl: 'https://cloud.test', online: true }), error => error.code === 'VNEXT_DESKTOP_AUTHORIZATION_INVALID');
    assert.strictEqual(restarted.status().offlineLease, null, 'known revocation must persist');
    const afterRevocationRestart = makeVault();
    assert.strictEqual((await afterRevocationRestart.resume()).offlineLease, null);
    assert.strictEqual((await client.resume({ online: false })).gateState.kind, 'offline-blocked');
    await assert.rejects(() => service.issueSession({ ...sessionInput, offlineLeaseVersion: 99 }), error => error.code === 'CLOUD_ONLINE_IDENTITY_REJECTED');
    const emptyVault = createDesktopIdentityVault({ filePath: path.join(workspace, 'empty.bin'), safeStorage, offlineLeasePublicKey: keys.publicKey });
    await assert.rejects(() => emptyVault.resume(), /VAULT/);
    for (const error of [new Error('net::ERR_INTERNET_DISCONNECTED'), { cause: { cause: { code: 'ENOTFOUND' } } }, { code: 'ETIMEDOUT' }]) {
      assert.strictEqual(isDesktopIdentityNetworkFailure(error), true);
    }
    assert.strictEqual(isDesktopIdentityNetworkFailure({ code: 'DESKTOP_DEVICE_NOT_ACTIVE' }), false);
    console.log('desktop offline next-day cold-start, signed lease, expiry and old-client compatibility passed');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
