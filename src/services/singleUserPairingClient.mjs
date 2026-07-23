const PAIRING_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;

function pairingError(code, cause, statusCode) {
  const rawCode = String(code || 'DESKTOP_PAIRING_FAILED');
  const stableCode = ({
    DESKTOP_PAIRING_GRANT_EXPIRED: 'PAIRING_CODE_EXPIRED',
    DESKTOP_PAIRING_GRANT_UNAVAILABLE: 'PAIRING_CODE_USED',
    DESKTOP_PAIRING_REQUEST_REPLAYED: 'PAIRING_CODE_USED',
    DESKTOP_PAIRING_GRANT_LOCKED: 'PAIRING_CODE_LOCKED',
    DESKTOP_PAIRING_CODE_INVALID: 'PAIRING_CODE_INVALID',
    DESKTOP_PAIRING_CAPABILITY_UNAVAILABLE: 'PAIRING_CAPABILITY_STALE',
    DESKTOP_PAIRING_KEY_ALREADY_BOUND: 'DESKTOP_DEVICE_FINGERPRINT_MISMATCH',
  })[rawCode] || rawCode;
  const error = new Error(stableCode);
  error.code = stableCode;
  if (cause) error.cause = cause;
  if (statusCode) error.statusCode = statusCode;
  return error;
}

function normalizedBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizedCloudRelayBaseUrl(value) {
  const normalized = normalizedBaseUrl(value);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch (_error) {
    // Preserve non-standard development bases so existing test and local transports can diagnose them.
  }
  return normalized;
}

async function readJson(response) {
  let body;
  try {
    body = await response.json();
  } catch (cause) {
    throw pairingError('PAIRING_RESPONSE_INVALID', cause, Number(response?.status) || 0);
  }
  if (!response?.ok || body?.success === false) {
    throw pairingError(body?.code || 'DESKTOP_PAIRING_REQUEST_FAILED', null, Number(response?.status) || 0);
  }
  return body;
}

async function fetchCapability(fetchImpl, baseUrl, path, channel) {
  const response = await fetchImpl(`${baseUrl}${path}`, { method: 'GET' });
  const body = await readJson(response);
  const capability = body?.capability;
  if (!capability?.id || !capability?.protocolVersion || !capability?.publicKey || !capability?.expiresAt) {
    throw pairingError('PAIRING_CAPABILITY_INVALID');
  }
  if (Date.parse(capability.expiresAt) <= Date.now()) {
    throw pairingError('PAIRING_CAPABILITY_STALE');
  }
  return Object.freeze({ channel, baseUrl, capability: Object.freeze({ ...capability }) });
}

function resultFromBody(body = {}) {
  const source = body.result && typeof body.result === 'object' ? body.result : body;
  if (!source.authorization || !source.profile || !source.offlineLease) {
    throw pairingError('PAIRING_RESULT_INVALID');
  }
  return Object.freeze({
    authorization: source.authorization,
    profile: source.profile,
    offlineLease: source.offlineLease,
    authorizationSummary: source.authorizationSummary || null,
  });
}

async function sha256Hex(value, cryptoImpl) {
  if (!cryptoImpl?.subtle?.digest) throw pairingError('PAIRING_CRYPTO_UNAVAILABLE');
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizePairingCode(value) {
  const normalized = String(value || '').replace(/[\s-]+/g, '').toUpperCase();
  if (!PAIRING_CODE_PATTERN.test(normalized)) throw pairingError('PAIRING_CODE_INVALID');
  return normalized;
}

export async function discoverPairingCapability({
  lanBaseUrl,
  cloudBaseUrl,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw pairingError('PAIRING_FETCH_REQUIRED');
  const lan = normalizedBaseUrl(lanBaseUrl);
  if (lan) {
    try {
      return await fetchCapability(
        fetchImpl,
        lan,
        '/api/desktop-identity/single-user/pairing-capability',
        'direct'
      );
    } catch (_directError) {
      // Cloud is the managed fallback when LAN discovery or capability validation fails.
    }
  }
  const cloud = normalizedCloudRelayBaseUrl(cloudBaseUrl);
  if (!cloud) throw pairingError('PAIRING_API_BASE_REQUIRED');
  try {
    return await fetchCapability(
      fetchImpl,
      cloud,
      '/api/cloud/desktop-pairing/capability',
      'cloud'
    );
  } catch (cause) {
    if (cause?.code) throw cause;
    throw pairingError('PAIRING_HOST_OFFLINE', cause);
  }
}

export async function submitPairingRequest({
  discovery,
  envelope,
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
} = {}) {
  if (!discovery?.baseUrl || !['direct', 'cloud'].includes(discovery.channel)) {
    throw pairingError('PAIRING_CAPABILITY_REQUIRED');
  }
  if (!envelope || typeof envelope !== 'object') throw pairingError('PAIRING_ENVELOPE_REQUIRED');
  if (discovery.channel === 'direct') {
    const body = await readJson(await fetchImpl(
      `${discovery.baseUrl}/api/desktop-identity/single-user/pairing-requests`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      }
    ));
    return Object.freeze({
      channel: 'direct',
      baseUrl: discovery.baseUrl,
      status: 'completed',
      result: resultFromBody(body),
    });
  }
  if (!cryptoImpl?.getRandomValues) throw pairingError('PAIRING_CRYPTO_UNAVAILABLE');
  const secretBytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  const requestSecret = Array.from(secretBytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const requestSecretHash = await sha256Hex(requestSecret, cryptoImpl);
  const body = await readJson(await fetchImpl(
    `${discovery.baseUrl}/api/cloud/desktop-pairing/requests`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envelope, requestSecretHash }),
    }
  ));
  if (!body?.request?.id || !body.request.expiresAt) throw pairingError('PAIRING_REQUEST_INVALID');
  return Object.freeze({
    channel: 'cloud',
    baseUrl: discovery.baseUrl,
    requestId: body.request.id,
    requestSecret,
    status: body.request.status || 'pending_host',
    expiresAt: body.request.expiresAt,
  });
}

export async function pollPairingResult({ pending, fetchImpl = globalThis.fetch } = {}) {
  if (pending?.channel === 'direct' && pending.result) return pending;
  if (pending?.channel !== 'cloud' || !pending.requestId || !pending.requestSecret || !pending.baseUrl) {
    throw pairingError('PAIRING_REQUEST_CONTEXT_REQUIRED');
  }
  const body = await readJson(await fetchImpl(
    `${pending.baseUrl}/api/cloud/desktop-pairing/requests/${encodeURIComponent(pending.requestId)}`,
    { method: 'GET', headers: { 'x-pairing-request-secret': pending.requestSecret } }
  ));
  const request = body?.request;
  if (!request?.status) throw pairingError('PAIRING_RESPONSE_INVALID');
  if (['rejected', 'expired', 'failed'].includes(request.status)) {
    throw pairingError(request.errorCode || (request.status === 'expired' ? 'PAIRING_CODE_EXPIRED' : 'PAIRING_REQUEST_REJECTED'));
  }
  return Object.freeze({
    ...pending,
    status: request.status,
    expiresAt: request.expiresAt || pending.expiresAt,
    ...(request.status === 'completed' ? { result: resultFromBody(request.result) } : {}),
  });
}
