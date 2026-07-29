'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { createIsolatedPrimaryHostProfile } = require('./isolated-primary-host-profile');

const exePath = path.resolve(String(process.env.GEWU_PACKAGED_HOST_EXE || ''));
assert(exePath && fs.existsSync(exePath), 'GEWU_PACKAGED_HOST_EXE_REQUIRED');
const startupTimeoutMs = Math.max(30_000, Number(process.env.GEWU_PACKAGED_HOST_STARTUP_TIMEOUT_MS || 120_000));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(check, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${description}${lastError ? `: ${lastError.message}` : ''}`);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-packaged-host-abi-'));
  const profilePath = path.join(root, 'profile');
  const port = await freePort();
  createIsolatedPrimaryHostProfile({ root, profilePath, hostPort: port });
  const child = childProcess.spawn(exePath, [`--user-data-dir=${profilePath}`], {
    cwd: path.dirname(exePath),
    detached: false,
    windowsHide: true,
    stdio: 'ignore',
  });
  try {
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      return response.ok;
    }, 'PACKAGED_HOST_BACKEND_NOT_HEALTHY', startupTimeoutMs);
    const logPath = path.join(profilePath, 'logs', 'electron-main.log');
    const log = fs.readFileSync(logPath, 'utf8');
    assert.match(log, /Embedded backend listening on 0\.0\.0\.0:/);
    assert.doesNotMatch(log, /NODE_MODULE_VERSION/);
    console.log(JSON.stringify({ success: true, backendPort: port, listener: '0.0.0.0', packaged: true }));
  } finally {
    try { childProcess.execFileSync('taskkill', ['/PID', String(child.pid), '/F'], { stdio: 'ignore' }); } catch (_error) { /* already exited */ }
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); } catch (_error) { /* locked temporary profile is left for manual inspection */ }
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
