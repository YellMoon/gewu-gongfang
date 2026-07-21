'use strict';

const REQUEST_TIMEOUT_MS = 15_000;

class RemovalCheckFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'RemovalCheckFailure';
  }
}

function fail(message) {
  throw new RemovalCheckFailure(message);
}

function parseHttpsUrl(rawValue) {
  const normalized = String(rawValue || '').trim().replace(/\/+$/, '');
  const parsed = new URL(normalized);
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('invalid URL');
  }
  return { normalized, parsed };
}

function loadRemovalCheckConfig(env = process.env) {
  try {
    const gateway = parseHttpsUrl(env.MINIAPP_REVIEW_BASE_URL);
    const backend = parseHttpsUrl(env.MINIAPP_REAL_API_BASE_URL);
    if (gateway.normalized !== gateway.parsed.origin
      || backend.parsed.origin !== gateway.parsed.origin
      || backend.normalized !== `${gateway.parsed.origin}/scheduling`) {
      throw new Error('invalid route ownership');
    }
    return { gatewayUrl: gateway.normalized, backendUrl: backend.normalized };
  } catch (_error) {
    throw new RemovalCheckFailure('review-demo removal check configuration is invalid');
  }
}

async function requestJson(fetchImpl, url, options, expectedStatus, expectedCode, step) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (_error) {
    fail(`${step}: network request failed`);
  }
  if (Number(response?.status) !== expectedStatus) fail(`${step}: unexpected HTTP status`);
  const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') fail(`${step}: invalid JSON content type`);
  let body;
  try {
    body = await response.json();
  } catch (_error) {
    fail(`${step}: invalid JSON response`);
  }
  if (!body || typeof body !== 'object' || body.code !== expectedCode) fail(`${step}: response code mismatch`);
  return body;
}

async function runReviewDemoRemovalCheck(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || global.fetch;
  const log = options.log || console.log;
  const { gatewayUrl, backendUrl } = loadRemovalCheckConfig(env);

  await requestJson(fetchImpl, `${gatewayUrl}/api/auth/review-demo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }, 410, 'REVIEW_DEMO_REMOVED', 'gateway login tombstone');
  await requestJson(fetchImpl, `${gatewayUrl}/api/review-demo/questions`, {
    method: 'GET',
  }, 410, 'REVIEW_DEMO_REMOVED', 'gateway question tombstone');
  await requestJson(fetchImpl, `${gatewayUrl}/api/review-demo/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }, 410, 'REVIEW_DEMO_REMOVED', 'gateway task tombstone');
  await requestJson(fetchImpl, `${backendUrl}/api/experience/questions`, {
    method: 'GET',
  }, 401, 'UNAUTHORIZED', 'scheduling backend experience ownership');

  log('review-demo removal check passed: gateway tombstones active; scheduling backend owns experience APIs');
  return { gatewayTombstone: true, backendOwnsExperience: true };
}

function sanitizeFailure(error) {
  if (error instanceof RemovalCheckFailure) return `review-demo removal check failed: ${error.message}`;
  return 'review-demo removal check failed: unexpected error';
}

if (require.main === module) {
  runReviewDemoRemovalCheck().catch(error => {
    console.error(sanitizeFailure(error));
    process.exitCode = 1;
  });
}

module.exports = {
  RemovalCheckFailure,
  loadRemovalCheckConfig,
  runReviewDemoRemovalCheck,
  sanitizeFailure,
};
