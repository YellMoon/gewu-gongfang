require('dotenv').config();
const http = require('http');
const { createApp } = require('./src/app');
const { createHostTaskWakeup } = require('./src/websocket/hostTaskWakeup');
const { resolveBackendPort } = require('./src/runtimePort');

const PORT = resolveBackendPort();
const app = createApp();
const server = http.createServer(app);
let hostTaskWakeup = null;

function runtimeConfigFromEnv() {
  return {
    nodeRole: process.env.GEWU_NODE_ROLE || 'desktop-client',
    deviceId: process.env.GEWU_DEVICE_ID || process.env.HOST_DEVICE_ID || '',
    cloudBaseUrl: process.env.GEWU_CLOUD_BASE_URL || process.env.GATEWAY_WS_URL || '',
    desktopSyncToken: process.env.GEWU_DESKTOP_SYNC_TOKEN || process.env.GEWU_CLOUD_RELAY_HOST_TOKEN || '',
  };
}

server.listen(PORT, () => {
  const runtimeConfig = runtimeConfigFromEnv();
  hostTaskWakeup = createHostTaskWakeup({
    runtimeConfig,
    localPort: PORT,
    log: message => console.warn(`[HostWS] ${message}`),
  });
  hostTaskWakeup?.start();
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`WebSocket host wakeup: ${hostTaskWakeup ? 'enabled' : 'disabled'}`);
});

function shutdown() {
  hostTaskWakeup?.stop();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
