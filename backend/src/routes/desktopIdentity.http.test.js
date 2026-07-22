const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseService } = require('../database');
const {
  createDesktopIdentityService,
  desktopExchangeSigningPayload,
} = require('../services/desktopIdentityService');
const { createDesktopSessionService } = require('../services/desktopSessionService');
const {
  desktopDeviceSessionSigningPayload,
} = require('../services/desktopDeviceChallengeService');
const { createMiniappIdentityService } = require('../services/miniappIdentityService');
const { createDesktopIdentityRouter } = require('./desktopIdentity');

async function requestJson(baseUrl, method, pathname, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function generateDeviceKey() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const der = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  return {
    privateKey: pair.privateKey,
    publicKey,
    keyFingerprint: crypto.createHash('sha256').update(der).digest('hex'),
  };
}

(async function () {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-desktop-identity-http-'));
  const dbPath = path.join(workspace, 'desktop-identity.db');
  const previous = {
    dbPath: process.env.DB_PATH,
    readDbPath: process.env.READ_DB_PATH,
    nodeEnv: process.env.NODE_ENV,
  };
  process.env.DB_PATH = dbPath;
  process.env.READ_DB_PATH = dbPath;
  process.env.NODE_ENV = 'production';

  let database;
  let server;
  try {
    database = new DatabaseService();
    const db = database.db;
    const jwtSecret = 'desktop-identity-http-test-secret';
    const canonicalId = 'miniapp-admin-13732250653';
    let clock = new Date('2026-07-17T09:00:00.000Z');
    const now = function () { return new Date(clock); };

    db.prepare(`INSERT INTO teachers
      (id, name, phone, deleted, created_at, updated_at)
      VALUES ('teacher-http-self', 'HTTP Canonical Teacher', '13732250653', 0, ?, ?)`)
      .run(clock.toISOString(), clock.toISOString());
    db.prepare('UPDATE users SET teacher_id=? WHERE id=?')
      .run('teacher-http-self', canonicalId);
    db.prepare(`INSERT INTO users
      (id, phone, name, role, status, login_enabled, review_status,
       auth_version, deleted, created_at, updated_at)
      VALUES ('approved-admin-other', '13000000001', 'Other Admin', 'admin',
        1, 1, 'approved', 1, 0, ?, ?)`)
      .run(clock.toISOString(), clock.toISOString());
    db.prepare(`INSERT INTO user_role_grants
      (user_id, role, subject_type, subject_id, status, source, created_at, updated_at)
      VALUES (?, 'teacher', 'teacher', 'teacher-http-self', 'active', 'test', ?, ?)`)
      .run(canonicalId, clock.toISOString(), clock.toISOString());

    const hostKey = generateDeviceKey();
    db.prepare(`INSERT INTO desktop_device_authorizations
      (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
       status, source_challenge_id, last_phone_verified_at, phone_reverify_due_at,
       credential_version, row_version, created_at, updated_at)
      VALUES ('authorization-http-host', 'device-http-host', 'Current Host', 'primary-host',
        ?, ?, ?, 'active', 'bootstrap-http-host', ?, '2026-08-16T09:00:00.000Z', 1, 1, ?, ?)`)
      .run(
        canonicalId,
        hostKey.publicKey,
        hostKey.keyFingerprint,
        clock.toISOString(),
        clock.toISOString(),
        clock.toISOString()
      );
    const otherKey = generateDeviceKey();
    db.prepare(`INSERT INTO desktop_device_authorizations
      (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
       status, source_challenge_id, last_phone_verified_at, phone_reverify_due_at,
       credential_version, row_version, created_at, updated_at)
      VALUES ('authorization-http-other', 'device-http-other', 'Other User PC', 'desktop-client',
        'approved-admin-other', ?, ?, 'active', 'bootstrap-http-other', ?,
        '2026-08-16T09:00:00.000Z', 1, 1, ?, ?)`)
      .run(otherKey.publicKey, otherKey.keyFingerprint, clock.toISOString(), clock.toISOString(), clock.toISOString());

    const identityService = createDesktopIdentityService({ db, now });
    const sessionService = createDesktopSessionService({ db, jwtSecret, now });
    const miniappIdentityService = createMiniappIdentityService({ db, jwtSecret, now });
    const usedLoginCodes = new Set();
    const usedPhoneCodes = new Set();
    const generatedUrlLinks = [];
    let failNextUrlLink = null;
    const createDesktopAuthorizationUrlLink = async function ({ challengeId }) {
      generatedUrlLinks.push(challengeId);
      if (failNextUrlLink) {
        const linkFailure = failNextUrlLink;
        failNextUrlLink = false;
        const error = new Error('url link failed');
        error.code = 'WECHAT_URL_LINK_FAILED';
        if (linkFailure === 'permission') error.wechatErrcode = 85407;
        throw error;
      }
      return `https://wxaurl.cn/test-${challengeId}`;
    };
    const createDesktopAuthorizationQrCode = async function ({ challengeId }) {
      return `data:image/jpeg;base64,${Buffer.from(`qr-${challengeId}`).toString('base64')}`;
    };
    const resolveWechatIdentity = async function (code) {
      if (!code || usedLoginCodes.has(code)) {
        const error = new Error('WECHAT_CODE_EXCHANGE_FAILED');
        error.code = 'WECHAT_CODE_EXCHANGE_FAILED';
        throw error;
      }
      usedLoginCodes.add(code);
      return { openid: 'wx-http-canonical', unionid: 'union-http-canonical' };
    };
    const resolveWechatPhoneNumber = async function (phoneCode) {
      if (!phoneCode || usedPhoneCodes.has(phoneCode)) {
        const error = new Error('WECHAT_PHONE_EXCHANGE_FAILED');
        error.code = 'WECHAT_PHONE_EXCHANGE_FAILED';
        throw error;
      }
      usedPhoneCodes.add(phoneCode);
      return '13732250653';
    };

    let targetDeviceIdForSelfTest = null;
    const authenticateDesktop = function (token) {
      if (token === 'self-device-test-token') {
        return Object.freeze({
          userId: canonicalId,
          deviceId: targetDeviceIdForSelfTest,
          activeRole: 'super_admin',
          eligibleRoles: Object.freeze(['super_admin', 'teacher']),
          authTime: clock.toISOString(),
          scope: Object.freeze({ kind: 'all' }),
        });
      }
      return sessionService.verifySessionToken(token);
    };

    const app = express();
    app.use(express.json({ limit: '64kb' }));
    app.use('/api/desktop-identity', createDesktopIdentityRouter({
      db,
      jwtSecret,
      now,
      identityService,
      sessionService,
      miniappIdentityService,
      authenticateDesktop,
      resolveWechatIdentity,
      resolveWechatPhoneNumber,
      createDesktopAuthorizationUrlLink,
      createDesktopAuthorizationQrCode,
    }));
    server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    async function startDevice(deviceId, deviceName, key) {
      const response = await requestJson(
        baseUrl,
        'POST',
        '/api/desktop-identity/challenges/start',
        { body: { deviceId, deviceName, publicKey: key.publicKey, keyFingerprint: key.keyFingerprint } }
      );
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.challenge.status, 'pending_phone');
      assert.strictEqual(response.body.data.challenge.qrValue, `https://wxaurl.cn/test-${response.body.data.challenge.id}`);
      return response.body.data.challenge;
    }

    async function confirmDevice(challengeId, suffix) {
      const response = await requestJson(
        baseUrl,
        'POST',
        `/api/desktop-identity/challenges/${challengeId}/confirm`,
        { body: { code: `fresh-login-${suffix}`, phoneCode: `fresh-phone-${suffix}` } }
      );
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.data.challenge.status, 'identity_verified_pending_approval');
      assert.strictEqual(response.body.data.claimant.id, canonicalId);
      assert.ok(!('phone' in response.body.data.claimant));
      assert.strictEqual(response.body.data.claimant.maskedPhone, '137****0653');
      return response.body.data;
    }

    async function approveDevice(challenge, token) {
      const response = await requestJson(
        baseUrl,
        'POST',
        `/api/desktop-identity/challenges/${challenge.id}/approve`,
        { token, body: { expectedRowVersion: challenge.rowVersion } }
      );
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.data.challenge.status, 'approved_pending_exchange');
      return response.body.data.challenge;
    }

    async function exchangeDevice(challenge, key, secret) {
      const payload = desktopExchangeSigningPayload({
        challengeId: challenge.id,
        deviceId: challenge.deviceId,
        rowVersion: challenge.rowVersion,
        challengeSecret: secret,
      });
      const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), key.privateKey).toString('base64');
      const response = await requestJson(
        baseUrl,
        'POST',
        `/api/desktop-identity/challenges/${challenge.id}/exchange`,
        {
          body: {
            challengeSecret: secret,
            signature,
            expectedRowVersion: challenge.rowVersion,
          },
        }
      );
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.data.authorization.status, 'active');
      assert.ok(response.body.data.token);
      assert.strictEqual(response.body.data.offlineLease.authorizationId, response.body.data.authorization.id);
      assert.strictEqual(response.body.data.offlineLease.deviceId, challenge.deviceId);
      assert.strictEqual(response.body.data.profile.userId, response.body.data.authorization.userId);
      assert.strictEqual(response.body.data.profile.activeRole, 'teacher');
      assert.deepStrictEqual(response.body.data.profile.eligibleRoles, ['super_admin', 'teacher']);
      assert.ok(
        Date.parse(response.body.data.offlineLease.expiresAt)
          - Date.parse(response.body.data.offlineLease.issuedAt)
          <= 72 * 60 * 60 * 1000
      );
      return response.body.data;
    }

    const qrFallbackKey = generateDeviceKey();
    failNextUrlLink = 'permission';
    const qrFallbackStart = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/challenges/start',
      { body: {
        deviceId: 'device-http-qr-fallback', deviceName: 'QR Fallback PC',
        publicKey: qrFallbackKey.publicKey, keyFingerprint: qrFallbackKey.keyFingerprint,
      } }
    );
    assert.strictEqual(qrFallbackStart.status, 200);
    assert.strictEqual(qrFallbackStart.body.data.challenge.qrValue, null);
    assert.ok(qrFallbackStart.body.data.challenge.qrImageDataUrl.startsWith('data:image/jpeg;base64,'));
    assert.strictEqual(qrFallbackStart.body.data.challenge.qrEntryMode, 'mini-program-code');

    const failedLinkKey = generateDeviceKey();
    failNextUrlLink = true;
    const failedLinkStart = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/challenges/start',
      { body: {
        deviceId: 'device-http-link-failed', deviceName: 'Link Failed PC',
        publicKey: failedLinkKey.publicKey, keyFingerprint: failedLinkKey.keyFingerprint,
      } }
    );
    assert.strictEqual(failedLinkStart.status, 502);
    assert.strictEqual(failedLinkStart.body.code, 'WECHAT_URL_LINK_FAILED');
    assert.strictEqual(
      db.prepare("SELECT status FROM desktop_identity_challenges WHERE device_id='device-http-link-failed'").get().status,
      'rejected',
      'production URL Link failure must abandon the challenge so the device can retry'
    );

    const secondKey = generateDeviceKey();
    const secondStarted = await startDevice('device-http-second', 'Second PC', secondKey);
    const publicProjection = await requestJson(
      baseUrl,
      'GET',
      `/api/desktop-identity/challenges/${secondStarted.id}`
    );
    assert.strictEqual(publicProjection.status, 200);
    assert.ok(!('challengeSecret' in publicProjection.body.data.challenge));
    assert.ok(!('publicKey' in publicProjection.body.data.challenge));
    assert.ok(!('claimedUserId' in publicProjection.body.data.challenge));
    assert.strictEqual(generatedUrlLinks.includes(secondStarted.id), true);

    const miniappProjection = await requestJson(
      baseUrl,
      'GET',
      `/api/desktop-identity/challenges/${secondStarted.id}/public`
    );
    assert.strictEqual(miniappProjection.status, 200);
    assert.deepStrictEqual(Object.keys(miniappProjection.body.data.challenge).sort(), [
      'createdAt', 'deviceName', 'expiresAt', 'id', 'keyFingerprintSummary', 'purpose', 'status',
    ].sort());
    assert.ok(!('deviceId' in miniappProjection.body.data.challenge));
    assert.ok(!('rowVersion' in miniappProjection.body.data.challenge));

    const injectedConfirm = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/challenges/${secondStarted.id}/confirm`,
      { body: { code: 'injected-code', phoneCode: 'injected-phone', userId: canonicalId } }
    );
    assert.strictEqual(injectedConfirm.status, 400);
    assert.strictEqual(injectedConfirm.body.code, 'DESKTOP_IDENTITY_INPUT_FORBIDDEN');

    const secondConfirmedData = await confirmDevice(secondStarted.id, 'second');
    const secondConfirmed = secondConfirmedData.challenge;
    targetDeviceIdForSelfTest = secondConfirmed.deviceId;

    const elevatedHost = sessionService.issueSession({
      userId: canonicalId,
      deviceId: 'device-http-host',
      activeRole: 'super_admin',
      authTime: clock,
    });
    const teacherHost = sessionService.issueSession({
      userId: canonicalId,
      deviceId: 'device-http-host',
      activeRole: 'teacher',
    });
    const staleSuperAdminHost = sessionService.issueSession({
      userId: canonicalId,
      deviceId: 'device-http-host',
      activeRole: 'super_admin',
      authTime: new Date(clock.getTime() - 60 * 60 * 1000),
    });

    const pending = await requestJson(
      baseUrl,
      'GET',
      '/api/desktop-identity/authorizations/pending',
      { token: elevatedHost.token }
    );
    assert.strictEqual(pending.status, 200);
    assert.strictEqual(pending.body.data.items.length, 1);
    assert.strictEqual(pending.body.data.items[0].claimant.id, canonicalId);
    assert.strictEqual(pending.body.data.items[0].claimant.maskedPhone, '137****0653');
    assert.deepStrictEqual(pending.body.data.items[0].claimant.eligibleRoles, ['super_admin', 'teacher']);
    assert.ok(!('userChoices' in pending.body.data.items[0]));

    const stalePendingRead = await requestJson(
      baseUrl,
      'GET',
      '/api/desktop-identity/authorizations/pending',
      { token: staleSuperAdminHost.token }
    );
    assert.strictEqual(stalePendingRead.status, 200, 'super-admin may always read the pending badge');

    const staleApproval = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/challenges/${secondConfirmed.id}/approve`,
      { token: staleSuperAdminHost.token, body: { expectedRowVersion: secondConfirmed.rowVersion } }
    );
    assert.strictEqual(staleApproval.status, 403, 'approval still requires recent local-password elevation');
    assert.strictEqual(staleApproval.body.code, 'DESKTOP_RECENT_ELEVATION_REQUIRED');

    const injectedApproval = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/challenges/${secondConfirmed.id}/approve`,
      {
        token: elevatedHost.token,
        body: { expectedRowVersion: secondConfirmed.rowVersion, userId: canonicalId },
      }
    );
    assert.strictEqual(injectedApproval.status, 400);
    assert.strictEqual(injectedApproval.body.code, 'DESKTOP_IDENTITY_INPUT_FORBIDDEN');

    const teacherApproval = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/challenges/${secondConfirmed.id}/approve`,
      { token: teacherHost.token, body: { expectedRowVersion: secondConfirmed.rowVersion } }
    );
    assert.strictEqual(teacherApproval.status, 403);
    assert.strictEqual(teacherApproval.body.code, 'DESKTOP_SUPER_ADMIN_ROLE_REQUIRED');

    const selfApproval = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/challenges/${secondConfirmed.id}/approve`,
      {
        token: 'self-device-test-token',
        body: { expectedRowVersion: secondConfirmed.rowVersion },
      }
    );
    assert.strictEqual(selfApproval.status, 403);
    assert.strictEqual(selfApproval.body.code, 'DESKTOP_DEVICE_SELF_APPROVAL_FORBIDDEN');

    const concurrentApprovals = await Promise.all([
      requestJson(
        baseUrl,
        'POST',
        `/api/desktop-identity/challenges/${secondConfirmed.id}/approve`,
        {
          token: elevatedHost.token,
          body: { expectedRowVersion: secondConfirmed.rowVersion },
        }
      ),
      requestJson(
        baseUrl,
        'POST',
        `/api/desktop-identity/challenges/${secondConfirmed.id}/approve`,
        {
          token: elevatedHost.token,
          body: { expectedRowVersion: secondConfirmed.rowVersion },
        }
      ),
    ]);
    assert.deepStrictEqual(
      concurrentApprovals.map(function (response) { return response.status; }).sort(),
      [200, 409]
    );
    const secondApprovedResponse = concurrentApprovals.find(function (response) {
      return response.status === 200;
    });
    const secondApproved = secondApprovedResponse.body.data.challenge;
    assert.strictEqual(secondApproved.status, 'approved_pending_exchange');
    const unsignedExchange = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/challenges/${secondApproved.id}/exchange`,
      {
        body: {
          challengeSecret: secondStarted.challengeSecret,
          expectedRowVersion: secondApproved.rowVersion,
        },
      }
    );
    assert.strictEqual(unsignedExchange.status, 400);
    assert.strictEqual(unsignedExchange.body.code, 'DESKTOP_DEVICE_SIGNATURE_REQUIRED');

    const secondExchange = await exchangeDevice(
      secondApproved,
      secondKey,
      secondStarted.challengeSecret
    );
    assert.strictEqual(secondExchange.session.activeRole, 'teacher');
    assert.strictEqual(sessionService.verifySessionToken(secondExchange.token).deviceId, 'device-http-second');

    const replayExchange = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/challenges/${secondApproved.id}/exchange`,
      {
        body: {
          challengeSecret: secondStarted.challengeSecret,
          signature: crypto.sign(
            null,
            Buffer.from(desktopExchangeSigningPayload({
              challengeId: secondApproved.id,
              deviceId: secondApproved.deviceId,
              rowVersion: secondApproved.rowVersion,
              challengeSecret: secondStarted.challengeSecret,
            }), 'utf8'),
            secondKey.privateKey
          ).toString('base64'),
          expectedRowVersion: secondApproved.rowVersion,
        },
      }
    );
    assert.strictEqual(replayExchange.status, 409);
    assert.strictEqual(replayExchange.body.code, 'DESKTOP_CHALLENGE_ALREADY_EXCHANGED');

    clock = new Date('2026-07-17T09:01:00.000Z');
    const thirdKey = generateDeviceKey();
    const thirdStarted = await startDevice('device-http-third', 'Third PC', thirdKey);
    const thirdConfirmedData = await confirmDevice(thirdStarted.id, 'third');
    const thirdApproved = await approveDevice(thirdConfirmedData.challenge, elevatedHost.token);
    const thirdExchange = await exchangeDevice(thirdApproved, thirdKey, thirdStarted.challengeSecret);
    assert.strictEqual(sessionService.verifySessionToken(thirdExchange.token).deviceId, 'device-http-third');

    const injectedDailyStart = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/session/challenges/start',
      {
        body: {
          authorizationId: thirdExchange.authorization.id,
          deviceId: 'device-http-third',
          userId: canonicalId,
        },
      }
    );
    assert.strictEqual(injectedDailyStart.status, 400);
    assert.strictEqual(injectedDailyStart.body.code, 'DESKTOP_IDENTITY_INPUT_FORBIDDEN');

    const dailyStarted = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/session/challenges/start',
      {
        body: {
          authorizationId: thirdExchange.authorization.id,
          deviceId: 'device-http-third',
        },
      }
    );
    assert.strictEqual(dailyStarted.status, 200);
    assert.strictEqual(dailyStarted.body.data.challenge.status, 'pending');
    const dailyChallenge = dailyStarted.body.data.challenge;
    const dailyPayload = desktopDeviceSessionSigningPayload(dailyChallenge);
    const dailySignature = crypto.sign(
      null,
      Buffer.from(dailyPayload, 'utf8'),
      thirdKey.privateKey
    ).toString('base64');
    const injectedDailyExchange = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/session/challenges/${dailyChallenge.id}/exchange`,
      {
        body: {
          signature: dailySignature,
          expectedRowVersion: dailyChallenge.rowVersion,
          authorizationId: thirdExchange.authorization.id,
        },
      }
    );
    assert.strictEqual(injectedDailyExchange.status, 400);
    assert.strictEqual(injectedDailyExchange.body.code, 'DESKTOP_IDENTITY_INPUT_FORBIDDEN');
    const dailyExchange = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/session/challenges/${dailyChallenge.id}/exchange`,
      {
        body: {
          signature: dailySignature,
          expectedRowVersion: dailyChallenge.rowVersion,
        },
      }
    );
    assert.strictEqual(dailyExchange.status, 200);
    assert.strictEqual(dailyExchange.body.data.session.activeRole, 'teacher');
    assert.strictEqual(dailyExchange.body.data.offlineLease.deviceId, 'device-http-third');
    assert.strictEqual(
      sessionService.verifySessionToken(dailyExchange.body.data.token).deviceId,
      'device-http-third'
    );
    const dailyReplay = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/session/challenges/${dailyChallenge.id}/exchange`,
      {
        body: {
          signature: dailySignature,
          expectedRowVersion: dailyChallenge.rowVersion,
        },
      }
    );
    assert.strictEqual(dailyReplay.status, 409);
    assert.strictEqual(dailyReplay.body.code, 'DESKTOP_SESSION_CHALLENGE_REPLAYED');

    const resetKey = generateDeviceKey();
    const resetStartResponse = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/challenges/start',
      { body: {
        deviceId: 'device-http-third',
        deviceName: 'Client supplied name must not replace the registered name',
        publicKey: resetKey.publicKey,
        keyFingerprint: resetKey.keyFingerprint,
        purpose: 'password_reset',
      } }
    );
    assert.strictEqual(resetStartResponse.status, 200);
    const resetStarted = resetStartResponse.body.data.challenge;
    const resetConfirmedData = await confirmDevice(resetStarted.id, 'password-reset');
    assert.strictEqual(resetConfirmedData.challenge.purpose, 'password_reset');
    assert.strictEqual(resetConfirmedData.challenge.deviceName, 'Third PC');
    const resetApproved = await approveDevice(resetConfirmedData.challenge, elevatedHost.token);
    const beforeResetExchange = await requestJson(
      baseUrl,
      'GET',
      '/api/desktop-identity/devices',
      { token: thirdExchange.token }
    );
    assert.strictEqual(beforeResetExchange.status, 200);
    const resetExchange = await exchangeDevice(
      resetApproved,
      resetKey,
      resetStarted.challengeSecret
    );
    assert.strictEqual(resetExchange.authorization.id, thirdExchange.authorization.id);
    assert.strictEqual(resetExchange.authorization.deviceId, 'device-http-third');
    assert.strictEqual(resetExchange.authorization.credentialVersion, 2);
    assert.strictEqual(resetExchange.authorization.keyFingerprint, resetKey.keyFingerprint);
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) count FROM desktop_device_authorizations WHERE device_id=?')
        .get('device-http-third').count,
      1
    );
    const oldSessionAfterReset = await requestJson(
      baseUrl,
      'GET',
      '/api/desktop-identity/devices',
      { token: thirdExchange.token }
    );
    assert.strictEqual(oldSessionAfterReset.status, 401);
    assert.strictEqual(oldSessionAfterReset.body.code, 'DESKTOP_SESSION_CREDENTIAL_VERSION_MISMATCH');
    const resetSessionUse = await requestJson(
      baseUrl,
      'GET',
      '/api/desktop-identity/devices',
      { token: resetExchange.token }
    );
    assert.strictEqual(resetSessionUse.status, 200);

    const devices = await requestJson(
      baseUrl,
      'GET',
      '/api/desktop-identity/devices',
      { token: elevatedHost.token }
    );
    assert.strictEqual(devices.status, 200);
    assert.deepStrictEqual(
      devices.body.data.items.map(function (item) { return item.deviceId; }).sort(),
      ['device-http-host', 'device-http-second', 'device-http-third']
    );
    assert.ok(devices.body.data.items.every(function (item) { return item.userId === canonicalId; }));

    const allDevices = await requestJson(
      baseUrl,
      'GET',
      '/api/desktop-identity/devices/all',
      { token: elevatedHost.token }
    );
    assert.strictEqual(allDevices.status, 200);
    assert.deepStrictEqual(
      allDevices.body.data.items.map(function (item) { return item.deviceId; }).sort(),
      ['device-http-host', 'device-http-other', 'device-http-second', 'device-http-third']
    );
    assert.strictEqual(allDevices.body.data.items.find(function (item) {
      return item.deviceId === 'device-http-host';
    }).deviceKind, 'primary-host');
    const teacherAllDevices = await requestJson(
      baseUrl,
      'GET',
      '/api/desktop-identity/devices/all',
      { token: teacherHost.token }
    );
    assert.strictEqual(teacherAllDevices.status, 403);
    assert.strictEqual(teacherAllDevices.body.code, 'DESKTOP_SUPER_ADMIN_ROLE_REQUIRED');

    const invalidOlderReplacement = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/devices/device-http-second/revoke',
      {
        token: elevatedHost.token,
        body: {
          expectedRowVersion: secondExchange.authorization.rowVersion,
          reason: 'replaced',
          replacementDeviceId: 'device-http-host',
        },
      }
    );
    assert.strictEqual(invalidOlderReplacement.status, 400);
    assert.strictEqual(invalidOlderReplacement.body.code, 'DESKTOP_DEVICE_REPLACEMENT_INVALID');

    const revokedSecond = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/devices/device-http-second/revoke',
      {
        token: elevatedHost.token,
        body: {
          expectedRowVersion: secondExchange.authorization.rowVersion,
          reason: 'replaced',
          replacementDeviceId: 'device-http-third',
        },
      }
    );
    assert.strictEqual(revokedSecond.status, 200);
    assert.strictEqual(revokedSecond.body.data.authorization.status, 'replaced');
    assert.strictEqual(revokedSecond.body.data.authorization.replacedByDeviceId, 'device-http-third');

    const revokedSessionUse = await requestJson(
      baseUrl,
      'GET',
      '/api/desktop-identity/devices',
      { token: secondExchange.token }
    );
    assert.strictEqual(revokedSessionUse.status, 401);
    const thirdStillActive = await requestJson(
      baseUrl,
      'GET',
      '/api/desktop-identity/devices',
      { token: resetExchange.token }
    );
    assert.strictEqual(thirdStillActive.status, 200);

    const sensitiveRows = JSON.stringify({
      challenges: db.prepare('SELECT * FROM desktop_identity_challenges').all(),
      authorizations: db.prepare('SELECT * FROM desktop_device_authorizations').all(),
      deviceSessionChallenges: db.prepare('SELECT * FROM desktop_device_session_challenges').all(),
      sessions: db.prepare('SELECT * FROM desktop_sessions').all(),
      loginEvents: db.prepare('SELECT * FROM miniapp_login_events').all(),
    });
    for (const secret of [
      'fresh-login-second',
      'fresh-phone-second',
      'fresh-login-third',
      'fresh-phone-third',
      secondStarted.challengeSecret,
      dailyChallenge.nonce,
    ]) {
      assert.ok(!sensitiveRows.includes(secret), `${secret} must not be persisted`);
    }

    console.log('desktop identity HTTP checks passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    try { database?.close(); } catch (_error) { /* best effort */ }
    if (previous.dbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previous.dbPath;
    if (previous.readDbPath === undefined) delete process.env.READ_DB_PATH;
    else process.env.READ_DB_PATH = previous.readDbPath;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch (_error) { /* Windows WAL */ }
  }
})().catch(function (error) {
  console.error(error);
  process.exit(1);
});
