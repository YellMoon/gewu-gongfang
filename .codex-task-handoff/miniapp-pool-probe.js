'use strict';

const fs = require('fs');
const path = require('path');
const WebSocket = require('../output/miniapp-automation/node_modules/ws');

const endpoint = process.argv[2] || 'ws://127.0.0.1:9436';
const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'miniapp-6.1.0-ui-coverage');

function openSocket() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('OPEN_TIMEOUT'));
    }, 12000);
    socket.once('open', () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

function call(socket, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = `gewu-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timeout = setTimeout(() => reject(new Error(`${method}:TIMEOUT`)), 12000);
    const onMessage = (data) => {
      let message;
      try { message = JSON.parse(String(data)); } catch (_error) { return; }
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      if (message.error) reject(new Error(`${method}:${message.error.message || 'RPC_ERROR'}`));
      else resolve(message.result);
    };
    socket.on('message', onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const sockets = await Promise.all(Array.from({ length: 3 }, () => openSocket()));
  try {
    const [current, system, capture] = await Promise.all([
      call(sockets[0], 'App.getCurrentPage'),
      call(sockets[1], 'App.callWxMethod', { method: 'getSystemInfoSync', args: [] }),
      call(sockets[2], 'App.captureScreenshot'),
    ]);
    const screenshotPath = path.join(evidenceDir, 'runtime-current-page.png');
    fs.writeFileSync(screenshotPath, capture.data, 'base64');
    console.log(JSON.stringify({
      connectedSockets: sockets.length,
      page: current.path,
      queryKeys: Object.keys(current.query || {}).sort(),
      platform: system.result?.platform || null,
      screenshotPath,
      screenshotBytes: fs.statSync(screenshotPath).size,
    }));
  } finally {
    for (const socket of sockets) socket.close();
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
