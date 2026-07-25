const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_POLLS = 300;

function relayError(code, cause, statusCode) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  if (statusCode) error.statusCode = statusCode;
  return error;
}

function normalizedBaseUrl(value) {
  const baseUrl = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw relayError('DESKTOP_SESSION_RELAY_BASE_URL_REQUIRED');
  }
  return baseUrl;
}

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function createRequestSecret(cryptoImpl) {
  if (!cryptoImpl?.getRandomValues || !cryptoImpl?.subtle?.digest) {
    throw relayError('DESKTOP_SESSION_RELAY_CRYPTO_UNAVAILABLE');
  }
  const bytes = new Uint8Array(32);
  cryptoImpl.getRandomValues(bytes);
  const secret = bytesToHex(bytes);
  const digest = await cryptoImpl.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret)
  );
  return { secret, secretHash: bytesToHex(new Uint8Array(digest)) };
}

async function requestJson(fetchImpl, url, options = {}) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (cause) {
    throw relayError('DESKTOP_SESSION_RELAY_UNREACHABLE', cause);
  }
  let body;
  try {
    body = await response.json();
  } catch (cause) {
    throw relayError('DESKTOP_SESSION_RELAY_RESPONSE_INVALID', cause, response.status);
  }
  if (!response.ok || body?.success === false) {
    throw relayError(
      body?.code || 'DESKTOP_SESSION_RELAY_REQUEST_FAILED',
      undefined,
      response.status
    );
  }
  return body;
}

async function pollRequest({
  apiBase,
  fetchImpl,
  requestId,
  requestSecret,
  sleep,
  pollIntervalMs,
  maxPolls,
}) {
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const body = await requestJson(
      fetchImpl,
      `${apiBase}/desktop-session/requests/${encodeURIComponent(requestId)}`,
      {
        method: 'GET',
        headers: { 'x-desktop-session-request-secret': requestSecret },
      }
    );
    const request = body?.request;
    if (!request?.status) throw relayError('DESKTOP_SESSION_RELAY_RESPONSE_INVALID');
    if (request.status === 'completed') {
      if (!request.result) throw relayError('DESKTOP_SESSION_RELAY_RESULT_REQUIRED');
      return request.result;
    }
    if (['failed', 'cancelled'].includes(request.status)) {
      throw relayError(request.errorCode || 'DESKTOP_SESSION_RELAY_HOST_REJECTED');
    }
    if (attempt + 1 < maxPolls) await sleep(pollIntervalMs);
  }
  throw relayError('DESKTOP_SESSION_RELAY_TIMEOUT');
}

export async function exchangeDesktopSessionThroughRelay({
  baseUrl,
  authorizationId,
  deviceId,
  fetchImpl = globalThis.fetch,
  signChallenge,
  cryptoImpl = globalThis.crypto,
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxPolls = DEFAULT_MAX_POLLS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw relayError('DESKTOP_SESSION_RELAY_FETCH_REQUIRED');
  if (typeof signChallenge !== 'function') throw relayError('DESKTOP_SESSION_RELAY_SIGNER_REQUIRED');
  if (!Number.isSafeInteger(maxPolls) || maxPolls < 1 || maxPolls > 300) {
    throw relayError('DESKTOP_SESSION_RELAY_POLL_LIMIT_INVALID');
  }
  const apiBase = `${normalizedBaseUrl(baseUrl)}/api/cloud`;
  const { secret: requestSecret, secretHash: requestSecretHash } = await createRequestSecret(cryptoImpl);
  const startBody = await requestJson(fetchImpl, `${apiBase}/desktop-session/challenges/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ authorizationId, deviceId, requestSecretHash }),
  });
  const startRequestId = startBody?.request?.id;
  if (!startRequestId) throw relayError('DESKTOP_SESSION_RELAY_RESPONSE_INVALID');
  const startResult = await pollRequest({
    apiBase,
    fetchImpl,
    requestId: startRequestId,
    requestSecret,
    sleep,
    pollIntervalMs,
    maxPolls,
  });
  const challenge = startResult.challenge;
  if (!challenge?.id) throw relayError('DESKTOP_SESSION_RELAY_CHALLENGE_REQUIRED');
  const proof = await signChallenge({
    purpose: 'session',
    authorizationId: challenge.authorizationId,
    challengeId: challenge.id,
    credentialVersion: challenge.credentialVersion,
    nonce: challenge.nonce,
    nonceIssuedAt: challenge.nonceIssuedAt,
  });
  if (!proof?.signature) throw relayError('DESKTOP_SESSION_RELAY_SIGNATURE_REQUIRED');
  const exchangeBody = await requestJson(
    fetchImpl,
    `${apiBase}/desktop-session/challenges/${encodeURIComponent(challenge.id)}/exchange`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-desktop-session-request-secret': requestSecret,
      },
      body: JSON.stringify({
        startRequestId,
        signature: proof.signature,
        expectedRowVersion: challenge.rowVersion,
      }),
    }
  );
  const exchangeRequestId = exchangeBody?.request?.id;
  if (!exchangeRequestId) throw relayError('DESKTOP_SESSION_RELAY_RESPONSE_INVALID');
  const issued = await pollRequest({
    apiBase,
    fetchImpl,
    requestId: exchangeRequestId,
    requestSecret,
    sleep,
    pollIntervalMs,
    maxPolls,
  });
  if (!issued.token || !issued.session || !issued.offlineLease || !issued.profile) {
    throw relayError('DESKTOP_SESSION_RELAY_RESULT_INVALID');
  }
  return issued;
}
