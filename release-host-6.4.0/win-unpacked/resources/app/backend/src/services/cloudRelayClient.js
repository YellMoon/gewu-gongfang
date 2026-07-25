const IDENTITY_PROVISIONING_CAPABILITY = 'identity-provisioning-v1';
const DESKTOP_PAIRING_CAPABILITY = 'desktop-pairing-v1';

function hostCapabilities() {
  return [IDENTITY_PROVISIONING_CAPABILITY, DESKTOP_PAIRING_CAPABILITY];
}

function buildHeaders(options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const authorization = options.authorization || options.Authorization || '';
  if (authorization) headers.Authorization = authorization;
  const hostCredential = options.hostCredential || options.host_credential || '';
  const hostDeviceId = options.hostDeviceId || options.host_device_id || '';
  const hostGeneration = options.hostGeneration ?? options.host_generation ?? '';
  const hasManagedHostIdentity = Boolean(hostCredential || hostGeneration !== '');
  if (hasManagedHostIdentity) {
    const generation = Number(hostGeneration);
    if (!hostCredential || !hostDeviceId || !Number.isInteger(generation) || generation < 1) {
      throw Object.assign(new Error('managed host identity requires credential, device id, and positive generation'), {
        code: 'MANAGED_HOST_IDENTITY_INCOMPLETE',
      });
    }
    headers['x-gewu-host-device-id'] = String(hostDeviceId);
    headers['x-gewu-host-generation'] = String(generation);
    headers['x-gewu-host-credential'] = String(hostCredential);
    return headers;
  }
  const hostToken = options.hostToken || options.host_token || '';
  if (hostToken) headers['x-gewu-host-token'] = hostToken;
  return headers;
}

function relayResponseError(body = {}, statusCode = 500) {
  return Object.assign(new Error(body.error || body.message || body.code || `cloud relay request failed (${statusCode})`), {
    code: body.code || 'CLOUD_RELAY_REQUEST_FAILED',
    statusCode,
    response: body,
  });
}

async function readJsonResponse(res) {
  const body = await res.json();
  if (res.ok === false || body?.success === false) throw relayResponseError(body, Number(res.status) || (res.ok === false ? 500 : 200));
  return body;
}

async function postJson(url, payload, options = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(options),
    body: JSON.stringify(payload),
  });
  return readJsonResponse(res);
}

function baseUrl() {
  return (process.env.GEWU_CLOUD_BASE_URL || '').replace(/\/+$/, '');
}

function skipped(reason, extra = {}) {
  return { success: false, skipped: true, reason, ...extra };
}

async function publishHeartbeat(payload, options = {}) {
  const base = baseUrl();
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(`${base}/api/cloud/host/heartbeat`, payload, options);
}

async function publishSnapshot(payload, options = {}) {
  const base = baseUrl();
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(`${base}/api/cloud/snapshots/publish`, payload, options);
}

async function publishDesktopPairingCapability(payload, options = {}) {
  const base = baseUrl();
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(`${base}/api/cloud/desktop-pairing/capability`, payload, options);
}

async function fetchPendingTasks(options = {}) {
  const base = baseUrl();
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured', { tasks: [] });
  const query = new URLSearchParams({ status: 'pending_host' });
  if (options.hostDeviceId || options.host_device_id) query.set('hostDeviceId', options.hostDeviceId || options.host_device_id);
  if (options.leaseMs || options.lease_ms) query.set('leaseMs', String(options.leaseMs || options.lease_ms));
  const res = await fetch(`${base}/api/cloud/tasks?${query}`, {
    headers: buildHeaders(options),
  });
  return readJsonResponse(res);
}

async function completeMiniappTask(taskId, payload = {}, options = {}) {
  const base = baseUrl();
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(`${base}/api/cloud/tasks/${taskId}/complete`, payload, options);
}

async function claimMiniappTask(payload = {}, options = {}) {
  const base = baseUrl();
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured', { task: null });
  return postJson(`${base}/api/cloud/tasks/claim`, payload, options);
}

async function updateMiniappTaskProgress(taskId, payload = {}, options = {}) {
  const base = baseUrl();
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(`${base}/api/cloud/tasks/${taskId}/progress`, payload, options);
}

async function failMiniappTask(taskId, payload = {}, options = {}) {
  const base = baseUrl();
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(`${base}/api/cloud/tasks/${taskId}/fail`, payload, options);
}

async function queryMiniappTaskState(taskId, options = {}) {
  const base = baseUrl();
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured', { task: null });
  const query = new URLSearchParams({ hostDeviceId: String(options.hostDeviceId || options.host_device_id || '') });
  const res = await fetch(`${base}/api/cloud/tasks/${encodeURIComponent(taskId)}/state?${query}`, { headers: buildHeaders(options) });
  return readJsonResponse(res);
}

module.exports = {
  DESKTOP_PAIRING_CAPABILITY,
  IDENTITY_PROVISIONING_CAPABILITY,
  hostCapabilities,
  publishHeartbeat,
  publishSnapshot,
  publishDesktopPairingCapability,
  fetchPendingTasks,
  completeMiniappTask,
  claimMiniappTask,
  updateMiniappTaskProgress,
  failMiniappTask,
  queryMiniappTaskState,
  buildHeaders,
  readJsonResponse,
};
