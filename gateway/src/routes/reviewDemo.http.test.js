'use strict';

const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-review-sandbox-'));
process.env.GATEWAY_DB_PATH = path.join(root, 'gateway.db');
process.env.JWT_SECRET = 'review-sandbox-http-secret-at-least-32-bytes';
process.env.MINIAPP_REVIEW_EXPERIENCE_CODE = 'review-sandbox-code-2026';

const { closeDatabase, getDb, initDatabase } = require('../db/database');
const createApp = require('../app');
const { generateToken } = require('../middleware/auth');
const { createReviewDemoRouter } = require('./reviewDemo');
const { createReviewDemoSandbox } = require('../services/reviewDemoSandbox');

let now = Date.parse('2026-07-14T12:00:00.000Z');
const sandbox = createReviewDemoSandbox({ now: () => now, ttlMs: 1_000 });
initDatabase();
const createdAt = new Date(now).toISOString();
getDb().prepare(`INSERT INTO users
  (id, name, user_type, status, login_enabled, review_status, created_at, updated_at)
  VALUES (?, ?, ?, 1, 1, 'approved', ?, ?)`)
  .run('normal-student', 'Normal Student', 'student', createdAt, createdAt);

const app = createApp({
  reviewDemoSandbox: sandbox,
  reviewDemoRouteOptions: {
    now: () => now,
    maxCreatesPerWindow: 10,
    rateWindowMs: 60_000,
    maxCreatesPerClientWindow: 11,
    clientRateWindowMs: 30 * 60_000,
  },
});
const server = app.listen(0);
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function request(route, options = {}, token) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${route}`, { ...options, headers, signal: AbortSignal.timeout(10_000) });
}

async function reviewToken(role, padding = '') {
  const response = await request('/api/auth/review-demo', {
    method: 'POST',
    body: JSON.stringify({ code: process.env.MINIAPP_REVIEW_EXPERIENCE_CODE, role, padding }),
  });
  assert.strictEqual(response.status, 200);
  return (await response.json()).data.token;
}

function openChunkedRequest(route, method, token, partialBody, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const target = new URL(route, baseUrl);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': contentType,
        'transfer-encoding': 'chunked',
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    const timer = setTimeout(() => {
      request.destroy();
      reject(new Error('review route did not reject an oversized chunked body before the request ended'));
    }, 1_000);
    request.on('response', () => clearTimeout(timer));
    request.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    request.write(partialBody);
  });
}

const payload = {
  questionIds: ['review-q-1', 'review-q-2'],
  title: '../../Review: HTTP Paper?\r\n',
  answerPosition: 'end',
  formulaMode: 'word-native',
};

(async () => {
  const tasksBefore = getDb().prepare('SELECT COUNT(*) count FROM miniapp_tasks').get().count;
  const tokenA = await reviewToken('student');
  const tokenB = await reviewToken('student', 'x'.repeat(70 * 1024));
  const tokenC = await reviewToken('student');
  const normalToken = generateToken(getDb().prepare('SELECT * FROM users WHERE id = ?').get('normal-student'));

  assert.strictEqual((await request('/api/review-demo/tasks', { method: 'POST', body: '{}' })).status, 401);
  const declaredOversized = await request('/api/review-demo/tasks', {
    method: 'POST',
    body: JSON.stringify({ taskType: 'question-paper', payload: { padding: 'x'.repeat(70 * 1024) } }),
  }, tokenB);
  assert.strictEqual(declaredOversized.status, 413);
  assert.strictEqual((await declaredOversized.json()).code, 'REVIEW_DEMO_BODY_TOO_LARGE');
  const normalDenied = await request('/api/review-demo/tasks', {
    method: 'POST', body: JSON.stringify({ taskType: 'question-paper', payload }),
  }, normalToken);
  assert.strictEqual(normalDenied.status, 403);
  assert.strictEqual((await normalDenied.json()).code, 'REVIEW_DEMO_CAPABILITY_REQUIRED');

  const oversized = await openChunkedRequest(
    '/api/review-demo/tasks',
    'POST',
    tokenA,
    `{"taskType":"question-paper","payload":{"padding":"${'x'.repeat(70 * 1024)}`,
  );
  assert.strictEqual(oversized.status, 413);
  assert.strictEqual(oversized.body.code, 'REVIEW_DEMO_BODY_TOO_LARGE');

  const unknownOversized = await openChunkedRequest(
    '/api/review-demo/not-a-route',
    'PATCH',
    tokenA,
    'x'.repeat(70 * 1024),
    'application/octet-stream',
  );
  assert.strictEqual(unknownOversized.status, 413);
  assert.strictEqual(unknownOversized.body.code, 'REVIEW_DEMO_BODY_TOO_LARGE');
  const unknownRoute = await request('/api/review-demo/not-a-route', {}, tokenA);
  assert.strictEqual(unknownRoute.status, 404);
  assert.strictEqual((await unknownRoute.json()).code, 'REVIEW_DEMO_ROUTE_NOT_FOUND');
  const oversizedWrongMethod = await request('/api/review-demo/tasks', {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: 'x'.repeat(70 * 1024),
  }, tokenA);
  assert.strictEqual(oversizedWrongMethod.status, 413);
  assert.strictEqual((await oversizedWrongMethod.json()).code, 'REVIEW_DEMO_BODY_TOO_LARGE');
  const wrongMethod = await request('/api/review-demo/tasks', { method: 'PUT', body: '{}' }, tokenA);
  assert.strictEqual(wrongMethod.status, 405);
  assert.strictEqual((await wrongMethod.json()).code, 'REVIEW_DEMO_METHOD_NOT_ALLOWED');

  const textCreate = await request('/api/review-demo/tasks', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ taskType: 'question-paper', payload }),
  }, tokenA);
  assert.strictEqual(textCreate.status, 415);
  assert.strictEqual((await textCreate.json()).code, 'REVIEW_DEMO_CONTENT_TYPE_UNSUPPORTED');
  const malformedCreate = await request('/api/review-demo/tasks', {
    method: 'POST', body: '{"taskType":',
  }, tokenA);
  assert.strictEqual(malformedCreate.status, 400);
  assert.strictEqual((await malformedCreate.json()).code, 'REVIEW_DEMO_BODY_INVALID');
  const structuredJsonCreate = await request('/api/review-demo/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/vnd.gewu.review+json; charset=utf-8' },
    body: JSON.stringify({ taskType: 'question-paper', payload }),
  }, tokenA);
  assert.strictEqual(structuredJsonCreate.status, 200);

  const quotedCharsetCreate = await request('/api/review-demo/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset="utf-8"' },
    body: JSON.stringify({ taskType: 'question-paper', payload }),
  }, tokenA);
  assert.strictEqual(quotedCharsetCreate.status, 200);
  for (const invalidContentType of [
    'application/json; charset=utf-8=evil',
    'application/json; charset=utf-8; charset=utf-8',
    'application/json; charset=gbk',
  ]) {
    const invalidContentTypeCreate = await request('/api/review-demo/tasks', {
      method: 'POST',
      headers: { 'content-type': invalidContentType },
      body: JSON.stringify({ taskType: 'question-paper', payload }),
    }, tokenA);
    assert.strictEqual(invalidContentTypeCreate.status, 415, invalidContentType);
    assert.strictEqual((await invalidContentTypeCreate.json()).code, 'REVIEW_DEMO_CONTENT_TYPE_UNSUPPORTED');
  }

  const createWord = await request('/api/review-demo/tasks', {
    method: 'POST', body: JSON.stringify({ taskType: 'paper-export-word', payload }),
  }, tokenA);
  assert.strictEqual(createWord.status, 200);
  const wordTask = (await createWord.json()).task;
  assert.strictEqual(wordTask.status, 'completed');
  assert.ok(wordTask.result.artifactId);
  assert.ok(!JSON.stringify(wordTask).includes('buffer'));

  const ownerResult = await request(`/api/review-demo/tasks/${wordTask.id}/result`, {}, tokenA);
  assert.strictEqual(ownerResult.status, 200);
  const crossResult = await request(`/api/review-demo/tasks/${wordTask.id}/result`, {}, tokenB);
  assert.strictEqual(crossResult.status, 404);
  assert.strictEqual((await crossResult.json()).code, 'REVIEW_DEMO_TASK_NOT_FOUND');

  const crossDownload = await request(`/api/review-demo/artifacts/${wordTask.result.artifactId}`, {}, tokenB);
  assert.strictEqual(crossDownload.status, 404);
  const wordDownload = await request(`/api/review-demo/artifacts/${wordTask.result.artifactId}`, {}, tokenA);
  assert.strictEqual(wordDownload.status, 200);
  assert.strictEqual(wordDownload.headers.get('cache-control'), 'no-store');
  assert.strictEqual(wordDownload.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(wordDownload.headers.get('content-disposition'), /^attachment; filename="Review-HTTP-Paper-[a-f0-9]{8}\.docx"$/);
  const wordBytes = Buffer.from(await wordDownload.arrayBuffer());
  assert.strictEqual(Number(wordDownload.headers.get('content-length')), wordBytes.length);
  assert.strictEqual(wordBytes.subarray(0, 2).toString(), 'PK');

  const createPdf = await request('/api/review-demo/tasks', {
    method: 'POST', body: JSON.stringify({ taskType: 'paper-export-pdf', payload: { ...payload, formulaMode: 'latex-vector' } }),
  }, tokenA);
  assert.strictEqual(createPdf.status, 200);
  const pdfTask = (await createPdf.json()).task;
  const pdfDownload = await request(`/api/review-demo/artifacts/${pdfTask.result.artifactId}`, {}, tokenA);
  assert.strictEqual(pdfDownload.status, 200);
  assert.strictEqual(pdfDownload.headers.get('content-type'), 'application/pdf');
  assert.strictEqual(Buffer.from(await pdfDownload.arrayBuffer()).subarray(0, 4).toString(), '%PDF');

  const rateLimited = await request('/api/review-demo/tasks', {
    method: 'POST', body: JSON.stringify({ taskType: 'question-paper', payload }),
  }, tokenC);
  assert.strictEqual(rateLimited.status, 429);
  assert.strictEqual((await rateLimited.json()).code, 'REVIEW_DEMO_RATE_LIMITED');
  assert.ok(rateLimited.headers.get('retry-after'));
  const trailingSlashRateLimited = await request('/api/review-demo/tasks/', {
    method: 'POST', body: JSON.stringify({ taskType: 'question-paper', payload }),
  }, tokenC);
  assert.strictEqual(trailingSlashRateLimited.status, 429);
  assert.strictEqual((await trailingSlashRateLimited.json()).code, 'REVIEW_DEMO_RATE_LIMITED');
  assert.ok(sandbox.stats().tasks < 50, 'rotating review sessions on one trusted client must not fill the process task budget');

  const parsedApp = express();
  parsedApp.use(express.json({ limit: '1mb' }));
  parsedApp.use((req, _res, next) => {
    req.authz = {
      role: 'student', reviewStatus: 'approved', status: 1, loginEnabled: 1,
      isReviewDemo: true, readOnly: true, reviewDemoSessionId: 'already-parsed-session',
    };
    next();
  });
  parsedApp.use('/api/review-demo', createReviewDemoRouter({ sandbox: createReviewDemoSandbox() }));
  const parsedServer = parsedApp.listen(0);
  try {
    const parsedResponse = await fetch(`http://127.0.0.1:${parsedServer.address().port}/api/review-demo/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskType: 'question-paper', payload }),
    });
    assert.strictEqual(parsedResponse.status, 500);
    assert.strictEqual((await parsedResponse.json()).code, 'REVIEW_DEMO_BODY_GATE_ORDER_INVALID');
  } finally {
    await new Promise(resolve => parsedServer.close(resolve));
  }

  const cancelled = await request(`/api/review-demo/tasks/${pdfTask.id}/cancel`, { method: 'POST', body: '{}' }, tokenA);
  assert.strictEqual(cancelled.status, 200);
  assert.strictEqual((await cancelled.json()).task.status, 'cancelled');
  assert.strictEqual((await request(`/api/review-demo/artifacts/${pdfTask.result.artifactId}`, {}, tokenA)).status, 404);

  now += 2_000;
  const expiredTask = await request(`/api/review-demo/tasks/${wordTask.id}/result`, {}, tokenA);
  assert.strictEqual(expiredTask.status, 410);
  assert.strictEqual((await expiredTask.json()).code, 'REVIEW_DEMO_TASK_EXPIRED');
  const expiredArtifact = await request(`/api/review-demo/artifacts/${wordTask.result.artifactId}`, {}, tokenA);
  assert.strictEqual(expiredArtifact.status, 410);
  assert.strictEqual((await expiredArtifact.json()).code, 'REVIEW_DEMO_ARTIFACT_EXPIRED');

  assert.strictEqual(getDb().prepare('SELECT COUNT(*) count FROM miniapp_tasks').get().count, tasksBefore);
  console.log('review demo HTTP sandbox checks passed');
})().finally(() => new Promise(resolve => server.close(resolve)))
  .then(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }); })
  .catch(error => { console.error(error); process.exitCode = 1; });
