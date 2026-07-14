'use strict';

const assert = require('assert');
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
  reviewDemoRouteOptions: { now: () => now, maxCreatesPerWindow: 3, rateWindowMs: 60_000 },
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

function openChunkedCreate(token, partialBody) {
  return new Promise((resolve, reject) => {
    const target = new URL('/api/review-demo/tasks', baseUrl);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
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
      reject(new Error('review create did not reject an oversized chunked body before the request ended'));
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

  const oversized = await openChunkedCreate(
    tokenA,
    `{"taskType":"question-paper","payload":{"padding":"${'x'.repeat(70 * 1024)}`,
  );
  assert.strictEqual(oversized.status, 413);
  assert.strictEqual(oversized.body.code, 'REVIEW_DEMO_BODY_TOO_LARGE');

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
  }, tokenA);
  assert.strictEqual(rateLimited.status, 429);
  assert.strictEqual((await rateLimited.json()).code, 'REVIEW_DEMO_RATE_LIMITED');
  assert.ok(rateLimited.headers.get('retry-after'));

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
