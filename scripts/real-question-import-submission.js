'use strict';

const crypto = require('crypto');
const path = require('path');
const { stableJson } = require('../shared/authorityProtocol');

function failure(code) { return Object.assign(new Error(code), { code }); }

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function questionTypeFromCandidate(value) {
  const values = Array.isArray(value) ? value : [value];
  const map = {
    single: '单选题', 'single-choice': '单选题', multi: '多选题', multiple: '多选题', 'multiple-choice': '多选题',
    experiment: '实验题', judge: '判断题', calculation: '解答题', problem: '解答题', fill: '解答题', short: '解答题', drawing: '解答题',
  };
  for (const item of values) {
    const raw = text(item);
    if (['单选题', '多选题', '实验题', '解答题', '判断题'].includes(raw)) return raw;
    const mapped = map[raw.toLowerCase().replace(/[\s_]+/g, '-')];
    if (mapped) return mapped;
  }
  return '解答题';
}

function requirePreparedItem(value) {
  if (!plainObject(value) || typeof value.itemId !== 'string' || !/^question_import_item_[A-Za-z0-9_-]{1,128}$/.test(value.itemId)
    || !Number.isSafeInteger(value.itemIndex) || value.itemIndex < 0 || typeof value.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.contentHash)
    || !plainObject(value.candidate)) throw failure('REAL_QUESTION_IMPORT_SUBMISSION_INPUT_INVALID');
  return value;
}

function recordFromPreparedItem({ taskId, item, subject = '物理' } = {}) {
  if (typeof taskId !== 'string' || !/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(taskId) || text(subject) !== subject) {
    throw failure('REAL_QUESTION_IMPORT_SUBMISSION_INPUT_INVALID');
  }
  const prepared = requirePreparedItem(item);
  const candidate = prepared.candidate;
  const content = text(candidate.stem || candidate.content);
  if (!content) throw failure('REAL_QUESTION_IMPORT_SUBMISSION_CONTENT_INVALID');
  const answer = text(candidate.answer) || null;
  const analysis = text(candidate.analysis || candidate.explanation) || null;
  const richContent = plainObject(candidate.rich_content) ? candidate.rich_content : null;
  return {
    id: `question-import-${prepared.contentHash.slice(0, 40)}`,
    subject, type: questionTypeFromCandidate(candidate.question_types || candidate.type), difficulty: 3, content,
    options: Array.isArray(candidate.options) ? candidate.options : [], answer, analysis, rich_content: richContent,
    knowledge_point_ids: [], model_point_ids: [], taxonomy_ids: {}, has_formula: Boolean(candidate.has_formula),
    import_task_id: taskId, import_item_id: prepared.itemId, import_item_index: prepared.itemIndex, import_content_hash: prepared.contentHash,
  };
}

function questionCommand({ taskId, item, subject } = {}) {
  const record = recordFromPreparedItem({ taskId, item, subject });
  const type = 'question.create.v1';
  const payload = { record };
  return {
    commandId: `question-import-${record.import_content_hash.slice(0, 48)}`,
    payloadHash: crypto.createHash('sha256').update(stableJson({ type, payload }), 'utf8').digest('hex'),
    type, payload,
  };
}

async function request(fetchImpl, sessionToken, deviceId, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: { Accept: 'application/json', Authorization: `Bearer ${sessionToken}`, 'x-device-id': deviceId, ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) throw failure(`REAL_QUESTION_IMPORT_SUBMISSION_HTTP_${response.status}_${String(body?.code || 'UNKNOWN').replace(/[^A-Z0-9_]/g, '')}`);
  return body;
}

function taskForSubmission(task, taskId) {
  if (!plainObject(task) || task.taskId !== taskId || !Array.isArray(task.items)) throw failure('REAL_QUESTION_IMPORT_SUBMISSION_TASK_INVALID');
  if (task.status === 'submitted') return { task, pending: [], alreadySubmittedCount: task.items.filter(item => item?.status === 'submitted').length };
  if (task.status !== 'drafts_prepared') throw failure('REAL_QUESTION_IMPORT_SUBMISSION_NOT_READY');
  const pending = task.items.filter(item => item?.status === 'draft_prepared');
  if (!pending.length || task.items.some(item => !['draft_prepared', 'submitted'].includes(item?.status))) throw failure('REAL_QUESTION_IMPORT_SUBMISSION_NOT_READY');
  return { task, pending, alreadySubmittedCount: task.items.length - pending.length };
}

function commandsForPreparedTask({ task, taskId, subject = '物理' } = {}) {
  const work = taskForSubmission(task, taskId);
  return { ...work, commands: work.pending.map(item => questionCommand({ taskId, item, subject })) };
}

