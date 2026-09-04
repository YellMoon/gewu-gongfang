'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cloudAcceptance = require('./real-cloud-business-acceptance');

const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
const OUTPUT_PREFIX = '/tmp/gewu-real-paper-export-';

function failure(code) { return Object.assign(new Error(code), { code }); }

function sourceSha256(value) {
  const current = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(current)) throw failure('REAL_PAPER_EXPORT_SOURCE_INVALID');
  return current;
}

function verifyRendererRevision(filePath, expectedSha256) {
  const expected = sourceSha256(expectedSha256);
  let actual;
  try {
    actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (_) {
    throw failure('REAL_PAPER_EXPORT_RENDERER_UNAVAILABLE');
  }
  if (actual !== expected) throw failure('REAL_PAPER_EXPORT_RENDERER_MISMATCH');
  return actual;
}

function exportMarker(examSha256, lectureSha256, rendererSha256, selectedQuestions) {
  const sources = [sourceSha256(examSha256), sourceSha256(lectureSha256)];
  if (sources[0] === sources[1]) throw failure('REAL_PAPER_EXPORT_SOURCE_INVALID');
  const renderer = sourceSha256(rendererSha256);
  if (!Array.isArray(selectedQuestions) || selectedQuestions.length !== 2
    || selectedQuestions.some(item => !item || typeof item.questionId !== 'string' || !item.questionId
      || !/^[0-9a-f]{64}$/u.test(item.contentHash || ''))) throw failure('REAL_PAPER_EXPORT_SOURCE_INVALID');
  const selection = selectedQuestions.map(item => `${item.questionId}:${item.contentHash}`).join(':');
  return `sources-${crypto.createHash('sha256').update(`real-paper-export-explicit-v2:${sources.join(':')}:${renderer}:${selection}`, 'utf8').digest('hex').slice(0, 32)}`;
}

async function loadExplicitQuestionIds({ query, tenantId = 'default', examSha256, lectureSha256 } = {}) {
  if (typeof query !== 'function' || typeof tenantId !== 'string' || !tenantId.trim()) throw failure('REAL_PAPER_EXPORT_SOURCE_INVALID');
  const hashes = [sourceSha256(examSha256), sourceSha256(lectureSha256)];
  if (hashes[0] === hashes[1]) throw failure('REAL_PAPER_EXPORT_SOURCE_INVALID');
  const result = await query(
    `WITH requested(source_type,source_sha256,ordinal) AS (
       VALUES ('exam',$2::text,1),('lecture',$3::text,2)
     ), ranked_tasks AS (
       SELECT requested.source_type,requested.ordinal,task.task_id,
              row_number() OVER (PARTITION BY requested.source_type ORDER BY task.created_at DESC,task.task_id DESC) AS rank
         FROM requested
         JOIN business.question_import_tasks task
           ON task.tenant_id=$1 AND task.source_type=requested.source_type
          AND task.source_sha256=requested.source_sha256 AND task.status='submitted'
     ), latest_tasks AS (
       SELECT source_type,ordinal,task_id FROM ranked_tasks WHERE rank=1
     ), candidates AS (
       SELECT latest.source_type,latest.ordinal,question.id AS "questionId",item.content_hash AS "contentHash"
         FROM latest_tasks latest
         JOIN business.question_import_items item
           ON item.import_task_id=latest.task_id AND item.item_index=0 AND item.status='submitted'
         JOIN business.questions question
           ON question.tenant_id=$1
          AND question.id=('question-import-' || left(item.content_hash,40))
          AND question.deleted=false AND question.status='published'
         JOIN business.question_contents content
           ON content.tenant_id=question.tenant_id AND content.question_id=question.id
          AND content.deleted=false AND content.content_hash=item.content_hash
     )
     SELECT source_type AS "sourceType","questionId","contentHash" FROM candidates ORDER BY ordinal`,
    [tenantId.trim(), ...hashes],
  );
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  if (rows.length !== 2 || rows[0]?.sourceType !== 'exam' || rows[1]?.sourceType !== 'lecture'
    || rows.some(row => typeof row.questionId !== 'string' || !row.questionId || !/^[0-9a-f]{64}$/u.test(row.contentHash || ''))
    || rows[0].questionId === rows[1].questionId) throw failure('REAL_PAPER_EXPORT_QUESTIONS_UNAVAILABLE');
  return rows.map(row => Object.freeze({ sourceType: row.sourceType, questionId: row.questionId, contentHash: row.contentHash }));
}

function artifactEvidence(format, bytes) {
  if (!['pdf', 'word'].includes(format) || !Buffer.isBuffer(bytes) || bytes.length < 8) throw failure('REAL_PAPER_EXPORT_ARTIFACT_INVALID');
  const expected = format === 'pdf'
    ? { extension: 'pdf', mimeType: PDF_MIME, signature: '%PDF-' }
    : { extension: 'docx', mimeType: WORD_MIME, signature: 'PK\x03\x04' };
  if (bytes.subarray(0, expected.signature.length).toString('binary') !== expected.signature) throw failure('REAL_PAPER_EXPORT_ARTIFACT_INVALID');
  return Object.freeze({ format, extension: expected.extension, mimeType: expected.mimeType, bytes: bytes.length });
}

async function waitForCompletedTask({ read, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 60, intervalMs = 2000 } = {}) {
  if (typeof read !== 'function' || typeof sleep !== 'function' || !Number.isSafeInteger(attempts) || attempts < 1 || !Number.isSafeInteger(intervalMs) || intervalMs < 0) {
    throw failure('REAL_PAPER_EXPORT_INPUT_INVALID');
  }
  for (let index = 0; index < attempts; index += 1) {
    const task = await read();
    if (task?.status === 'completed' && task?.phase === 'completed' && Number(task.progress) === 100) return task;
    if (['failed', 'cancelled'].includes(task?.status)) throw failure('REAL_PAPER_EXPORT_TASK_FAILED');
    if (index + 1 < attempts) await sleep(intervalMs);
  }
  throw failure('REAL_PAPER_EXPORT_TASK_TIMEOUT');
}

async function waitForReadyDelivery({ read, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 60, intervalMs = 2000 } = {}) {
  if (typeof read !== 'function' || typeof sleep !== 'function' || !Number.isSafeInteger(attempts) || attempts < 1 || !Number.isSafeInteger(intervalMs) || intervalMs < 0) {
    throw failure('REAL_PAPER_EXPORT_INPUT_INVALID');
  }
  for (let index = 0; index < attempts; index += 1) {
    const delivery = await read();
    if (delivery?.status === 'ready') return delivery;
    if (index + 1 < attempts) await sleep(intervalMs);
  }
  throw failure('REAL_PAPER_EXPORT_DELIVERY_TIMEOUT');
}

async function jsonRequest(fetchImpl, token, url, { method = 'GET', body, idempotencyKey } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: 'application/json', Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) throw failure(`REAL_PAPER_EXPORT_HTTP_${response.status}_${String(payload?.code || 'UNKNOWN').replace(/[^A-Z0-9_]/g, '')}`);
  return payload;
}

