const base = (process.env.GEWU_CLOUD_BASE_URL || process.argv[2] || '').replace(/\/+$/, '');

if (!base) {
  console.error('Missing GEWU_CLOUD_BASE_URL or URL argument');
  process.exit(1);
}

async function readJson(response, label) {
  if (!response.ok) {
    throw new Error(`${label} request failed with HTTP ${response.status}`);
  }
  return response.json();
}

async function main() {
  const heartbeat = await fetch(`${base}/api/cloud/host/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostDeviceId: 'smoke_host', status: 'online' }),
  }).then(response => readJson(response, 'heartbeat'));
  if (!heartbeat.success) throw new Error('heartbeat failed');

  const snapshot = await fetch(`${base}/api/cloud/snapshots/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snapshotType: 'smoke',
      payload: { ok: true },
      sourceDeviceId: 'smoke_host',
    }),
  }).then(response => readJson(response, 'snapshot publish'));
  if (!snapshot.success) throw new Error('snapshot publish failed');

  const read = await fetch(`${base}/api/cloud/snapshots/read?snapshotType=smoke`)
    .then(response => readJson(response, 'snapshot read'));
  if (!read.success || !read.snapshot) throw new Error('snapshot read failed');

  console.log('cloud relay smoke passed');
}

main().catch(error => {
  console.error('cloud relay smoke failed');
  console.error(error.message || error);
  process.exit(1);
});
