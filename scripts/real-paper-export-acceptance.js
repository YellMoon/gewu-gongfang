'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cloudAcceptance = require('./real-cloud-business-acceptance');

const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
const OUTPUT_PREFIX = '/tmp/gewu-real-paper-export-';

function failure(code) { return Object.assign(new Error(code), { code }); }

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
    title: `GeWu export verification ${marker}-${format}`,
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
    const questions = await appPool.query("SELECT id FROM business.questions WHERE tenant_id=$1 AND deleted=false ORDER BY created_at,id LIMIT 2", [env.CLOUD_BUSINESS_TENANT_ID || 'default']);
    const questionIds = questions.rows.map(row => row.id).filter(id => typeof id === 'string');
    if (questionIds.length < 1) throw failure('REAL_PAPER_EXPORT_QUESTIONS_UNAVAILABLE');
    const marker = crypto.randomUUID().replace(/[^A-Za-z0-9_-]/g, '');
    const token = cloudAcceptance.makeMiniappSessionToken(env.CLOUD_MINIAPP_TICKET_SECRET, loaded.identity.accountId);
    const artifacts = [];
    for (const format of ['pdf', 'word']) artifacts.push(await createAndDownload({ fetchImpl: fetch, token, baseUrl: 'http://127.0.0.1:3002', format, questionIds, marker }));
    return Object.freeze({ ok: true, artifacts });
  } finally {
    await Promise.allSettled([appPool?.end?.(), writerPool?.end?.()]);
  }
}

module.exports = Object.freeze({ artifactEvidence, waitForCompletedTask, waitForReadyDelivery, createAndDownload, runFromEnvironment });

if (require.main === module) runFromEnvironment()
  .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code || 'REAL_PAPER_EXPORT_FAILED' })}\n`); process.exitCode = 1; });
