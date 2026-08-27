'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cloudAcceptance = require('./real-cloud-business-acceptance');
const { sealForAgent } = require(fs.existsSync('/shared/encryptedNasRelay.js') ? '/shared/encryptedNasRelay' : '../shared/encryptedNasRelay');

const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

function failure(code) { return Object.assign(new Error(code), { code }); }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw failure('REAL_QUESTION_IMPORT_INPUT_INVALID');
  return value;
}

function importSource(sourceType, sourcePath) {
  if (!['exam', 'lecture'].includes(sourceType) || typeof sourcePath !== 'string' || !sourcePath.startsWith('/') || !/\.docx$/iu.test(sourcePath)) {
    throw failure('REAL_QUESTION_IMPORT_SOURCE_INVALID');
  }
  const sourceFileName = path.posix.basename(sourcePath);
  if (!sourceFileName || sourceFileName.length > 512) throw failure('REAL_QUESTION_IMPORT_SOURCE_INVALID');
  return Object.freeze({ sourceType, sourcePath, sourceFileName, sourceMimeType: WORD_MIME });
}

function taskEvidence(task) {
  if (!task || typeof task !== 'object' || !/^question_import_task_[A-Za-z0-9_-]{8,128}$/.test(task.taskId || '')
    || typeof task.status !== 'string' || typeof task.phase !== 'string') throw failure('REAL_QUESTION_IMPORT_TASK_INVALID');
  const items = Array.isArray(task.items) ? task.items : [];
  const acceptedOrWarningCount = items.filter(item => ['accepted', 'warning'].includes(item?.validation?.status)).length;
  return Object.freeze({ taskId: task.taskId, status: task.status, phase: task.phase, itemCount: items.length, acceptedOrWarningCount });
}

async function waitForCandidates({ read, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 36, intervalMs = 5000 } = {}) {
  if (typeof read !== 'function' || typeof sleep !== 'function' || !Number.isSafeInteger(attempts) || attempts < 1 || !Number.isSafeInteger(intervalMs) || intervalMs < 0) {
    throw failure('REAL_QUESTION_IMPORT_INPUT_INVALID');
  }
  for (let index = 0; index < attempts; index += 1) {
    const task = await read();
    const evidence = taskEvidence(task);
    if (evidence.status === 'candidates_ready' && evidence.itemCount > 0 && evidence.acceptedOrWarningCount > 0) return task;
    if (['failed', 'cancelled', 'quarantined'].includes(evidence.status)) throw failure('REAL_QUESTION_IMPORT_TASK_FAILED');
    if (index + 1 < attempts) await sleep(intervalMs);
  }
  throw failure('REAL_QUESTION_IMPORT_TASK_TIMEOUT');
}

function hash(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }

async function preflightPayload(request) {
  const { createQuestionImportTaskRepository } = require('/app/src/questionImportTaskRepository');
  const stop = failure('REAL_QUESTION_IMPORT_PREFLIGHT_COMPLETE');
  const repository = createQuestionImportTaskRepository({ query: async () => { throw stop; } });
  try {
    await repository.create({ tenantId: 'default', actor: { accountId: 'acceptance-preflight', roles: ['super_admin'] }, idempotencyKey: 'acceptance-preflight', request });
  } catch (error) {
    if (error === stop) return true;
    throw error;
  }
  throw failure('REAL_QUESTION_IMPORT_PREFLIGHT_INVALID');
}

async function request(fetchImpl, sessionToken, deviceId, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: { Accept: 'application/json', Authorization: `Bearer ${sessionToken}`, 'x-device-id': deviceId, ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) throw failure(`REAL_QUESTION_IMPORT_HTTP_${response.status}_${String(body?.code || 'UNKNOWN').replace(/[^A-Z0-9_]/g, '')}`);
  return body;
}

