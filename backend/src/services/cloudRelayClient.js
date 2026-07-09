function buildHeaders(options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const authorization = options.authorization || options.Authorization || '';
  if (authorization) headers.Authorization = authorization;
  const hostToken = options.hostToken || options.host_token || '';
  if (hostToken) headers['x-gewu-host-token'] = hostToken;
  return headers;
}

async function postJson(url, payload, options = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(options),
    body: JSON.stringify(payload),
  });
  return res.json();
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

async function fetchPendingTasks(options = {}) {
  const base = baseUrl();
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured', { tasks: [] });
  const res = await fetch(`${base}/api/cloud/tasks?status=pending_host`, {
    headers: buildHeaders(options),
  });
  return res.json();
}

async function completeMiniappTask(taskId, payload = {}, options = {}) {
  const base = baseUrl();
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(`${base}/api/cloud/tasks/${taskId}/complete`, payload, options);
}

module.exports = {
  publishHeartbeat,
  publishSnapshot,
  fetchPendingTasks,
  completeMiniappTask,
  buildHeaders,
};
