'use strict';

// Runs inside the cloud API container. It publishes only two explicitly named
// imported samples through the normal desktop question command endpoint.
const crypto = require('crypto');
const path = require('path');
const { stableJson } = require('../shared/authorityProtocol');

function failure(code) { return Object.assign(new Error(code), { code }); }

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function importedQuestionIds(task) {
  if (!plainObject(task) || !Array.isArray(task.items)) throw failure('REAL_QUESTION_IMPORT_PUBLISH_TASK_INVALID');
  return task.items.map(item => {
    if (!plainObject(item) || typeof item.contentHash !== 'string' || !/^[0-9a-f]{64}$/u.test(item.contentHash)) {
      throw failure('REAL_QUESTION_IMPORT_PUBLISH_TASK_INVALID');
    }
    return `question-import-${item.contentHash.slice(0, 40)}`;
  });
}

function changesForPublishedQuestion(question) {
  if (!plainObject(question) || typeof question.id !== 'string' || !question.id
    || typeof question.subject !== 'string' || !question.subject || typeof question.type !== 'string' || !question.type
    || !Number.isSafeInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > 5
    || typeof question.content !== 'string' || !question.content || !Array.isArray(question.options)
    || !(question.answer === null || typeof question.answer === 'string') || !(question.analysis === null || typeof question.analysis === 'string')
    || !(question.rich_content === null || plainObject(question.rich_content)) || !Array.isArray(question.knowledge_point_ids)
    || !Array.isArray(question.model_point_ids) || !plainObject(question.taxonomy_ids) || typeof question.has_formula !== 'boolean') {
    throw failure('REAL_QUESTION_IMPORT_PUBLISH_QUESTION_INVALID');
  }
  return {
    subject: question.subject, type: question.type, difficulty: question.difficulty, content: question.content,
    options: question.options, answer: question.answer, analysis: question.analysis, rich_content: question.rich_content,
    knowledge_point_ids: question.knowledge_point_ids, model_point_ids: question.model_point_ids,
    taxonomy_ids: question.taxonomy_ids, has_formula: question.has_formula, status: 'published',
  };
}

function questionPublishCommand(question) {
  const changes = changesForPublishedQuestion(question);
  const type = 'question.update.v1';
  const payload = { id: question.id, changes };
  return {
    commandId: `question-publish-${crypto.createHash('sha256').update(question.id, 'utf8').digest('hex').slice(0, 40)}`,
    payloadHash: crypto.createHash('sha256').update(stableJson({ type, payload }), 'utf8').digest('hex'),
    type,
    payload,
  };
}

async function request(fetchImpl, sessionToken, deviceId, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: { Accept: 'application/json', Authorization: `Bearer ${sessionToken}`, 'x-device-id': deviceId, ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) throw failure(`REAL_QUESTION_IMPORT_PUBLISH_HTTP_${response.status}_${String(body?.code || 'UNKNOWN').replace(/[^A-Z0-9_]/g, '')}`);
  return body;
}

