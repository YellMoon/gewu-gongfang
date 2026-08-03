const { requestHash, resultHash, taskRow, parseJson } = require('../../../shared/cloudRelayLogic');

const IDENTITY_PROVISIONING_CAPABILITY = 'identity-provisioning-v1';

function hostCapabilities() { return [IDENTITY_PROVISIONING_CAPABILITY]; }

function buildHeaders(options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const authorization = options.authorization || options.Authorization || '';
  if (authorization) headers.Authorization = authorization;
  const hostCredential = options.hostCredential || options.host_credential || '';
  const hostDeviceId = options.hostDeviceId || options.host_device_id || '';
  const hostGeneration = options.hostGeneration ?? options.host_generation ?? '';
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

function taskOperationBaseUrl(options = {}) {
  return String(options.relayBaseUrl || options.relay_base_url || baseUrl()).replace(/\/+$/, '');
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

async function completeMiniappTask(taskId, payload = {}, options = {}) {
  const base = taskOperationBaseUrl(options);
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(`${base}/api/cloud/tasks/${taskId}/complete`, payload, options);
}

async function claimMiniappTask(payload = {}, options = {}) {
  const base = taskOperationBaseUrl(options);
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured', { task: null });
  const claimed = await postJson(`${base}/api/cloud/tasks/claim`, payload, options);
  return { ...claimed, relayBaseUrl: base };
}

async function updateMiniappTaskProgress(taskId, payload = {}, options = {}) {
  const base = taskOperationBaseUrl(options);
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(`${base}/api/cloud/tasks/${taskId}/progress`, payload, options);
}

async function failMiniappTask(taskId, payload = {}, options = {}) {
  const base = taskOperationBaseUrl(options);
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(`${base}/api/cloud/tasks/${taskId}/fail`, payload, options);
}

async function queryMiniappTaskState(taskId, options = {}) {
  const base = taskOperationBaseUrl(options);
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured', { task: null });
  const query = new URLSearchParams({ hostDeviceId: String(options.hostDeviceId || options.host_device_id || '') });
  const res = await fetch(`${base}/api/cloud/tasks/${encodeURIComponent(taskId)}/state?${query}`, { headers: buildHeaders(options) });
  return readJsonResponse(res);
}

async function readRelayTaskActorGrant(taskId, options = {}) {
  const base = taskOperationBaseUrl(options);
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  const res = await fetch(`${base}/api/cloud/tasks/${encodeURIComponent(taskId)}/actor-grant`, {
    headers: buildHeaders(options),
  });
  return readJsonResponse(res);
}

async function claimAuthorityCommands(payload = {}, options = {}) {
  const base = taskOperationBaseUrl(options);
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured', { commands: [] });
  return postJson(`${base}/api/authority/host/commands/claim`, payload, options);
}

async function renewAuthorityCommand(commandId, payload = {}, options = {}) {
  const base = taskOperationBaseUrl(options);
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(
    `${base}/api/authority/host/commands/${encodeURIComponent(commandId)}/renew`,
    payload,
    options,
  );
}

async function publishAuthorityReceipt(commandId, payload = {}, options = {}) {
  const base = taskOperationBaseUrl(options);
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(
    `${base}/api/authority/host/commands/${encodeURIComponent(commandId)}/receipt`,
    payload,
    options,
  );
}

async function publishAuthorityProjection(projection, options = {}) {
  const base = taskOperationBaseUrl(options);
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(
    `${base}/api/authority/host/projections`,
    { projection },
    options,
  );
}

async function publishAuthorityHostEpoch(epoch, options = {}) {
  const base = taskOperationBaseUrl(options);
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(
    `${base}/api/authority/host/epoch`,
    { epoch },
    options,
  );
}

async function publishAuthorityControlRecords(snapshot, options = {}) {
  const base = taskOperationBaseUrl(options);
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(
    `${base}/api/authority/host/control-records`,
    { snapshot },
    options,
  );
}

async function readAuthorityHostEpoch(options = {}) {
  const base = taskOperationBaseUrl(options);
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  const res = await fetch(`${base}/api/authority/host/epoch`, { headers: buildHeaders(options) });
  return readJsonResponse(res);
}

async function readAuthorityControlRecords(options = {}) {
  const base = taskOperationBaseUrl(options);
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  const res = await fetch(`${base}/api/authority/host/control-records`, {
    headers: buildHeaders(options),
  });
  return readJsonResponse(res);
}

function createAuthorityCommandSource(options = {}) {
  return Object.freeze({
    async claim(input) {
      const response = await claimAuthorityCommands(input, options);
      return Array.isArray(response.commands) ? response.commands : [];
    },
    async renew(input) {
      const response = await renewAuthorityCommand(input.commandId, input, options);
      return response.claim;
    },
    async publishReceipt(receipt, claim) {
      const response = await publishAuthorityReceipt(receipt.commandId, {
        claimToken: claim?.claimToken,
        receipt,
      }, options);
      return response.receipt;
    },
  });
}

module.exports = {
  IDENTITY_PROVISIONING_CAPABILITY,
  hostCapabilities,
  publishHeartbeat,
  publishSnapshot,
  completeMiniappTask,
  claimMiniappTask,
  updateMiniappTaskProgress,
  failMiniappTask,
  queryMiniappTaskState,
  readRelayTaskActorGrant,
  claimAuthorityCommands,
  renewAuthorityCommand,
  publishAuthorityReceipt,
  publishAuthorityControlRecords,
  readAuthorityHostEpoch,
  readAuthorityControlRecords,
  publishAuthorityHostEpoch,
  publishAuthorityProjection,
  createAuthorityCommandSource,
  buildHeaders,
  readJsonResponse,
  // 共享逻辑
  requestHash,
  resultHash,
  taskRow,
  parseJson,
};
