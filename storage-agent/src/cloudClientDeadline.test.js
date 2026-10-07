'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { createStorageCloudClient } = require('./cloudClient');

async function main() {
  const sockets = new Set();
  const timers = new Set();
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.url === '/headers') return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"ok":');
    if (req.url === '/trickle') {
      const timer = setInterval(() => res.write(' '), 5);
      timers.add(timer);
      res.on('close', () => { clearInterval(timer); timers.delete(timer); });
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const mode of ['headers', 'body', 'trickle']) {
      const cleanup = new AbortController();
      const client = createStorageCloudClient({ cloudBaseUrl: 'https://cloud.example', agentId: 'nas-test', token: 'x'.repeat(32), requestTimeoutMs: 25,
        fetch: (_, options) => fetch(`http://127.0.0.1:${server.address().port}/${mode}`, { ...options, signal: options.signal || cleanup.signal }) });
      const watchdog = setTimeout(() => cleanup.abort(), 250);
      const started = Date.now();
      try {
        await assert.rejects(client.lease(), error => error.code === 'STORAGE_CLOUD_TIMEOUT');
        assert.ok(Date.now() - started < 200, `${mode} must stop at the overall deadline`);
      } finally { clearTimeout(watchdog); cleanup.abort(); }
    }
    let signal;
    const stalled = createStorageCloudClient({ cloudBaseUrl: 'https://cloud.example', agentId: 'nas-test', token: 'x'.repeat(32), requestTimeoutMs: 25,
      fetch: async (_, options) => { signal = options.signal; return { status: 200, ok: true, json: () => new Promise(() => {}) }; } });
    await assert.rejects(Promise.race([stalled.uploadArtifactDelivery({ deliveryId: 'delivery_test1234', leaseToken: 'l'.repeat(24), bytes: Buffer.from('test') }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('watchdog')), 250))]), error => error.code === 'STORAGE_CLOUD_TIMEOUT');
    assert.equal(signal.aborted, true);
    assert.throws(() => createStorageCloudClient({ cloudBaseUrl: 'https://cloud.example', agentId: 'nas-test', token: 'x'.repeat(32), requestTimeoutMs: 300000 }), /STORAGE_CLOUD_CONFIG_INVALID/);
    console.log('storage cloud overall deadline tests passed');
  } finally {
    for (const timer of timers) clearInterval(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