async function createAndDownload({ fetchImpl, token, baseUrl, format, questionIds, marker, writeFile = fs.writeFileSync } = {}) {
  if (typeof fetchImpl !== 'function' || typeof token !== 'string' || !token || typeof baseUrl !== 'string' || !/^https?:\/\//.test(baseUrl)
    || !['pdf', 'word'].includes(format) || !Array.isArray(questionIds) || questionIds.length < 1 || typeof marker !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(marker)) {
    throw failure('REAL_PAPER_EXPORT_INPUT_INVALID');
  }
  const taskType = format === 'pdf' ? 'paper-export-pdf' : 'paper-export-word';
  const request = {
    questionIds,
    title: String.fromCharCode(29289, 29702, 35797, 39064),
    subject: 'physics',
    answerPosition: 'after',
    formulaMode: 'word-native',
  };
  const created = await jsonRequest(fetchImpl, token, `${baseUrl}/api/business/miniapp-paper-export-tasks`, {
    method: 'POST', body: { taskType, request }, idempotencyKey: `real-paper-export-${marker}-${format}`,
  });
  const taskId = created?.task?.taskId;
  if (typeof taskId !== 'string' || !/^paper_task_[A-Za-z0-9_-]{8,128}$/.test(taskId)) throw failure('REAL_PAPER_EXPORT_TASK_INVALID');
  await waitForCompletedTask({ read: async () => (await jsonRequest(fetchImpl, token, `${baseUrl}/api/business/miniapp-paper-export-tasks/${encodeURIComponent(taskId)}`)).task });
  const deliveryCreated = await jsonRequest(fetchImpl, token, `${baseUrl}/api/business/miniapp-paper-export-tasks/${encodeURIComponent(taskId)}/delivery`, { method: 'POST', body: {} });
  const deliveryId = deliveryCreated?.delivery?.deliveryId;
  if (typeof deliveryId !== 'string' || !/^delivery_[A-Za-z0-9_-]{8,128}$/.test(deliveryId)) throw failure('REAL_PAPER_EXPORT_DELIVERY_INVALID');
  const delivery = await waitForReadyDelivery({ read: async () => (await jsonRequest(fetchImpl, token, `${baseUrl}/api/business/miniapp-artifact-deliveries/${encodeURIComponent(deliveryId)}`)).delivery });
  if (delivery.mimeType !== (format === 'pdf' ? PDF_MIME : WORD_MIME)) throw failure('REAL_PAPER_EXPORT_DELIVERY_INVALID');
  const download = await fetchImpl(`${baseUrl}/api/business/miniapp-artifact-deliveries/${encodeURIComponent(deliveryId)}/download`, {
    headers: { Authorization: `Bearer ${token}`, Accept: '*/*' },
  });
  const bytes = Buffer.from(await download.arrayBuffer());
  if (!download.ok) throw failure(`REAL_PAPER_EXPORT_DOWNLOAD_${download.status}`);
  const evidence = artifactEvidence(format, bytes);
  const artifactPath = `${OUTPUT_PREFIX}${format}.${evidence.extension}`;
  writeFile(artifactPath, bytes);
  return Object.freeze({
    ...evidence, taskId, deliveryId, path: artifactPath,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  });
}

