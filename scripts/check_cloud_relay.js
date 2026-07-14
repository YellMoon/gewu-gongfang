const base = (process.env.GEWU_CLOUD_BASE_URL || process.argv[2] || '').replace(/\/+$/, '');
const smokeJwt = process.env.SMOKE_JWT || '';
const hostToken = process.env.GEWU_CLOUD_RELAY_HOST_TOKEN || process.env.GEWU_DESKTOP_SYNC_TOKEN || '';

if (!base) {
  console.error('Missing GEWU_CLOUD_BASE_URL or URL argument');
  process.exitCode = 1;
  return;
}

if (!hostToken) {
  console.error('Missing GEWU_CLOUD_RELAY_HOST_TOKEN or GEWU_DESKTOP_SYNC_TOKEN');
  process.exitCode = 1;
  return;
}

function userHeaders(extra = {}) {
  return {
    ...extra,
    ...(smokeJwt ? { Authorization: `Bearer ${smokeJwt}` } : {}),
  };
}

function hostHeaders(extra = {}) {
  return { ...extra, 'x-gewu-host-token': hostToken };
}

async function readJson(response, label) {
  if (!response.ok) {
    throw new Error(`${label} request failed with HTTP ${response.status}`);
  }
  return response.json();
}

async function verifyAnonymousUserBoundary() {
  const response = await fetch(`${base}/api/cloud/snapshots/read?snapshotType=smoke`);
  if (![401, 403].includes(response.status)) {
    throw new Error(`anonymous snapshot read should be rejected, got HTTP ${response.status}`);
  }
}

async function main() {
  const heartbeat = await fetch(`${base}/api/cloud/host/heartbeat`, {
    method: 'POST',
    headers: hostHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ hostDeviceId: 'smoke_host', status: 'online' }),
  }).then(response => readJson(response, 'heartbeat'));
  if (!heartbeat.success) throw new Error('heartbeat failed');

  const snapshot = await fetch(`${base}/api/cloud/snapshots/publish`, {
    method: 'POST',
    headers: hostHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      snapshotType: 'smoke',
      payload: { ok: true },
      sourceDeviceId: 'smoke_host',
    }),
  }).then(response => readJson(response, 'snapshot publish'));
  if (!snapshot.success) throw new Error('snapshot publish failed');

  await verifyAnonymousUserBoundary();

  if (!smokeJwt) {
    const pendingTasks = await fetch(`${base}/api/cloud/tasks?status=pending_host`, {
      headers: hostHeaders(),
    }).then(response => readJson(response, 'host task list'));
    if (!pendingTasks.success || !Array.isArray(pendingTasks.tasks)) throw new Error('host task list failed');
    console.log('cloud relay smoke passed (host protocol and anonymous user boundary; authenticated user flow skipped: SMOKE_JWT not set)');
    return;
  }

  const read = await fetch(`${base}/api/cloud/snapshots/read?snapshotType=smoke`, {
    headers: userHeaders(),
  })
    .then(response => readJson(response, 'snapshot read'));
  if (!read.success || !read.snapshot) throw new Error('snapshot read failed');

  const createdTask = await fetch(`${base}/api/cloud/tasks`, {
    method: 'POST',
    headers: userHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      taskType: 'question-paper',
      payload: { title: 'Smoke Test Paper', questionCount: 1 },
      createdBy: 'smoke',
    }),
  }).then(response => readJson(response, 'task create'));
  if (!createdTask.success || !createdTask.task?.id) throw new Error('task create failed');
  const taskId = createdTask.task.id;

  const pendingTasks = await fetch(`${base}/api/cloud/tasks?status=pending_host`, {
    headers: hostHeaders(),
  })
    .then(response => readJson(response, 'task list'));
  if (!pendingTasks.success || !pendingTasks.tasks?.some(task => task.id === taskId)) {
    throw new Error('task list failed');
  }

  const completedTask = await fetch(`${base}/api/cloud/tasks/${taskId}/complete`, {
    method: 'POST',
    headers: hostHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      success: true,
      hostDeviceId: 'smoke_host',
      result: { title: 'Smoke Test Paper', questionCount: 1 },
    }),
  }).then(response => readJson(response, 'task complete'));
  if (!completedTask.success || completedTask.task?.status !== 'completed') {
    throw new Error('task complete failed');
  }

  const taskResult = await fetch(`${base}/api/cloud/tasks/${taskId}/result`, {
    headers: userHeaders(),
  })
    .then(response => readJson(response, 'task result'));
  if (!taskResult.success || taskResult.task?.status !== 'completed') {
    throw new Error('task result failed');
  }

  console.log('cloud relay smoke passed');
}

main().catch(error => {
  console.error('cloud relay smoke failed');
  console.error(error.message || error);
  process.exitCode = 1;
});
