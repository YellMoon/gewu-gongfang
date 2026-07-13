const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { getInstance } = require('../database');
const {
  publishHeartbeat,
  publishSnapshot,
  fetchPendingTasks,
  claimMiniappTask,
  updateMiniappTaskProgress,
  completeMiniappTask,
  failMiniappTask,
  queryMiniappTaskState,
} = require('../services/cloudRelayClient');
const questionBank = require('../services/questionBankService');
const { resolveQuestionAssetPath, resolveBoundQuestionBankRoot } = require('../services/questionBankStorageService');
const { updateCommittedQuestion, createTrustedInternalStorageUpdateContext } = require('../services/questionBankStorageService');
const { createLocalQuestionImageResolver, writePaperArtifact } = require('../services/paperArtifactService');
const { resolveLegacyQuestionSelection, resolveTaskQuestionSelection } = require('../services/paperExportSelectionService');
const { verifyRelayAssertion } = require('../services/relayAssertionService');
const { bindPaperCompletionClaim, processDurablePaperTask, replayPaperCompletionOutbox } = require('../services/paperJobProcessor');
const { recoverStalePaperJobs } = require('../services/paperJobRepository');
const { cleanupPaperStorage, reconcilePaperArtifacts } = require('../services/paperStorageCleanup');

const router = Router();

function hostDeviceId() {
  return process.env.GEWU_DEVICE_ID || 'unknown';
}

