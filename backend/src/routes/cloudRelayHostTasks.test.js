const assert = require('assert');
const fs = require('fs');

const route = fs.readFileSync('backend/src/routes/cloudRelayHost.js', 'utf-8');
const questionBankRoute = fs.readFileSync('backend/src/routes/questionBank.js', 'utf-8');
const client = fs.readFileSync('backend/src/services/cloudRelayClient.js', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(route.includes('processMiniappTask'), 'host cloud relay route should process miniapp tasks');
assert.ok(route.includes('question_previews') && route.includes('stemPreview'), 'host snapshots must publish a minimal question preview index');
assert.ok(route.includes("task.task_type === 'question-paper'"), 'host should process miniapp paper assembly tasks');
assert.ok(route.includes("task.task_type === 'paper-export-word'"), 'host should process miniapp Word export tasks');
assert.ok(route.includes("task.task_type === 'paper-export-pdf'"), 'host should process miniapp PDF export tasks');
assert.ok(route.includes("task.task_type === 'identity-provisioning'"), 'host should process internal identity provisioning tasks');
assert.ok(route.includes('requestHash: task.request_hash'), 'host must pass the cloud request hash into the receipt boundary');
assert.ok(route.includes('capabilities: hostCapabilities()'), 'host heartbeat must advertise its authoritative provisioning capability');
assert.ok(route.includes('writePaperArtifact'), 'host should write paper export artifacts');
assert.ok(route.includes('recoverStalePaperJobs'), 'host processor must recover stale local processing jobs after restart');
assert.ok(route.includes('cleanupPaperStorage'), 'host processor startup must clean stale temp and expired artifacts safely');
assert.ok(route.includes('reconcilePaperArtifacts'), 'host processor startup must reconcile rename/DB crash windows before cleanup');
assert.ok(route.includes('bindPaperCompletionClaim') && route.includes('replayPaperCompletionOutbox'), 'host must bind current claim CAS and replay durable completion outbox every round');
assert.ok(route.includes('queryMiniappTaskState'), 'lost completion ACK must query cloud terminal state before retrying');
assert.ok(route.includes('createLocalQuestionImageResolver(paperRoot)'), 'relay host export must inject the configured local image resolver');
assert.ok(questionBankRoute.includes('processDurablePaperTask') && questionBankRoute.includes("relayScope: 'direct'") && questionBankRoute.includes('skipCompletionOutbox: true'), 'question bank direct export must use the durable snapshot/worker repository chain without a cloud outbox');
assert.ok(route.includes('answerPosition'), 'relay task payload must carry canonical answerPosition through to the artifact result');
assert.ok(route.includes('fileUrl'), 'host should return downloadable artifact URLs');
const artifactRoute = fs.readFileSync('backend/src/routes/paperArtifactAccess.js', 'utf-8');
assert.ok(artifactRoute.includes("router.get('/:artifactId'"), 'read-only artifact router should expose artifactId download route');
assert.ok(artifactRoute.includes("router.get('/:artifactId/access'") && artifactRoute.includes("req.get('x-gewu-artifact-token')"), 'artifact access must refresh short tokens with GET and download through a header rather than a query parameter');
assert.ok(artifactRoute.includes("Cache-Control', 'no-store'"), 'artifact access exchange must prohibit caching');
assert.ok(artifactRoute.includes('verifyArtifactDownloadToken'), 'artifact download must verify the dedicated HMAC token');
assert.ok(artifactRoute.includes('GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET'), 'artifact download must use its independent required secret');
assert.ok(artifactRoute.includes('FROM paper_artifacts WHERE artifact_id'), 'artifact download must resolve only DB-registered artifacts');
assert.ok(!route.includes("router.get('/artifacts/:fileName'"), 'anonymous filename download route must be closed');
assert.ok(artifactRoute.includes('res.download'), 'host artifact route should download generated files');
assert.ok(route.includes('completeMiniappTask(task.id'), 'host should complete miniapp tasks back to cloud');
assert.ok(route.includes("router.post('/tasks/process'"), 'host should expose a process pending tasks endpoint');
assert.ok(route.includes('authOptionsFromRequest'), 'host route should forward authenticated maintenance requests to cloud relay');
assert.ok(route.includes('hostCredential') && route.includes('hostGeneration'), 'registered host must forward its managed epoch credential');
assert.ok(route.includes('hostToken'), 'unregistered host should retain the one-time bootstrap compatibility token');
assert.ok(route.includes("fetchPendingTasks({ ...authOptions, hostDeviceId: hostDeviceId(), leaseMs: 60000 })"), 'legacy polling must identify the host so the cloud route atomically leases V1 work');
assert.ok(route.includes('claimToken: task.claimToken'), 'legacy completion must return its V1 claim token');
assert.ok(route.includes('verifyRelayAssertion') && route.includes('resolveRelaySessionActorContext')
  && route.includes('consumeRelayAuthorizationNonce'),
  'desktop sync host must verify a short-lived V2 relay assertion, rebuild its session actor, and consume its nonce');
assert.ok(!route.includes('resolveOrProvisionRelayActorContext'),
  'desktop sync host must not trust the removed V1 pairing approval path');
assert.ok(route.includes('authz,'), 'desktop sync host apply must pass actor context into the shared DB validator');
assert.ok(route.includes('AUTHORIZATION_CONTEXT_REQUIRED'), 'desktop sync without authenticated actor/device must fail closed');
assert.ok(!route.includes('payload.authorizationContext'), 'desktop sync host must not trust relay payload role or teacher context');
assert.ok(client.includes('x-gewu-host-token'), 'cloud relay client should send the host token header');
assert.ok(client.includes('x-gewu-host-credential') && client.includes('x-gewu-host-generation'), 'cloud relay client should send managed host identity headers');
assert.ok(route.includes('req.headers.authorization'), 'host route should read Authorization from incoming requests');
assert.ok(packageJson.includes('backend/src/routes/cloudRelayHostTasks.test.js'), 'host task processing test should run in npm test');

const { processClaimedV2Tasks, processMiniappTask, authOptionsFromRequest } = require('./cloudRelayHost');
const { resolvePaperExportQuestions } = require('./questionBank');
const { resultHash: hashTaskResult } = require('../services/cloudRelayTaskService');
const { DatabaseService } = require('../database');
const { createDesktopSessionService } = require('../services/desktopSessionService');
const { issueRelayAssertion } = require('../services/relayAssertionService');
const os = require('os');
const path = require('path');

{
  const names = ['GEWU_CLOUD_RELAY_HOST_TOKEN', 'GEWU_DESKTOP_SYNC_TOKEN', 'GEWU_PRIMARY_HOST_CREDENTIAL', 'GEWU_PRIMARY_HOST_GENERATION', 'GEWU_DEVICE_ID'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.GEWU_CLOUD_RELAY_HOST_TOKEN = 'bootstrap-root';
    process.env.GEWU_DESKTOP_SYNC_TOKEN = 'legacy-sync';
    delete process.env.GEWU_PRIMARY_HOST_CREDENTIAL;
    delete process.env.GEWU_PRIMARY_HOST_GENERATION;
    process.env.GEWU_DEVICE_ID = 'host-a';
    assert.deepStrictEqual(authOptionsFromRequest({ headers: { authorization: 'Bearer session' } }), {
      authorization: 'Bearer session',
      hostToken: 'bootstrap-root',
    });

    process.env.GEWU_PRIMARY_HOST_CREDENTIAL = 'managed-credential';
    process.env.GEWU_PRIMARY_HOST_GENERATION = '2';
    assert.deepStrictEqual(authOptionsFromRequest({ headers: { authorization: 'Bearer session' } }), {
      authorization: 'Bearer session',
      hostCredential: 'managed-credential',
      hostDeviceId: 'host-a',
      hostGeneration: 2,
    }, 'managed host identity must suppress the bootstrap root token');
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

(async () => {
  const relayRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-host-relay-v2-'));
  const previousDbPath = process.env.DB_PATH;
  const previousReadDbPath = process.env.READ_DB_PATH;
  const previousRelaySecret = process.env.GEWU_CLOUD_RELAY_HOST_TOKEN;
  process.env.DB_PATH = path.join(relayRoot, 'relay.db');
  process.env.READ_DB_PATH = process.env.DB_PATH;
  process.env.GEWU_CLOUD_RELAY_HOST_TOKEN = 'host-relay-v2-secret';
  const relayDb = new DatabaseService();
  try {
    const createdAt = new Date();
    const createdIso = createdAt.toISOString();
    relayDb.db.prepare('INSERT INTO teachers (id,name,created_at,updated_at) VALUES (?,?,?,?)')
      .run('host-t1', 'Host Teacher 1', createdIso, createdIso);
    relayDb.db.prepare('INSERT INTO teachers (id,name,created_at,updated_at) VALUES (?,?,?,?)')
      .run('host-t2', 'Host Teacher 2', createdIso, createdIso);
    relayDb.db.prepare(`INSERT INTO courses
      (id,name,display_name,type,source_type,teacher_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run('host-c1','Course 1','Course 1',1,1,'host-t1',createdIso,createdIso);
    relayDb.db.prepare(`INSERT INTO courses
      (id,name,display_name,type,source_type,teacher_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run('host-c2','Course 2','Course 2',1,1,'host-t2',createdIso,createdIso);
    relayDb.db.prepare(`INSERT INTO users
      (id,phone,name,role,status,login_enabled,teacher_id,review_status,auth_version,deleted,created_at,updated_at)
      VALUES ('host-relay-user','13900000041','Relay Teacher','teacher',1,1,'host-t1','approved',5,0,?,?)`)
      .run(createdIso, createdIso);
    relayDb.db.prepare(`INSERT INTO user_role_grants
      (user_id,role,subject_type,subject_id,status,source,created_at,updated_at)
      VALUES ('host-relay-user','teacher','teacher','host-t1','active','test',?,?)`)
      .run(createdIso, createdIso);
    relayDb.db.prepare(`INSERT INTO desktop_device_authorizations
      (id,device_id,device_name,device_kind,user_id,public_key,key_fingerprint,status,
       source_challenge_id,last_phone_verified_at,phone_reverify_due_at,credential_version,row_version,created_at,updated_at)
      VALUES ('host-relay-auth','host-relay-device','Relay PC','desktop-client','host-relay-user','test-public-key',?,'active',
        'host-relay-challenge',?,?,2,1,?,?)`)
      .run('c'.repeat(64), createdIso, new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(), createdIso, createdIso);
    relayDb.registerSyncDevice('host-relay-device', { ownerUserId:'host-relay-user', trusted:true });
    const sessions = createDesktopSessionService({
      db: relayDb.db,
      jwtSecret: 'host-relay-session-secret',
      now: () => new Date(createdAt),
      uuid: () => 'host-relay-session',
    });
    const online = sessions.issueSession({ userId:'host-relay-user', deviceId:'host-relay-device' });
    const assertionFor = (taskId, nonce) => issueRelayAssertion({
      taskId,
      actorUserId:'host-relay-user',
      deviceId:'host-relay-device',
      sessionId:online.session.id,
      activeRole:'teacher',
      teacherId:'host-t1',
      authVersion:5,
      credentialVersion:2,
      issuedAt:createdAt.getTime(),
      expiresAt:Date.parse(online.session.expiresAt),
      nonce,
    }, process.env.GEWU_CLOUD_RELAY_HOST_TOKEN);
    const updateAt = new Date(createdAt.getTime() + 1000).toISOString();
    const deniedTask = {
      id:'relay-teacher-denied',
      task_type:'desktop-sync',
      payload:{
        deviceId:'host-relay-device', actorUserId:'host-relay-user', tenantId:'default',
        relayAssertion:assertionFor('relay-teacher-denied','nonce-teacher-denied'),
        pendingChanges:[{ id:'relay-op-denied', table:'courses', action:'update', data:{ id:'host-c2', name:'forged', teacher_id:'host-t2' }, updatedAt:updateAt }],
      },
    };
    const denied = await processMiniappTask(deniedTask, relayDb);
    assert.strictEqual(denied.applied, 0);
    assert.strictEqual(relayDb.db.prepare("SELECT name FROM courses WHERE id='host-c2'").get().name, 'Course 2');
    assert.strictEqual(relayDb.db.prepare("SELECT reason_code FROM sync_rejections WHERE operation_id='relay-op-denied'").get().reason_code, 'TEACHER_SCOPE_VIOLATION');

    const allowedTask = {
      id:'relay-teacher-allowed',
      task_type:'desktop-sync',
      payload:{
        deviceId:'host-relay-device', actorUserId:'host-relay-user', tenantId:'default',
        relayAssertion:assertionFor('relay-teacher-allowed','nonce-teacher-allowed'),
        pendingChanges:[{ id:'relay-op-allowed', table:'courses', action:'update', data:{ id:'host-c1', name:'teacher update', teacher_id:'host-t1' }, updatedAt:updateAt }],
      },
    };
    const allowed = await processMiniappTask(allowedTask, relayDb);
    assert.strictEqual(allowed.applied, 1);
    assert.strictEqual(relayDb.db.prepare("SELECT name FROM courses WHERE id='host-c1'").get().name, 'teacher update');

    relayDb.db.prepare("UPDATE desktop_device_authorizations SET status='revoked',credential_version=3 WHERE device_id='host-relay-device'").run();
    const revokedTask = {
      id:'relay-device-revoked',
      task_type:'desktop-sync',
      payload:{
        deviceId:'host-relay-device', actorUserId:'host-relay-user', tenantId:'default',
        relayAssertion:assertionFor('relay-device-revoked','nonce-device-revoked'),
        pendingChanges:[{ id:'relay-op-revoked', table:'courses', action:'update', data:{ id:'host-c1', name:'revoked update', teacher_id:'host-t1' }, updatedAt:new Date(createdAt.getTime() + 2000).toISOString() }],
      },
    };
    await assert.rejects(() => processMiniappTask(revokedTask, relayDb), error => error.code === 'AUTHORIZATION_CONTEXT_REQUIRED');
    assert.strictEqual(relayDb.db.prepare("SELECT name FROM courses WHERE id='host-c1'").get().name, 'teacher update');
  } finally {
    relayDb.close();
    if (previousDbPath === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = previousDbPath;
    if (previousReadDbPath === undefined) delete process.env.READ_DB_PATH; else process.env.READ_DB_PATH = previousReadDbPath;
    if (previousRelaySecret === undefined) delete process.env.GEWU_CLOUD_RELAY_HOST_TOKEN; else process.env.GEWU_CLOUD_RELAY_HOST_TOKEN = previousRelaySecret;
    fs.rmSync(relayRoot, { recursive:true, force:true });
  }
  const calls = [];
  const selectionRows = [
    { id: 'q1', tenant_id: 'tenant-a', status: 'published', stem: 'one' },
    { id: 'q2', tenant_id: 'tenant-a', status: 'published', stem: 'two' },
    { id: 'draft-a', tenant_id: 'tenant-a', status: 'draft', stem: 'draft' },
  ];
  const selectionQuestionBank = {
    getQuestion: (_db, id, tenantId) => selectionRows.find(row => row.id === id && row.tenant_id === tenantId) || null,
    listQuestions: () => selectionRows,
  };
  const dependencies = {
    questionBank: selectionQuestionBank,
    writePaperArtifact: async (format, payload, questions) => {
      calls.push({ format, payload, questions });
      const answerPosition = ['after-each', 'inline', 'after-question'].includes(payload.answerPosition) ? 'after-each' : (payload.answerPosition === 'hidden' || payload.includeAnswers === false ? 'hidden' : 'end');
      return { fileName: `paper.${format === 'word' ? 'docx' : 'pdf'}`, fileUrl: '/artifact', answerPosition, requestedFormulaMode: 'word-native', effectiveFormulaModes: ['word-native'], fallbackCount: 0, formulaCount: 0, sha256: 'a'.repeat(64), pageCount: format === 'pdf' ? 1 : null, diagnostics: [] };
    },
  };
  let provisioningInput = null;
  const provisioningResult = await processMiniappTask({
    task_type: 'identity-provisioning',
    request_hash: 'c'.repeat(64),
    payload: {
      applicationId: 'application-1',
      revision: 1,
      applicationType: 'student',
      payload: { studentName: 'Student' },
      reviewedBy: 'admin-1',
      tenantId: 'default',
    },
  }, {}, {
    ...dependencies,
    identityProvisioningService: {
      provision(input) {
        provisioningInput = input;
        return {
          entityId: 'student-1',
          entityType: 'student',
          receiptId: 'receipt-1',
          resultHash: 'd'.repeat(64),
        };
      },
    },
  });
  assert.deepStrictEqual(provisioningInput, {
    applicationId: 'application-1',
    revision: 1,
    applicationType: 'student',
    payload: { studentName: 'Student' },
    reviewedBy: 'admin-1',
    tenantId: 'default',
    requestHash: 'c'.repeat(64),
  });
  assert.deepStrictEqual(provisioningResult, {
    entityId: 'student-1',
    entityType: 'student',
    receiptId: 'receipt-1',
    resultHash: 'd'.repeat(64),
  });
  const word = await processMiniappTask({ task_type: 'paper-export-word', protocol_version: 2, selection_context: { tenantId: 'tenant-a', allowDraft: false }, payload: { title: 'word', tenantId: 'tenant-a', answerPosition: 'end', questionIds: ['q2', 'q1'] } }, {}, dependencies);
  const pdf = await processMiniappTask({ task_type: 'paper-export-pdf', protocol_version: 2, selection_context: { tenantId: 'tenant-a', allowDraft: false }, payload: { title: 'pdf', tenantId: 'tenant-a', answerPosition: 'after-each', questionIds: ['q1'] } }, {}, dependencies);
  assert.strictEqual(calls[0].format, 'word');
  assert.strictEqual(calls[0].payload.answerPosition, 'end');
  assert.strictEqual(calls[1].format, 'pdf');
  assert.strictEqual(calls[1].payload.answerPosition, 'after-each');
  assert.strictEqual(word.answerPosition, 'end');
  assert.strictEqual(pdf.answerPosition, 'after-each');
  assert.strictEqual(word.sha256, 'a'.repeat(64));
  assert.strictEqual(word.pageCount, null);
  assert.deepStrictEqual(word.diagnostics, []);
  assert.strictEqual(pdf.pageCount, 1);
  assert.deepStrictEqual(calls[0].questions.map(row => row.id), ['q2', 'q1'], 'V2 host export must preserve exact questionIds order');
  await assert.rejects(
    () => processMiniappTask({ task_type: 'paper-export-word', protocol_version: 2, selection_context: { tenantId: 'tenant-a', allowDraft: false }, payload: { tenantId: 'tenant-a', questionIds: ['q1', 'q1'] } }, {}, dependencies),
    error => error.code === 'QUESTION_IDS_DUPLICATE'
  );
  const direct = resolvePaperExportQuestions({}, { questionIds: ['q2', 'q1'] }, { tenantId: 'tenant-a', allowDraft: false }, { questionBank: selectionQuestionBank });
  assert.deepStrictEqual(direct.map(row => row.id), ['q2', 'q1'], 'direct export must share exact selection semantics');
  assert.throws(
    () => resolvePaperExportQuestions({}, { questionIds: ['draft-a'] }, { tenantId: 'tenant-a', allowDraft: false }, { questionBank: selectionQuestionBank }),
    error => error.code === 'QUESTION_DRAFT_FORBIDDEN'
  );
  const legacy = await processMiniappTask({ task_type: 'paper-export-word', protocol_version: 1, payload: { answerPosition: 'inline', questionCount: 1, tenantId: 'tenant-a' } }, {}, dependencies);
  assert.strictEqual(legacy.answerPosition, 'after-each', 'legacy input must return the canonical artifact answer position');

  const claimedQueue = [
    { task: { id: 'v2-ok', task_type: 'paper-export-word', protocol_version: 2, row_version: 1, payload: {} }, claimToken: 'claim-ok' },
    { task: { id: 'v2-fail', task_type: 'paper-export-pdf', protocol_version: 2, row_version: 1, payload: {} }, claimToken: 'claim-fail' },
  ];
  const lifecycle = [];
  const claimedResults = await processClaimedV2Tasks({}, { hostToken: 'trusted' }, {
    hostDeviceId: () => 'host-a',
    claimMiniappTask: async () => ({ success: true, ...(claimedQueue.shift() || { task: null, claimToken: null }) }),
    updateMiniappTaskProgress: async (id, body) => { lifecycle.push(['progress', id, body]); return { task: { row_version: 2 } }; },
    processMiniappTask: async task => { if (task.id === 'v2-fail') throw Object.assign(new Error('boom'), { code: 'BOOM' }); return { fileName: 'paper.docx' }; },
    completeMiniappTask: async (id, body) => { lifecycle.push(['complete', id, body]); return { success: true }; },
    failMiniappTask: async (id, body) => { lifecycle.push(['fail', id, body]); return { success: true }; },
  });
  assert.deepStrictEqual(claimedResults.map(row => [row.id, row.success]), [['v2-ok', true], ['v2-fail', false]]);
  assert.ok(lifecycle.some(([kind, id, body]) => kind === 'complete'
    && id === 'v2-ok'
    && body.claimToken === 'claim-ok'
    && body.expectedRowVersion === 2
    && body.operationId === 'host-task:v2-ok'
    && body.resultHash === hashTaskResult({ fileName: 'paper.docx' })));
  assert.ok(lifecycle.some(([kind, id, body]) => kind === 'fail' && id === 'v2-fail' && body.claimToken === 'claim-fail' && body.expectedRowVersion === 2 && body.errorCode === 'BOOM'));

  let durableClaimed = true; let durableCalls = 0; let legacyExportCalls = 0;
  const durableResults = await processClaimedV2Tasks({}, {}, {
    hostDeviceId: () => 'host-a',
    claimMiniappTask: async () => durableClaimed
      ? (durableClaimed = false, { success: true, task: { id: 'v2-durable', task_type: 'paper-export-pdf', protocol_version: 2, row_version: 1, payload: {} }, claimToken: 'claim-durable' })
      : ({ success: true, task: null }),
    updateMiniappTaskProgress: async (_id, body) => ({ success: true, task: { row_version: body.expectedRowVersion + 1 } }),
    processDurablePaperTask: async () => { durableCalls += 1; return { artifactReady: true, artifact: { artifact_id: 'artifact-1' }, jobKey: 'job-1' }; },
    processMiniappTask: async () => { legacyExportCalls += 1; throw new Error('legacy export path must not run'); },
    completeMiniappTask: async () => ({ success: true }), failMiniappTask: async () => ({ success: true }),
    markPaperCompletionDelivered: () => {},
  });
  assert.strictEqual(durableResults[0].success, true);
  assert.strictEqual(durableCalls, 1);
  assert.strictEqual(legacyExportCalls, 0, 'V2 exports must not duplicate generation through processMiniappTask');

  let retryClaimed = true; let retryFailCalls = 0;
  const retryScheduled = await processClaimedV2Tasks({}, {}, {
    hostDeviceId: () => 'host-a',
    claimMiniappTask: async () => retryClaimed
      ? (retryClaimed = false, { success: true, task: { id: 'v2-retry', task_type: 'paper-export-pdf', protocol_version: 2, row_version: 1, payload: {} }, claimToken: 'claim-retry' })
      : ({ success: true, task: null }),
    updateMiniappTaskProgress: async (_id, body) => ({ success: true, task: { row_version: body.expectedRowVersion + 1 } }),
    processDurablePaperTask: async () => { const error = new Error('transient'); error.paperJob = { status: 'retry_wait', next_attempt_at: '2026-07-13T00:01:00.000Z' }; throw error; },
    completeMiniappTask: async () => ({ success: true }), failMiniappTask: async () => { retryFailCalls += 1; return { success: true }; },
  });
  assert.strictEqual(retryScheduled[0].retryScheduled, true);
  assert.strictEqual(retryFailCalls, 0, 'local retry_wait must leave cloud lease to expire instead of terminally failing the task');

  let falseSuccessClaimed = true;
  const falseSuccessResults = await processClaimedV2Tasks({}, { hostToken: 'trusted' }, {
    hostDeviceId: () => 'host-a',
    claimMiniappTask: async () => falseSuccessClaimed
      ? (falseSuccessClaimed = false, { success: true, task: { id: 'v2-complete-conflict', task_type: 'paper-export-pdf', protocol_version: 2, row_version: 1, payload: {} }, claimToken: 'claim-conflict' })
      : ({ success: true, task: null }),
    updateMiniappTaskProgress: async () => ({ success: true, task: { row_version: 2 } }),
    processMiniappTask: async () => ({ fileName: 'paper.pdf' }),
    completeMiniappTask: async () => ({ success: false, code: 'TASK_VERSION_CONFLICT', error: 'stale row version' }),
    failMiniappTask: async (_id, body) => ({ success: true, body }),
  });
  assert.strictEqual(falseSuccessResults[0].success, false, 'completion responses with success=false must never be reported as successful host processing');
  assert.strictEqual(falseSuccessResults[0].errorCode, 'TASK_VERSION_CONFLICT');

  let heartbeatClaimed = true;
  let heartbeatUpdates = 0;
  let heartbeatInFlight = 0;
  let maxHeartbeatInFlight = 0;
  let completedRowVersion = null;
  const heartbeatResults = await processClaimedV2Tasks({}, { hostToken: 'trusted' }, {
    hostDeviceId: () => 'host-a',
    leaseMs: 30,
    heartbeatIntervalMs: 5,
    claimMiniappTask: async () => heartbeatClaimed
      ? (heartbeatClaimed = false, { success: true, task: { id: 'v2-long', task_type: 'paper-export-pdf', protocol_version: 2, row_version: 1, payload: {} }, claimToken: 'claim-long' })
      : ({ success: true, task: null }),
    updateMiniappTaskProgress: async (_id, body) => {
      heartbeatInFlight += 1;
      maxHeartbeatInFlight = Math.max(maxHeartbeatInFlight, heartbeatInFlight);
      await new Promise(resolve => setTimeout(resolve, 2));
      heartbeatInFlight -= 1;
      heartbeatUpdates += 1;
      return { success: true, task: { row_version: body.expectedRowVersion + 1 } };
    },
    processMiniappTask: async () => {
      await new Promise(resolve => setTimeout(resolve, 35));
      return { fileName: 'long.pdf' };
    },
    completeMiniappTask: async (_id, body) => {
      completedRowVersion = body.expectedRowVersion;
      return { success: true };
    },
    failMiniappTask: async () => ({ success: true }),
  });
  assert.strictEqual(heartbeatResults[0].success, true);
  assert.ok(heartbeatUpdates >= 2, 'long rendering must renew its V2 lease while processing');
  assert.strictEqual(maxHeartbeatInFlight, 1, 'lease heartbeats must be serialized');
  assert.strictEqual(completedRowVersion, 1 + heartbeatUpdates, 'completion must use the newest heartbeat row_version after stopping the heartbeat');

  let failingHeartbeatClaimed = true;
  let progressCalls = 0;
  let completeCalls = 0;
  let cleanedResult = null;
  const heartbeatFailureResults = await processClaimedV2Tasks({}, {}, {
    hostDeviceId: () => 'host-a',
    heartbeatIntervalMs: 2,
    claimMiniappTask: async () => failingHeartbeatClaimed
      ? (failingHeartbeatClaimed = false, { success: true, task: { id: 'v2-lease-lost', task_type: 'paper-export-pdf', protocol_version: 2, row_version: 1, payload: {} }, claimToken: 'claim-lost' })
      : ({ success: true, task: null }),
    updateMiniappTaskProgress: async (_id, body) => {
      progressCalls += 1;
      return progressCalls === 1 ? { success: true, task: { row_version: body.expectedRowVersion + 1 } } : { success: false, code: 'TASK_CLAIM_INVALID', error: 'lease lost' };
    },
    processMiniappTask: async () => {
      await new Promise(resolve => setTimeout(resolve, 12));
      return { fileName: 'orphan.pdf' };
    },
    cleanupTaskResult: async result => { cleanedResult = result; },
    completeMiniappTask: async () => { completeCalls += 1; return { success: true }; },
    failMiniappTask: async () => ({ success: false, code: 'TASK_CLAIM_INVALID', error: 'lease lost' }),
  });
  assert.strictEqual(heartbeatFailureResults[0].success, false);
  assert.strictEqual(completeCalls, 0, 'lease renewal failure must prevent completion');
  assert.deepStrictEqual(cleanedResult, { fileName: 'orphan.pdf' }, 'a generated artifact must be offered for cleanup when its lease is lost');
  console.log('cloudRelayHost task processing checks passed');
})().catch(error => { console.error(error); process.exit(1); });
