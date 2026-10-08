'use strict';
function createPersonalFinanceTransport({ capture, isSameSession, request, baseUrl }) {
  return async (path, method = 'GET', data, idempotencyKey) => {
    const session = capture();
    if (!session.token) throw Object.assign(new Error('FINANCE_LOGIN_REQUIRED'), { code: 'FINANCE_LOGIN_REQUIRED' });
    const result = await request({ url: baseUrl.replace(/\/+$/, '') + '/api/business/miniapp-personal-finance' + path, method, data, timeout: 60000, header: { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}) } });
    if (!isSameSession(session)) throw Object.assign(new Error('FINANCE_SESSION_CHANGED'), { code: 'FINANCE_SESSION_CHANGED' });
    if (result.statusCode !== 200 || result.data?.ok !== true) { const code = result.data?.code || 'FINANCE_REQUEST_FAILED'; throw Object.assign(new Error(code), { code }); }
    return result.data;
  };
}
module.exports = { createPersonalFinanceTransport };
