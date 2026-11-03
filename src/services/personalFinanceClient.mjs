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
    const controller = new AbortController();
    let timeout;
    const armTimeout = () => { clearTimeout(timeout); timeout = setTimeout(() => controller.abort(), 60000); timeout.unref?.(); };
    armTimeout();
    try {
    const response = await fetch(baseUrl.replace(/\/+$/, '') + '/api/business/personal-finance' + path, {
      method, headers: { Authorization: session.authorization, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'x-idempotency-key': key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal, redirect: 'error',
    });
    let data;
    if (path === '/ledger' && response.ok && typeof response.body?.getReader === 'function') {
      // A large verified ledger can transfer for over a minute. Bound inactivity,
      // rather than cancelling a healthy download after its first 60 seconds.
      armTimeout();
      const reader = response.body.getReader(), decoder = new TextDecoder(), parts = [];
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          armTimeout();
          parts.push(decoder.decode(chunk.value, { stream: true }));
        }
        parts.push(decoder.decode());
        data = JSON.parse(parts.join(''));
      } finally { reader.releaseLock(); }
    } else data = await response.json();
    if (fingerprint(readSession()) !== scope) throw error('FINANCE_SESSION_CHANGED');
    if (!response.ok || data.ok === false) throw error(data.code || 'FINANCE_REQUEST_FAILED');
    return data;
    } catch (caught) {
      if (controller.signal.aborted || ['AbortError', 'TimeoutError'].includes(caught?.name)) throw error('FINANCE_REQUEST_TIMEOUT');
      throw caught;
    } finally { clearTimeout(timeout); }
  }
  return Object.freeze({
    getMetadata: () => request('/metadata'),
    queryProjection: input => request('/projection', 'POST', input || {}),
    transactionDetails: id => request('/transactions/' + encodeURIComponent(id)),
    searchObservations: input => request('/observations/search', 'POST', input || {}),
    getLedger: async () => {
      const result = await request('/ledger');
      // The compatibility field omits reset decisions for older clients. Current
      // readers need the complete immutable sequence used by cloud projections.
      if (Array.isArray(result.ledger?.annotationHistory)) {
        const { annotationHistory, ...ledger } = result.ledger;
        return { ...result, ledger: { ...ledger, annotations: annotationHistory } };
      }
      return result;
    },
    discoverAccounts: input => request('/accounts/discover', 'POST', input || {}),
    tuitionReviewState: () => request('/tuition-review'),
    submitTuitionReview: (input,key) => request('/tuition-review/submit','POST',input,key),
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
