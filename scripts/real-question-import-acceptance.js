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

function parserRevision(value) {
  const current = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(current)) throw failure('REAL_QUESTION_IMPORT_PARSER_REVISION_INVALID');
  return current;
}

function sourceFileEvidence(source) {
  const bytes = fs.readFileSync(source.sourcePath);
  if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) throw failure('REAL_QUESTION_IMPORT_SOURCE_INVALID');
  return Object.freeze({ bytes, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'), sourceBytes: bytes.length });
}

function importIdempotencyKey(sourceType, sourceSha256, parserSha256) {
  if (!['exam', 'lecture'].includes(sourceType) || !/^[0-9a-f]{64}$/u.test(String(sourceSha256 || ''))) {
    throw failure('REAL_QUESTION_IMPORT_SOURCE_INVALID');
  }
  return `real-question-import-v2-${sourceType}-${sourceSha256}-${parserRevision(parserSha256)}`;
}

async function findReusableImport({ query, tenantId = 'default', accountId, sourceType, sourceSha256, sourceBytes, parserSha256 } = {}) {
  const tenant = String(tenantId || '').trim();
  const account = String(accountId || '').trim();
  const revision = parserRevision(parserSha256);
  if (typeof query !== 'function' || !tenant || !account || !['exam', 'lecture'].includes(sourceType)
    || !/^[0-9a-f]{64}$/u.test(String(sourceSha256 || '')) || !Number.isSafeInteger(sourceBytes) || sourceBytes < 1) {
    throw failure('REAL_QUESTION_IMPORT_INPUT_INVALID');
  }
  const result = await query(
    `SELECT task.task_id AS "taskId",task.status,task.phase,
            count(item.item_id)::int AS "itemCount",
            count(item.item_id) FILTER (WHERE item.validation_json->>'status' IN ('accepted','warning'))::int AS "acceptedOrWarningCount"
       FROM business.question_import_tasks task
       LEFT JOIN business.question_import_items item ON item.import_task_id=task.task_id
      WHERE task.tenant_id=$1 AND task.account_id=$2 AND task.source_type=$3
        AND task.source_sha256=$4 AND task.source_size_bytes=$5
        AND task.metadata_json->>'acceptance'='real-question-import-v2'
        AND task.metadata_json->>'parserSha256'=$6
      GROUP BY task.task_id,task.status,task.phase,task.created_at
      ORDER BY task.created_at DESC,task.task_id DESC LIMIT 2`,
    [tenant, account, sourceType, sourceSha256, sourceBytes, revision],
  );
  const rows = Array.isArray(result?.rows) ? result.rows : null;
  if (!rows) throw failure('REAL_QUESTION_IMPORT_REUSE_UNAVAILABLE');
  if (rows.length > 1) throw failure('REAL_QUESTION_IMPORT_DUPLICATE_REVISION');
  if (rows.length === 0) return null;
  const row = rows[0];
  if (!row || !/^question_import_task_[A-Za-z0-9_-]{8,128}$/u.test(row.taskId || '')
    || !['awaiting_source_storage', 'queued_for_parse', 'parsing', 'candidates_ready', 'drafts_prepared', 'submitted', 'failed', 'cancelled', 'quarantined'].includes(row.status)
    || typeof row.phase !== 'string' || !Number.isSafeInteger(row.itemCount) || row.itemCount < 0
    || !Number.isSafeInteger(row.acceptedOrWarningCount) || row.acceptedOrWarningCount < 0 || row.acceptedOrWarningCount > row.itemCount) {
    throw failure('REAL_QUESTION_IMPORT_REUSE_UNAVAILABLE');
  }
  if (['failed', 'cancelled', 'quarantined'].includes(row.status)) throw failure('REAL_QUESTION_IMPORT_FAILED_REVISION');
  if (['candidates_ready', 'drafts_prepared', 'submitted'].includes(row.status)
    && (row.itemCount < 1 || row.acceptedOrWarningCount < 1)) throw failure('REAL_QUESTION_IMPORT_REUSE_UNAVAILABLE');
  return Object.freeze({
    taskId: row.taskId, status: row.status, phase: row.phase,
    itemCount: row.itemCount, acceptedOrWarningCount: row.acceptedOrWarningCount,
  });
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

function acceptanceBaseUrl(env = process.env) {
  const value = String(env.REAL_QUESTION_IMPORT_BASE_URL || cloudAcceptance.PUBLIC_BASE_URL).replace(/\/$/u, '');
  if (![cloudAcceptance.PUBLIC_BASE_URL, 'http://127.0.0.1:3002'].includes(value)) {
    throw failure('REAL_QUESTION_IMPORT_BASE_URL_INVALID');
  }
  return value;
}

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

async function createWordImport({
  fetchImpl, sessionToken, deviceId, baseUrl, source, parserSha256,
  sourceEvidence: suppliedSourceEvidence = null,
  idFactory = crypto.randomUUID, now = () => new Date(), sealer = sealForAgent, preflight = preflightPayload,
}) {
  if (typeof idFactory !== 'function' || typeof now !== 'function' || typeof sealer !== 'function' || typeof preflight !== 'function') {
    throw failure('REAL_QUESTION_IMPORT_INPUT_INVALID');
  }
  const revision = parserRevision(parserSha256);
  const sourceEvidence = suppliedSourceEvidence || sourceFileEvidence(source);
  if (!sourceEvidence || !Buffer.isBuffer(sourceEvidence.bytes) || !Number.isSafeInteger(sourceEvidence.sourceBytes)
    || sourceEvidence.sourceBytes !== sourceEvidence.bytes.length || !/^[0-9a-f]{64}$/u.test(sourceEvidence.sourceSha256 || '')
    || crypto.createHash('sha256').update(sourceEvidence.bytes).digest('hex') !== sourceEvidence.sourceSha256) {
    throw failure('REAL_QUESTION_IMPORT_SOURCE_INVALID');
  }
  const bytes = sourceEvidence.bytes;
  const relayKey = await request(fetchImpl, sessionToken, deviceId, `${baseUrl}/api/desktop/question-imports/relay-key`);
  if (typeof relayKey.agentPublicKey !== 'string' || typeof relayKey.agentKeyFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(relayKey.agentKeyFingerprint)) {
    throw failure('REAL_QUESTION_IMPORT_RELAY_KEY_INVALID');
  }
  const suffix = String(idFactory()).replace(/[^A-Za-z0-9_-]/g, '');
  if (suffix.length < 8) throw failure('REAL_QUESTION_IMPORT_ID_INVALID');
  const storageTaskId = `task_${suffix}`;
  const objectId = `obj_${suffix}`;
  const sealed = sealer({ agentPublicKey: relayKey.agentPublicKey, binding: `${storageTaskId}:${objectId}:1`, plaintext: bytes });
  if (!sealed || !sealed.envelope || !Buffer.isBuffer(sealed.ciphertext)
    || sealed.envelope.plaintextSha256 !== sourceEvidence.sourceSha256 || sealed.envelope.plaintextBytes !== sourceEvidence.sourceBytes) {
    throw failure('REAL_QUESTION_IMPORT_RELAY_PAYLOAD_INVALID');
  }
  const current = now();
  if (!(current instanceof Date) || !Number.isFinite(current.getTime())) throw failure('REAL_QUESTION_IMPORT_INPUT_INVALID');
  const payload = {
    sourceType: source.sourceType, sourceFileName: source.sourceFileName, sourceMimeType: source.sourceMimeType,
    sourceSha256: sourceEvidence.sourceSha256, sourceBytes: sourceEvidence.sourceBytes,
    metadata: { sourceFileName: source.sourceFileName, acceptance: 'real-question-import-v2', parserSha256: revision },
    storage: { taskId: storageTaskId, objectId, objectVersion: 1 },
    relay: { agentKeyFingerprint: relayKey.agentKeyFingerprint, envelope: sealed.envelope, ciphertextBase64: sealed.ciphertext.toString('base64url'), expiresAt: new Date(current.getTime() + 15 * 60 * 1000).toISOString() },
  };
  await preflight({
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
    headers: { 'Content-Type': 'application/json', 'x-idempotency-key': importIdempotencyKey(source.sourceType, sourceEvidence.sourceSha256, revision) },
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
    const revision = parserRevision(env.REAL_QUESTION_IMPORT_PARSER_SHA256);
    const sources = [exam, lecture].map(source => Object.freeze({ source, evidence: sourceFileEvidence(source) }));
    stage = 'runtime-resolution';
    const runtimeModules = cloudAcceptance.resolveRuntimeModules(__dirname);
    const { Pool } = require(runtimeModules.pgPath);
    const { resolveRuntimeDatabaseUser } = require(path.join(path.dirname(runtimeModules.packagePath), 'src', 'runtimeDatabaseRole'));
    appPool = new Pool({ host: env.POSTGRES_HOST || '127.0.0.1', port: Number(env.POSTGRES_PORT || 5432), database: env.POSTGRES_DB || 'gewu_cloud', user: resolveRuntimeDatabaseUser(env.POSTGRES_USER), password: env.POSTGRES_PASSWORD });
    writerPool = new Pool({ host: env.POSTGRES_HOST || '127.0.0.1', port: Number(env.POSTGRES_PORT || 5432), database: env.POSTGRES_DB || 'gewu_cloud', user: 'vnext_pg17_writer', password: env.COMMAND_WRITER_POSTGRES_PASSWORD });
    stage = 'identity-loading';
    const loaded = await cloudAcceptance.loadActiveSuperAdminSession(appPool, writerPool, env.CLOUD_OPERATOR_PHONE_HMACS);
    const tenantId = env.CLOUD_BUSINESS_TENANT_ID || 'default';
    const baseUrl = acceptanceBaseUrl(env);
    const plans = [];
    for (const current of sources) {
      stage = `reuse-audit-${current.source.sourceType}`;
      const existing = await findReusableImport({
        query: (...args) => appPool.query(...args), tenantId, accountId: loaded.identity.accountId,
        sourceType: current.source.sourceType, sourceSha256: current.evidence.sourceSha256,
        sourceBytes: current.evidence.sourceBytes, parserSha256: revision,
      });
      plans.push(Object.freeze({ ...current, existing }));
    }
    const requiresDesktopApi = plans.some(plan => !plan.existing || !['drafts_prepared', 'submitted'].includes(plan.existing.status));
    if (requiresDesktopApi) {
      stage = 'controlled-registration';
      registration = await cloudAcceptance.runOnlineRegistrationAcceptance({ fetchImpl: fetch, runtimeModules, ticketSecret: env.CLOUD_IDENTITY_TICKET_SECRET, identity: loaded.identity });
    }
    const sessionToken = registration?.sessionToken || null;
    const deviceId = registration?.fixture?.deviceId || null;
    const results = [];
    for (const plan of plans) {
      const source = plan.source;
      const common = {
        sourceType: source.sourceType, sourceFileNameSha256: hash(source.sourceFileName),
        sourceSha256: plan.evidence.sourceSha256, sourceBytes: plan.evidence.sourceBytes, parserSha256: revision,
      };
      if (plan.existing && ['drafts_prepared', 'submitted'].includes(plan.existing.status)) {
        results.push(Object.freeze({ ...common, reused: true, final: plan.existing }));
        continue;
      }
      stage = `create-${source.sourceType}`;
      const created = plan.existing || await createWordImport({
        fetchImpl: fetch, sessionToken, deviceId, baseUrl,
        source, sourceEvidence: plan.evidence, parserSha256: revision,
      });
      stage = `parse-${source.sourceType}`;
      const ready = await waitForCandidates({
        read: async () => (await request(fetch, sessionToken, deviceId, `${baseUrl}/api/desktop/question-imports/${encodeURIComponent(created.taskId)}`)).task,
      });
      stage = `prepare-${source.sourceType}`;
      const prepared = await request(fetch, sessionToken, deviceId, `${baseUrl}/api/desktop/question-imports/${encodeURIComponent(created.taskId)}/prepare-drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      results.push(Object.freeze({
        ...common, reused: Boolean(plan.existing), ready: taskEvidence(ready),
        prepared: taskEvidence(prepared.task), final: taskEvidence(prepared.task),
      }));
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

module.exports = Object.freeze({
  importSource, parserRevision, sourceFileEvidence, importIdempotencyKey, findReusableImport,
  taskEvidence, waitForCandidates, acceptanceBaseUrl, preflightPayload, createWordImport, runFromEnvironment,
});

if (require.main === module) runFromEnvironment()
  .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code || 'REAL_QUESTION_IMPORT_FAILED', stage: error?.stage || null })}\n`); process.exitCode = 1; });
