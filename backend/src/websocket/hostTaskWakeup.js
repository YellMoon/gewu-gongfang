const HostWebSocketClient = require('./client');

function gatewayWebSocketUrl(cloudBaseUrl) {
  try {
    const url = new URL(String(cloudBaseUrl || '').trim());
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return '';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol === 'http:') url.protocol = 'ws:';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch (_error) {
    return '';
  }
}

function createHostTaskWakeup({
  runtimeConfig = {},
  hostToken = process.env.GEWU_CLOUD_RELAY_HOST_TOKEN || '',
  localPort = Number(process.env.PORT || 3001),
  HostWebSocketClient: Client = HostWebSocketClient,
  fetchImpl = globalThis.fetch,
  log = () => {},
} = {}) {
  if (runtimeConfig.nodeRole !== 'primary-host' || !runtimeConfig.deviceId || !hostToken) return null;
  const gatewayUrl = gatewayWebSocketUrl(runtimeConfig.cloudBaseUrl || process.env.GEWU_CLOUD_BASE_URL);
  if (!gatewayUrl || typeof fetchImpl !== 'function') return null;
  const client = new Client({
    hostDeviceId: runtimeConfig.deviceId,
    gatewayUrl,
    hostToken,
  });
  let stopped = false;
  let processing = null;
  const wake = () => {
    if (stopped || processing) return processing;
    processing = Promise.resolve(fetchImpl(`http://127.0.0.1:${Number(localPort)}/api/cloud-relay-host/tasks/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(runtimeConfig.desktopSyncToken ? { 'x-gewu-desktop-sync-token': runtimeConfig.desktopSyncToken } : {}),
      },
      body: JSON.stringify({ skipMaintenance: true }),
    })).then(async response => {
      if (!response?.ok) throw new Error(`HOST_TASK_WAKE_HTTP_${response?.status || 0}`);
      const payload = await response.json();
      if (payload?.success === false) throw new Error(payload.code || 'HOST_TASK_WAKE_REJECTED');
      return payload;
    }).catch(error => {
      log(`Host WebSocket task wake failed: ${error.message}`);
      return null;
    }).finally(() => { processing = null; });
    return processing;
  };
  client.on('new_task', wake);
  client.on('error', error => log(`Host WebSocket error: ${error.message}`));
  return Object.freeze({
    client,
    start() { if (!stopped) client.connect(); },
    stop() {
      stopped = true;
      client.removeListener?.('new_task', wake);
      client.disconnect();
    },
    wake,
  });
}

module.exports = { createHostTaskWakeup, gatewayWebSocketUrl };