async function createWordImport({ fetchImpl, sessionToken, deviceId, baseUrl, source, idFactory = crypto.randomUUID }) {
  const bytes = fs.readFileSync(source.sourcePath);
  if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) throw failure('REAL_QUESTION_IMPORT_SOURCE_INVALID');
  const relayKey = await request(fetchImpl, sessionToken, deviceId, `${baseUrl}/api/desktop/question-imports/relay-key`);
  if (typeof relayKey.agentPublicKey !== 'string' || typeof relayKey.agentKeyFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(relayKey.agentKeyFingerprint)) {
    throw failure('REAL_QUESTION_IMPORT_RELAY_KEY_INVALID');
  }
  const suffix = String(idFactory()).replace(/[^A-Za-z0-9_-]/g, '');
  if (suffix.length < 8) throw failure('REAL_QUESTION_IMPORT_ID_INVALID');
  const storageTaskId = `task_${suffix}`;
  const objectId = `obj_${suffix}`;
  const sealed = sealForAgent({ agentPublicKey: relayKey.agentPublicKey, binding: `${storageTaskId}:${objectId}:1`, plaintext: bytes });
  const payload = {
    sourceType: source.sourceType, sourceFileName: source.sourceFileName, sourceMimeType: source.sourceMimeType,
    sourceSha256: sealed.envelope.plaintextSha256, sourceBytes: bytes.length,
    metadata: { sourceFileName: source.sourceFileName, acceptance: 'real-question-import-v1' },
    storage: { taskId: storageTaskId, objectId, objectVersion: 1 },
    relay: { agentKeyFingerprint: relayKey.agentKeyFingerprint, envelope: sealed.envelope, ciphertextBase64: sealed.ciphertext.toString('base64url'), expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() },
  };
  await preflightPayload({
    ...payload,
    relay: {
      agentKeyFingerprint: payload.relay.agentKeyFingerprint,
      envelope: payload.relay.envelope,
      ciphertext: sealed.ciphertext,
      expiresAt: payload.relay.expiresAt,
    },
  });
  const created = await request(fetchImpl, sessionToken, deviceId, `${baseUrl}/api/desktop/question-imports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-idempotency-key': `real-question-import-${source.sourceType}-${suffix}` },
    body: JSON.stringify(payload),
  });
  return created.task;
}

async function runFromEnvironment(env = process.env) {
  let stage = 'source-validation';
  let appPool;
  let writerPool;
  let registration = null;
  try {
    const exam = importSource('exam', env.REAL_QUESTION_IMPORT_EXAM_PATH || '/tmp/gewu-real-exam.docx');
    const lecture = importSource('lecture', env.REAL_QUESTION_IMPORT_LECTURE_PATH || '/tmp/gewu-real-lecture.docx');
    for (const source of [exam, lecture]) if (!fs.statSync(source.sourcePath).isFile()) throw failure('REAL_QUESTION_IMPORT_SOURCE_INVALID');
    stage = 'runtime-resolution';
    const runtimeModules = cloudAcceptance.resolveRuntimeModules(__dirname);
    const { Pool } = require(runtimeModules.pgPath);
    const { resolveRuntimeDatabaseUser } = require(path.join(path.dirname(runtimeModules.packagePath), 'src', 'runtimeDatabaseRole'));
    appPool = new Pool({ host: env.POSTGRES_HOST || '127.0.0.1', port: Number(env.POSTGRES_PORT || 5432), database: env.POSTGRES_DB || 'gewu_cloud', user: resolveRuntimeDatabaseUser(env.POSTGRES_USER), password: env.POSTGRES_PASSWORD });
    writerPool = new Pool({ host: env.POSTGRES_HOST || '127.0.0.1', port: Number(env.POSTGRES_PORT || 5432), database: env.POSTGRES_DB || 'gewu_cloud', user: 'vnext_pg17_writer', password: env.COMMAND_WRITER_POSTGRES_PASSWORD });
    stage = 'identity-loading';
    const loaded = await cloudAcceptance.loadActiveSuperAdminSession(appPool, writerPool, env.CLOUD_OPERATOR_PHONE_HMACS);
    stage = 'controlled-registration';
    registration = await cloudAcceptance.runOnlineRegistrationAcceptance({ fetchImpl: fetch, runtimeModules, ticketSecret: env.CLOUD_IDENTITY_TICKET_SECRET, identity: loaded.identity });
    const sessionToken = registration.sessionToken;
    const deviceId = registration.fixture.deviceId;
    const results = [];
    for (const source of [exam, lecture]) {
      stage = `create-${source.sourceType}`;
      const created = await createWordImport({ fetchImpl: fetch, sessionToken, deviceId, baseUrl: cloudAcceptance.PUBLIC_BASE_URL, source });
      stage = `parse-${source.sourceType}`;
      const ready = await waitForCandidates({
        read: async () => (await request(fetch, sessionToken, deviceId, `${cloudAcceptance.PUBLIC_BASE_URL}/api/desktop/question-imports/${encodeURIComponent(created.taskId)}`)).task,
      });
      stage = `prepare-${source.sourceType}`;
      const prepared = await request(fetch, sessionToken, deviceId, `${cloudAcceptance.PUBLIC_BASE_URL}/api/desktop/question-imports/${encodeURIComponent(created.taskId)}/prepare-drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      results.push(Object.freeze({ sourceType: source.sourceType, sourceFileNameSha256: hash(source.sourceFileName), ready: taskEvidence(ready), prepared: taskEvidence(prepared.task) }));
    }
    return Object.freeze({ ok: true, imports: results });
  } catch (error) {
    error.stage = error.stage || stage;
    throw error;
  } finally {
    if (registration?.fixture && writerPool) await cloudAcceptance.revokeOnlineRegistrationAcceptance(writerPool, registration.fixture);
    await Promise.allSettled([appPool?.end?.(), writerPool?.end?.()]);
  }
}

module.exports = Object.freeze({ importSource, taskEvidence, waitForCandidates, preflightPayload, createWordImport, runFromEnvironment });

if (require.main === module) runFromEnvironment()
  .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code || 'REAL_QUESTION_IMPORT_FAILED', stage: error?.stage || null })}\n`); process.exitCode = 1; });
