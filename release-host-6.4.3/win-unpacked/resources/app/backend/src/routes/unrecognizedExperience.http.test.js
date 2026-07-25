'use strict';

const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createUnrecognizedExperienceRouter } = require('./unrecognizedExperience');
const { createUnrecognizedExperienceSandbox } = require('../services/unrecognizedExperienceSandbox');
const { EXPERIENCE_QUESTION_IDS } = require('../services/unrecognizedExperienceData');

function fakeWriter(format, _payload, _questions, options) {
  const bytes = format === 'word' ? Buffer.from('PK experience word') : Buffer.from('%PDF- experience pdf');
  const filePath = path.join(options.root, 'assets', 'exports', options.finalFileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  fs.writeFileSync(`${filePath}.verified.json`, JSON.stringify({ sha256: 'b'.repeat(64), sizeBytes: bytes.length }));
  return Promise.resolve({
    fileName: options.finalFileName,
    filePath,
    sha256: 'b'.repeat(64),
    pageCount: 1,
    formulaCount: 0,
    fallbackCount: 0,
    effectiveFormulaModes: [],
  });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-experience-route-test-'));
  const sandbox = createUnrecognizedExperienceSandbox({ root, writeArtifact: fakeWriter });
  const app = express();
  app.use((req, _res, next) => {
    const sessionId = req.get('x-test-session');
    if (sessionId) {
      const tokenUse = req.get('x-test-token-use') || 'unrecognized-student';
      req.authz = {
        tokenUse,
        accountState: tokenUse === 'unrecognized-student' ? 'unrecognized' : 'formal',
        clientType: 'miniapp',
        sessionId,
      };
    }
    next();
  });
  app.use('/api/experience', createUnrecognizedExperienceRouter({
    sandbox,
    maxBodyBytes: 512,
    maxCreatesPerWindow: 3,
    rateWindowMs: 60_000,
    maxCreatesPerClientWindow: 10,
  }));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(route, options = {}, sessionId = 'session-a', tokenUse) {
    const headers = { ...(options.headers || {}) };
    if (sessionId) headers['x-test-session'] = sessionId;
    if (tokenUse) headers['x-test-token-use'] = tokenUse;
    if (options.body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
    return fetch(`${baseUrl}${route}`, { ...options, headers, signal: AbortSignal.timeout(10_000) });
  }

  try {
    const denied = await request('/api/experience/questions', {}, null);
    assert.strictEqual(denied.status, 403);
    assert.strictEqual((await denied.json()).code, 'UNRECOGNIZED_EXPERIENCE_SCOPE_REQUIRED');
    const formalDenied = await request('/api/experience/questions', {}, 'formal-session', 'miniapp-session');
    assert.strictEqual(formalDenied.status, 403);

    const questionsResponse = await request('/api/experience/questions');
    assert.strictEqual(questionsResponse.status, 200);
    assert.strictEqual(questionsResponse.headers.get('cache-control'), 'private, no-store');
    const questionsBody = await questionsResponse.json();
    assert.deepStrictEqual(questionsBody.questions.map(item => item.id), EXPERIENCE_QUESTION_IDS);
    assert.ok(!JSON.stringify(questionsBody).includes('question-asset://'));

    const oversized = await request('/api/experience/tasks', {
      method: 'POST', body: JSON.stringify({ taskType: 'question-paper', payload: { padding: 'x'.repeat(1_024) } }),
    });
    assert.strictEqual(oversized.status, 413);
    assert.strictEqual((await oversized.json()).code, 'UNRECOGNIZED_EXPERIENCE_BODY_TOO_LARGE');

    const textBody = await request('/api/experience/tasks', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
    });
    assert.strictEqual(textBody.status, 415);
    const malformed = await request('/api/experience/tasks', { method: 'POST', body: '{"taskType":' });
    assert.strictEqual(malformed.status, 400);

    const invalidId = await request('/api/experience/tasks', {
      method: 'POST',
      body: JSON.stringify({ taskType: 'question-paper', payload: { title: 'invalid', questionIds: ['real-question-id'] } }),
    });
    assert.strictEqual(invalidId.status, 400);
    assert.strictEqual((await invalidId.json()).code, 'UNRECOGNIZED_EXPERIENCE_QUESTION_INVALID');

    const createWord = await request('/api/experience/tasks', {
      method: 'POST',
      body: JSON.stringify({
        taskType: 'paper-export-word',
        payload: {
          title: '\u793a\u4f8b\u8bd5\u5377',
          questionIds: [EXPERIENCE_QUESTION_IDS[0]],
          answerPosition: 'end',
          formulaMode: 'word-native',
        },
      }),
    });
    assert.strictEqual(createWord.status, 202);
    const createdWordTask = (await createWord.json()).task;
    assert.ok(!JSON.stringify(createdWordTask).includes('ownerSessionId'));
    assert.ok(!JSON.stringify(createdWordTask).includes('filePath'));
    await sandbox.waitForTask('session-a', createdWordTask.id);

    const ownerResult = await request(`/api/experience/tasks/${createdWordTask.id}/result`);
    assert.strictEqual(ownerResult.status, 200);
    const completedWordTask = (await ownerResult.json()).task;
    assert.strictEqual(completedWordTask.status, 'completed');
    assert.ok(completedWordTask.result.artifactId);
    const crossResult = await request(`/api/experience/tasks/${createdWordTask.id}/result`, {}, 'session-b');
    assert.strictEqual(crossResult.status, 404);

    const artifactPath = `/api/experience/artifacts/${completedWordTask.result.artifactId}`;
    const crossDownload = await request(artifactPath, {}, 'session-b');
    assert.strictEqual(crossDownload.status, 404);
    const ownerDownload = await request(artifactPath);
    assert.strictEqual(ownerDownload.status, 200);
    assert.strictEqual(ownerDownload.headers.get('cache-control'), 'private, no-store');
    assert.strictEqual(ownerDownload.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.strictEqual(Buffer.from(await ownerDownload.arrayBuffer()).subarray(0, 2).toString('ascii'), 'PK');

    const paper = await request('/api/experience/tasks', {
      method: 'POST',
      body: JSON.stringify({
        taskType: 'question-paper',
        payload: { title: 'paper', questionIds: EXPERIENCE_QUESTION_IDS },
      }),
    });
    assert.strictEqual(paper.status, 202);
    assert.strictEqual((await paper.json()).task.status, 'completed');

    const rateLimited = await request('/api/experience/tasks', {
      method: 'POST',
      body: JSON.stringify({
        taskType: 'question-paper',
        payload: { title: 'rate', questionIds: [EXPERIENCE_QUESTION_IDS[0]] },
      }),
    });
    assert.strictEqual(rateLimited.status, 429);
    assert.strictEqual((await rateLimited.json()).code, 'UNRECOGNIZED_EXPERIENCE_RATE_LIMITED');
    assert.ok(rateLimited.headers.get('retry-after'));

    const cancelled = await request(`/api/experience/tasks/${createdWordTask.id}/cancel`, { method: 'POST', body: '{}' });
    assert.strictEqual(cancelled.status, 200);
    assert.strictEqual((await cancelled.json()).task.status, 'cancelled');
    assert.strictEqual((await request(artifactPath)).status, 404);

    const wrongMethod = await request('/api/experience/questions', { method: 'POST', body: '{}' });
    assert.strictEqual(wrongMethod.status, 405);
    assert.strictEqual(wrongMethod.headers.get('allow'), 'GET');
    const notFound = await request('/api/experience/not-a-route');
    assert.strictEqual(notFound.status, 404);
    assert.strictEqual((await notFound.json()).code, 'UNRECOGNIZED_EXPERIENCE_ROUTE_NOT_FOUND');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await sandbox.close();
  }

  const parsedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-experience-parsed-test-'));
  const parsedSandbox = createUnrecognizedExperienceSandbox({ root: parsedRoot, writeArtifact: fakeWriter });
  const parsedApp = express();
  parsedApp.use(express.json());
  parsedApp.use((req, _res, next) => {
    req.authz = { tokenUse: 'unrecognized-student', accountState: 'unrecognized', clientType: 'miniapp', sessionId: 'parsed-session' };
    next();
  });
  parsedApp.use('/api/experience', createUnrecognizedExperienceRouter({ sandbox: parsedSandbox }));
  const parsedServer = parsedApp.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${parsedServer.address().port}/api/experience/tasks`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(response.status, 500);
    assert.strictEqual((await response.json()).code, 'UNRECOGNIZED_EXPERIENCE_BODY_GATE_ORDER_INVALID');
  } finally {
    await new Promise(resolve => parsedServer.close(resolve));
    await parsedSandbox.close();
  }

  const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.ok(appSource.includes("require('./routes/unrecognizedExperience')"));
  const experienceMountAt = appSource.indexOf("app.use('/api/experience'");
  const globalJsonParserAt = appSource.indexOf("app.use(express.json({ limit: '50mb' }))");
  assert.ok(experienceMountAt >= 0, 'Backend must mount the fixed experience router');
  assert.ok(globalJsonParserAt >= 0 && experienceMountAt < globalJsonParserAt,
    'the experience body gate must run before the global 50 MiB JSON parser');
  assert.ok(appSource.includes("app.use('/api/experience', authMiddleware"));

  console.log('unrecognized experience HTTP route checks passed');
})().catch(error => { console.error(error); process.exit(1); });