async function publishImportedSamples({ fetchImpl, sessionToken, deviceId, baseUrl, taskIds }) {
  if (typeof fetchImpl !== 'function' || typeof sessionToken !== 'string' || !sessionToken || typeof deviceId !== 'string' || !deviceId
    || typeof baseUrl !== 'string' || !Array.isArray(taskIds) || taskIds.length !== 2) throw failure('REAL_QUESTION_IMPORT_PUBLISH_INPUT_INVALID');
  const root = baseUrl.replace(/\/$/, '');
  const desiredIds = [];
  for (const taskId of taskIds) {
    const taskBody = await request(fetchImpl, sessionToken, deviceId, `${root}/api/desktop/question-imports/${encodeURIComponent(taskId)}`);
    const ids = importedQuestionIds(taskBody.task);
    if (!ids.length) throw failure('REAL_QUESTION_IMPORT_PUBLISH_TASK_INVALID');
    desiredIds.push(ids[0]);
  }
  const listed = await request(fetchImpl, sessionToken, deviceId, `${root}/api/desktop/question-bank/questions?limit=200`);
  if (!Array.isArray(listed.questions)) throw failure('REAL_QUESTION_IMPORT_PUBLISH_LIST_INVALID');
  const selected = desiredIds.map(id => listed.questions.find(question => question?.id === id));
  if (selected.some(question => !question)) throw failure('REAL_QUESTION_IMPORT_PUBLISH_NOT_FOUND');
  for (const question of selected) {
    if (question.status !== 'published') {
      await request(fetchImpl, sessionToken, deviceId, `${root}/api/desktop/question-bank/commands`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(questionPublishCommand(question)),
      });
    }
  }
  const confirmed = await request(fetchImpl, sessionToken, deviceId, `${root}/api/desktop/question-bank/questions?limit=200`);
  const published = desiredIds.map(id => confirmed.questions?.find(question => question?.id === id));
  if (published.some(question => !question || question.status !== 'published')) throw failure('REAL_QUESTION_IMPORT_PUBLISH_INCOMPLETE');
  return { questionIds: desiredIds, publishedCount: published.length };
}

async function runFromEnvironment(env = process.env) {
  const cloudAcceptance = require('./real-cloud-business-acceptance');
  const taskIds = [env.REAL_QUESTION_IMPORT_EXAM_TASK_ID, env.REAL_QUESTION_IMPORT_LECTURE_TASK_ID];
  if (taskIds.some(taskId => typeof taskId !== 'string' || !/^question_import_task_[A-Za-z0-9_-]{1,128}$/u.test(taskId))) {
    throw failure('REAL_QUESTION_IMPORT_PUBLISH_INPUT_INVALID');
  }
  const runtimeModules = cloudAcceptance.resolveRuntimeModules(__dirname);
  const { Pool } = require(runtimeModules.pgPath);
  const { resolveRuntimeDatabaseUser } = require(path.join(path.dirname(runtimeModules.packagePath), 'src', 'runtimeDatabaseRole'));
  const appPool = new Pool({ host: env.POSTGRES_HOST || '127.0.0.1', port: Number(env.POSTGRES_PORT || 5432), database: env.POSTGRES_DB || 'gewu_cloud', user: resolveRuntimeDatabaseUser(env.POSTGRES_USER), password: env.POSTGRES_PASSWORD });
  const writerPool = new Pool({ host: env.POSTGRES_HOST || '127.0.0.1', port: Number(env.POSTGRES_PORT || 5432), database: env.POSTGRES_DB || 'gewu_cloud', user: 'vnext_pg17_writer', password: env.COMMAND_WRITER_POSTGRES_PASSWORD });
  let registration = null;
  try {
    const loaded = await cloudAcceptance.loadActiveSuperAdminSession(appPool, writerPool, env.CLOUD_OPERATOR_PHONE_HMACS);
    registration = await cloudAcceptance.runOnlineRegistrationAcceptance({ fetchImpl: fetch, runtimeModules, ticketSecret: env.CLOUD_IDENTITY_TICKET_SECRET, identity: loaded.identity });
    const result = await publishImportedSamples({
      fetchImpl: fetch, sessionToken: registration.sessionToken, deviceId: registration.fixture.deviceId,
      baseUrl: cloudAcceptance.PUBLIC_BASE_URL, taskIds,
    });
    return { ok: true, ...result };
  } finally {
    if (registration?.fixture) await cloudAcceptance.revokeOnlineRegistrationAcceptance(writerPool, registration.fixture);
    await Promise.allSettled([appPool.end(), writerPool.end()]);
  }
}

module.exports = Object.freeze({ importedQuestionIds, changesForPublishedQuestion, questionPublishCommand, publishImportedSamples, runFromEnvironment });

if (require.main === module) runFromEnvironment()
  .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code || 'REAL_QUESTION_IMPORT_PUBLISH_FAILED' })}\n`); process.exitCode = 1; });