function hostLanUrls() {
  const raw = process.env.GEWU_HOST_LAN_URLS || '';
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (_err) {
    return raw.split(/[;,]/).map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function authOptionsFromRequest(req) {
  const hostToken = process.env.GEWU_CLOUD_RELAY_HOST_TOKEN || process.env.GEWU_DESKTOP_SYNC_TOKEN || '';
  return {
    authorization: req.headers.authorization || '',
    hostToken,
  };
}

function exportRoot() {
  const root = process.env.QUESTION_BANK_ROOT || path.join(process.cwd(), 'data', 'GewuQuestionBank');
  return root;
}

function buildSnapshotPayload(db) {
  if (typeof db.exportAllData === 'function') return db.exportAllData();

  return {
    students: typeof db.getAllStudents === 'function' ? db.getAllStudents() : [],
    courses: typeof db.getAllCourses === 'function' ? db.getAllCourses() : [],
    schedules: typeof db.getAllSchedules === 'function' ? db.getAllSchedules() : [],
    teachers: typeof db.getAllTeachers === 'function' ? db.getAllTeachers() : [],
    rooms: typeof db.getAllRooms === 'function' ? db.getAllRooms() : [],
    schools: typeof db.getAllSchools === 'function' ? db.getAllSchools() : [],
    institutions: typeof db.getAllInstitutions === 'function' ? db.getAllInstitutions() : [],
  };
}

function selectQuestions(db, payload = {}) {
  return resolveLegacyQuestionSelection(db, payload, { tenantId: payload.tenantId || payload.tenant_id || 'default', allowDraft: false });
}

async function processMiniappTask(task, db, dependencies = {}) {
  const payload = task.payload || {};
  const selectTaskQuestions = dependencies.selectQuestions || ((database, taskPayload) => resolveTaskQuestionSelection(
    database,
    task,
    task.selection_context || { tenantId: taskPayload.tenantId || taskPayload.tenant_id || 'default', allowDraft: false },
    { questionBank: dependencies.questionBank || questionBank }
  ));
  const writeTaskArtifact = dependencies.writePaperArtifact || writePaperArtifact;
  if (task.task_type === 'desktop-sync') {
    const changes = payload.pendingChanges || payload.changes || [];
    let claims;
    try {
      claims = verifyRelayAssertion(payload.relayAssertion, process.env.GEWU_CLOUD_RELAY_HOST_TOKEN || '');
    } catch (_error) { claims = null; }
    const validClaims = claims && claims.taskId === task.id && claims.actorUserId === payload.actorUserId
      && claims.deviceId === (payload.deviceId || payload.device_id) && db.consumeRelayAuthorizationNonce(claims);
    const authz = validClaims ? db.resolveOrProvisionRelayActorContext(claims.deviceId, claims.actorUserId, claims.pairingApprovalId) : false;
    if (!authz) {
      const error = new Error('AUTHORIZATION_CONTEXT_REQUIRED'); error.code = 'AUTHORIZATION_CONTEXT_REQUIRED'; throw error;
    }
    const result = db.applySyncChanges(changes, {
      deviceId: authz.deviceId,
      tenantId: payload.tenantId || payload.tenant_id || 'default',
      authz,
      storageHooks: { updateCommittedQuestion: ({ change, tenantId }) => updateCommittedQuestion(change.data.id, { db: db.db || db, tenantId, internalCredential: createTrustedInternalStorageUpdateContext({ validatedAuthz: authz, hostRuntime: { runtimeNodeRole: process.env.GEWU_NODE_ROLE || 'desktop-client' } }), payload: change.data }) },
    });
    return {
      taskType: task.task_type,
      deviceId: payload.deviceId || payload.device_id || 'unknown',
      acceptedChanges: changes.length,
      applied: result.applied || 0,
      conflicts: result.conflicts || 0,
      errors: result.errors || [],
    };
  }

  if (task.task_type === 'question-paper') {
    const questions = selectTaskQuestions(db, payload);
    return {
      taskType: task.task_type,
      title: payload.title || '练习试卷',
      subject: payload.subject || '',
      questionCount: questions.length,
      questions: questions.map((question, index) => ({
        number: index + 1,
        id: question.id,
        type: question.type,
        stem: question.stem,
        score: question.score || 0,
      })),
    };
  }

  if (task.task_type === 'paper-export-word') {
    const questions = selectTaskQuestions(db, payload);
    const paperRoot = exportRoot();
    const artifact = await writeTaskArtifact('word', payload, questions, {
      root: paperRoot,
      deviceId: hostDeviceId(),
      resolveImageAsset: createLocalQuestionImageResolver(paperRoot),
    });
    return {
      taskType: task.task_type,
      format: 'word',
      title: payload.title || '练习试卷',
      subject: payload.subject || '',
      questionCount: questions.length,
      answerPosition: artifact.answerPosition,
      fileName: artifact.fileName,
      fileUrl: artifact.fileUrl,
      requestedFormulaMode: artifact.requestedFormulaMode,
      effectiveFormulaModes: artifact.effectiveFormulaModes,
      fallbackCount: artifact.fallbackCount,
      formulaCount: artifact.formulaCount,
      sha256: artifact.sha256,
      pageCount: artifact.pageCount,
      diagnostics: artifact.diagnostics || [],
      questions: questions.map(question => ({ id: question.id, stem: question.stem })),
    };
  }

  if (task.task_type === 'paper-export-pdf') {
    const questions = selectTaskQuestions(db, payload);
    const paperRoot = exportRoot();
    const artifact = await writeTaskArtifact('pdf', payload, questions, {
      root: paperRoot,
      deviceId: hostDeviceId(),
      resolveImageAsset: createLocalQuestionImageResolver(paperRoot),
    });
    return {
      taskType: task.task_type,
      format: 'pdf',
      title: payload.title || '练习试卷',
      subject: payload.subject || '',
      questionCount: questions.length,
      answerPosition: artifact.answerPosition,
      fileName: artifact.fileName,
      fileUrl: artifact.fileUrl,
      requestedFormulaMode: artifact.requestedFormulaMode,
      effectiveFormulaModes: artifact.effectiveFormulaModes,
      fallbackCount: artifact.fallbackCount,
      formulaCount: artifact.formulaCount,
      sha256: artifact.sha256,
      pageCount: artifact.pageCount,
      diagnostics: artifact.diagnostics || [],
      questions: questions.map(question => ({ id: question.id, stem: question.stem })),
    };
  }

  if (task.task_type === 'asset-import') {
    return {
      taskType: task.task_type,
      accepted: true,
      fileName: payload.fileName || payload.name || '',
    };
  }

  throw new Error(`unsupported miniapp task type: ${task.task_type}`);
}

function startSerialLeaseHeartbeat({ intervalMs, renew }) {
  let stopped = false;
  let timer = null;
  let inFlight = Promise.resolve();
  let failure = null;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      inFlight = Promise.resolve()
        .then(renew)
        .catch(error => {
          failure = error;
          stopped = true;
        })
        .finally(() => {
          if (!stopped) schedule();
        });
    }, intervalMs);
  };
  schedule();
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
      if (failure) throw failure;
    },
  };
}

async function cleanupGeneratedTaskResult(result) {
  const fileName = result?.fileName ? path.basename(result.fileName) : '';
  if (!fileName) return;
  const filePath = resolveQuestionAssetPath(exportRoot(), 'exports', fileName);
  if (fs.existsSync(filePath)) await fs.promises.unlink(filePath);
}

