const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function requestJson(baseUrl, method, pathname, { token, body, idempotencyKey } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

(async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-applications-http-'));
  const dbPath = path.join(workspace, 'applications.db');
  const envSnapshot = { ...process.env };
  Object.assign(process.env, {
    APP_ENV: 'prod',
    NODE_ENV: 'production',
    DB_PATH: dbPath,
    READ_DB_PATH: dbPath,
    JWT_SECRET: 'miniapp-applications-http-test-secret',
    REQUIRE_NONCE: 'false',
  });

  delete require.cache[require.resolve('../database')];
  delete require.cache[require.resolve('../middleware/auth')];
  delete require.cache[require.resolve('../app')];
  const { getInstance } = require('../database');
  const { createMiniappIdentityService } = require('../services/miniappIdentityService');
  const { createApp } = require('../app');
  const database = getInstance();
  const db = database.db;
  const now = '2026-09-01T02:00:00.000Z';
  const insertPending = db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, identity_kind, status, login_enabled,
     review_status, auth_version, deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', 'unrecognized', 1, 0, 'pending', 1, 0, ?, ?)`);
  insertPending.run('http-student', '13800138100', '13800138100', 'Student Applicant', now, now);
  insertPending.run('http-parent', '13800138101', '13800138101', 'Parent Applicant', now, now);
  insertPending.run('http-teacher', '13800138102', '13800138102', 'Teacher Applicant', now, now);
  insertPending.run('http-other', '13800138103', '13800138103', 'Other Applicant', now, now);

  let sequence = 0;
  const identity = createMiniappIdentityService({
    db,
    jwtSecret: process.env.JWT_SECRET,
    now: () => new Date(now),
    uuid: () => `http-identity-${++sequence}`,
  });
  const tokens = Object.fromEntries(['student', 'parent', 'teacher', 'other'].map(kind => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(`http-${kind}`);
    return [kind, identity.issueUnrecognizedToken(user, `http-${kind}-session`).token];
  }));

  const server = createApp().listen(0);
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const noToken = await requestJson(baseUrl, 'GET', '/api/miniapp/applications/me');
    assert.strictEqual(noToken.status, 401);

    const studentPayload = {
      studentName: '\u5f20\u540c\u5b66',
      studentPhone: '13800138100',
      school: '\u5b81\u6ce2\u4e2d\u5b66',
      currentGrade: '\u9ad8\u4e00',
      parentRelation: '\u5988\u5988',
      parentPhone: '13800138101',
      applicantAgeConfirmation: true,
    };
    const created = await requestJson(baseUrl, 'POST', '/api/miniapp/applications', {
      token: tokens.student,
      idempotencyKey: 'http-student-revision-1',
      body: { applicationType: 'student', payload: studentPayload },
    });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.success, true);
    assert.strictEqual(created.body.data.created, true);
    assert.strictEqual(created.body.data.application.applicantIdentityKind, 'student');
    assert.ok(!('payload_json' in created.body.data.application));

    const replayed = await requestJson(baseUrl, 'POST', '/api/miniapp/applications', {
      token: tokens.student,
      idempotencyKey: 'http-student-revision-1',
      body: { applicationType: 'student', payload: studentPayload },
    });
    assert.strictEqual(replayed.status, 200);
    assert.strictEqual(replayed.body.data.replayed, true);
    assert.strictEqual(replayed.body.data.application.id, created.body.data.application.id);

    const reused = await requestJson(baseUrl, 'POST', '/api/miniapp/applications', {
      token: tokens.student,
      idempotencyKey: 'http-student-revision-1',
      body: { applicationType: 'student', payload: { ...studentPayload, notes: 'changed' } },
    });
    assert.strictEqual(reused.status, 409);
    assert.strictEqual(reused.body.code, 'IDEMPOTENCY_KEY_REUSED');

    const parentConflict = await requestJson(baseUrl, 'POST', '/api/miniapp/applications', {
      token: tokens.parent,
      idempotencyKey: 'http-parent-same-pair',
      body: {
        applicationType: 'student',
        payload: {
          ...studentPayload,
          applicantAgeConfirmation: undefined,
          guardianConfirmation: true,
        },
      },
    });
    assert.strictEqual(parentConflict.status, 409);
    assert.strictEqual(parentConflict.body.code, 'ACTIVE_APPLICATION_EXISTS');
    assert.ok(!('data' in parentConflict.body));
    assert.ok(!('application' in parentConflict.body));
    assert.ok(!JSON.stringify(parentConflict.body).includes('\u5f20\u540c\u5b66'));

    const mine = await requestJson(baseUrl, 'GET', '/api/miniapp/applications/me', { token: tokens.student });
    assert.strictEqual(mine.status, 200);
    assert.strictEqual(mine.body.data.state, 'submitted');
    assert.strictEqual(mine.body.data.application.id, created.body.data.application.id);
    const parentMine = await requestJson(baseUrl, 'GET', '/api/miniapp/applications/me', { token: tokens.parent });
    assert.strictEqual(parentMine.body.data.state, 'not_submitted');
    assert.strictEqual(parentMine.body.data.application, null);

    const otherWithdraw = await requestJson(
      baseUrl,
      'POST',
      `/api/miniapp/applications/${created.body.data.application.id}/withdraw`,
      { token: tokens.other, idempotencyKey: 'http-other-withdraw', body: {} },
    );
    assert.strictEqual(otherWithdraw.status, 404);
    assert.strictEqual(otherWithdraw.body.code, 'APPLICATION_NOT_FOUND');

    const teacherInvalid = await requestJson(baseUrl, 'POST', '/api/miniapp/applications', {
      token: tokens.teacher,
      idempotencyKey: 'http-teacher-invalid',
      body: {
        applicationType: 'teacher',
        payload: { name: '\u674e\u8001\u5e08', phone: '13800138102', hourly_rate: 500 },
      },
    });
    assert.strictEqual(teacherInvalid.status, 400);
    assert.strictEqual(teacherInvalid.body.code, 'APPLICATION_FIELD_FORBIDDEN');
    const teacherCreated = await requestJson(baseUrl, 'POST', '/api/miniapp/applications', {
      token: tokens.teacher,
      idempotencyKey: 'http-teacher-revision-1',
      body: {
        applicationType: 'teacher',
        payload: { name: '\u674e\u8001\u5e08', phone: '13800138102', subject: '\u7269\u7406' },
      },
    });
    assert.strictEqual(teacherCreated.status, 201);
    assert.deepStrictEqual(teacherCreated.body.data.application.payload, {
      name: '\u674e\u8001\u5e08', phone: '13800138102', subject: '\u7269\u7406',
    });

    db.prepare("UPDATE miniapp_role_applications SET status='rejected' WHERE id=?")
      .run(created.body.data.application.id);
    const revisionTwo = await requestJson(baseUrl, 'POST', '/api/miniapp/applications', {
      token: tokens.student,
      idempotencyKey: 'http-student-revision-2',
      body: { applicationType: 'student', payload: { ...studentPayload, notes: 'revision two' } },
    });
    assert.strictEqual(revisionTwo.status, 201);
    assert.strictEqual(revisionTwo.body.data.application.revision, 2);
    const withdrawn = await requestJson(
      baseUrl,
      'POST',
      `/api/miniapp/applications/${revisionTwo.body.data.application.id}/withdraw`,
      { token: tokens.student, idempotencyKey: 'http-student-withdraw-2', body: {} },
    );
    assert.strictEqual(withdrawn.status, 200);
    assert.strictEqual(withdrawn.body.data.state, 'withdrawn');
    const crossTokenReplay = await requestJson(
      baseUrl,
      'POST',
      `/api/miniapp/applications/${revisionTwo.body.data.application.id}/withdraw`,
      { token: tokens.other, idempotencyKey: 'http-student-withdraw-2', body: {} },
    );
    assert.strictEqual(crossTokenReplay.status, 404, 'in-memory idempotency must be isolated by bearer token');
    assert.strictEqual(crossTokenReplay.body.code, 'APPLICATION_NOT_FOUND');
    assert.ok(!('data' in crossTokenReplay.body));

    const revisionThree = await requestJson(baseUrl, 'POST', '/api/miniapp/applications', {
      token: tokens.student,
      idempotencyKey: 'http-student-revision-3',
      body: { applicationType: 'student', payload: { ...studentPayload, notes: 'revision three' } },
    });
    assert.strictEqual(revisionThree.status, 201);
    db.prepare("UPDATE miniapp_role_applications SET status='provisioning' WHERE id=?")
      .run(revisionThree.body.data.application.id);
    const provisioningWithdraw = await requestJson(
      baseUrl,
      'POST',
      `/api/miniapp/applications/${revisionThree.body.data.application.id}/withdraw`,
      { token: tokens.student, idempotencyKey: 'http-student-withdraw-3', body: {} },
    );
    assert.strictEqual(provisioningWithdraw.status, 409);
    assert.strictEqual(provisioningWithdraw.body.code, 'APPLICATION_WITHDRAW_NOT_ALLOWED');

    db.prepare(`INSERT INTO students
      (id, name, phone, parent_phone, parent_relation, school, grade_year, deleted, created_at, updated_at)
      VALUES ('http-student-profile', ?, '13800138100', '13800138101', ?, ?, 2026, 0, ?, ?)`)
      .run('\u5f20\u540c\u5b66', '\u5988\u5988', '\u5b81\u6ce2\u4e2d\u5b66', now, now);
    db.prepare(`UPDATE users SET role='student', identity_kind='student', student_id='http-student-profile',
      review_status='approved', login_enabled=1, auth_version=auth_version+1, updated_at=? WHERE id='http-student'`)
      .run(now);
    db.prepare("UPDATE miniapp_role_applications SET status='approved', updated_at=? WHERE id=?")
      .run(now, revisionThree.body.data.application.id);
    const formalUser = db.prepare("SELECT * FROM users WHERE id='http-student'").get();
    const formalToken = identity.issueFormalToken(formalUser, 'http-student-formal-session').token;
    const approvedMine = await requestJson(baseUrl, 'GET', '/api/miniapp/applications/me', { token: formalToken });
    assert.strictEqual(approvedMine.status, 200);
    assert.strictEqual(approvedMine.body.data.state, 'approved_relogin_required');
    assert.strictEqual(approvedMine.body.data.application.id, revisionThree.body.data.application.id);

    console.log('miniapp applications HTTP checks passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.close();
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) delete process.env[key];
    }
    Object.assign(process.env, envSnapshot);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
