const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createCloudBusinessApp } = require('../../cloud-business-api/src/app');
const { createDesktopIdentityVault } = require('../../public/desktopIdentityVault');

function mockSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(String(value), 'utf8'),
    decryptString: value => Buffer.from(value).toString('utf8'),
  };
}

function signedOfflineLease(privateKey, input) {
  const lease = {
    v: 1,
    id: input.id,
    userId: input.userId,
    deviceId: input.deviceId,
    authorizationId: input.authorizationId,
    credentialVersion: 1,
    eligibleRoles: ['teacher'],
    activeRole: 'teacher',
    teacherId: input.teacherId,
    studentId: null,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    scope: { kind: 'teacher', teacherId: input.teacherId },
  };
  return {
    ...lease,
    signature: crypto.sign(null, Buffer.from(JSON.stringify(lease), 'utf8'), privateKey).toString('base64url'),
  };
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function close(server) {
  await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
}

async function main() {
  const {
    createDesktopIdentityClient,
    isDesktopIdentityNetworkFailure,
    resolveDesktopGateState,
  } = await import('./desktopIdentityClient.mjs');
  const fixtureAccount = Object.freeze({
    id: 'fixture-account-desktop-cold-start',
    login: 'fixture.teacher',
    password: 'fixture-password-never-used-outside-this-test',
    teacherId: 'fixture-teacher-desktop-cold-start',
  });
  const clock = new Date('2026-09-01T10:00:00.000Z');
  const leaseKeys = crypto.generateKeyPairSync('ed25519');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-desktop-login-http-'));
  const identityPath = path.join(workspace, 'identity.bin');
  let server = null;
  let proxyServer = null;
  try {
    const vault = createDesktopIdentityVault({
      filePath: identityPath,
      safeStorage: mockSafeStorage(),
      offlineLeasePublicKey: leaseKeys.publicKey,
      now: () => new Date(clock),
    });
    const oldIdentity = vault.beginUnifiedOnlineRegistration({ deviceName: 'Fixture desktop' });
    vault.completeRegistration({
      authorization: {
        id: 'fixture-session-before-cold-start',
        deviceId: oldIdentity.deviceId,
        deviceName: oldIdentity.deviceName,
        deviceKind: oldIdentity.deviceKind,
        userId: fixtureAccount.id,
        keyFingerprint: oldIdentity.keyFingerprint,
        status: 'active',
        authorizationSource: 'wechat_phone',
        credentialVersion: 1,
        lastPhoneVerifiedAt: clock.toISOString(),
        phoneReverifyDueAt: '2026-09-01T11:00:00.000Z',
      },
      profile: {
        userId: fixtureAccount.id,
        user: { id: fixtureAccount.id, name: 'Fixture Teacher' },
        eligibleRoles: ['teacher'],
        activeRole: 'teacher',
        teacherId: fixtureAccount.teacherId,
        studentId: null,
      },
      offlineLease: signedOfflineLease(leaseKeys.privateKey, {
        id: 'fixture-lease-before-cold-start',
        userId: fixtureAccount.id,
        deviceId: oldIdentity.deviceId,
        authorizationId: 'fixture-session-before-cold-start',
        teacherId: fixtureAccount.teacherId,
        issuedAt: clock.toISOString(),
        expiresAt: '2026-09-01T11:00:00.000Z',
      }),
    });
    vault.lock();
    const preservedIdentityBytes = fs.readFileSync(identityPath);
    const passwordChallenge = 'fixture-password-device-challenge';
    const verificationToken = 'fixture-password-verification-token';
    const renewedSessionId = 'fixture-session-after-password-login';
    const renewedExpiresAt = '2026-09-01T11:00:00.000Z';
    let registeredInstallation = null;
    let sessionRecoveryMode = 'revoked';
    const observed = [];
    const app = createCloudBusinessApp({
      query: async () => ({ rows: [] }),
      desktopPasswordAuthentication: {
        enroll: async () => { throw new Error('fixture enrollment is disabled'); },
        enrollFromVerificationTicket: async () => { throw new Error('fixture enrollment is disabled'); },
        verify: async input => {
          observed.push(['password-verification', { ...input, password: '<redacted>' }]);
          assert.deepStrictEqual(input, {
            loginType: 'account_name',
            login: fixtureAccount.login,
            password: fixtureAccount.password,
          });
          return { verificationToken, deviceChallenge: passwordChallenge };
        },
      },
      desktopVerifiedAccess: {
        read: async input => {
          observed.push(['verified-access', input]);
          assert.deepStrictEqual(input, { verificationToken });
          return { access: 'allowed', roles: ['teacher'], teacherId: fixtureAccount.teacherId };
        },
      },
      desktopRegistration: {
        begin: async () => { throw new Error('fixture QR registration is disabled'); },
        register: async input => {
          observed.push(['online-registration', {
            ...input,
            verificationToken: '<redacted>',
            deviceProof: '<redacted>',
          }]);
          assert.strictEqual(input.verificationToken, verificationToken);
          assert.ok(crypto.verify(
            null,
            Buffer.from(passwordChallenge, 'utf8'),
            crypto.createPublicKey(input.installationPublicKey),
            Buffer.from(input.deviceProof, 'base64url'),
          ), 'the HTTP fixture must receive proof from the replacement installation key');
          registeredInstallation = {
            id: input.installationId,
            publicKey: input.installationPublicKey,
          };
          return {
            receiptId: 'fixture-registration-receipt',
            sessionId: renewedSessionId,
            replayed: false,
            sessionToken: 'fixtureSessionPayload.fixtureSessionSignature',
            offlineLease: signedOfflineLease(leaseKeys.privateKey, {
              id: 'fixture-lease-after-password-login',
              userId: fixtureAccount.id,
              deviceId: input.installationId,
              authorizationId: renewedSessionId,
              teacherId: fixtureAccount.teacherId,
              issuedAt: clock.toISOString(),
              expiresAt: renewedExpiresAt,
            }),
          };
        },
        sessionContext: async input => {
          observed.push(['session-context', { sessionToken: '<redacted>' }]);
          assert.deepStrictEqual(input, { sessionToken: 'fixtureSessionPayload.fixtureSessionSignature' });
          return {
            authorityId: 'fixture-authority',
            accountId: fixtureAccount.id,
            deviceId: registeredInstallation.id,
            installationId: registeredInstallation.id,
            sessionId: renewedSessionId,
            expiresAt: renewedExpiresAt,
            rowVersion: 1,
            roles: ['teacher'],
            teacherId: fixtureAccount.teacherId,
            studentId: null,
          };
        },
      },
      desktopCloudIdentity: {
        startChallenge: async () => {
          if (sessionRecoveryMode === 'revoked') {
            throw Object.assign(new Error('VNEXT_DESKTOP_AUTHORIZATION_INVALID'), { code: 'P0001' });
          }
          throw new Error('fixture cloud identity outage');
        },
        exchangeChallenge: async () => { throw new Error('unexpected fixture challenge exchange'); },
        switchRole: async () => { throw new Error('unexpected fixture role switch'); },
        listDevices: async () => { throw new Error('unexpected fixture device list'); },
        revokeDevice: async () => { throw new Error('unexpected fixture device revocation'); },
      },
    });
    server = await listen(app);
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    let storedSession = null;
    const client = createDesktopIdentityClient({
      desktopIdentity: vault,
      fetchImpl: fetch,
      now: () => new Date(clock),
      sessionStore: {
        save: async value => { storedSession = value; },
        clear: async () => { storedSession = null; },
      },
    });

    let revokedSessionError = null;
    try {
      await client.resume({ baseUrl, online: true });
    } catch (error) {
      revokedSessionError = error;
    }
    assert.strictEqual(revokedSessionError?.code, 'VNEXT_DESKTOP_AUTHORIZATION_INVALID');
    assert.strictEqual(isDesktopIdentityNetworkFailure(revokedSessionError), false,
      'a revoked cloud authorization must never enter the signed-lease offline fallback');
    await client.lock();

    proxyServer = http.createServer((request, response) => {
      const statusMatch = request.url.match(/^\/(502|503|504)\//);
      response.statusCode = Number(statusMatch?.[1] || 503);
      if (request.url.includes('/generic-json/')) {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ success: false, code: 'UPSTREAM_TEMPORARILY_UNAVAILABLE' }));
        return;
      }
      response.setHeader('content-type', 'text/html');
      response.end('<html><body>temporary proxy outage</body></html>');
    });
    await new Promise((resolve, reject) => {
      proxyServer.once('error', reject);
      proxyServer.listen(0, '127.0.0.1', resolve);
    });
    const proxyBaseUrl = `http://127.0.0.1:${proxyServer.address().port}`;
    for (const outageStatus of [502, 503, 504]) {
      for (const outageBody of ['html', 'generic-json']) {
        const unavailableBaseUrl = `${proxyBaseUrl}/${outageStatus}/${outageBody}`;
        let proxyError = null;
        try {
          await client.resume({ baseUrl: unavailableBaseUrl, online: true });
        } catch (error) {
          proxyError = error;
        }
        assert.strictEqual(proxyError?.code, 'CLOUD_ONLINE_IDENTITY_UNAVAILABLE',
          '502/503/504 responses must retain outage semantics even with an HTML or generic JSON body');
        assert.strictEqual(isDesktopIdentityNetworkFailure(proxyError), true);
        await client.lock();
      }
    }

    sessionRecoveryMode = 'unavailable';
    let coldStartError = null;
    try {
      await client.resume({ baseUrl, online: true });
    } catch (error) {
      coldStartError = error;
    }
    assert.strictEqual(coldStartError?.code, 'CLOUD_ONLINE_IDENTITY_UNAVAILABLE',
      'the fixture must first reproduce a cold-start session recovery failure');
    assert.strictEqual(isDesktopIdentityNetworkFailure(coldStartError), true);
    storedSession = { token: 'stale-bearer-before-offline-fallback' };
    const offlineFallback = await client.resume({ baseUrl, online: false });
    assert.strictEqual(offlineFallback.gateState.kind, 'offline-unlocked',
      'the unlocked signed lease must remain usable when the cloud session endpoint is unavailable');
    assert.strictEqual(storedSession, null,
      'entering the offline partition must clear any process-memory online bearer session');
    const pending = await client.beginPasswordVerification({
      baseUrl,
      deviceName: 'Fixture desktop',
      idempotencyKey: 'fixture-password-login-recovery',
      loginType: 'account_name',
      login: fixtureAccount.login,
      password: fixtureAccount.password,
    });
    assert.strictEqual(vault.status().state, 'unified_online_recovery_pending');
    assert.notStrictEqual(pending.publicIdentity.deviceId, oldIdentity.deviceId);
    assert.deepStrictEqual(fs.readFileSync(identityPath), preservedIdentityBytes,
      'password verification alone must not replace the prior local identity');

    const completed = await client.completeUnifiedOnlineRegistration({ pending });
    assert.strictEqual(completed.gateState.kind, 'online-unlocked');
    assert.strictEqual(completed.session.userId, fixtureAccount.id);
    assert.strictEqual(completed.session.activeRole, 'teacher');
    assert.strictEqual(storedSession.session.id, renewedSessionId);
    assert.strictEqual(vault.status().deviceId, pending.publicIdentity.deviceId);
    assert.notDeepStrictEqual(fs.readFileSync(identityPath), preservedIdentityBytes);
    assert.deepStrictEqual(observed.map(entry => entry[0]), [
      'password-verification',
      'verified-access',
      'online-registration',
      'session-context',
    ]);
    console.log(`desktop identity HTTP cold-start fixture passed on ${baseUrl}`);
  } finally {
    if (proxyServer) await close(proxyServer);
    if (server) await close(server);
    const resolvedWorkspace = path.resolve(workspace);
    const resolvedTempRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolvedWorkspace.startsWith(resolvedTempRoot));
    fs.rmSync(resolvedWorkspace, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
