'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUN_FLAG = 'E2E_RUN_ISOLATED_AUTHORITY_USER_LIFECYCLE';
const ROOT_PREFIX = 'gewu-authority-user-lifecycle-';
const ROOT_PATTERN = /^gewu-authority-user-lifecycle-[A-Za-z0-9]+$/;
const MARKER = '.gewu-isolated-authority-user-lifecycle';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function requestJson(origin, pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, options);
  return { status: response.status, body: await response.json() };
}

function assertDisposableRoot(root) {
  const resolved = path.resolve(root);
  assert.strictEqual(path.dirname(resolved), path.resolve(os.tmpdir()), 'ISOLATED_LIFECYCLE_TEMP_PARENT_REQUIRED');
  assert.match(path.basename(resolved), ROOT_PATTERN, 'ISOLATED_LIFECYCLE_ROOT_MARKER_REQUIRED');
  assert.strictEqual(fs.existsSync(path.join(resolved, MARKER)), true, 'ISOLATED_LIFECYCLE_MARKER_REQUIRED');
  return resolved;
}

function removeDisposableRoot(root) {
  const resolved = assertDisposableRoot(root);
  // SAFE_RECURSIVE_DELETE_OK: exact OS temp child, strict basename, and run-owned marker verified above.
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  assert.strictEqual(fs.existsSync(resolved), false, 'ISOLATED_LIFECYCLE_ROOT_REMOVAL_REQUIRED');
}

