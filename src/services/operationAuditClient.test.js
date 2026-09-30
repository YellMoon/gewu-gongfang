const assert = require('node:assert/strict');

(async () => {
  const { loadOperationAudits, auditErrorMessage } = await import('./operationAuditClient.mjs');
  let request;
  const data = await loadOperationAudits({
    baseUrl: 'https://example.test/cloud-business/', session: { authorization: 'Bearer test' },
    filters: { page: 3, pageSize: 20, q: '课程 A', action: 'update', status: 'conflict', from: '2026-09-01T00:00:00.000Z' },
    fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ success: true, data: { items: [{ id: '1' }], total: 52, scope: 'self' } }) }; },
  });
  const url = new URL(request.url);
  assert.equal(url.pathname, '/cloud-business/api/desktop/operation-audits');
  assert.equal(url.searchParams.get('offset'), '40');
  assert.equal(url.searchParams.get('q'), '课程 A');
  assert.equal(request.options.headers.Authorization, 'Bearer test');
  assert.equal(data.total, 52);
  assert.equal(data.scope, 'self');
  let calls = 0;
  await assert.rejects(loadOperationAudits({ baseUrl: 'https://example.test', session: {}, fetchImpl: () => { calls++; } }), /AUTHORIZATION_CONTEXT_REQUIRED/);
  assert.equal(calls, 0);
  await assert.rejects(loadOperationAudits({ baseUrl: 'https://example.test', session: { authorization: 'Bearer test' }, fetchImpl: async () => ({ ok: false, json: async () => ({ code: 'CLOUD_BUSINESS_ACCESS_DENIED' }) }) }), /CLOUD_BUSINESS_ACCESS_DENIED/);
  await assert.rejects(loadOperationAudits({ baseUrl: 'https://example.test', session: { authorization: 'Bearer test' }, fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, data: {} }) }) }), /OPERATION_AUDIT_RESPONSE_INVALID/);
  assert.match(auditErrorMessage('CLOUD_BUSINESS_ACCESS_DENIED'), /权限|登录/);
  assert.match(auditErrorMessage('NETWORK'), /云端|连接/);
  const abortController = new AbortController();
  const aborted = loadOperationAudits({ baseUrl: 'https://example.test', session: { authorization: 'Bearer test' }, signal: abortController.signal,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })),
  });
  abortController.abort();
  await assert.rejects(aborted, /cancelled/);
  console.log('operationAuditClient tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
