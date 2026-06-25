async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

async function publishHeartbeat(payload) {
  const base = baseUrl();
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(`${base}/api/cloud/host/heartbeat`, payload);
}

async function publishSnapshot(payload) {
  const base = baseUrl();
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured');
  return postJson(`${base}/api/cloud/snapshots/publish`, payload);
}

async function fetchPendingTasks() {
  const base = baseUrl();
  if (!base) return skipped('GEWU_CLOUD_BASE_URL is not configured', { tasks: [] });
  const res = await fetch(`${base}/api/cloud/tasks?status=pending_host`);
  return res.json();
}

module.exports = {
  publishHeartbeat,
  publishSnapshot,
  fetchPendingTasks,
};
