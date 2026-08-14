'use strict';

const { spawn } = require('child_process');
const { randomBytes } = require('crypto');
const { types } = require('util');
const { Client } = require('pg');

const IMAGE_REFERENCE = 'postgres@sha256:a65e6a841f6c4dbc4abda3d67fa3bc21824e9611064fcd82e87ea67aad60a0c3';
const LOCAL_DOCKER_HOST = process.platform === 'win32'
  ? 'npipe:////./pipe/docker_engine'
  : 'unix:///var/run/docker.sock';
const DOCKER_OVERRIDE_KEYS = ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'];
const MAX_OUTPUT_BYTES = 64 * 1024;
const DOCKER_TIMEOUT_MS = 30_000;
const READINESS_TIMEOUT_MS = 30_000;
const handles = new WeakMap();
const runtimes = new WeakMap();

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalidConfig() {
  return codedError('VNEXT_PG17_RUNTIME_CONFIG_INVALID', 'vNext PG17 disposable runtime does not accept configuration');
}

function unavailable() {
  return codedError('VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE', 'Docker PostgreSQL 17 disposable runtime is unavailable');
}

function invalidHandle() {
  return codedError('VNEXT_PG17_HANDLE_INVALID', 'vNext PG17 disposable handle is invalid');
}

function randomToken(bytes = 18) {
  return randomBytes(bytes).toString('hex');
}

function safeEnvironment() {
  const environment = { ...process.env };
  for (const key of DOCKER_OVERRIDE_KEYS) delete environment[key];
  return environment;
}

function dockerOverridesPresent() {
  return DOCKER_OVERRIDE_KEYS.some(key => typeof process.env[key] === 'string' && process.env[key] !== '');
}

function runDocker(args, timeoutMs = DOCKER_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let outputBytes = 0;
    const stdout = [];
    const stderr = [];
    let child;
    try {
      child = spawn('docker', ['--host', LOCAL_DOCKER_HOST, ...args], {
        shell: false,
        windowsHide: true,
        env: safeEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (_) {
      reject(unavailable());
      return;
    }

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const collect = target => chunk => {
      if (outputBytes >= MAX_OUTPUT_BYTES) return;
      const allowed = Math.min(chunk.length, MAX_OUTPUT_BYTES - outputBytes);
      outputBytes += allowed;
      target.push(chunk.subarray(0, allowed));
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.once('error', () => finish(unavailable()));
    child.once('close', code => {
      if (code !== 0) return finish(unavailable());
      finish(null, {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) { /* no-op */ }
      finish(unavailable());
    }, timeoutMs);
  });
}

function parseDockerJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    throw unavailable();
  }
}

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) throw unavailable();
  return `"${identifier}"`;
}

function quoteLiteral(value) {
  if (typeof value !== 'string') throw unavailable();
  return `'${value.replace(/'/g, "''")}'`;
}

async function closeClient(client) {
  if (!client) return;
  try { await client.end(); } catch (_) { /* no-op */ }
}

function explicitClientOptions({ host, port, user, password, database }) {
  return { host, port, user, password, database, ssl: false, connectionTimeoutMillis: 5_000 };
}

async function connectClient(options) {
  const client = new Client(explicitClientOptions(options));
  await client.connect();
  return client;
}

async function waitForAdmin(options) {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const client = await connectClient(options);
      await client.query('SELECT 1');
      return client;
    } catch (_) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw unavailable();
}

function makeFacade(client) {
  return Object.freeze({ query: (text, values) => client.query(text, values) });
}

function runtimeState(runtime) {
  const state = runtimes.get(runtime);
  if (!state) throw invalidHandle();
  return state;
}

async function cleanupContainer(state) {
  if (!state || !state.containerId || state.cleaned) return;
  state.cleaned = true;
  try { await runDocker(['rm', '--force', state.containerId]); } catch (_) { /* no-op */ }
}

async function closeHandles(state) {
  for (const handle of state.handles) {
    const handleState = handles.get(handle);
    if (!handleState || handleState.closed) continue;
    handleState.closed = true;
    await Promise.all(Object.values(handleState.clients).map(closeClient));
  }
}

