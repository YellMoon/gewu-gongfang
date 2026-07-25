'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writePaperArtifactInWorker } = require('./paperArtifactWorker');
const {
  unrecognizedExperienceQuestionById,
} = require('./unrecognizedExperienceData');

const TASK_TYPES = new Set(['question-paper', 'paper-export-word', 'paper-export-pdf']);
const ANSWER_POSITIONS = new Set(['end', 'after-each', 'hidden']);
const FORMULA_MODES = new Set(['word-native', 'eq-field', 'mathtype-compatible', 'latex-vector']);

function experienceError(code, statusCode, message = code) {
  return Object.assign(new Error(message), { code, statusCode });
}

function isXml10Text(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    const valid = codePoint === 0x9 || codePoint === 0xA || codePoint === 0xD
      || (codePoint >= 0x20 && codePoint <= 0xD7FF)
      || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
      || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
    if (!valid) return false;
  }
  return true;
}

function normalizedExperienceRequest(input = {}) {
  const taskType = String(input.taskType || '');
  if (!TASK_TYPES.has(taskType)) {
    throw experienceError('UNRECOGNIZED_EXPERIENCE_TASK_TYPE_INVALID', 400);
  }
  const rawTitle = String(input.title || '');
  if (!isXml10Text(rawTitle)) {
    throw experienceError('UNRECOGNIZED_EXPERIENCE_TITLE_INVALID', 400);
  }
  const title = rawTitle.normalize('NFC').trim();
  if (!title || title.length > 80) {
    throw experienceError('UNRECOGNIZED_EXPERIENCE_TITLE_INVALID', 400);
  }
  const requestedQuestionIds = Array.isArray(input.questionIds)
    ? input.questionIds.map(value => String(value || ''))
    : [];
  if (requestedQuestionIds.length < 1 || requestedQuestionIds.length > 4) {
    throw experienceError('UNRECOGNIZED_EXPERIENCE_QUESTION_COUNT_INVALID', 400);
  }
  const questionIds = Array.from(new Set(requestedQuestionIds));
  const questions = questionIds.map(unrecognizedExperienceQuestionById);
  if (questions.some(question => !question)) {
    throw experienceError('UNRECOGNIZED_EXPERIENCE_QUESTION_INVALID', 400);
  }
  const answerPosition = String(input.answerPosition || 'end');
  if (!ANSWER_POSITIONS.has(answerPosition)) {
    throw experienceError('UNRECOGNIZED_EXPERIENCE_ANSWER_POSITION_INVALID', 400);
  }
  const formulaMode = String(input.formulaMode || 'word-native');
  if (!FORMULA_MODES.has(formulaMode)) {
    throw experienceError('UNRECOGNIZED_EXPERIENCE_FORMULA_MODE_INVALID', 400);
  }
  return { taskType, title, questionIds, questions, answerPosition, formulaMode };
}

function answerDocument(answer) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: answer }] }],
  };
}

function exportQuestion(question) {
  return {
    id: question.id,
    type: question.type,
    rich_content: {
      version: 1,
      type: 'question-document',
      sections: {
        stem: question.stemRichContent,
        options: question.options.map(option => ({
          label: option.key,
          isCorrect: question.answer.includes(option.key),
          content: option.contentRichContent,
        })),
        subQuestions: [],
        answer: answerDocument(question.answer),
        analysis: question.explanationRichContent,
      },
    },
  };
}

function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function createDedicatedRoot(requestedRoot) {
  const root = requestedRoot
    ? path.resolve(requestedRoot)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-unrecognized-experience-'));
  if (requestedRoot) {
    fs.mkdirSync(root, { recursive: true });
    if (fs.readdirSync(root).length > 0) {
      throw experienceError('UNRECOGNIZED_EXPERIENCE_ROOT_NOT_EMPTY', 500);
    }
  }
  const marker = path.join(root, '.unrecognized-experience-root');
  const markerToken = crypto.randomUUID();
  fs.writeFileSync(marker, markerToken, { encoding: 'utf8', flag: 'wx' });
  return { root, marker, markerToken };
}

