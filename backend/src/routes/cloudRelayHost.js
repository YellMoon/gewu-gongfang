const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { getInstance } = require('../database');
const {
  publishHeartbeat,
  publishSnapshot,
  fetchPendingTasks,
  completeMiniappTask,
} = require('../services/cloudRelayClient');
const questionBank = require('../services/questionBankService');
const { resolveQuestionAssetPath } = require('../services/questionBankStorageService');
const { updateCommittedQuestion, createTrustedInternalStorageUpdateContext } = require('../services/questionBankStorageService');
const { writePaperArtifact } = require('../services/paperArtifactService');
const { verifyRelayAssertion } = require('../services/relayAssertionService');

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
  const tenantId = payload.tenantId || payload.tenant_id || 'default';
  const limit = Math.max(1, Math.min(Number(payload.questionCount || payload.count || 20) || 20, 100));
  const filters = {
    subject: payload.subject || undefined,
    type: payload.type || undefined,
    difficulty: payload.difficulty || undefined,
    status: payload.status || 'published',
  };
  const rows = questionBank.listQuestions(db.db || db, filters, tenantId);
  return rows.slice(0, limit);
}

async function processMiniappTask(task, db) {
  const payload = task.payload || {};
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
    const questions = selectQuestions(db, payload);
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
    const questions = selectQuestions(db, payload);
    const artifact = await writePaperArtifact('word', payload, questions, {
      root: exportRoot(),
      deviceId: hostDeviceId(),
    });
    return {
      taskType: task.task_type,
      format: 'word',
      title: payload.title || '练习试卷',
      subject: payload.subject || '',
      questionCount: questions.length,
      fileName: artifact.fileName,
      fileUrl: artifact.fileUrl,
      requestedFormulaMode: artifact.requestedFormulaMode,
      effectiveFormulaModes: artifact.effectiveFormulaModes,
      fallbackCount: artifact.fallbackCount,
      formulaCount: artifact.formulaCount,
      questions: questions.map(question => ({ id: question.id, stem: question.stem })),
    };
  }

  if (task.task_type === 'paper-export-pdf') {
    const questions = selectQuestions(db, payload);
    const artifact = await writePaperArtifact('pdf', payload, questions, {
      root: exportRoot(),
      deviceId: hostDeviceId(),
    });
    return {
      taskType: task.task_type,
      format: 'pdf',
      title: payload.title || '练习试卷',
      subject: payload.subject || '',
      questionCount: questions.length,
      fileName: artifact.fileName,
      fileUrl: artifact.fileUrl,
      requestedFormulaMode: artifact.requestedFormulaMode,
      effectiveFormulaModes: artifact.effectiveFormulaModes,
      fallbackCount: artifact.fallbackCount,
      formulaCount: artifact.formulaCount,
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
    const result = await fetchPendingTasks(authOptionsFromRequest(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/artifacts/:fileName', (req, res, next) => {
  try {
    const root = exportRoot();
    const fileName = path.basename(req.params.fileName);
    const filePath = resolveQuestionAssetPath(root, 'exports', fileName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'artifact not found' });
    return res.download(filePath, fileName);
  } catch (err) {
    next(err);
  }
});

router.post('/tasks/process', async (req, res, next) => {
  try {
    const db = getInstance();
    const authOptions = authOptionsFromRequest(req);
    const pending = await fetchPendingTasks(authOptions);
    if (!pending.success) return res.json(pending);
    const tasks = pending.tasks || [];
    const results = [];
    for (const task of tasks) {
      try {
        const result = await processMiniappTask(task, db);
        const completed = await completeMiniappTask(task.id, {
          success: true,
          hostDeviceId: hostDeviceId(),
          result,
        }, authOptions);
        results.push({ id: task.id, success: true, completed });
      } catch (err) {
        const completed = await completeMiniappTask(task.id, {
          success: false,
          hostDeviceId: hostDeviceId(),
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
