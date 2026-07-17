const assert = require('assert');

(async () => {
  const { downloadHostArtifactRuntime, requestHostPaperExportRuntime } = await import('./hostPaperExportRuntime.mjs');
  const authorizationSession = await import('./desktopAuthorizationSession.mjs');
  const storage = { getItem: () => null, removeItem: () => {} };
  await authorizationSession.saveDesktopAuthorizationSession({
    token: 'jwt-token',
    expiresAt: '2026-07-17T18:00:00.000Z',
    session: {
      id: 'session-1', userId: 'user-1', deviceId: 'device-1',
      activeRole: 'teacher', eligibleRoles: ['teacher'], rowVersion: 1,
    },
    profile: { userId: 'user-1', activeRole: 'teacher', eligibleRoles: ['teacher'], teacherId: 'teacher-1' },
  });
  let captured;
  const fetchImpl = async (url, init) => { captured = { url, init }; return { ok: true, json: async () => ({ success: true, data: { artifactId: 'artifact-1', fileName: 'paper.pdf', fileUrl: '/api/cloud-relay-host/artifacts/artifact-1', accessUrl: '/api/cloud-relay-host/artifacts/artifact-1/access', token: 'short-1' } }) }; };
  const input = { title: 'paper', format: 'pdf', formulaMode: 'word-native', questionIds: ['q1'], answerPosition: 'end' };
  const result = await requestHostPaperExportRuntime('/api/question-bank', input, { fetchImpl, storage, idempotencyKeyFactory: () => 'idem-1' });
  assert.strictEqual(captured.url, '/api/question-bank/paper-export');
  assert.strictEqual(captured.init.headers.Authorization, 'Bearer jwt-token');
  assert.strictEqual(captured.init.headers['x-device-id'], 'device-1');
  assert.strictEqual(captured.init.headers['x-idempotency-key'], 'idem-1');
  assert.strictEqual(JSON.parse(captured.init.body).answerPosition, 'end');
  assert.strictEqual(result.fileName, 'paper.pdf');
  const calls = []; const clicked = []; let revoked = '';
  const downloadFetch = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return { ok: false, status: 410 };
    if (calls.length === 2) return { ok: true, status: 200, json: async () => ({ success: true, data: { token: 'short-2', fileUrl: result.fileUrl } }) };
    return { ok: true, status: 200, blob: async () => new Blob(['pdf']) };
  };
  await downloadHostArtifactRuntime('/api/question-bank', result, { storage, fetchImpl: downloadFetch,
    createObjectURL: () => 'blob:paper', revokeObjectURL: value => { revoked = value; },
    createAnchor: () => ({ click() { clicked.push(this.href); } }),
  });
  assert.strictEqual(calls.length, 3, 'expired token must refresh exactly once then retry download');
  assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer jwt-token');
  assert.strictEqual(calls[0].init.headers['x-gewu-artifact-token'], 'short-1');
  assert.strictEqual(calls[1].url, '/api/cloud-relay-host/artifacts/artifact-1/access');
  assert.strictEqual(calls[1].init.method, 'GET');
  assert.strictEqual(calls[2].init.headers['x-gewu-artifact-token'], 'short-2');
  assert.deepStrictEqual(clicked, ['blob:paper'], 'download anchor must point only to a local Blob URL'); assert.strictEqual(revoked, 'blob:paper');
  await assert.rejects(() => requestHostPaperExportRuntime('/api', input, { storage, fetchImpl: async () => ({ ok: false, json: async () => ({ success: false, error: 'denied' }) }) }), /denied/);
  await authorizationSession.clearDesktopAuthorizationSession({ storage });
  await assert.rejects(() => requestHostPaperExportRuntime('/api', input, { storage: { getItem: () => null }, fetchImpl }), /AUTHORIZATION_CONTEXT_REQUIRED/);
  console.log('host paper export behavior checks passed');
})().catch(error => { console.error(error); process.exit(1); });