async function processClaimedV2Tasks(db, authOptions, dependencies = {}) {
  const claimTask = dependencies.claimMiniappTask || claimMiniappTask;
  const updateProgress = dependencies.updateMiniappTaskProgress || updateMiniappTaskProgress;
  const completeTask = dependencies.completeMiniappTask || completeMiniappTask;
  const failTask = dependencies.failMiniappTask || failMiniappTask;
  const processTask = dependencies.processMiniappTask || processMiniappTask;
  const processDurableTask = dependencies.processDurablePaperTask || processDurablePaperTask;
  const bindCompletionClaim = dependencies.bindPaperCompletionClaim || bindPaperCompletionClaim;
  const replayCompletionOutbox = dependencies.replayPaperCompletionOutbox || replayPaperCompletionOutbox;
  const queryTaskState = dependencies.queryMiniappTaskState || queryMiniappTaskState;
  const resolveHostDeviceId = dependencies.hostDeviceId || hostDeviceId;
  const cleanupTaskResult = dependencies.cleanupTaskResult || cleanupGeneratedTaskResult;
  const leaseMs = Math.max(100, Number(dependencies.leaseMs || 60000));
  const heartbeatIntervalMs = Math.max(1, Number(dependencies.heartbeatIntervalMs || Math.floor(leaseMs / 3)));
  const results = [];
  const writerDb = db.db || db;
  if (typeof writerDb.prepare === 'function') {
    await replayCompletionOutbox(writerDb, {
      completeTask: (taskId, body) => completeTask(taskId, body, authOptions),
      queryTaskState: taskId => queryTaskState(taskId, { ...authOptions, hostDeviceId: resolveHostDeviceId() }),
    });
    const staleBefore = new Date(Date.now() - Math.max(60000, Number(dependencies.staleJobMs || 300000))).toISOString();
    recoverStalePaperJobs(writerDb, { staleBefore });
    try {
      const authoritativeRoot = resolveBoundQuestionBankRoot(writerDb);
      reconcilePaperArtifacts(writerDb, authoritativeRoot);
      cleanupPaperStorage(writerDb, authoritativeRoot);
    } catch (error) {
      if (!['QUESTION_BANK_STORE_NOT_BOUND', 'QUESTION_BANK_AUTHORITY_MISMATCH'].includes(error.code)) throw error;
    }
  }
  const requireRelaySuccess = response => {
    if (response?.success === false) {
      throw Object.assign(new Error(response.error || response.message || response.code || 'cloud relay rejected task operation'), {
        code: response.code || 'CLOUD_RELAY_REQUEST_FAILED',
        response,
      });
    }
    return response;
  };
  for (let count = 0; count < 100; count += 1) {
    const claimed = await claimTask({ hostDeviceId: resolveHostDeviceId(), leaseMs }, authOptions);
    if (!claimed?.success || !claimed.task) break;
    const { task, claimToken } = claimed;
    let rowVersion = Number(task.row_version || 0);
    let heartbeat = null;
    let generatedResult = null;
    let durableArtifactReady = false;
    try {
      const progress = requireRelaySuccess(await updateProgress(task.id, {
        claimToken,
        expectedRowVersion: rowVersion,
        phase: 'processing',
        progress: 5,
        leaseMs,
      }, authOptions));
      rowVersion = Number(progress?.task?.row_version ?? rowVersion + 1);
      heartbeat = startSerialLeaseHeartbeat({
        intervalMs: heartbeatIntervalMs,
        renew: async () => {
          const renewed = requireRelaySuccess(await updateProgress(task.id, {
            claimToken,
            expectedRowVersion: rowVersion,
            phase: 'processing',
            progress: Number(progress?.task?.progress || 5),
            leaseMs,
          }, authOptions));
          rowVersion = Number(renewed?.task?.row_version ?? rowVersion + 1);
        },
      });
      const durableExport = Number(task.protocol_version || 1) >= 2 && ['paper-export-word', 'paper-export-pdf'].includes(task.task_type)
        && (Boolean(dependencies.processDurablePaperTask) || !dependencies.processMiniappTask);
      const result = durableExport
        ? await processDurableTask(task, db, {
          deferCompletion: true,
          selectQuestions: (database, durableTask) => resolveTaskQuestionSelection(
            database,
            durableTask,
            durableTask.selection_context || { tenantId: durableTask.payload?.tenantId || durableTask.payload?.tenant_id || 'default', allowDraft: false },
            { questionBank: dependencies.questionBank || questionBank }
          ),
        })
        : await processTask(task, db);
      generatedResult = result;
      durableArtifactReady = Boolean(durableExport && result?.artifactReady);
      await heartbeat.stop();
      if (durableArtifactReady && typeof writerDb.prepare === 'function') {
        bindCompletionClaim(writerDb, task.id, result.artifact.artifact_id, { claimToken, expectedRowVersion: rowVersion });
        await replayCompletionOutbox(writerDb, {
          completeTask: (taskId, body) => completeTask(taskId, body, authOptions),
          queryTaskState: taskId => queryTaskState(taskId, { ...authOptions, hostDeviceId: resolveHostDeviceId() }),
        });
        const localCompletion = writerDb.prepare('SELECT status FROM paper_completion_outbox WHERE task_id=? AND artifact_id=?').get(task.id, result.artifact.artifact_id);
        if (localCompletion?.status === 'delivered') { results.push({ id: task.id, success: true, completed: { success: true, replayedFromOutbox: true } }); continue; }
        if (localCompletion?.status === 'terminal_cancelled') { results.push({ id: task.id, success: false, cancelled: true, artifactReady: false }); continue; }
        throw Object.assign(new Error('paper completion remains pending after reconciliation'), { code: 'TASK_COMPLETION_PENDING' });
      }
      const completed = requireRelaySuccess(await completeTask(task.id, { claimToken, expectedRowVersion: rowVersion, result }, authOptions));
      results.push({ id: task.id, success: true, completed });
    } catch (error) {
      try { await heartbeat?.stop(); } catch (_heartbeatError) { /* preserve the first processing error */ }
      if (durableArtifactReady) {
        results.push({ id: task.id, success: false, artifactReady: true, callbackPending: true, error: error.message, errorCode: error.code || 'TASK_COMPLETION_PENDING' });
        continue;
      }
      if (error.paperJob?.status === 'retry_wait') {
        results.push({ id: task.id, success: false, retryScheduled: true, nextAttemptAt: error.paperJob.next_attempt_at, error: error.message, errorCode: error.code || 'TASK_RETRY_SCHEDULED' });
        continue;
      }
      let cleanupError = null;
      if (generatedResult) {
        try { await cleanupTaskResult(generatedResult); } catch (artifactCleanupError) { cleanupError = artifactCleanupError.message; }
      }
      let failed = null;
      let failError = null;
      try {
        failed = requireRelaySuccess(await failTask(task.id, {
          claimToken,
          expectedRowVersion: rowVersion,
          errorCode: error.code || 'TASK_PROCESSING_FAILED',
          error: error.message,
        }, authOptions));
      } catch (taskFailError) {
        failError = { code: taskFailError.code || 'TASK_FAIL_REPORT_FAILED', message: taskFailError.message };
      }
      results.push({ id: task.id, success: false, error: error.message, errorCode: error.code || 'TASK_PROCESSING_FAILED', failed, failError, cleanupError });
    }
  }
  return results;
}

