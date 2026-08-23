const assert = require('assert');

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

(async () => {
  const client = await import('./paperExportTaskClient.mjs');
  const authorizationSession = await import('./desktopAuthorizationSession.mjs');
  const authStorage = memoryStorage();
  await authorizationSession.saveDesktopAuthorizationSession({
    token: 'jwt-token',
    expiresAt: '2026-07-17T18:00:00.000Z',
    session: {
      id: 'session-1', userId: 'user-1', deviceId: 'desktop-2',
      activeRole: 'teacher', eligibleRoles: ['teacher'], rowVersion: 1,
    },
    profile: { userId: 'user-1', activeRole: 'teacher', eligibleRoles: ['teacher'], teacherId: 'teacher-1' },
  });
  const taskStorage = memoryStorage();
  const input = {
    title: 'Midterm', subject: 'Physics', format: 'pdf', formulaMode: 'word-native',
    answerPosition: 'after-each', questionIds: ['q3', 'q1', 'q2'],
  };
  const config = {
    cloudBaseUrl: 'https://cloud.example.com/api', cloudBusinessIdentityBaseUrl: 'https://cloud-business.example.com', deviceId: 'desktop-2',
  };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/paper-export-tasks') && init.method === 'POST') {
      return { ok: true, status: 202, json: async () => ({ ok: true, task: { taskId: 'task-1', status: 'queued', phase: 'queued', progress: 0 } }) };
    }
    if (url.endsWith('/paper-export-tasks/task-1') && !init.method) {
      return { ok: true, status: 200, json: async () => ({ ok: true, task: { taskId: 'task-1', status: 'processing', phase: 'rendering', progress: 55 } }) };
    }
    if (url.endsWith('/paper-export-tasks/task-1/cancel')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, task: { taskId: 'task-1', status: 'cancelled', phase: 'cancelled', progress: 55 } }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const accepted = await client.submitPaperExportTask(config, input, {
    fetchImpl, authStorage, taskStorage, idempotencyKeyFactory: () => 'idem-1', now: () => '2026-07-14T00:00:00.000Z',
  });
  assert.strictEqual(accepted.accepted, true);
  assert.deepStrictEqual(JSON.parse(calls[0].init.body), {
    taskType: 'paper-export-pdf',
    payload: { questionIds: ['q3', 'q1', 'q2'], answerPosition: 'after', formulaMode: 'word-native', title: 'Midterm', subject: 'Physics' },
  }, 'cloud submission must preserve editor order and all export choices while cloud freezes the authoritative question snapshot');
  assert.strictEqual(calls[0].url, 'https://cloud-business.example.com/api/desktop/paper-export-tasks');
  assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer jwt-token');
  assert.strictEqual(calls[0].init.headers['x-idempotency-key'], 'idem-1');
  assert.strictEqual(client.loadPaperExportTasks(taskStorage)[0].serverTaskId, 'task-1', 'accepted tasks must survive a restart');

  const polled = await client.refreshPaperExportTask(config, accepted.task.localId, { fetchImpl, authStorage, taskStorage });
  assert.deepStrictEqual([polled.phase, polled.progress, polled.status], ['rendering', 55, 'processing']);
  const cancelled = await client.cancelPaperExportTask(config, accepted.task.localId, { fetchImpl, authStorage, taskStorage });
  assert.strictEqual(cancelled.status, 'cancelled');

  const offlineStorage = memoryStorage();
  const offline = await client.submitPaperExportTask(config, input, {
    taskStorage: offlineStorage, authStorage, idempotencyKeyFactory: () => 'idem-offline',
    fetchImpl: async () => { throw new Error('network offline'); }, now: () => '2026-07-14T00:00:01.000Z',
  });
  assert.strictEqual(offline.accepted, false);
  assert.strictEqual(client.loadPaperExportTasks(offlineStorage)[0].status, 'draft', 'unconfirmed network requests must remain local drafts');
  assert.ok(!client.loadPaperExportTasks(offlineStorage)[0].serverTaskId);
  const retryCalls = [];
  const retried = await client.retryPaperExportTask(config, offline.task.localId, {
    taskStorage: offlineStorage, authStorage, idempotencyKeyFactory: () => 'idem-retry',
    fetchImpl: async (url, init) => { retryCalls.push({ url, init }); return { ok: true, status: 202, json: async () => ({ ok: true, task: { taskId: 'task-retry', status: 'queued', phase: 'queued', progress: 0 } }) }; },
  });
  assert.strictEqual(retried.accepted, true);
  assert.strictEqual(JSON.parse(retryCalls[0].init.body).payload.questionIds.join(','), 'q3,q1,q2');
  assert.strictEqual(retryCalls[0].init.headers['x-idempotency-key'], 'idem-retry', 'manual retry must use a fresh idempotency key');

  const unavailableStorage = memoryStorage();
  const unavailable = await client.submitPaperExportTask(config, input, { taskStorage: unavailableStorage, authStorage,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ ok: false, code: 'CLOUD_TASK_UNAVAILABLE' }) }) });
  assert.strictEqual(unavailable.accepted, false);
  assert.strictEqual(client.loadPaperExportTasks(unavailableStorage)[0].status, 'draft');
  assert.strictEqual(client.loadPaperExportTasks(unavailableStorage)[0].errorCode, 'CLOUD_TASK_UNAVAILABLE');

  assert.ok(!String(client.submitPaperExportTask).includes('primary-host'), 'every desktop must submit an export task to cloud');

  const downloadCalls = []; let clicked = '';
  const completed = { fileName: 'paper.pdf', accessEndpoint: '/api/desktop/paper-export-artifacts/a1/access' };
  await client.downloadPaperExportResult(config, completed, {
    authStorage,
    fetchImpl: async (url, init = {}) => {
      downloadCalls.push({ url, init });
      if (downloadCalls.length === 1) return { ok: true, status: 200, json: async () => ({ ok: true, data: { token: 'short-1', downloadEndpoint: '/api/desktop/paper-export-artifacts/a1/download' } }) };
      if (downloadCalls.length === 2) return { ok: false, status: 410 };
      if (downloadCalls.length === 3) return { ok: true, status: 200, json: async () => ({ ok: true, data: { token: 'short-2', downloadEndpoint: '/api/desktop/paper-export-artifacts/a1/download' } }) };
      return { ok: true, status: 200, blob: async () => new Blob(['pdf']) };
    },
    createObjectURL: () => 'blob:paper', revokeObjectURL: () => undefined,
    createAnchor: () => ({ click() { clicked = this.href; } }),
  });
  assert.strictEqual(downloadCalls[0].url, 'https://cloud-business.example.com/api/desktop/paper-export-artifacts/a1/access');
  assert.strictEqual(downloadCalls[0].init.method, 'GET');
  assert.strictEqual(downloadCalls[1].init.headers['x-gewu-artifact-token'], 'short-1');
  assert.strictEqual(downloadCalls[2].url, downloadCalls[0].url, '410 must refresh access through cloud before retrying');
  assert.strictEqual(downloadCalls[3].init.headers['x-gewu-artifact-token'], 'short-2');
  assert.strictEqual(clicked, 'blob:paper');
  await assert.rejects(
    () => client.downloadPaperExportResult(config, { fileName: 'legacy.pdf', accessEndpoint: '/api/cloud-relay-host/artifacts/a1/access' }, { authStorage }),
    error => error.code === 'ARTIFACT_ACCESS_ENDPOINT_INVALID',
  );
  assert.ok(downloadCalls.every(call => !String(call.url).startsWith('https://cloud.example.com/')), 'artifact access must not use the retired sync endpoint');

  console.log('paper export task client checks passed');
})().catch(error => { console.error(error); process.exit(1); });
