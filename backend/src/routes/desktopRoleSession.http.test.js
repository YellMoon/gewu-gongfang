const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseService } = require('../database');
const {
  createDesktopSessionService,
  desktopRoleElevationSigningPayload,
} = require('../services/desktopSessionService');
const {
  assertRecordWritable,
  scopeBusinessSnapshot,
} = require('../services/dataScopeService');
const { createDesktopIdentityRouter } = require('./desktopIdentity');
const permissionsRouter = require('./permissions');

async function requestJson(baseUrl, method, pathname, { token, body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

(async function () {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-desktop-role-session-'));
  const previous = {
    dbPath: process.env.DB_PATH,
    readDbPath: process.env.READ_DB_PATH,
    nodeEnv: process.env.NODE_ENV,
  };
  process.env.DB_PATH = path.join(workspace, 'role-session.db');
  process.env.READ_DB_PATH = process.env.DB_PATH;
  process.env.NODE_ENV = 'production';

  let database;
  let server;
  try {
    database = new DatabaseService();
    const db = database.db;
    const userId = 'miniapp-admin-13732250653';
    const teacherId = 'teacher-role-self';
    const deviceId = 'device-role-host';
    const jwtSecret = 'desktop-role-session-test-secret';
    let clock = new Date('2026-07-17T10:00:00.000Z');
    let advanceClockAfterReadMs = 0;
    const now = function () {
      const current = new Date(clock);
      if (advanceClockAfterReadMs > 0) {
        clock = new Date(clock.getTime() + advanceClockAfterReadMs);
      }
      return current;
    };
    const keyPair = crypto.generateKeyPairSync('ed25519');
    const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' });

    db.prepare(`INSERT INTO teachers
      (id, name, phone, deleted, created_at, updated_at)
      VALUES (?, 'Canonical Working Teacher', '13732250653', 0, ?, ?)`)
      .run(teacherId, clock.toISOString(), clock.toISOString());
    db.prepare('UPDATE users SET teacher_id=? WHERE id=?').run(teacherId, userId);
    db.prepare(`INSERT OR REPLACE INTO user_role_grants
      (user_id, role, subject_type, subject_id, status, source, created_at, updated_at)
      VALUES (?, 'teacher', 'teacher', ?, 'active', 'test', ?, ?)`)
      .run(userId, teacherId, clock.toISOString(), clock.toISOString());
    db.prepare(`INSERT INTO desktop_device_authorizations
      (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
       status, source_challenge_id, last_phone_verified_at, phone_reverify_due_at,
       credential_version, row_version, created_at, updated_at)
      VALUES ('authorization-role-host', ?, 'Role Host', 'primary-host', ?, ?,
        'fingerprint-role-host', 'active', 'bootstrap-role-host', ?,
        '2026-08-16T10:00:00.000Z', 1, 1, ?, ?)`)
      .run(deviceId, userId, publicKey, clock.toISOString(), clock.toISOString(), clock.toISOString());

    const sessions = createDesktopSessionService({ db, jwtSecret, now });
    const teacherSession = sessions.issueSession({ userId, deviceId, activeRole: 'teacher' });
    const snapshot = {
      courses: [
        { id: 'course-self', teacher_id: teacherId },
        { id: 'course-other', teacher_id: 'teacher-other' },
      ],
      schedules: [],
      students: [],
      enrollments: [],
      consumptions: [],
      payments: [],
      institutions: [],
      rooms: [],
      schools: [],
      assetRecords: [],
      questions: [],
    };

    function authenticateTest(req, res, next) {
      try {
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const context = sessions.verifySessionToken(token);
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(context.userId);
        req.user = { ...user, role: context.activeRole, user_type: context.activeRole };
        req.authz = {
          ...context,
          runtimeNodeRole: 'primary-host',
          tokenDeviceId: context.deviceId,
          isPrimaryHost: context.deviceKind === 'primary-host',
        };
        return next();
      } catch (error) {
        return res.status(401).json({ success: false, code: error.code || 'TOKEN_INVALID' });
      }
    }

    const app = express();
    app.use(express.json({ limit: '64kb' }));
    app.use('/api/desktop-identity', createDesktopIdentityRouter({
      db,
      jwtSecret,
      now,
      sessionService: sessions,
      authenticateDesktop: function (token) { return sessions.verifySessionToken(token); },
    }));
    app.use('/api/permissions', authenticateTest, permissionsRouter);
    app.get('/test/snapshot', authenticateTest, function (req, res) {
      res.json({
        success: true,
        data: scopeBusinessSnapshot(snapshot, {
          ...req.authz.scope,
          userId: req.authz.userId,
        }),
      });
    });
    app.post('/test/courses/:id', authenticateTest, function (req, res) {
      try {
        assertRecordWritable('courses', req.body, {
          ...req.authz.scope,
          userId: req.authz.userId,
        });
        return res.json({ success: true });
      } catch (error) {
        return res.status(403).json({ success: false, code: error.code });
      }
    });
    server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const teacherPermissions = await requestJson(
      baseUrl,
      'GET',
      '/api/permissions/my',
      {
        token: teacherSession.token,
        headers: { 'x-active-role': 'super_admin' },
      }
    );
    assert.strictEqual(teacherPermissions.status, 200);
    assert.strictEqual(teacherPermissions.body.data.identity.active_role, 'teacher');
    assert.strictEqual(teacherPermissions.body.data.identity.teacher_id, teacherId);
    assert.deepStrictEqual(
      teacherPermissions.body.data.identity.eligible_roles,
      ['super_admin', 'teacher']
    );
    assert.strictEqual(teacherPermissions.body.data.is_admin, false);

    const teacherSnapshot = await requestJson(baseUrl, 'GET', '/test/snapshot', {
      token: teacherSession.token,
    });
    assert.deepStrictEqual(
      teacherSnapshot.body.data.courses.map(function (course) { return course.id; }),
      ['course-self']
    );
    const teacherCrossWrite = await requestJson(baseUrl, 'POST', '/test/courses/course-other', {
      token: teacherSession.token,
      body: { id: 'course-other', teacher_id: 'teacher-other' },
    });
    assert.strictEqual(teacherCrossWrite.status, 403);
    assert.strictEqual(teacherCrossWrite.body.code, 'TEACHER_SCOPE_VIOLATION');

    const injectedRoleSwitch = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/session/role',
      {
        token: teacherSession.token,
        body: { activeRole: 'super_admin', authTime: clock.toISOString() },
      }
    );
    assert.strictEqual(injectedRoleSwitch.status, 400);
    assert.strictEqual(injectedRoleSwitch.body.code, 'DESKTOP_IDENTITY_INPUT_FORBIDDEN');

    const unsignedElevation = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/session/role',
      {
        token: teacherSession.token,
        body: { activeRole: 'super_admin' },
      }
    );
    assert.strictEqual(unsignedElevation.status, 403);
    assert.strictEqual(unsignedElevation.body.code, 'DESKTOP_ROLE_ELEVATION_SIGNATURE_REQUIRED');

    const staleIssuedAt = '2026-07-17T09:55:00.000Z';
    const stalePayload = desktopRoleElevationSigningPayload({
      sessionId: teacherSession.session.id,
      deviceId,
      activeRole: 'super_admin',
      sessionVersion: teacherSession.session.rowVersion,
      elevationIssuedAt: staleIssuedAt,
    });
    const staleElevation = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/session/role',
      {
        token: teacherSession.token,
        body: {
          activeRole: 'super_admin',
          elevationIssuedAt: staleIssuedAt,
          elevationSignature: crypto.sign(
            null,
            Buffer.from(stalePayload, 'utf8'),
            keyPair.privateKey
          ).toString('base64'),
        },
      }
    );
    assert.strictEqual(staleElevation.status, 403);
    assert.strictEqual(staleElevation.body.code, 'DESKTOP_ROLE_ELEVATION_PROOF_STALE');
    assert.strictEqual(sessions.verifySessionToken(teacherSession.token).activeRole, 'teacher');

    const elevationIssuedAt = clock.toISOString();
    const elevationPayload = desktopRoleElevationSigningPayload({
      sessionId: teacherSession.session.id,
      deviceId,
      activeRole: 'super_admin',
      sessionVersion: teacherSession.session.rowVersion,
      elevationIssuedAt,
    });
    const elevationSignature = crypto.sign(
      null,
      Buffer.from(elevationPayload, 'utf8'),
      keyPair.privateKey
    ).toString('base64');
    const expectedElevationAuthTime = new Date(clock.getTime() + 1000).toISOString();
    advanceClockAfterReadMs = 1000;
    const elevated = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/session/role',
      {
        token: teacherSession.token,
        body: {
          activeRole: 'super_admin',
          elevationIssuedAt,
          elevationSignature,
        },
      }
    );
    advanceClockAfterReadMs = 0;
    assert.strictEqual(elevated.status, 200);
    assert.strictEqual(elevated.body.data.session.activeRole, 'super_admin');
    assert.strictEqual(elevated.body.data.session.authTime, expectedElevationAuthTime);
    assert.strictEqual(elevated.body.data.session.expiresAt, teacherSession.session.expiresAt);
    const elevationAudit = db.prepare(`SELECT * FROM authorization_audit_log
      WHERE action='desktop_session_active_role_switched'
      ORDER BY created_at DESC LIMIT 1`).get();
    assert.ok(elevationAudit);
    assert.strictEqual(JSON.parse(elevationAudit.before_json).activeRole, 'teacher');
    assert.strictEqual(JSON.parse(elevationAudit.after_json).activeRole, 'super_admin');
    assert.throws(
      function () { sessions.verifySessionToken(teacherSession.token); },
      function (error) { return error.code === 'DESKTOP_SESSION_REVOKED'; }
    );

    const adminPermissions = await requestJson(baseUrl, 'GET', '/api/permissions/my', {
      token: elevated.body.data.token,
    });
    assert.strictEqual(adminPermissions.body.data.identity.active_role, 'super_admin');
    assert.strictEqual(adminPermissions.body.data.identity.teacher_id, null);
    assert.strictEqual(adminPermissions.body.data.is_admin, true);
    const adminSnapshot = await requestJson(baseUrl, 'GET', '/test/snapshot', {
      token: elevated.body.data.token,
    });
    assert.deepStrictEqual(
      adminSnapshot.body.data.courses.map(function (course) { return course.id; }),
      ['course-self', 'course-other']
    );

    clock = new Date('2026-07-17T10:01:00.000Z');
    const downgraded = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/session/role',
      {
        token: elevated.body.data.token,
        body: { activeRole: 'teacher' },
      }
    );
    assert.strictEqual(downgraded.status, 200);
    assert.strictEqual(downgraded.body.data.session.activeRole, 'teacher');
    assert.strictEqual(downgraded.body.data.session.authTime, null);
    assert.throws(
      function () { sessions.verifySessionToken(elevated.body.data.token); },
      function (error) { return error.code === 'DESKTOP_SESSION_REVOKED'; }
    );
    assert.strictEqual(
      sessions.verifySessionToken(downgraded.body.data.token).activeRole,
      'teacher'
    );

    const ungrantedRole = await requestJson(
      baseUrl,
      'POST',
      '/api/desktop-identity/session/role',
      {
        token: downgraded.body.data.token,
        body: { activeRole: 'admin' },
      }
    );
    assert.strictEqual(ungrantedRole.status, 403);
    assert.strictEqual(ungrantedRole.body.code, 'ACTIVE_ROLE_NOT_GRANTED');

    console.log('desktop role session HTTP checks passed');
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
