const assert = require('assert');
const fs = require('fs');

const route = fs.readFileSync('backend/src/routes/cloudRelayHost.js', 'utf-8');
const questionBankRoute = fs.readFileSync('backend/src/routes/questionBank.js', 'utf-8');
const client = fs.readFileSync('backend/src/services/cloudRelayClient.js', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(route.includes('processMiniappTask'), 'host cloud relay route should process miniapp tasks');
assert.ok(route.includes("task.task_type === 'question-paper'"), 'host should process miniapp paper assembly tasks');
assert.ok(route.includes("task.task_type === 'paper-export-word'"), 'host should process miniapp Word export tasks');
assert.ok(route.includes("task.task_type === 'paper-export-pdf'"), 'host should process miniapp PDF export tasks');
assert.ok(route.includes('writePaperArtifact'), 'host should write paper export artifacts');
assert.ok(route.includes('createLocalQuestionImageResolver(paperRoot)'), 'relay host export must inject the configured local image resolver');
assert.ok(questionBankRoute.includes('createLocalQuestionImageResolver(paperRoot)'), 'question bank export must inject the configured local image resolver');
assert.ok(route.includes('answerPosition'), 'relay task payload must carry canonical answerPosition through to the artifact result');
assert.ok(route.includes('fileUrl'), 'host should return downloadable artifact URLs');
assert.ok(route.includes("router.get('/artifacts/:fileName'"), 'host should expose artifact download route');
assert.ok(route.includes('res.download'), 'host artifact route should download generated files');
assert.ok(route.includes('completeMiniappTask(task.id'), 'host should complete miniapp tasks back to cloud');
assert.ok(route.includes("router.post('/tasks/process'"), 'host should expose a process pending tasks endpoint');
assert.ok(route.includes('authOptionsFromRequest'), 'host route should forward authenticated maintenance requests to cloud relay');
assert.ok(route.includes('hostToken'), 'host route should forward a host token to protected cloud relay routes');
assert.ok(route.includes("fetchPendingTasks({ ...authOptions, hostDeviceId: hostDeviceId(), leaseMs: 60000 })"), 'legacy polling must identify the host so the cloud route atomically leases V1 work');
assert.ok(route.includes('claimToken: task.claimToken'), 'legacy completion must return its V1 claim token');
assert.ok(route.includes('verifyRelayAssertion') && route.includes('consumeRelayAuthorizationNonce'),
  'desktop sync host must verify a short-lived relay assertion and consume its nonce');
assert.ok(route.includes('authz,'), 'desktop sync host apply must pass actor context into the shared DB validator');
assert.ok(route.includes('AUTHORIZATION_CONTEXT_REQUIRED'), 'desktop sync without authenticated actor/device must fail closed');
assert.ok(!route.includes('payload.authorizationContext'), 'desktop sync host must not trust relay payload role or teacher context');
assert.ok(client.includes('x-gewu-host-token'), 'cloud relay client should send the host token header');
assert.ok(route.includes('req.headers.authorization'), 'host route should read Authorization from incoming requests');
assert.ok(packageJson.includes('backend/src/routes/cloudRelayHostTasks.test.js'), 'host task processing test should run in npm test');

const { processClaimedV2Tasks, processMiniappTask } = require('./cloudRelayHost');
const { resolvePaperExportQuestions } = require('./questionBank');

(async () => {
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
  assert.ok(lifecycle.some(([kind, id, body]) => kind === 'complete' && id === 'v2-ok' && body.claimToken === 'claim-ok' && body.expectedRowVersion === 2));
  assert.ok(lifecycle.some(([kind, id, body]) => kind === 'fail' && id === 'v2-fail' && body.claimToken === 'claim-fail' && body.expectedRowVersion === 2 && body.errorCode === 'BOOM'));

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
