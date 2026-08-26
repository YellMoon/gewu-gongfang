'use strict';

const assert = require('assert');
const http = require('http');

const { startFixtureServer } = require('./capture-miniapp-ui-matrix');
const { cloudSessionUser } = require('../miniapp/src/pages/login/cloudSessionIdentityRuntime');
const TEST_PORT = 3020;

function request(pathname, token, port = TEST_PORT, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, body: JSON.parse(body) }));
    });
    request.once('error', reject);
    request.end();
  });
}

(async () => {
  assert.strictEqual(typeof startFixtureServer, 'function', 'fixture server must be reusable outside the legacy automator runner');
  const { server } = await startFixtureServer(TEST_PORT);
  try {
    const response = await request('/api/miniapp/cloud-context', 'fixture-teacher');
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.identity.accountId, 'fixture-teacher');
    assert.deepStrictEqual(response.body.identity.roles, ['teacher']);
    assert.strictEqual(response.body.identity.status, 'active');
    assert.strictEqual(response.body.identity.profile.type, 'teacher');
    assert.strictEqual(response.body.identity.profile.id, 'fixture-teacher');
    assert.ok(response.body.capabilities.includes('business:teacher-scope'));
    assert.strictEqual(cloudSessionUser(response.body.identity)?.user_type, 'teacher');

    const guardianResponse = await request('/api/miniapp/cloud-context', 'fixture-guardian');
    assert.strictEqual(guardianResponse.statusCode, 200);
    assert.strictEqual(guardianResponse.body.identity.accountId, 'fixture-guardian');
    assert.deepStrictEqual(guardianResponse.body.identity.roles, ['student']);
    assert.strictEqual(guardianResponse.body.identity.profile.relationship, 'guardian');
    const guardian = cloudSessionUser(guardianResponse.body.identity);
    assert.strictEqual(guardian?.identity_kind, 'family_member');
    assert.strictEqual(guardian?.student_relationship, 'guardian');

    const visitorResponse = await request('/api/miniapp/cloud-context', 'fixture-visitor');
    assert.strictEqual(visitorResponse.statusCode, 200);
    assert.deepStrictEqual(visitorResponse.body.identity.roles, []);
    assert.strictEqual(visitorResponse.body.identity.status, 'visitor');
    assert.strictEqual(cloudSessionUser(visitorResponse.body.identity)?.user_type, 'visitor');

    const visitorQuestions = await request('/api/business/miniapp-question-previews', 'fixture-visitor');
    assert.strictEqual(visitorQuestions.statusCode, 200);
    assert.strictEqual(visitorQuestions.body.questions.length, 1);
    assert.deepStrictEqual(visitorQuestions.body.questions[0], {
      id: 'fixture-question-1',
      subject: 'physics',
      type: 'single_choice',
      stemPreview: 'Which force changes an object velocity?',
      options: ['A. Balanced force', 'B. Net force'],
      answer: 'B. Net force',
      explanation: 'A non-zero net force changes velocity.',
      difficulty: 2,
      source: '2026 city mock',
      knowledgeLabels: ['Dynamics'],
      status: 'published',
    });

    const exportTask = await request('/api/business/miniapp-paper-export-tasks', 'fixture-paper-teacher', TEST_PORT, 'POST');
    assert.strictEqual(exportTask.statusCode, 202);
    assert.deepStrictEqual(exportTask.body.task, {
      taskId: 'paper_task_fixture', status: 'completed', phase: 'completed', progress: 100,
      requestHash: 'f'.repeat(64), createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z',
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log('capture miniapp UI fixture test passed');
})().catch(error => {
  console.error(error && (error.stack || error.message || error));
  process.exitCode = 1;
});
