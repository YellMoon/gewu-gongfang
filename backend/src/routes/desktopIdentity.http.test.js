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
const { activationReceiptSigningPayload } = require('../services/deviceActivationService');
const {
  desktopDeviceSessionSigningPayload,
} = require('../services/desktopDeviceChallengeService');
const { createMiniappIdentityService } = require('../services/miniappIdentityService');
const { createDesktopIdentityRouter } = require('./desktopIdentity');

async function requestJson(baseUrl, method, pathname, { token, body, headers: extraHeaders } = {}) {
  const headers = { ...(extraHeaders || {}) };
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

    db.prepare(`INSERT INTO authority_metadata(key,value,updated_at)
      VALUES('database_authority_id','authority-desktop-identity-http',?)`)
      .run(clock.toISOString());

    db.prepare(`INSERT INTO teachers
      (id, name, phone, deleted, created_at, updated_at)
      VALUES ('teacher-http-self', 'HTTP Canonical Teacher', '13732250653', 0, ?, ?)`)
      .run(clock.toISOString(), clock.toISOString());
    db.prepare('UPDATE users SET teacher_id=? WHERE id=?')
      .run('teacher-http-self', canonicalId);
    db.prepare('UPDATE users SET wechat_openid=?, wechat_unionid=? WHERE id=?')
      .run('wx-http-canonical', 'union-http-canonical', canonicalId);
    db.prepare(`INSERT INTO users
      (id, phone, name, role, status, login_enabled, review_status,
       auth_version, deleted, created_at, updated_at)
      VALUES ('approved-admin-other', '13000000001', 'Other Admin', 'admin',
        1, 1, 'approved', 1, 0, ?, ?)`)
      .run(clock.toISOString(), clock.toISOString());
    db.prepare(`INSERT INTO users
      (id, wechat_openid, wechat_unionid, phone, phone_normalized, name, role, status, login_enabled,
       review_status, auth_version, deleted, created_at, updated_at)
      VALUES ('legacy-role-only-http', 'wx-http-legacy', 'union-http-legacy',
        '13500135000', '13500135000', 'Legacy Role Only', 'admin', 1, 1, 'approved', 1, 0, ?, ?)`)
      .run(clock.toISOString(), clock.toISOString());
    for (const fixture of [
      ['legacy-formal-http', 'wx-http-legacy-grant', 'union-http-legacy-grant', '13500135001', '13500135001', 'Legacy Formal', 'visitor'],
      ['disabled-canonical-http', 'wx-http-disabled-canonical', 'union-http-disabled-canonical', '13500135002', '13500135002', 'Disabled Canonical', 'visitor'],
      ['canonical-visitor-http', 'wx-http-canonical-visitor', 'union-http-canonical-visitor', '13500135003', '13500135003', 'Canonical Visitor', 'visitor'],
    ]) {
      db.prepare(`INSERT INTO users
        (id,wechat_openid,wechat_unionid,phone,phone_normalized,name,role,identity_kind,status,
         login_enabled,review_status,auth_version,deleted,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'visitor',1,1,'approved',1,0,?,?)`)
        .run(...fixture, clock.toISOString(), clock.toISOString());
    }
    for (const grant of [
      ['legacy-formal-http', 'teacher', 'teacher', 'legacy-formal-teacher-record'],
      ['legacy-formal-http', 'admin', null, null],
      ['disabled-canonical-http', 'admin', null, null],
    ]) {
      db.prepare(`INSERT INTO user_role_grants
        (user_id,role,subject_type,subject_id,status,source,created_at,updated_at)
        VALUES (?,?,?,?,'active','desktop-identity-http-test',?,?)`)
        .run(grant[0], grant[1], grant[2], grant[3], clock.toISOString(), clock.toISOString());
    }
    for (const user of [canonicalId, 'approved-admin-other']) {
      db.prepare(`INSERT OR IGNORE INTO authority_accounts
        (user_id, authority_id, status, created_at, updated_at)
        VALUES (?, 'authority-desktop-identity-http', 'active', ?, ?)`)
        .run(user, clock.toISOString(), clock.toISOString());
    }
    db.prepare(`INSERT INTO authority_accounts
      (user_id,authority_id,status,created_at,updated_at) VALUES
      ('disabled-canonical-http','authority-desktop-identity-http','disabled',?,?),
      ('canonical-visitor-http','authority-desktop-identity-http','active',?,?)`)
      .run(clock.toISOString(), clock.toISOString(), clock.toISOString(), clock.toISOString());
    for (const binding of [
      ['binding-http-super-admin', canonicalId, 'super_admin', null, null],
      ['binding-http-teacher', canonicalId, 'teacher', 'teacher', 'teacher-http-self'],
      ['binding-http-other-admin', 'approved-admin-other', 'admin', null, null],
    ]) {
      db.prepare(`INSERT INTO authority_role_bindings
        (binding_id, authority_id, user_id, role, subject_type, subject_id, status,
         grant_version, granted_by, created_at, updated_at)
        VALUES (?, 'authority-desktop-identity-http', ?, ?, ?, ?, 'active', 1, 'test', ?, ?)`)
        .run(binding[0], binding[1], binding[2], binding[3], binding[4],
          clock.toISOString(), clock.toISOString());
    }

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
    const challengeEligibilityUsers = new Map([
      ['wx-http-legacy-grant', 'legacy-formal-http'],
      ['wx-http-disabled-canonical', 'disabled-canonical-http'],
      ['wx-http-canonical-visitor', 'canonical-visitor-http'],
    ]);
    const challengeMiniappIdentityService = {
      ...miniappIdentityService,
      loginWithClaimedWechat(input) {
        const userId = challengeEligibilityUsers.get(input.openid);
        if (!userId) return miniappIdentityService.loginWithClaimedWechat(input);
        return {
          loginEventId: `login-event-${userId}`,
          user: {
            id: userId,
            role: 'visitor',
            identity_kind: 'visitor',
            account_state: 'visitor',
          },
        };
      },
    };
    let confirmedLegacyFormalIdentity = null;
    const challengeEligibilityIds = new Set([
      'legacy-formal-challenge', 'disabled-canonical-challenge', 'canonical-visitor-challenge',
    ]);
    const primaryHostIdentityService = {
      readOperationChallenge(challengeId) {
        if (!challengeEligibilityIds.has(challengeId)) {
          const error = new Error('PRIMARY_HOST_CHALLENGE_NOT_FOUND');
          error.code = 'PRIMARY_HOST_CHALLENGE_NOT_FOUND';
          throw error;
        }
        return { id: challengeId, operation: 'bootstrap', status: 'pending_phone', rowVersion: 1 };
      },
      confirmOperationChallenge(input) {
        confirmedLegacyFormalIdentity = input.identity;
      },
      readPublicOperationChallenge(challengeId) {
        return { id: challengeId, operation: 'bootstrap', status: 'identity_verified', rowVersion: 2 };
      },
    };
    const usedLoginCodes = new Set();
    const generatedUrlLinks = [];
    let failNextUrlLink = null;
    let failNextQrCode = false;
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
      if (failNextQrCode) {
        failNextQrCode = false;
        const error = new Error('qr code failed');
        error.code = 'WECHAT_QR_CODE_FAILED';
        throw error;
      }
      return `data:image/jpeg;base64,${Buffer.from(`qr-${challengeId}`).toString('base64')}`;
    };
    const resolveWechatIdentity = async function (code) {
      if (!code || usedLoginCodes.has(code)) {
        const error = new Error('WECHAT_CODE_EXCHANGE_FAILED');
        error.code = 'WECHAT_CODE_EXCHANGE_FAILED';
        throw error;
      }
      usedLoginCodes.add(code);
      if (code.includes('visitor')) return { openid: 'wx-http-visitor', unionid: 'union-http-visitor' };
      if (code.includes('legacy-grant')) return { openid: 'wx-http-legacy-grant', unionid: 'union-http-legacy-grant' };
      if (code.includes('disabled-canonical')) return { openid: 'wx-http-disabled-canonical', unionid: 'union-http-disabled-canonical' };
      if (code.includes('canonical-no-grant')) return { openid: 'wx-http-canonical-visitor', unionid: 'union-http-canonical-visitor' };
      if (code.includes('legacy')) return { openid: 'wx-http-legacy', unionid: 'union-http-legacy' };
      if (code.includes('conflict')) return { openid: 'wx-http-conflict', unionid: 'union-http-conflict' };
      return { openid: 'wx-http-canonical', unionid: 'union-http-canonical' };
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
      miniappIdentityService: challengeMiniappIdentityService,
      primaryHostIdentityService,
      authenticateDesktop,
      resolveWechatIdentity,
      createDesktopAuthorizationUrlLink,
      createDesktopAuthorizationQrCode,
      resolveActivationAuthority: () => Object.freeze({
        authorityId: 'authority-http-1',
        hostEpochId: 'epoch-http-1',
        hostGeneration: 7,
        hostPublicKey: 'test-host-public-key',
      }),
    }));
    server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const legacyFormalChallenge = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/challenges/legacy-formal-challenge/confirm',
      { body: { code: 'legacy-grant-login', phone: '13500135001', expectedRowVersion: 1 } },
    );
    assert.strictEqual(legacyFormalChallenge.status, 200,
      'an active legacy formal grant must reach the challenge resolver even when the scalar role is visitor');
    assert.strictEqual(confirmedLegacyFormalIdentity.id, 'legacy-formal-http');
    const disabledCanonicalChallenge = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/challenges/disabled-canonical-challenge/confirm',
      { body: { code: 'disabled-canonical-login', phone: '13500135002', expectedRowVersion: 1 } },
    );
    assert.strictEqual(disabledCanonicalChallenge.status, 403);
    assert.strictEqual(disabledCanonicalChallenge.body.code, 'ACTIVE_ROLE_NOT_GRANTED',
      'a disabled canonical account must fail closed instead of falling back to an active legacy grant');
    const canonicalVisitorChallenge = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/challenges/canonical-visitor-challenge/confirm',
      { body: { code: 'canonical-no-grant-login', phone: '13500135003', expectedRowVersion: 1 } },
    );
    assert.strictEqual(canonicalVisitorChallenge.status, 403);
    assert.strictEqual(canonicalVisitorChallenge.body.code, 'DESKTOP_IDENTITY_VISITOR_FORBIDDEN',
      'an active account without a formal grant remains visitor-only');
    const retiredRoute = await fetch(`${baseUrl}/api/desktop-identity/single-user/bootstrap`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(retiredRoute.status, 404, 'legacy single-user routes must not remain registered');

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
        { body: { code: `fresh-login-${suffix}`, phone: '13732250653' } }
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

    async function exchangeRequest(challenge, key, secret) {
      const payload = desktopExchangeSigningPayload({
        challengeId: challenge.id,
        deviceId: challenge.deviceId,
        rowVersion: challenge.rowVersion,
        challengeSecret: secret,
      });
      const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), key.privateKey).toString('base64');
      return requestJson(
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
    }

    async function exchangeDevice(
      challenge,
      key,
      secret,
      { activeRole = 'teacher', eligibleRoles = ['super_admin', 'teacher'] } = {},
    ) {
      const response = await exchangeRequest(challenge, key, secret);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.data.authorization.status, 'active');
      assert.ok(response.body.data.token);
      assert.strictEqual(response.body.data.offlineLease.authorizationId, response.body.data.authorization.id);
      assert.strictEqual(response.body.data.offlineLease.deviceId, challenge.deviceId);
      assert.strictEqual(response.body.data.profile.userId, response.body.data.authorization.userId);
      assert.strictEqual(response.body.data.profile.activeRole, activeRole);
      assert.deepStrictEqual(response.body.data.profile.eligibleRoles, eligibleRoles);
      assert.ok(
        Date.parse(response.body.data.offlineLease.expiresAt)
          - Date.parse(response.body.data.offlineLease.issuedAt)
          <= 14 * 24 * 60 * 60 * 1000
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
    assert.strictEqual(failedLinkStart.status, 200);
    assert.strictEqual(failedLinkStart.body.data.challenge.qrEntryMode, 'mini-program-code');
    assert.ok(failedLinkStart.body.data.challenge.qrImageDataUrl.startsWith('data:image/jpeg;base64,'));

    const failedEntryKey = generateDeviceKey();
    failNextUrlLink = true;
    failNextQrCode = true;
    const failedEntryStart = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/challenges/start',
      { body: {
        deviceId: 'device-http-entry-failed', deviceName: 'Entry Failed PC',
        publicKey: failedEntryKey.publicKey, keyFingerprint: failedEntryKey.keyFingerprint,
      } }
    );
    assert.strictEqual(failedEntryStart.status, 502);
    assert.strictEqual(failedEntryStart.body.code, 'WECHAT_QR_CODE_FAILED');
    assert.strictEqual(
      db.prepare("SELECT status FROM desktop_identity_challenges WHERE device_id='device-http-entry-failed'").get().status,
      'rejected',
      'failure of both official WeChat entry methods must abandon the challenge so the device can retry'
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
      'createdAt', 'deviceName', 'expiresAt', 'id', 'keyFingerprintSummary', 'purpose', 'rowVersion', 'status',
    ].sort());
    assert.ok(!('deviceId' in miniappProjection.body.data.challenge));
    assert.strictEqual(miniappProjection.body.data.challenge.rowVersion, secondStarted.rowVersion);

    const retiredPhoneCode = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/challenges/${secondStarted.id}/confirm`,
      { body: { code: 'retired-phone-code-login', phone: '13732250653', phoneCode: 'retired-phone-code' } }
    );
    assert.strictEqual(retiredPhoneCode.status, 400);
    assert.strictEqual(retiredPhoneCode.body.code, 'DESKTOP_IDENTITY_INPUT_FORBIDDEN');

    const visitorKey = generateDeviceKey();
    const visitorStarted = await startDevice('device-http-visitor', 'Visitor PC', visitorKey);
    const visitorUnverifiedExchange = await exchangeRequest(
      { ...visitorStarted, deviceId: 'device-http-visitor' },
      visitorKey,
      visitorStarted.challengeSecret,
    );
    assert.strictEqual(visitorUnverifiedExchange.status, 409);
    assert.strictEqual(visitorUnverifiedExchange.body.code, 'DESKTOP_CHALLENGE_STATE_INVALID');
    const visitorConfirm = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/challenges/${visitorStarted.id}/confirm`,
      { body: { code: 'fresh-login-visitor', phone: '13600136000', expectedRowVersion: visitorStarted.rowVersion } }
    );
    assert.strictEqual(visitorConfirm.status, 200);
    assert.strictEqual(visitorConfirm.body.data.challenge.status, 'identity_verified_pending_approval');
    assert.deepStrictEqual(visitorConfirm.body.data.claimant.eligibleRoles, ['visitor']);
    const visitorUserId = visitorConfirm.body.data.claimant.id;
    const visitorConfirmed = visitorConfirm.body.data.challenge;
    const visitorUnapprovedExchange = await exchangeRequest(
      visitorConfirmed,
      visitorKey,
      visitorStarted.challengeSecret,
    );
    assert.strictEqual(visitorUnapprovedExchange.status, 409);
    assert.strictEqual(visitorUnapprovedExchange.body.code, 'DESKTOP_CHALLENGE_STATE_INVALID');
    assert.strictEqual(
      (await requestJson(baseUrl, 'GET', `/api/desktop-identity/challenges/${visitorStarted.id}/public`)).body.data.challenge.status,
      'identity_verified_pending_approval',
      'a verified canonical visitor must still wait for explicit host approval'
    );

    const legacyKey = generateDeviceKey();
    const legacyStarted = await startDevice('device-http-legacy-role', 'Legacy Role PC', legacyKey);
    const legacyConfirm = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/challenges/${legacyStarted.id}/confirm`,
      { body: { code: 'fresh-login-legacy', phone: '13500135000', expectedRowVersion: legacyStarted.rowVersion } },
    );
    assert.strictEqual(legacyConfirm.status, 400);
    assert.strictEqual(legacyConfirm.body.code, 'FORMAL_IDENTITY_MAPPING_INVALID');
    assert.strictEqual(
      (await requestJson(baseUrl, 'GET', `/api/desktop-identity/challenges/${legacyStarted.id}/public`)).body.data.challenge.status,
      'pending_phone',
      'legacy users.role must not advance an ungranted desktop identity challenge',
    );

    const conflictKey = generateDeviceKey();
    const conflictStarted = await startDevice('device-http-conflict', 'Conflict PC', conflictKey);
    const conflictConfirm = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/challenges/${conflictStarted.id}/confirm`,
      { body: { code: 'fresh-login-conflict', phone: '13732250653', expectedRowVersion: conflictStarted.rowVersion } }
    );
    assert.strictEqual(conflictConfirm.status, 409);
    assert.strictEqual(conflictConfirm.body.code, 'PHONE_WECHAT_BINDING_CONFLICT');

    const injectedConfirm = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/challenges/${secondStarted.id}/confirm`,
      { body: { code: 'injected-code', phone: '13732250653', userId: canonicalId } }
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

    const visitorApproved = await approveDevice(visitorConfirmed, elevatedHost.token);
    const visitorExchange = await exchangeDevice(
      visitorApproved,
      visitorKey,
      visitorStarted.challengeSecret,
      { activeRole: 'visitor', eligibleRoles: ['visitor'] },
    );
    const visitorContext = sessionService.verifySessionToken(visitorExchange.token);
    assert.strictEqual(visitorContext.userId, visitorUserId);
    assert.strictEqual(visitorContext.activeRole, 'visitor');
    assert.deepStrictEqual(visitorContext.scope, { kind: 'visitor', userId: visitorUserId });
    assert.throws(
      () => sessionService.issueSession({
        userId: visitorUserId,
        deviceId: 'device-http-visitor',
        activeRole: 'admin',
      }),
      error => error?.code === 'ACTIVE_ROLE_NOT_GRANTED',
      'a canonical visitor desktop must fail closed instead of borrowing users.role',
    );

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

    const activationKey = generateDeviceKey();
    const activationStarted = await startDevice('device-http-activation', 'Activation PC', activationKey);
    const activationConfirmed = await confirmDevice(activationStarted.id, 'activation');
    const activationApproved = await approveDevice(activationConfirmed.challenge, elevatedHost.token);
    const activationExchangeProof = crypto.sign(
      null,
      Buffer.from(desktopExchangeSigningPayload({
        challengeId: activationApproved.id,
        deviceId: activationApproved.deviceId,
        rowVersion: activationApproved.rowVersion,
        challengeSecret: activationStarted.challengeSecret,
      }), 'utf8'),
      activationKey.privateKey
    ).toString('base64');
    const activationPending = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/challenges/${activationApproved.id}/activation/exchange`,
      { body: { challengeSecret: activationStarted.challengeSecret, signature: activationExchangeProof, expectedRowVersion: activationApproved.rowVersion } }
    );
    assert.strictEqual(activationPending.status, 200, JSON.stringify(activationPending.body));
    assert.strictEqual(activationPending.body.data.activation.status, 'activation_pending');
    assert.strictEqual(activationPending.body.data.activationPackage.authorization.status, 'active');
    assert.strictEqual(activationPending.body.data.activationPackage.authorityId, 'authority-http-1');
    assert.strictEqual(activationPending.body.data.activationPackage.hostEpochId, 'epoch-http-1');
    assert.strictEqual(activationPending.body.data.activationPackage.hostGeneration, 7);
    assert.strictEqual(activationPending.body.data.activationPackage.grant.version, 1);
    assert.strictEqual(activationPending.body.data.activationPackage.lease.activeRole, 'teacher');
    assert.strictEqual(
      Date.parse(activationPending.body.data.activationPackage.lease.expiresAt)
        - Date.parse(activationPending.body.data.activationPackage.lease.issuedAt),
      14 * 24 * 60 * 60 * 1000
    );
    assert.strictEqual(
      db.prepare('SELECT status FROM desktop_device_authorizations WHERE device_id=?').get('device-http-activation').status,
      'pending'
    );
    const activationFinalizeProof = crypto.sign(
      null,
      Buffer.from(activationReceiptSigningPayload({
        activationId: activationPending.body.data.activation.id,
        packageHash: activationPending.body.data.activation.packageHash,
      }), 'utf8'),
      activationKey.privateKey
    ).toString('base64');
    const activationFinalized = await requestJson(
      baseUrl,
      'POST',
      `/api/desktop-identity/activations/${activationPending.body.data.activation.id}/finalize`,
      { body: { signature: activationFinalizeProof } }
    );
    assert.strictEqual(activationFinalized.status, 200);
    assert.strictEqual(activationFinalized.body.data.authorization.status, 'active');
    assert.ok(activationFinalized.body.data.token);
    assert.strictEqual(activationFinalized.body.data.offlineLease.deviceId, 'device-http-activation');
    assert.strictEqual(
      db.prepare("SELECT status FROM device_grants WHERE device_id='device-http-activation'").get().status,
      'active'
    );
    assert.strictEqual(
      db.prepare("SELECT status FROM device_leases WHERE device_id='device-http-activation'").get().status,
      'active'
    );
    assert.strictEqual(
      db.prepare(`SELECT version FROM authority_projection_versions
        WHERE authority_id='authority-http-1' AND host_epoch_id='epoch-http-1'`).get().version,
      1,
      'activation finalize must advance the control/projection source version atomically',
    );

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
      ['device-http-activation', 'device-http-host', 'device-http-second', 'device-http-third']
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
      [
        'device-http-activation', 'device-http-host', 'device-http-other',
        'device-http-second', 'device-http-third', 'device-http-visitor',
      ]
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