async function provisionRoles(admin, rolePasswords) {
  await admin.query('CREATE ROLE vnext_pg17_owner NOLOGIN NOINHERIT');
  await admin.query(`CREATE ROLE vnext_pg17_migrator LOGIN NOINHERIT PASSWORD ${quoteLiteral(rolePasswords.migrator)}`);
  await admin.query(`CREATE ROLE vnext_pg17_runtime LOGIN NOINHERIT PASSWORD ${quoteLiteral(rolePasswords.runtime)}`);
  await admin.query(`CREATE ROLE vnext_pg17_verifier LOGIN NOINHERIT PASSWORD ${quoteLiteral(rolePasswords.verifier)}`);
  await admin.query('GRANT vnext_pg17_owner TO vnext_pg17_migrator WITH SET OPTION');
  await admin.query('REVOKE INHERIT OPTION FOR vnext_pg17_owner FROM vnext_pg17_migrator');
}

async function startRuntime(runtime) {
  const state = runtimeState(runtime);
  if (state.cleaned) throw unavailable();
  if (state.started) return;
  if (dockerOverridesPresent()) throw unavailable();
  const label = `vnext-pg17-${randomToken(12)}`;
  const adminUser = `vnextpg17_${randomToken(8)}`;
  const adminPassword = randomToken(24);
  const adminDatabase = `vnextpg17_${randomToken(8)}`;
  state.label = label;
  state.admin = { user: adminUser, password: adminPassword, database: adminDatabase };
  state.rolePasswords = {
    migrator: randomToken(24),
    runtime: randomToken(24),
    verifier: randomToken(24),
  };
  let adminClient;
  try {
    const runResult = await runDocker([
      'run', '--rm', '--detach', '--label', label,
      '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=512m',
      '--env', `POSTGRES_USER=${adminUser}`,
      '--env', `POSTGRES_PASSWORD=${adminPassword}`,
      '--env', `POSTGRES_DB=${adminDatabase}`,
      '--publish', '127.0.0.1::5432', IMAGE_REFERENCE,
    ]);
    state.containerId = runResult.stdout.trim();
    if (!/^[a-f0-9]{12,64}$/.test(state.containerId)) throw unavailable();
    const inspection = parseDockerJson((await runDocker(['inspect', state.containerId])).stdout);
    const container = inspection[0];
    const requestedBinding = container && container.HostConfig && container.HostConfig.PortBindings
      && container.HostConfig.PortBindings['5432/tcp'];
    const activeBinding = container && container.NetworkSettings && container.NetworkSettings.Ports
      && container.NetworkSettings.Ports['5432/tcp'];
    if (!container || container.Config.Image !== IMAGE_REFERENCE || !Array.isArray(requestedBinding)
      || requestedBinding.length !== 1 || requestedBinding[0].HostIp !== '127.0.0.1'
      || !Array.isArray(activeBinding) || activeBinding.length !== 1 || activeBinding[0].HostIp !== '127.0.0.1'
      || !/^\d+$/.test(activeBinding[0].HostPort)) {
      throw unavailable();
    }
    const image = parseDockerJson((await runDocker(['image', 'inspect', IMAGE_REFERENCE])).stdout)[0];
    if (!image || image.Id !== container.Image || !Array.isArray(image.RepoDigests)
      || !image.RepoDigests.includes(IMAGE_REFERENCE)) throw unavailable();
    state.connection = { host: '127.0.0.1', port: Number(activeBinding[0].HostPort) };
    adminClient = await waitForAdmin({ ...state.connection, ...state.admin });
    await provisionRoles(adminClient, state.rolePasswords);
    state.started = true;
  } catch (_) {
    await closeClient(adminClient);
    await cleanupContainer(state);
    throw unavailable();
  }
  await closeClient(adminClient);
}

async function createHandle(runtime, database, clients) {
  const handle = Object.freeze({});
  handles.set(handle, { runtime, database, clients, closed: false });
  runtimeState(runtime).handles.add(handle);
  return handle;
}

