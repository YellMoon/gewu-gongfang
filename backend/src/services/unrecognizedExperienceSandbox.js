'use strict';

const crypto = require('crypto');
const { unrecognizedExperienceQuestionById } = require('./unrecognizedExperienceData');

const TASK_TYPE = 'question-paper';

function experienceError(code, statusCode, message = code) {
  return Object.assign(new Error(message), { code, statusCode });
}

function normalizedExperienceRequest(input = {}) {
  if (String(input.taskType || '') !== TASK_TYPE) throw experienceError('UNRECOGNIZED_EXPERIENCE_TASK_TYPE_INVALID', 400);
  const title = String(input.title || '').normalize('NFC').trim();
  if (!title || title.length > 80) throw experienceError('UNRECOGNIZED_EXPERIENCE_TITLE_INVALID', 400);
  const questionIds = Array.isArray(input.questionIds) ? [...new Set(input.questionIds.map(value => String(value || '')))] : [];
  if (questionIds.length < 1 || questionIds.length > 4) throw experienceError('UNRECOGNIZED_EXPERIENCE_QUESTION_COUNT_INVALID', 400);
  const questions = questionIds.map(unrecognizedExperienceQuestionById);
  if (questions.some(question => !question)) throw experienceError('UNRECOGNIZED_EXPERIENCE_QUESTION_INVALID', 400);
  return { title, questionIds, questions };
}

function createUnrecognizedExperienceSandbox(options = {}) {
  const now = options.now || Date.now;
  const ttlMs = Number(options.ttlMs ?? 30 * 60 * 1000);
  const maxTasks = Number(options.maxTasks ?? 50);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new RangeError('ttlMs must be a positive integer');
  if (!Number.isSafeInteger(maxTasks) || maxTasks < 1) throw new RangeError('maxTasks must be a positive integer');
  const tasks = new Map();
  const expiredOwners = new Map();
  let closed = false;

  function requireSession(sessionId) {
    const value = String(sessionId || '').trim();
    if (!value) throw experienceError('UNRECOGNIZED_EXPERIENCE_SESSION_REQUIRED', 401);
    return value;
  }

  function cleanup() {
    const current = now();
    for (const [id, task] of tasks) {
      if (task.expiresAtMs <= current) {
        tasks.delete(id);
        expiredOwners.set(id, task.ownerSessionId);
      }
    }
    while (expiredOwners.size > maxTasks) expiredOwners.delete(expiredOwners.keys().next().value);
  }

  function create(sessionId, input) {
    if (closed) throw experienceError('UNRECOGNIZED_EXPERIENCE_SANDBOX_CLOSED', 503);
    cleanup();
    if (tasks.size >= maxTasks) throw experienceError('UNRECOGNIZED_EXPERIENCE_SANDBOX_BUSY', 429);
    const ownerSessionId = requireSession(sessionId);
    const request = normalizedExperienceRequest(input);
    const expiresAtMs = now() + ttlMs;
    const task = {
      id: `experience-task-${crypto.randomUUID()}`,
      ownerSessionId,
      status: 'completed', phase: 'completed', progress: 100,
      createdAt: new Date(now()).toISOString(), expiresAt: new Date(expiresAtMs).toISOString(), expiresAtMs,
      request: { taskType: TASK_TYPE, title: request.title, questionIds: request.questionIds },
      result: {
        questionCount: request.questions.length,
        questionIds: request.questionIds,
        questions: request.questions.map(question => ({ id: question.id, type: question.type, stemRichContent: question.stemRichContent })),
      },
      error: null,
    };
    tasks.set(task.id, task);
    return task;
  }

  function getTask(sessionId, taskId) {
    cleanup();
    const ownerSessionId = requireSession(sessionId);
    const id = String(taskId || '');
    const task = tasks.get(id);
    if (!task) {
      if (expiredOwners.get(id) === ownerSessionId) throw experienceError('UNRECOGNIZED_EXPERIENCE_TASK_EXPIRED', 410);
      throw experienceError('UNRECOGNIZED_EXPERIENCE_TASK_NOT_FOUND', 404);
    }
    if (task.ownerSessionId !== ownerSessionId) throw experienceError('UNRECOGNIZED_EXPERIENCE_TASK_NOT_FOUND', 404);
    return task;
  }

  function cancel(sessionId, taskId) {
    const task = getTask(sessionId, taskId);
    task.status = 'cancelled';
    task.phase = 'cancelled';
    task.progress = 100;
    return task;
  }

  return Object.freeze({
    create,
    getTask,
    async waitForTask(sessionId, taskId) { return getTask(sessionId, taskId); },
    cancel,
    stats() { cleanup(); return { tasks: tasks.size, artifacts: 0, bytes: 0, activeGenerations: 0, queuedGenerations: 0 }; },
    async close() { closed = true; tasks.clear(); expiredOwners.clear(); },
  });
}

module.exports = Object.freeze({ createUnrecognizedExperienceSandbox, experienceError, normalizedExperienceRequest });
