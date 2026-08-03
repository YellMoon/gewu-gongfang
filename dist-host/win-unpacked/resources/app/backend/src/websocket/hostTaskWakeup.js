const HostWebSocketClient = require('./client');

function gatewayWebSocketUrl(cloudBaseUrl) {
  try {
    const url = new URL(String(cloudBaseUrl || '').trim());
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return '';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol === 'http:') url.protocol = 'ws:';
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch (_error) {
    return '';
  }
}

function createHostTaskWakeup({
  runtimeConfig = {},
  localPort = Number(process.env.PORT || 3001),
  HostWebSocketClient: Client = HostWebSocketClient,
  worker = null,
  authorityFrameHandler = null,
  log = () => {},
} = {}) {
  const hostCredential = runtimeConfig.hostCredential || process.env.GEWU_PRIMARY_HOST_CREDENTIAL || '';
  const hostGeneration = Number(
    runtimeConfig.primaryHostGeneration
    || runtimeConfig.hostGeneration
    || process.env.GEWU_PRIMARY_HOST_GENERATION
    || 0
  );
  if (runtimeConfig.nodeRole !== 'primary-host' || !runtimeConfig.deviceId || !hostCredential
    || !Number.isSafeInteger(hostGeneration) || hostGeneration < 1 || !worker || typeof worker.wake !== 'function') return null;
  const gatewayUrl = gatewayWebSocketUrl(runtimeConfig.cloudBaseUrl || process.env.GEWU_CLOUD_BASE_URL);
  if (!gatewayUrl) return null;
  const client = new Client({
    hostDeviceId: runtimeConfig.deviceId,
    gatewayUrl,
    hostCredential,
    hostGeneration,
  });
  let stopped = false;
  let processing = null;
  const cloud = {
    state: 'configured',
    lastError: null,
    lastConnectedAt: null,
    lastEventAt: null,
    nextRetryAt: null,
  };
  function cloudStatus(state, error = null) {
    cloud.state = state;
    cloud.lastEventAt = new Date().toISOString();
    if (error) cloud.lastError = error?.code || error?.message || 'CLOUD_CONTROL_UNAVAILABLE';
    const status = client.getStatus?.();
    cloud.nextRetryAt = status?.nextRetryAt || null;
    if (state === 'connected') {
      cloud.lastError = null;
      cloud.lastConnectedAt = cloud.lastEventAt;
    }
  }
  const wake = () => {
    if (stopped || processing) return processing;
    processing = Promise.resolve(worker.wake())
      .catch(error => {
      log(`Host WebSocket task wake failed: ${error.message}`);
      return null;
      }).finally(() => { processing = null; });
    return processing;
  };
  client.on('new_task', wake);
  const handleAuthorityForward = async payload => {
    const relayRequestId = String(payload?.relayRequestId || '');
    if (!relayRequestId || typeof authorityFrameHandler?.handle !== 'function') return;
    const response = await authorityFrameHandler.handle(payload.frame);
    client.send('authority_command_result', { relayRequestId, response });
  };
  client.on('authority_command_forward', handleAuthorityForward);
  client.on('connected', () => cloudStatus('connected'));
  client.on('disconnected', () => cloudStatus('degraded'));
  client.on('error', error => cloudStatus('degraded', error));
  client.on('max_reconnect_attempts', () => cloudStatus('disabled'));
  return Object.freeze({
    client,
    start() {
      if (stopped) return;
      cloudStatus('connecting');
      client.connect();
    },
    stop() {
      stopped = true;
      client.removeListener?.('new_task', wake);
      client.removeListener?.('authority_command_forward', handleAuthorityForward);
      client.disconnect();
    },
    wake,
    status() {
      const clientStatus = client.getStatus?.();
      return Object.freeze({
        running: !stopped,
        cloud: Object.freeze({
          ...cloud,
          nextRetryAt: clientStatus?.nextRetryAt || cloud.nextRetryAt,
          state: clientStatus?.connected ? 'connected' : cloud.state,
        }),
      });
    },
  });
}

module.exports = { createHostTaskWakeup, gatewayWebSocketUrl };