async function runFromEnvironment(env = process.env) {
  let appPool;
  let writerPool;
  try {
    const runtimeModules = cloudAcceptance.resolveRuntimeModules(__dirname);
    const { Pool } = require(runtimeModules.pgPath);
    const { resolveRuntimeDatabaseUser } = require(path.join(path.dirname(runtimeModules.packagePath), 'src', 'runtimeDatabaseRole'));
    appPool = new Pool({ host: env.POSTGRES_HOST || '127.0.0.1', port: Number(env.POSTGRES_PORT || 5432), database: env.POSTGRES_DB || 'gewu_cloud', user: resolveRuntimeDatabaseUser(env.POSTGRES_USER), password: env.POSTGRES_PASSWORD, max: 1 });
    writerPool = new Pool({ host: env.POSTGRES_HOST || '127.0.0.1', port: Number(env.POSTGRES_PORT || 5432), database: env.POSTGRES_DB || 'gewu_cloud', user: 'vnext_pg17_writer', password: env.COMMAND_WRITER_POSTGRES_PASSWORD, max: 1 });
    const loaded = await cloudAcceptance.loadActiveSuperAdminSession(appPool, writerPool, env.CLOUD_OPERATOR_PHONE_HMACS);
    const examSha256 = sourceSha256(env.REAL_QUESTION_IMPORT_EXAM_SHA256);
    const lectureSha256 = sourceSha256(env.REAL_QUESTION_IMPORT_LECTURE_SHA256);
    const rendererSha256 = verifyRendererRevision(env.REAL_PAPER_EXPORT_RENDERER_PATH || '/app/src/paperExportRenderer.js', env.REAL_PAPER_EXPORT_RENDERER_SHA256);
    const selectedQuestions = await loadExplicitQuestionIds({
      query: (...args) => appPool.query(...args), tenantId: env.CLOUD_BUSINESS_TENANT_ID || 'default',
      examSha256, lectureSha256,
    });
    const questionIds = selectedQuestions.map(item => item.questionId);
    const marker = exportMarker(examSha256, lectureSha256, rendererSha256, selectedQuestions);
    const token = cloudAcceptance.makeMiniappSessionToken(env.CLOUD_MINIAPP_TICKET_SECRET, loaded.identity.accountId);
    const artifacts = [];
    for (const format of ['pdf', 'word']) artifacts.push(await createAndDownload({ fetchImpl: fetch, token, baseUrl: 'http://127.0.0.1:3002', format, questionIds, marker }));
    return Object.freeze({ ok: true, marker, questionIds, artifacts });
  } finally {
    await Promise.allSettled([appPool?.end?.(), writerPool?.end?.()]);
  }
}

module.exports = Object.freeze({ sourceSha256, verifyRendererRevision, exportMarker, loadExplicitQuestionIds, artifactEvidence, waitForCompletedTask, waitForReadyDelivery, createAndDownload, runFromEnvironment });

if (require.main === module) runFromEnvironment()
  .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code || 'REAL_PAPER_EXPORT_FAILED' })}\n`); process.exitCode = 1; });
