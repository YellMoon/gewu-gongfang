import { readDesktopAuthorizationSession } from './desktopAuthorizationSession.mjs';
import { resolveDesktopIdentityBaseUrl } from './managedSyncConfig.mjs';
const error = code => Object.assign(new Error(code), { code });
export function formatMinor(value) {
  if (value === null || value === undefined) return '未校准';
  const n = BigInt(value), absolute = n < 0n ? -n : n;
  return (n < 0n ? '-' : '') + String(absolute / 100n) + '.' + String(absolute % 100n).padStart(2, '0');
}
export function parseMoney(value) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(value)) throw error('FINANCE_AMOUNT_INVALID');
  const [whole, decimal = ''] = value.replace('-', '').split('.');
  return String((BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'))) * (value.startsWith('-') ? -1n : 1n));
}
export function createPersonalFinanceClient({ readSession = readDesktopAuthorizationSession, fetch = globalThis.fetch, baseUrl = resolveDesktopIdentityBaseUrl() } = {}) {
  const root = new URL(baseUrl);
  if (root.protocol !== 'https:' && !(root.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(root.hostname))) throw error('FINANCE_BASE_URL_INVALID');
  const fingerprint = value => JSON.stringify([value.authorization, value.authContext.userId, value.authContext.activeRole, value.authContext.sessionId]);
  async function request(path, method = 'GET', body, key) {
    const session = readSession(), scope = fingerprint(session);
    if (!['teacher', 'super_admin'].includes(session.authContext.activeRole)) throw error('FINANCE_ACCESS_DENIED');
    const response = await fetch(baseUrl.replace(/\/+$/, '') + '/api/business/personal-finance' + path, {
      method, headers: { Authorization: session.authorization, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'x-idempotency-key': key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000), redirect: 'error',
    });
    const data = await response.json();
    if (fingerprint(readSession()) !== scope) throw error('FINANCE_SESSION_CHANGED');
    if (!response.ok || data.ok === false) throw error(data.code || 'FINANCE_REQUEST_FAILED');
    return data;
  }
  return Object.freeze({
    getLedger: () => request('/ledger'),
    previewFile: input => request('/imports/preview', 'POST', input),
    importFile: (input, key) => request('/imports', 'POST', input, key),
    createAccount: input => request('/accounts', 'POST', input),
    updateAccount: (id, input) => request('/accounts/' + encodeURIComponent(id), 'PATCH', input),
    createLink: input => request('/links', 'POST', input),
    deleteLink: (id, input) => request('/links/' + encodeURIComponent(id), 'DELETE', input),
    createBalanceSnapshot: input => request('/balance-snapshots', 'POST', input),
    annotateObservation: (id, input) => request('/transactions/' + encodeURIComponent(id), 'PATCH', input),
    mailboxStatus: () => request('/mailbox'),
    checkMailbox: input => request('/mailbox/check', 'POST', input || {}),
    previewMailbox: input => request('/mailbox/preview', 'POST', input),
    importMailbox: (input, key) => request('/mailbox/import', 'POST', input, key),
  });
}
