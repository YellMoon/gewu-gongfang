'use strict';
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const execute = promisify(execFile);
const LOCAL_DOCKER_HOST = process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';

function failure(code, message) { return Object.assign(new Error(message), {code}); }
function createLocalDockerReadiness({platform = process.platform, run = execute, exists = fs.existsSync, launch = spawn,
  env = process.env, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 180000} = {}) {
  let pending;
  const environment = {...env};
  for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete environment[key];
  const command = args => run('docker', args, {windowsHide:true, env:environment, timeout:5000, maxBuffer:65536});
  async function ready() {
    try {
      const result = await command(['--host',LOCAL_DOCKER_HOST,'info','--format','{{.OSType}}']);
      if (result.stdout.trim() !== 'linux') throw failure('VNEXT_PG17_DOCKER_LINUX_ENGINE_REQUIRED', 'PostgreSQL tests require the local Docker Linux engine. Select Linux containers in Docker Desktop.');
      return true;
    } catch (error) {
      if (error.code === 'VNEXT_PG17_DOCKER_LINUX_ENGINE_REQUIRED') throw error;
      if (error.code === 'ENOENT') throw failure('VNEXT_PG17_DOCKER_NOT_INSTALLED', 'Docker CLI is unavailable. Install Docker Desktop before running PostgreSQL tests.');
      return false;
    }
  }
  async function prepare() {
    if (await ready()) return;
    if (platform !== 'win32') throw failure('VNEXT_PG17_DOCKER_ENGINE_UNAVAILABLE', 'Start the local Docker daemon before running PostgreSQL tests.');
    try { await command(['desktop','start','--detach']); }
    catch (_) {
      const candidates = [env.ProgramFiles && path.join(env.ProgramFiles,'Docker','Docker','Docker Desktop.exe'),
        env.LOCALAPPDATA && path.join(env.LOCALAPPDATA,'Programs','DockerDesktop','Docker Desktop.exe')].filter(Boolean);
      const executable = candidates.find(exists);
      if (!executable) throw failure('VNEXT_PG17_DOCKER_DESKTOP_START_FAILED', 'Docker Desktop could not start automatically. Check its installation and WSL configuration.');
      const child = launch(executable, [], {windowsHide:true, detached:true, stdio:'ignore', env:environment});
      await new Promise((resolve,reject) => { child.once('spawn',resolve); child.once('error',reject); });
      child.unref();
    }
    process.stderr.write('Waiting for the local Docker Linux engine (up to 180 seconds)...\n');
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      if (await ready()) return;
      await wait(Math.min(2000, Math.max(0, deadline-now())));
    }
    throw failure('VNEXT_PG17_DOCKER_DESKTOP_READY_TIMEOUT', 'Docker Desktop did not become ready within 180 seconds. Check Docker Desktop diagnostics and WSL startup.');
  }
  return function ensureLocalDockerReady() {
    if (!pending) pending = prepare().finally(() => { pending = undefined; });
    return pending;
  };
}
module.exports = {createLocalDockerReadiness, ensureLocalDockerReady:createLocalDockerReadiness()};