async function main() {
  if (process.env[RUN_FLAG] !== '1') {
    throw Object.assign(new Error('ISOLATED_AUTHORITY_USER_LIFECYCLE_FLAG_REQUIRED'), {
      code: 'ISOLATED_AUTHORITY_USER_LIFECYCLE_FLAG_REQUIRED',
    });
  }

  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), ROOT_PREFIX));
  const runId = `e2e-sol-20260801-${crypto.randomUUID().slice(0, 8)}`;
  fs.writeFileSync(path.join(isolatedRoot, MARKER), `${runId}\n`, 'utf8');
  const authorityId = `${runId}-authority`;
  const hostEpochId = `${runId}-epoch`;
  const hostDeviceId = `${runId}-host`;
  const superUserId = `${runId}-super`;
  const superDeviceId = `${runId}-super-desktop`;
  const superGrantId = `${runId}-super-device-grant`;
  const superLeaseId = `${runId}-super-lease`;
  const teacherProfileId = `${runId}-teacher-profile`;
  const phone = '19900000001';
  const openid = `${runId}-openid`;
  const envSnapshot = { ...process.env };
  const realFetch = global.fetch;
  let server = null;
  let database = null;
  let completed = false;
  let summary = null;

  Object.assign(process.env, {
    APP_ENV: 'prod',
    NODE_ENV: 'production',
    DB_PATH: path.join(isolatedRoot, 'authority-user-lifecycle.db'),
    READ_DB_PATH: path.join(isolatedRoot, 'authority-user-lifecycle.db'),
    JWT_SECRET: `${runId}-jwt-secret`,
    WECHAT_APPID: `${runId}-appid`,
    WECHAT_APPSECRET: `${runId}-appsecret`,
  });

  global.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('/sns/jscode2session')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ openid, unionid: null }),
      };
    }
    if (url.includes('/wxa/business/getuserphonenumber')) {
      throw Object.assign(new Error('AUTOMATIC_PHONE_ADAPTER_MUST_NOT_RUN'), {
        code: 'AUTOMATIC_PHONE_ADAPTER_MUST_NOT_RUN',
      });
    }
    return realFetch(input, options);
  };

  try {
    const { stableJson, validateEnvelope, PROTOCOL } = require('../shared/authorityProtocol');
    const { createSignedAuthorityProjection } = require('../shared/authorityProjectionProtocol');
    const { getInstance } = require('../backend/src/database');
    database = getInstance();
    const db = database.db;
    const now = new Date().toISOString();
    const hostKey = crypto.generateKeyPairSync('ed25519');
    const hostPublicKey = hostKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();

    db.prepare(`INSERT INTO authority_metadata(key,value,updated_at)
      VALUES('database_authority_id',?,?)`).run(authorityId, now);
    db.prepare(`INSERT INTO users
      (id,phone,phone_normalized,name,role,identity_kind,status,login_enabled,
       review_status,auth_version,deleted,created_at,updated_at)
      VALUES(?,?,?,'Isolated Super Admin','super_admin','super_admin',1,1,
       'approved',1,0,?,?)`).run(superUserId, '19900000002', '19900000002', now, now);
    db.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
      VALUES(?,?,'active',?,?)`).run(superUserId, authorityId, now, now);
    db.prepare(`INSERT INTO authority_role_bindings
      (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,
       granted_by,created_at,updated_at)
      VALUES(?,?,?,'super_admin',NULL,NULL,'active',1,?,?,?)`)
      .run(`${runId}-super-role-grant`, authorityId, superUserId, superUserId, now, now);
    db.prepare(`INSERT INTO teachers(id,name,phone,deleted,created_at,updated_at)
      VALUES(?,?,?,0,?,?)`).run(teacherProfileId, 'Isolated Teacher', phone, now, now);
    db.pragma('foreign_keys = OFF');
    db.prepare(`INSERT INTO primary_host_epochs
      (id,generation,device_id,user_id,authorization_id,status,activation_reason,source_epoch_id,
       challenge_id,db_instance_digest,schema_version,store_id,db_authority_id,host_credential_hash,
       host_public_key,credential_version,row_version,created_at,updated_at,activated_at,retired_at)
      VALUES(?,1,?,?,?,'active','bootstrap',NULL,?,?,1,?,?,?, ?,1,1,?,?,?,NULL)`)
      .run(
        hostEpochId,
        hostDeviceId,
        superUserId,
        `${runId}-host-authorization`,
        `${runId}-host-challenge`,
        `${runId}-db-digest`,
        `${runId}-store`,
        authorityId,
        `${runId}-host-credential-hash`,
        hostPublicKey,
        now,
        now,
        now,
      );
    db.pragma('foreign_keys = ON');
    db.prepare(`INSERT INTO device_grants
      (grant_id,authority_id,device_id,user_id,public_key,host_generation,status,
       grant_version,approved_by,created_at,updated_at,revoked_at)
      VALUES(?,?,?,?,?,1,'active',1,?,?,?,NULL)`)
      .run(
        superGrantId,
        authorityId,
        superDeviceId,
        superUserId,
        `${runId}-desktop-public-key`,
        superUserId,
        now,
        now,
      );
    db.prepare(`INSERT INTO device_leases
      (lease_id,grant_id,authority_id,device_id,user_id,active_role,grant_version,status,
       issued_at,expires_at,revoked_at)
      VALUES(?,?,?,?,?,'super_admin',1,'active',?,'2099-01-01T00:00:00.000Z',NULL)`)
      .run(superLeaseId, superGrantId, authorityId, superDeviceId, superUserId, now);

    delete require.cache[require.resolve('../backend/src/app')];
    const { createApp } = require('../backend/src/app');
    const app = createApp();
    server = app.listen(0);
    const origin = `http://127.0.0.1:${server.address().port}`;

    const login = await requestJson(origin, '/api/auth/wechat-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: `${runId}-login-code`,
        phone,
        miniappVersion: 'isolated-current-source',
        platform: 'wechat',
      }),
    });
    assert.strictEqual(login.status, 200, JSON.stringify(login.body));
    assert.strictEqual(login.body.data.user.role, 'visitor');
    const visitorUserId = login.body.data.user.id;
    const visitorToken = login.body.data.token;
    assert.deepStrictEqual(
      db.prepare(`SELECT phone_normalized,wechat_openid,role,identity_kind
        FROM users WHERE id=?`).get(visitorUserId),
      { phone_normalized: phone, wechat_openid: openid, role: 'visitor', identity_kind: 'visitor' },
    );

    const projectionStore = app.locals.authorityProjectionStore;
    projectionStore.publish(createSignedAuthorityProjection({
      authorityId,
      hostEpochId,
      userId: visitorUserId,
      role: 'visitor',
      sourceVersion: 1,
      generatedAt: now,
      payload: {
        questionPreviews: [{ id: `${runId}-question-preview`, title: 'Isolated preview' }],
        courses: [],
      },
      privateKey: hostKey.privateKey,
    }));
    const visitorProjection = await requestJson(origin, '/api/miniapp/projection', {
      headers: { authorization: `Bearer ${visitorToken}` },
    });
    assert.strictEqual(visitorProjection.status, 200, JSON.stringify(visitorProjection.body));
    assert.strictEqual(visitorProjection.body.projection.role, 'visitor');
    assert.strictEqual(visitorProjection.body.projection.payload.questionPreviews.length, 1);

    const submitted = await requestJson(origin, '/api/miniapp/applications', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${visitorToken}`,
        'content-type': 'application/json',
        'x-idempotency-key': `${runId}-teacher-application`,
      },
      body: JSON.stringify({ requestedRole: 'teacher', bindingHint: teacherProfileId }),
    });
    assert.strictEqual(submitted.status, 202, JSON.stringify(submitted.body));
    assert.strictEqual(submitted.body.command.status, 'pending');

    const { createAuthorityHostRuntime } = require('../backend/src/services/authorityHostRuntime');
    const hostRuntime = createAuthorityHostRuntime({
      database,
      targetHostId: hostDeviceId,
      commandSource: app.locals.authorityCommandInbox,
    });
    const submitProcessed = await hostRuntime.processor.processOnce();
    assert.strictEqual(submitProcessed.processed, 1);
    const mine = await requestJson(origin, '/api/miniapp/applications/me', {
      headers: { authorization: `Bearer ${visitorToken}` },
    });
    assert.strictEqual(mine.status, 200, JSON.stringify(mine.body));
    assert.strictEqual(mine.body.application.status, 'pending');
    assert.ok(mine.body.application.applicationId);

    const { buildRoleReviewDraft } = await import('../src/services/authorityRoleReviewRuntime.mjs');
    const { createDesktopCommandOutbox } = await import('../src/services/desktopCommandOutbox.mjs');
    const { createDesktopAuthorityClient } = await import('../src/services/desktopAuthorityClient.mjs');
    let sealedOutbox = '';
    let draftSequence = 0;
    let commandSequence = 0;
    const outbox = createDesktopCommandOutbox({
      store: {
        read: async () => sealedOutbox,
        write: async value => { sealedOutbox = value; },
      },
      codec: {
        seal: async value => Buffer.from(JSON.stringify(value)).toString('base64'),
        open: async value => JSON.parse(Buffer.from(value, 'base64').toString('utf8')),
      },
      createId: () => `${runId}-review-draft-${++draftSequence}`,
      now: () => new Date().toISOString(),
    });
    const desktopClient = createDesktopAuthorityClient({
      outbox,
      createEnvelope: async draft => {
        const payload = Object.freeze({ ...draft.payload });
        return validateEnvelope({
          protocol: PROTOCOL,
          commandId: `${runId}-review-command-${++commandSequence}`,
          idempotencyKey: `${runId}-review-idempotency-${commandSequence}`,
          authorityId,
          hostEpochId,
          actor: { userId: superUserId, deviceId: superDeviceId, role: 'super_admin' },
          lease: { id: superLeaseId, grantVersion: 1 },
          type: draft.type,
          payload,
          payloadHash: sha256(stableJson(payload)),
          createdAt: new Date().toISOString(),
        });
      },
      transports: {
        submit: async envelope => {
          app.locals.authorityCommandInbox.enqueue(envelope);
          const processed = await hostRuntime.processor.processOnce();
          assert.strictEqual(processed.processed, 1);
          const receipt = app.locals.authorityCommandInbox.findReceipt({
            commandId: envelope.commandId,
            actor: envelope.actor,
          });
          assert.ok(receipt, 'desktop review command receipt required');
          return { receipt, transportUsed: 'durable-relay' };
        },
      },
    });
    const reviewDraft = await desktopClient.appendDraft(buildRoleReviewDraft({
      applicationId: mine.body.application.applicationId,
      authorityId,
      userId: visitorUserId,
      requestedRole: 'teacher',
      bindingHint: teacherProfileId,
      status: 'pending',
    }, 'approve'));
    const hostCommandsBeforeConfirm = db.prepare('SELECT COUNT(*) count FROM host_commands').get().count;
    assert.strictEqual(await desktopClient.submit(reviewDraft.id), undefined);
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) count FROM host_commands').get().count,
      hostCommandsBeforeConfirm,
      'desktop review draft must not sync before explicit confirmation',
    );
    const reviewed = await desktopClient.confirmAndSubmit(reviewDraft.id);
    assert.strictEqual(reviewed.transportUsed, 'durable-relay');
    assert.strictEqual(reviewed.receipt.status, 'committed');
    const canonicalGrant = db.prepare(`SELECT role,subject_type,subject_id,status
      FROM authority_role_bindings
      WHERE authority_id=? AND user_id=? AND role='teacher' AND status='active'`)
      .get(authorityId, visitorUserId);
    assert.deepStrictEqual(canonicalGrant, {
      role: 'teacher',
      subject_type: 'teacher',
      subject_id: teacherProfileId,
      status: 'active',
    });
    assert.deepStrictEqual(
      db.prepare('SELECT role,identity_kind,teacher_id FROM users WHERE id=?').get(visitorUserId),
      { role: 'visitor', identity_kind: 'visitor', teacher_id: null },
      'host review must not write legacy scalar identity fields',
    );

    const relogin = await requestJson(origin, '/api/auth/wechat-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: `${runId}-login-code`, phone, platform: 'wechat' }),
    });
    assert.strictEqual(relogin.status, 200, JSON.stringify(relogin.body));
    assert.strictEqual(relogin.body.data.user.account_state, 'formal');
    assert.strictEqual(relogin.body.data.user.role, 'teacher');
    assert.strictEqual(relogin.body.data.user.teacher_id, teacherProfileId);

    projectionStore.publish(createSignedAuthorityProjection({
      authorityId,
      hostEpochId,
      userId: visitorUserId,
      role: 'teacher',
      sourceVersion: 2,
      generatedAt: new Date().toISOString(),
      payload: {
        courses: [{ id: `${runId}-course`, teacher_id: teacherProfileId, name: 'Isolated course' }],
        schedules: [{ id: `${runId}-schedule`, course_id: `${runId}-course` }],
        payments: [],
      },
      privateKey: hostKey.privateKey,
    }));
    const teacherProjection = await requestJson(origin, '/api/miniapp/projection', {
      headers: { authorization: `Bearer ${relogin.body.data.token}` },
    });
    assert.strictEqual(teacherProjection.status, 200, JSON.stringify(teacherProjection.body));
    assert.strictEqual(teacherProjection.body.projection.role, 'teacher');
    assert.deepStrictEqual(
      teacherProjection.body.projection.payload.courses.map(item => item.id),
      [`${runId}-course`],
    );

    const { projectionCacheEntries } = require('../miniapp/src/utils/authorityProjectionCache');
    const { deriveAccess, permissionIdentityKey } = require('../miniapp/src/utils/miniappAuthorizationRuntime');
    const miniappCache = Object.fromEntries(
      projectionCacheEntries(teacherProjection.body.projection.payload),
    );
    assert.strictEqual(miniappCache.courses.length, 1);
    const capabilities = ['business:teacher-scope', 'question-bank:view', 'question-bank:edit'];
    const miniappAccess = deriveAccess(relogin.body.data.user, {
      status: 'loaded',
      identityKey: permissionIdentityKey(relogin.body.data.user),
      capabilities,
    });
    assert.strictEqual(miniappAccess.role, 'teacher');
    assert.strictEqual(miniappAccess.experienceOnly, false);

    const { buildAuthorityBackedBrowserCache } = await import('../src/services/authorityProjectionCacheAdapter.mjs');
    const desktopCache = buildAuthorityBackedBrowserCache({
      projection: teacherProjection.body.projection,
      outbox: [],
      localOnly: {},
    });
    assert.strictEqual(desktopCache.courses.length, 1);
    assert.strictEqual(desktopCache.authorityCacheMetadata.role, 'teacher');

    summary = {
      success: true,
      manualPhoneBound: true,
      miniappReadBeforeReview: true,
      roleApplicationSubmitted: true,
      hostReviewedThroughDesktopFacade: true,
      canonicalGrantActive: true,
      miniappFormalRoleAfterReview: true,
      miniappReadAfterReview: true,
      desktopProjectionRead: true,
      isolatedRoot,
    };
    completed = true;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    try { database?.close(); } catch (_error) { /* preserve primary assertion */ }
    global.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (!(key in envSnapshot)) delete process.env[key];
    Object.assign(process.env, envSnapshot);
    if (completed) removeDisposableRoot(isolatedRoot);
  }

  console.log(JSON.stringify({
    ...summary,
    isolatedDataRemoved: completed && !fs.existsSync(isolatedRoot),
  }));
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