router.post('/heartbeat', async (req, res, next) => {
  try {
    const result = await publishHeartbeat({
      hostDeviceId: hostDeviceId(),
      status: 'online',
      baseUrl: process.env.GEWU_HOST_BASE_URL || '',
      lanUrls: hostLanUrls(),
    }, authOptionsFromRequest(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/snapshot', async (req, res, next) => {
  try {
    const db = getInstance();
    const result = await publishSnapshot({
      snapshotType: 'full',
      payload: buildSnapshotPayload(db),
      sourceDeviceId: hostDeviceId(),
      version: new Date().toISOString(),
    }, authOptionsFromRequest(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/tasks/pending', async (req, res, next) => {
  try {
    const authOptions = authOptionsFromRequest(req);
    const result = await fetchPendingTasks({ ...authOptions, hostDeviceId: hostDeviceId(), leaseMs: 60000 });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/tasks/process', async (req, res, next) => {
  try {
    const db = getInstance();
    const authOptions = authOptionsFromRequest(req);
    const claimedResults = await processClaimedV2Tasks(db, authOptions);
    const pending = await fetchPendingTasks({ ...authOptions, hostDeviceId: hostDeviceId(), leaseMs: 60000 });
    if (!pending.success) return res.json(claimedResults.length ? { success: true, processed: claimedResults.length, results: claimedResults, legacy: pending } : pending);
    const tasks = pending.tasks || [];
    const results = [...claimedResults];
    for (const task of tasks) {
      try {
        const result = await processMiniappTask(task, db);
        const completed = await completeMiniappTask(task.id, {
          success: true,
          hostDeviceId: hostDeviceId(),
          claimToken: task.claimToken,
          expectedRowVersion: task.row_version,
          result,
        }, authOptions);
        results.push({ id: task.id, success: true, completed });
      } catch (err) {
        const completed = await completeMiniappTask(task.id, {
          success: false,
          hostDeviceId: hostDeviceId(),
          claimToken: task.claimToken,
          expectedRowVersion: task.row_version,
          result: { error: err.message },
        }, authOptions);
        results.push({ id: task.id, success: false, error: err.message, completed });
      }
    }
    res.json({ success: true, processed: results.length, results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.processMiniappTask = processMiniappTask;
module.exports.processClaimedV2Tasks = processClaimedV2Tasks;
module.exports.selectQuestions = selectQuestions;
module.exports.startSerialLeaseHeartbeat = startSerialLeaseHeartbeat;
module.exports.cleanupGeneratedTaskResult = cleanupGeneratedTaskResult;
