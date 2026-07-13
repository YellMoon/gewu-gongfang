const assert = require('assert');

(async () => {
  const { requestHostPaperExportRuntime } = await import('./hostPaperExportRuntime.mjs');
  const storage = { getItem: () => JSON.stringify({ token: 'jwt-token', userId: 'user-1', deviceId: 'device-1' }) };
  let captured;
  const fetchImpl = async (url, init) => { captured = { url, init }; return { ok: true, json: async () => ({ success: true, data: { fileName: 'paper.pdf', fileUrl: '/paper.pdf' } }) }; };
  const input = { title: 'paper', format: 'pdf', formulaMode: 'word-native', questionIds: ['q1'], answerPosition: 'end' };
  const result = await requestHostPaperExportRuntime('/api/question-bank', input, { fetchImpl, storage });
  assert.strictEqual(captured.url, '/api/question-bank/paper-export');
  assert.strictEqual(captured.init.headers.Authorization, 'Bearer jwt-token');
  assert.strictEqual(captured.init.headers['x-device-id'], 'device-1');
  assert.strictEqual(JSON.parse(captured.init.body).answerPosition, 'end');
  assert.strictEqual(result.fileName, 'paper.pdf');
  await assert.rejects(() => requestHostPaperExportRuntime('/api', input, { storage, fetchImpl: async () => ({ ok: false, json: async () => ({ success: false, error: 'denied' }) }) }), /denied/);
  await assert.rejects(() => requestHostPaperExportRuntime('/api', input, { storage: { getItem: () => null }, fetchImpl }), /AUTHORIZATION_CONTEXT_REQUIRED/);
  console.log('host paper export behavior checks passed');
})().catch(error => { console.error(error); process.exit(1); });
