'use strict';

const assert = require('assert');
const { createCloudBusinessApp } = require('./app');

async function request(app, path, { method = 'GET', headers = {}, body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let responseBody = null;
    try { responseBody = JSON.parse(text); } catch (_) { /* missing routes are asserted as failures below */ }
    return { status: response.status, body: responseBody };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  const questionCalls = [];
  const paperCalls = [];
  const miniappCloudAccount = {
    login: async () => { throw new Error('not used'); },
    context: async ({ token }) => {
      if (token === 'miniapp-ticket.signature') return { accountId: 'miniapp-super-admin-1', status: 'active', roles: ['super_admin'], profile: null };
      if (token === 'miniapp-student.signature') return { accountId: 'miniapp-student-1', status: 'active', roles: ['student'], profile: { type: 'student', id: 'student-1' } };
      if (token === 'miniapp-visitor.signature') return { accountId: 'miniapp-visitor-1', status: 'visitor', roles: [], profile: null };
      throw new Error('rejected');
    },
    pendingAccounts: async () => [],
    assignRole: async () => { throw new Error('not used'); },
  };
  const questionAuthority = {
    create: async () => { throw new Error('not used'); },
    list: async input => {
      questionCalls.push(input);
      return [{ id: 'q-1', subject: 'physics', type: 'single_choice', content: 'Visible stem', status: 'published', answer: 'A', analysis: 'Why A', options: ['A. force'], difficulty: 2, source: '2026 city mock', knowledgeLabels: ['Dynamics'] }];
    },
  };
  const paperExportTasks = {
    create: async input => {
      paperCalls.push(input);
      return { taskId: 'paper_task_1', status: 'queued', phase: 'queued', progress: 0, requestHash: 'a'.repeat(64), createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', replayed: false };
    },
    read: async () => ({ taskId: 'paper_task_1', status: 'queued', phase: 'queued', progress: 0, requestHash: 'a'.repeat(64), createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', replayed: false }),
    cancel: async () => ({ taskId: 'paper_task_1', status: 'cancelled', phase: 'cancelled', progress: 0, requestHash: 'a'.repeat(64), createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', replayed: false }),
  };
  const browseQueries = [];
  const app = createCloudBusinessApp({ query: async (text, values) => {
    if (text.includes("q.status='published'")) {
      browseQueries.push(values);
      return { rows: [{ id: 'q-public', subject: 'physics', type: 'single_choice', stem: 'Published stem', answer: 'A', explanation: 'Published explanation', options: [], difficulty: 2, source: '2026 city mock', knowledgeLabels: ['Dynamics'], status: 'published' }] };
    }
    return { rows: [] };
  }, miniappCloudAccount, questionAuthority, paperExportTasks, businessTenantId: 'default' });
  const headers = { authorization: 'Bearer miniapp-ticket.signature' };

  const previews = await request(app, '/api/business/miniapp-question-previews', { headers });
  assert.strictEqual(previews.status, 200);
  assert.deepStrictEqual(previews.body, { ok: true, questions: [{ id: 'q-1', subject: 'physics', type: 'single_choice', stemPreview: 'Visible stem', answer: 'A', explanation: 'Why A', options: ['A. force'], richContent: null, difficulty: 2, source: '2026 city mock', knowledgeLabels: ['Dynamics'], status: 'published' }] });
  assert.deepStrictEqual(questionCalls[0], { tenantId: 'default', actor: { accountId: 'miniapp-super-admin-1', status: 'active', roles: ['super_admin'], profile: null }, limit: 200 });

  const studentPreviews = await request(app, '/api/business/miniapp-question-previews', { headers: { authorization: 'Bearer miniapp-student.signature' } });
  assert.strictEqual(studentPreviews.status, 200);
  assert.deepStrictEqual(studentPreviews.body, { ok: true, questions: [{ id: 'q-public', subject: 'physics', type: 'single_choice', stemPreview: 'Published stem', answer: 'A', explanation: 'Published explanation', options: [], richContent: null, difficulty: 2, source: '2026 city mock', knowledgeLabels: ['Dynamics'], status: 'published' }] });
  assert.deepStrictEqual(browseQueries.at(-1), ['default', 200], 'student browsing retains the formal question limit');

  const visitorBrowse = await request(app, '/api/business/miniapp-question-previews', { headers: { authorization: 'Bearer miniapp-visitor.signature' } });
  assert.strictEqual(visitorBrowse.status, 200);
  assert.deepStrictEqual(visitorBrowse.body, { ok: true, questions: [{ id: 'q-public', subject: 'physics', type: 'single_choice', stemPreview: 'Published stem', answer: 'A', explanation: 'Published explanation', options: [], richContent: null, difficulty: 2, source: '2026 city mock', knowledgeLabels: ['Dynamics'], status: 'published' }] });
  assert.deepStrictEqual(browseQueries.at(-1), ['default', 20], 'visitor browsing is limited by question count while retaining answer and explanation');

  const created = await request(app, '/api/business/miniapp-paper-export-tasks', {
    method: 'POST', headers: { ...headers, 'x-idempotency-key': 'miniapp-paper-1' },
    body: { taskType: 'paper-export-pdf', request: { questionIds: ['q-1'], title: 'paper', subject: 'physics', answerPosition: 'after', formulaMode: 'word-native' } },
  });
  assert.strictEqual(created.status, 202);
  assert.strictEqual(paperCalls.length, 1);
  assert.strictEqual(paperCalls[0].actor.accountId, 'miniapp-super-admin-1');

  const studentExport = await request(app, '/api/business/miniapp-paper-export-tasks', {
    method: 'POST', headers: { authorization: 'Bearer miniapp-student.signature', 'x-idempotency-key': 'miniapp-student-paper' },
    body: { taskType: 'paper-export-pdf', request: { questionIds: ['q-public'], title: 'paper', subject: 'physics', answerPosition: 'after', formulaMode: 'word-native' } },
  });
  assert.strictEqual(studentExport.status, 403);

  const disallowed = await request(app, '/api/business/miniapp-paper-export-tasks', {
    method: 'POST', headers: { ...headers, 'x-idempotency-key': 'miniapp-paper-2' },
    body: { taskType: 'question-paper', request: { questionIds: ['q-1'], title: 'paper', subject: 'physics', answerPosition: 'after', formulaMode: 'word-native' } },
  });
  assert.strictEqual(disallowed.status, 400);
  console.log('cloud miniapp limited-task checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
