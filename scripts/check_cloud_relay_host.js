const base = (process.env.GEWU_HOST_BASE_URL || process.argv[2] || 'http://127.0.0.1:3001').replace(/\/+$/, '');

async function readJson(response, label) {
  if (!response.ok) {
    throw new Error(`${label} request failed with HTTP ${response.status}`);
  }
  return response.json();
}

async function post(path) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }).then(response => readJson(response, path));
}

async function get(path) {
  return fetch(`${base}${path}`).then(response => readJson(response, path));
}

async function main() {
  const heartbeat = await post('/api/cloud-relay-host/heartbeat');
  if (!heartbeat.success && !heartbeat.skipped) throw new Error('host heartbeat failed');

  const snapshot = await post('/api/cloud-relay-host/snapshot');
  if (!snapshot.success && !snapshot.skipped) throw new Error('host snapshot failed');

  const pending = await get('/api/cloud-relay-host/tasks/pending');
  if (!pending.success && !pending.skipped) throw new Error('host pending task fetch failed');

  const processed = await post('/api/cloud-relay-host/tasks/process');
  if (!processed.success && !processed.skipped) throw new Error('host task process failed');

  console.log('cloud relay host smoke passed');
}

main().catch(error => {
  console.error('cloud relay host smoke failed');
  console.error(error.message || error);
  process.exit(1);
});