async function submitPreparedTask({ fetchImpl, sessionToken, deviceId, baseUrl, taskId, subject = '物理' } = {}) {
  if (typeof fetchImpl !== 'function' || typeof sessionToken !== 'string' || !sessionToken || typeof deviceId !== 'string' || !deviceId
    || typeof baseUrl !== 'string' || !/^https:\/\/[A-Za-z0-9.-]+(?:\/[^?#]*)?$/u.test(baseUrl) || typeof taskId !== 'string') {
    throw failure('REAL_QUESTION_IMPORT_SUBMISSION_INPUT_INVALID');
  }
  const taskUrl = `${baseUrl.replace(/\/$/, '')}/api/desktop/question-imports/${encodeURIComponent(taskId)}`;
  const initial = await request(fetchImpl, sessionToken, deviceId, taskUrl);
  const work = commandsForPreparedTask({ task: initial.task, taskId, subject });
  for (const command of work.commands) {
    await request(fetchImpl, sessionToken, deviceId, `${baseUrl.replace(/\/$/, '')}/api/desktop/question-bank/commands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
    });
  }
  const completed = await request(fetchImpl, sessionToken, deviceId, taskUrl);
  if (completed?.task?.status !== 'submitted') throw failure('REAL_QUESTION_IMPORT_SUBMISSION_INCOMPLETE');
  return { taskId, submittedCount: work.pending.length, alreadySubmittedCount: work.alreadySubmittedCount, status: 'submitted' };
}

async function assertMediaVerified(pool, taskId) {
  const result = await pool.query(
    "SELECT count(*)::integer AS total,count(*) FILTER (WHERE storage_state='verified')::integer AS verified FROM business.question_import_media_objects WHERE import_task_id=$1",
    [taskId],
  );
  const row = result?.rows?.[0] || {};
  const total = Number(row.total);
  const verified = Number(row.verified);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(verified) || total !== verified) throw failure('REAL_QUESTION_IMPORT_MEDIA_NOT_READY');
  return { total, verified };
}

async function runFromEnvironment(env = process.env) {
  const cloudAcceptance = require('./real-cloud-business-acceptance');
  const taskIds = [env.REAL_QUESTION_IMPORT_EXAM_TASK_ID, env.REAL_QUESTION_IMPORT_LECTURE_TASK_ID];
  if (taskIds.some(taskId => typeof taskId !== 'string' || !/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(taskId))) throw failure('REAL_QUESTION_IMPORT_SUBMISSION_INPUT_INVALID');
  const runtimeModules = cloudAcceptance.resolveRuntimeModules(__dirname);
  const { Pool } = require(runtimeModules.pgPath);
  const { resolveRuntimeDatabaseUser } = require(path.join(path.dirname(runtimeModules.packagePath), 'src', 'runtimeDatabaseRole'));
  const appPool = new Pool({ host: env.POSTGRES_HOST || '127.0.0.1', port: Number(env.POSTGRES_PORT || 5432), database: env.POSTGRES_DB || 'gewu_cloud', user: resolveRuntimeDatabaseUser(env.POSTGRES_USER), password: env.POSTGRES_PASSWORD });
  const writerPool = new Pool({ host: env.POSTGRES_HOST || '127.0.0.1', port: Number(env.POSTGRES_PORT || 5432), database: env.POSTGRES_DB || 'gewu_cloud', user: 'vnext_pg17_writer', password: env.COMMAND_WRITER_POSTGRES_PASSWORD });
  let registration = null;
  try {
    const loaded = await cloudAcceptance.loadActiveSuperAdminSession(appPool, writerPool, env.CLOUD_OPERATOR_PHONE_HMACS);
    for (const taskId of taskIds) await assertMediaVerified(appPool, taskId);
    registration = await cloudAcceptance.runOnlineRegistrationAcceptance({ fetchImpl: fetch, runtimeModules, ticketSecret: env.CLOUD_IDENTITY_TICKET_SECRET, identity: loaded.identity });
    const results = [];
    for (const taskId of taskIds) results.push(await submitPreparedTask({ fetchImpl: fetch, sessionToken: registration.sessionToken, deviceId: registration.fixture.deviceId, baseUrl: cloudAcceptance.PUBLIC_BASE_URL, taskId }));
    return { ok: true, imports: results };
  } finally {
    if (registration?.fixture) await cloudAcceptance.revokeOnlineRegistrationAcceptance(writerPool, registration.fixture);
    await Promise.allSettled([appPool.end(), writerPool.end()]);
  }
}

module.exports = Object.freeze({ questionTypeFromCandidate, recordFromPreparedItem, questionCommand, taskForSubmission, commandsForPreparedTask, submitPreparedTask, assertMediaVerified, runFromEnvironment });

if (require.main === module) runFromEnvironment()
  .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code || 'REAL_QUESTION_IMPORT_SUBMISSION_FAILED' })}\n`); process.exitCode = 1; });
