'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const base = 'https://physicsedu.xyz/scheduling';
const token = process.env.GEWU_DESKTOP_SYNC_TOKEN || '';
if (!token) throw new Error('desktop sync token is unavailable');

const headers = {
  'content-type': 'application/json',
  'x-gewu-desktop-sync-token': token,
};

async function request(path, method) {
  const response = await fetch(`${base}${path}`, { method, headers });
  const body = await response.json();
  if (!response.ok || (!body.success && !body.skipped)) {
    throw new Error(`${path} failed with HTTP ${response.status}`);
  }
  return body;
}

(async () => {
  await request('/api/cloud-relay-host/heartbeat', 'POST');
  await request('/api/cloud-relay-host/snapshot', 'POST');
  await request('/api/cloud-relay-host/tasks/pending', 'GET');
  await request('/api/cloud-relay-host/tasks/process', 'POST');
  console.log('cloud relay host smoke passed with desktop sync credential');
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