async function createIsolatedHandle(runtime) {
  const state = runtimeState(runtime);
  if (!state.started || state.cleaned) throw unavailable();
  const database = `vnextpg17_${randomToken(8)}`;
  let admin;
  const clients = {};
  try {
    admin = await connectClient({ ...state.connection, ...state.admin });
    await admin.query(`CREATE DATABASE ${quoteIdentifier(database)} OWNER vnext_pg17_owner`);
    await admin.query(`REVOKE CREATE, TEMPORARY ON DATABASE ${quoteIdentifier(database)} FROM PUBLIC`);
    await closeClient(admin);
    admin = null;
    const common = { ...state.connection, database };
    clients.migrator = await connectClient({ ...common, user: 'vnext_pg17_migrator', password: state.rolePasswords.migrator });
    clients.runtime = await connectClient({ ...common, user: 'vnext_pg17_runtime', password: state.rolePasswords.runtime });
    clients.verifier = await connectClient({ ...common, user: 'vnext_pg17_verifier', password: state.rolePasswords.verifier });
    clients['fixture-provisioner'] = await connectClient({
      ...common,
      user: state.admin.user,
      password: state.admin.password,
    });
    return await createHandle(runtime, database, clients);
  } catch (_) {
    await closeClient(admin);
    await Promise.all(Object.values(clients).map(closeClient));
    await closeHandles(state);
    await cleanupContainer(state);
    throw unavailable();
  }
}

async function createPeerHandle(runtime, originalHandle) {
  const original = handles.get(originalHandle);
  if (!original || original.runtime !== runtime || original.closed) throw invalidHandle();
  const state = runtimeState(runtime);
  try {
    const verifier = await connectClient({
      ...state.connection,
      database: original.database,
      user: 'vnext_pg17_verifier',
      password: state.rolePasswords.verifier,
    });
    return await createHandle(runtime, original.database, { verifier });
  } catch (_) {
    throw unavailable();
  }
}

async function disposeHandle(runtime, handle) {
  const handleState = handles.get(handle);
  if (!handleState || handleState.runtime !== runtime || handleState.closed) throw invalidHandle();
  const state = runtimeState(runtime);
  for (const candidate of state.handles) {
    const candidateState = handles.get(candidate);
    if (candidate !== handle && candidateState && !candidateState.closed
      && candidateState.database === handleState.database) throw invalidHandle();
  }
  handleState.closed = true;
  await Promise.all(Object.values(handleState.clients).map(closeClient));
  state.handles.delete(handle);
  let admin;
  try {
    admin = await connectClient({ ...state.connection, ...state.admin });
    await admin.query(`DROP DATABASE ${quoteIdentifier(handleState.database)} WITH (FORCE)`);
  } catch (_) {
    throw unavailable();
  } finally {
    await closeClient(admin);
  }
}

function createDisposablePg17Runtime() {
  if (arguments.length !== 0) throw invalidConfig();
  const runtime = {};
  const state = { started: false, cleaned: false, handles: new Set() };
  const publicRuntime = Object.freeze({
    start: () => startRuntime(publicRuntime),
    createIsolatedHandle: () => createIsolatedHandle(publicRuntime),
    createPeerHandle: handle => createPeerHandle(publicRuntime, handle),
    disposeHandle: handle => disposeHandle(publicRuntime, handle),
    stop: async () => {
      const current = runtimeState(publicRuntime);
      await closeHandles(current);
      await cleanupContainer(current);
    },
  });
  runtimes.set(publicRuntime, state);
  return publicRuntime;
}

function isVNextPg17DisposableHandle(handle) {
  const state = handles.get(handle);
  return Boolean(state && !state.closed && state.runtime && runtimes.has(state.runtime));
}

function isVNextPg17DisposableHandleForRuntime(runtime, handle) {
  const state = handles.get(handle);
  return Boolean(state && !state.closed && state.runtime === runtime && runtimes.has(runtime));
}

async function withVNextPg17SyntheticQuery(handle, purpose, callback) {
  if (!isVNextPg17DisposableHandle(handle) || !['migrator', 'runtime', 'verifier', 'fixture-provisioner'].includes(purpose)
    || typeof callback !== 'function' || types.isProxy(callback)) throw invalidHandle();
  const state = handles.get(handle);
  const client = state.clients[purpose];
  if (!client) throw invalidHandle();
  return callback(makeFacade(client));
}

module.exports = {
  createDisposablePg17Runtime,
  isVNextPg17DisposableHandle,
  isVNextPg17DisposableHandleForRuntime,
  withVNextPg17SyntheticQuery,
};
