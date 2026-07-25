'use strict';

const fs = require('fs');
const path = require('path');
const WebSocket = require('../output/miniapp-automation/node_modules/ws');

const endpoint = process.argv[2] || 'ws://127.0.0.1:9431';
const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'miniapp-6.1.0-ui-coverage');

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = `gewu-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const socket = new WebSocket(endpoint);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`${method}:TIMEOUT`));
    }, 12000);
    socket.on('open', () => socket.send(JSON.stringify({ id, method, params })));
    socket.on('message', (data) => {
      let message;
      try { message = JSON.parse(String(data)); } catch (_error) { return; }
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error) reject(new Error(`${method}:${message.error.message || 'RPC_ERROR'}`));
      else resolve(message.result);
    });
    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`${method}:${error.code || 'WS_ERROR'}`));
    });
  });
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const tool = await call('Tool.getInfo');
  const current = await call('App.getCurrentPage');
  const system = await call('App.callWxMethod', { method: 'getSystemInfoSync', args: [] });
  const capture = await call('App.captureScreenshot');
  const screenshotPath = path.join(evidenceDir, 'runtime-current-page.png');
  fs.writeFileSync(screenshotPath, capture.data, 'base64');
  console.log(JSON.stringify({
    toolVersion: tool.version,
    sdkVersion: tool.SDKVersion,
    page: current.path,
    queryKeys: Object.keys(current.query || {}).sort(),
    platform: system.result?.platform || null,
    screenshotPath,
    screenshotBytes: fs.statSync(screenshotPath).size,
  }));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