function createUnrecognizedExperienceSandbox(options = {}) {
  const now = options.now || Date.now;
  const ttlMs = Number(options.ttlMs ?? 30 * 60 * 1000);
  const maxTasks = Number(options.maxTasks ?? 50);
  const maxArtifactBytes = Number(options.maxArtifactBytes ?? 16 * 1024 * 1024);
  const maxConcurrentGenerations = Number(options.maxConcurrentGenerations ?? 2);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new RangeError('ttlMs must be a positive integer');
  if (!Number.isSafeInteger(maxTasks) || maxTasks < 1) throw new RangeError('maxTasks must be a positive integer');
  if (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes < 1) throw new RangeError('maxArtifactBytes must be a positive integer');
  if (!Number.isSafeInteger(maxConcurrentGenerations) || maxConcurrentGenerations < 1) {
    throw new RangeError('maxConcurrentGenerations must be a positive integer');
  }

  const dedicated = createDedicatedRoot(options.root);
  const root = dedicated.root;
  const exportsRoot = path.join(root, 'assets', 'exports');
  const tempRoot = path.join(root, 'assets', 'paper-job-temp');
  const writeArtifact = options.writeArtifact || writePaperArtifactInWorker;
  const tasks = new Map();
  const artifacts = new Map();
  const expiredTaskOwners = new Map();
  const expiredArtifactOwners = new Map();
  const generationWaiters = [];
  let activeGenerations = 0;
  let closed = false;

  function requireSession(sessionId) {
    const value = String(sessionId || '').trim();
    if (!value) throw experienceError('UNRECOGNIZED_EXPERIENCE_SESSION_REQUIRED', 401);
    return value;
  }

  function rememberExpired(map, id, ownerSessionId) {
    map.delete(id);
    map.set(id, ownerSessionId);
    while (map.size > maxTasks) map.delete(map.keys().next().value);
  }

  function artifactBytes() {
    return [...artifacts.values()].reduce((sum, artifact) => sum + Number(artifact.sizeBytes || 0), 0);
  }

  function removeArtifactFiles(filePath) {
    if (!filePath || !inside(exportsRoot, filePath)) return;
    for (const candidate of [filePath, `${filePath}.verified.json`, `${filePath}.normalized.docx`]) {
      if (inside(exportsRoot, candidate)) {
        try { fs.rmSync(candidate, { force: true }); } catch (_error) { /* best effort inside the dedicated root */ }
      }
    }
  }

  function removeTaskTemp(task) {
    const taskTemp = path.join(tempRoot, task.id);
    if (!inside(tempRoot, taskTemp)) return;
    try { fs.rmSync(taskTemp, { recursive: true, force: true }); } catch (_error) { /* best effort inside the dedicated root */ }
  }

  function clearTaskArtifact(task, artifact) {
    if (!task || !artifact) return;
    if (task.artifact === artifact || task.result?.artifactId === artifact.id) {
      task.artifact = null;
      task.result = {
        ...task.result,
        artifactId: null,
        fileName: null,
        mimeType: null,
        downloadPath: null,
      };
    }
  }

  function releaseArtifact(artifact, expired = false) {
    if (!artifact) return;
    artifacts.delete(artifact.id);
    if (expired) rememberExpired(expiredArtifactOwners, artifact.id, artifact.ownerSessionId);
    clearTaskArtifact(tasks.get(artifact.taskId), artifact);
    removeArtifactFiles(artifact.filePath);
  }

  function releaseTask(task, expired = false) {
    if (!task) return;
    task.released = true;
    task.abortController?.abort(experienceError('UNRECOGNIZED_EXPERIENCE_TASK_RELEASED', 410));
    if (task.artifact) releaseArtifact(task.artifact, expired);
    tasks.delete(task.id);
    if (expired) rememberExpired(expiredTaskOwners, task.id, task.ownerSessionId);
    if (task.promise && !task.settled) task.promise.finally(() => removeTaskTemp(task));
    else removeTaskTemp(task);
  }

  function cleanup() {
    const current = now();
    for (const task of [...tasks.values()]) {
      if (task.expiresAtMs <= current) releaseTask(task, true);
    }
    for (const artifact of [...artifacts.values()]) {
      if (artifact.expiresAtMs <= current) {
        const task = tasks.get(artifact.taskId);
        if (task) releaseTask(task, true);
        else releaseArtifact(artifact, true);
      }
    }
  }

  function acquireGenerationSlot(signal) {
    if (signal.aborted) return Promise.reject(signal.reason || experienceError('UNRECOGNIZED_EXPERIENCE_TASK_CANCELLED', 409));
    return new Promise((resolve, reject) => {
      let waiter = null;
      const start = () => {
        signal.removeEventListener('abort', onAbort);
        activeGenerations += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          activeGenerations -= 1;
          while (generationWaiters.length) {
            const next = generationWaiters.shift();
            if (!next.cancelled) { next.start(); break; }
          }
        });
      };
      const onAbort = () => {
        if (waiter) waiter.cancelled = true;
        reject(signal.reason || experienceError('UNRECOGNIZED_EXPERIENCE_TASK_CANCELLED', 409));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (activeGenerations < maxConcurrentGenerations) start();
      else {
        waiter = { start, cancelled: false };
        generationWaiters.push(waiter);
      }
    });
  }

  function taskPayload(request) {
    return {
      title: request.title,
      answerPosition: request.answerPosition,
      includeAnswers: request.answerPosition !== 'hidden',
      formulaMode: request.formulaMode,
    };
  }

  async function generate(task, request) {
    let releaseGenerationSlot = null;
    let rendered = null;
    try {
      releaseGenerationSlot = await acquireGenerationSlot(task.abortController.signal);
      if (task.released || task.status === 'cancelled') return task;
      task.status = 'running';
      task.phase = 'rendering';
      task.progress = 20;
      const word = request.taskType === 'paper-export-word';
      const extension = word ? 'docx' : 'pdf';
      const format = word ? 'word' : 'pdf';
      const finalFileName = `${task.id}.${extension}`;
      const snapshotHash = crypto.createHash('sha256')
        .update(JSON.stringify({ questionIds: request.questionIds, answerPosition: request.answerPosition, formulaMode: request.formulaMode }))
        .digest('hex');
      rendered = await writeArtifact(format, taskPayload(request), request.questions.map(exportQuestion), {
        root,
        tempDir: path.join(tempRoot, task.id),
        finalFileName,
        signal: task.abortController.signal,
        artifactIdentity: { artifactId: task.id, jobKey: task.id, snapshotHash },
        onProgress: event => {
          if (task.released || task.status === 'cancelled') return;
          task.phase = String(event?.phase || task.phase);
          const progress = { rendering: 35, validating: 65, finalizing: 85, completed: 95 }[task.phase];
          if (progress) task.progress = progress;
        },
      });
      if (task.released || task.status === 'cancelled' || task.abortController.signal.aborted) {
        removeArtifactFiles(rendered?.filePath);
        return task;
      }
      if (!rendered?.filePath || !inside(exportsRoot, rendered.filePath)) {
        throw experienceError('UNRECOGNIZED_EXPERIENCE_ARTIFACT_PATH_INVALID', 500);
      }
      const stat = fs.statSync(rendered.filePath);
      if (!stat.isFile()) throw experienceError('UNRECOGNIZED_EXPERIENCE_ARTIFACT_PATH_INVALID', 500);
      if (stat.size > maxArtifactBytes) {
        removeArtifactFiles(rendered.filePath);
        throw experienceError('UNRECOGNIZED_EXPERIENCE_ARTIFACT_TOO_LARGE', 413);
      }
      if (artifactBytes() + stat.size > maxArtifactBytes) {
        removeArtifactFiles(rendered.filePath);
        throw experienceError('UNRECOGNIZED_EXPERIENCE_ARTIFACT_CAPACITY_EXCEEDED', 429);
      }
      const artifact = {
        id: `experience-artifact-${crypto.randomUUID()}`,
        ownerSessionId: task.ownerSessionId,
        taskId: task.id,
        fileName: path.basename(rendered.fileName || rendered.filePath),
        filePath: rendered.filePath,
        mimeType: word
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/pdf',
        sizeBytes: stat.size,
        sha256: rendered.sha256 || null,
        pageCount: rendered.pageCount ?? null,
        formulaCount: Number(rendered.formulaCount || 0),
        fallbackCount: Number(rendered.fallbackCount || 0),
        effectiveFormulaModes: rendered.effectiveFormulaModes || [],
        expiresAtMs: task.expiresAtMs,
      };
      artifacts.set(artifact.id, artifact);
      task.artifact = artifact;
      task.status = 'completed';
      task.phase = 'completed';
      task.progress = 100;
      task.error = null;
      task.result = {
        questionCount: request.questions.length,
        questionIds: request.questionIds,
        artifactId: artifact.id,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        downloadPath: `/api/experience/artifacts/${artifact.id}`,
      };
      return task;
    } catch (error) {
      if (rendered?.filePath) removeArtifactFiles(rendered.filePath);
      if (task.released || task.status === 'cancelled' || task.abortController.signal.aborted || error?.code === 'ABORT_ERR') {
        task.status = 'cancelled';
        task.phase = 'cancelled';
        task.progress = 100;
        task.error = null;
      } else {
        task.status = 'failed';
        task.phase = 'failed';
        task.progress = 100;
        task.error = {
          code: error?.code || 'UNRECOGNIZED_EXPERIENCE_EXPORT_FAILED',
          message: error?.message || 'Experience export failed',
        };
      }
      return task;
    } finally {
      if (releaseGenerationSlot) releaseGenerationSlot();
      task.settled = true;
      removeTaskTemp(task);
    }
  }

  function create(sessionId, input) {
    if (closed) throw experienceError('UNRECOGNIZED_EXPERIENCE_SANDBOX_CLOSED', 503);
    cleanup();
    const ownerSessionId = requireSession(sessionId);
    const request = normalizedExperienceRequest(input);
    if (tasks.size >= maxTasks) throw experienceError('UNRECOGNIZED_EXPERIENCE_SANDBOX_BUSY', 429);
    const taskId = `experience-task-${crypto.randomUUID()}`;
    const expiresAtMs = now() + ttlMs;
    const task = {
      id: taskId,
      ownerSessionId,
      status: request.taskType === 'question-paper' ? 'completed' : 'queued',
      phase: request.taskType === 'question-paper' ? 'completed' : 'queued',
      progress: request.taskType === 'question-paper' ? 100 : 0,
      createdAt: new Date(now()).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
      request: {
        taskType: request.taskType,
        title: request.title,
        questionIds: request.questionIds,
        answerPosition: request.answerPosition,
        formulaMode: request.formulaMode,
      },
      result: {
        questionCount: request.questions.length,
        questionIds: request.questionIds,
        artifactId: null,
        fileName: null,
        mimeType: null,
        downloadPath: null,
      },
      error: null,
      artifact: null,
      abortController: new AbortController(),
      promise: null,
      settled: request.taskType === 'question-paper',
      released: false,
    };
    tasks.set(task.id, task);
    if (request.taskType !== 'question-paper') task.promise = generate(task, request);
    return task;
  }

  function getTask(sessionId, taskId) {
    cleanup();
    const ownerSessionId = requireSession(sessionId);
    const id = String(taskId || '');
    const task = tasks.get(id);
    if (!task) {
      if (expiredTaskOwners.get(id) === ownerSessionId) {
        throw experienceError('UNRECOGNIZED_EXPERIENCE_TASK_EXPIRED', 410);
      }
      throw experienceError('UNRECOGNIZED_EXPERIENCE_TASK_NOT_FOUND', 404);
    }
    if (task.ownerSessionId !== ownerSessionId) {
      throw experienceError('UNRECOGNIZED_EXPERIENCE_TASK_NOT_FOUND', 404);
    }
    return task;
  }

  async function waitForTask(sessionId, taskId) {
    const task = getTask(sessionId, taskId);
    if (task.promise) await task.promise;
    return task;
  }

  function getArtifact(sessionId, artifactId) {
    cleanup();
    const ownerSessionId = requireSession(sessionId);
    const id = String(artifactId || '');
    const artifact = artifacts.get(id);
    if (!artifact) {
      if (expiredArtifactOwners.get(id) === ownerSessionId) {
        throw experienceError('UNRECOGNIZED_EXPERIENCE_ARTIFACT_EXPIRED', 410);
      }
      throw experienceError('UNRECOGNIZED_EXPERIENCE_ARTIFACT_NOT_FOUND', 404);
    }
    if (artifact.ownerSessionId !== ownerSessionId) {
      throw experienceError('UNRECOGNIZED_EXPERIENCE_ARTIFACT_NOT_FOUND', 404);
    }
    if (!inside(exportsRoot, artifact.filePath) || !fs.existsSync(artifact.filePath)) {
      releaseArtifact(artifact);
      throw experienceError('UNRECOGNIZED_EXPERIENCE_ARTIFACT_NOT_FOUND', 404);
    }
    return artifact;
  }

  function cancel(sessionId, taskId) {
    const task = getTask(sessionId, taskId);
    task.status = 'cancelled';
    task.phase = 'cancelled';
    task.progress = 100;
    task.error = null;
    task.abortController.abort(experienceError('UNRECOGNIZED_EXPERIENCE_TASK_CANCELLED', 409));
    if (task.artifact) releaseArtifact(task.artifact);
    return task;
  }

  function stats() {
    cleanup();
    return {
      tasks: tasks.size,
      artifacts: artifacts.size,
      bytes: artifactBytes(),
      activeGenerations,
      queuedGenerations: generationWaiters.filter(waiter => !waiter.cancelled).length,
    };
  }

  async function close() {
    if (closed) return;
    closed = true;
    const pending = [];
    for (const task of [...tasks.values()]) {
      task.abortController.abort(experienceError('UNRECOGNIZED_EXPERIENCE_SANDBOX_CLOSED', 503));
      if (task.promise) pending.push(task.promise);
    }
    await Promise.allSettled(pending);
    for (const task of [...tasks.values()]) releaseTask(task);
    if (fs.existsSync(dedicated.marker)
      && fs.readFileSync(dedicated.marker, 'utf8') === dedicated.markerToken) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  return { cancel, close, create, getArtifact, getTask, root, stats, waitForTask };
}

module.exports = {
  ANSWER_POSITIONS,
  FORMULA_MODES,
  TASK_TYPES,
  createUnrecognizedExperienceSandbox,
  experienceError,
  normalizedExperienceRequest,
};
