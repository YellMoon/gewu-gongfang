'use strict';

const { spawn } = require('child_process');
const { randomBytes } = require('crypto');
const { types } = require('util');
const { Client, Pool } = require('pg');

const IMAGE_REFERENCE = 'postgres@sha256:a65e6a841f6c4dbc4abda3d67fa3bc21824e9611064fcd82e87ea67aad60a0c3';
const LOCAL_DOCKER_HOST = process.platform === 'win32'
  ? 'npipe:////./pipe/docker_engine'
  : 'unix:///var/run/docker.sock';
const DOCKER_OVERRIDE_KEYS = ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'];
const MAX_OUTPUT_BYTES = 64 * 1024;
const DOCKER_TIMEOUT_MS = 30_000;
const READINESS_TIMEOUT_MS = 30_000;
const DISPOSABLE_OWNER_LABEL = 'com.gewu.vnext-pg17-disposable=1';
const DISPOSABLE_PROCESS_OWNER_LABEL = `com.gewu.vnext-pg17-disposable-owner=${process.pid}`;
const handles = new WeakMap();
const runtimes = new WeakMap();
const syntheticVerifierPools = new WeakMap();
const syntheticTlsBrands = new WeakMap();
const syntheticVerifierFaultPlans = new WeakMap();
const syntheticQueryTraces = new WeakMap();
const businessFoundationDdlTraces = new WeakMap();
const businessFoundationDdlFaultPlans = new WeakMap();
const copyOnlyRehearsalTargets = new WeakMap();
const copyOnlyRehearsalFaultPlans = new WeakMap();
const VERIFIER_FAULT_STAGES = new Set(['begin', 'setup', 'identity', 'tls', 'catalog', 'commit', 'rollback', 'release']);
const COPY_ONLY_REHEARSAL_STAGES = new Set(['authorities', 'accounts', 'trustedDevices', 'installations', 'links', 'capabilityCatalog', 'roleGrants', 'capabilityOverrides', 'dataScopeGrants', 'profileBindings', 'verifiedContacts', 'receipts', 'auditEvents', 'outboxEvents', 'postReadMismatch', 'postReadHistoricalMismatch', 'postReadProfileMismatch', 'postReadContactMismatch', 'postReadEvidenceMismatch', 'commit', 'rollback']);
const COPY_ONLY_TERMINAL_STAGES = new Set(['commit', 'rollback']);
const BUSINESS_FOUNDATION_DDL_FAULT_STAGES = new Set(['commit', 'rollback']);
const COPY_ONLY_TARGET_DATA_RELATIONS = Object.freeze([
  'vnext_authorities', 'vnext_accounts', 'vnext_trusted_devices', 'vnext_device_installations', 'vnext_account_device_links',
  'vnext_role_grants', 'vnext_capability_catalog', 'vnext_capability_overrides', 'vnext_data_scope_grants', 'vnext_profile_bindings',
  'vnext_verified_contacts', 'vnext_authorization_command_receipts', 'vnext_authorization_audit_events', 'vnext_authorization_outbox_events',
  'vnext_bootstrap_consumptions', 'vnext_authorization_policy_publications', 'vnext_trust_root_evidence', 'vnext_sessions', 'vnext_recent_reauthentication_events',
]);
const COPY_ONLY_TARGET_EMPTY_SQL = COPY_ONLY_TARGET_DATA_RELATIONS.map((relation, index) => `SELECT '${relation}'::text AS relation, COUNT(*)::int AS count FROM vnext_control_plane.${relation}${index + 1 === COPY_ONLY_TARGET_DATA_RELATIONS.length ? '' : ' UNION ALL'}`).join(' ');

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

function copyOnlyTargetUnavailable() {
  return codedError('VNEXT_PG17_COPY_REHEARSAL_TARGET_UNAVAILABLE', 'vNext PG17 copy-only rehearsal target is unavailable');
}

function migrationInputInvalid() {
  return codedError('VNEXT_PG17_MIGRATION_INPUT_INVALID', 'vNext PG17 migration input is invalid');
}

function businessSchemaDrift() {
  return codedError('VNEXT_PG17_SCHEMA_DRIFT', 'vNext PG17 business schema drift was detected');
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

function makeFacade(client, trace = null) {
  return Object.freeze({
    query: (text, values) => {
      if (trace && trace.armed) trace.queries.push(text);
      return client.query(text, values);
    },
  });
}

function runtimeState(runtime) {
  const state = runtimes.get(runtime);
  if (!state) throw invalidHandle();
  return state;
}

async function cleanupContainer(state) {
  if (!state || !state.containerId || state.cleaned) return;
  try {
    await runDocker(['rm', '--force', state.containerId]);
  } catch (_) {
    // Docker may have auto-removed the --rm container concurrently. Only a
    // successful, exact absence check can turn that race into a clean state.
  }
  let remaining;
  try {
    remaining = (await runDocker(['ps', '--all', '--quiet', '--no-trunc', '--filter', `id=${state.containerId}`])).stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } catch (_) {
    throw unavailable();
  }
  if (remaining.length !== 0) throw unavailable();
  state.cleaned = true;
}

async function closeHandles(state) {
  for (const handle of state.handles) {
    const handleState = handles.get(handle);
    if (!handleState || handleState.closed) continue;
    handleState.closed = true;
    await Promise.all(Object.values(handleState.clients).map(closeClient));
    await Promise.all(Object.values(handleState.pools).map(pool => pool.end()));
  }
}

async function provisionRoles(admin, rolePasswords) {
  await admin.query('CREATE ROLE vnext_pg17_owner NOLOGIN NOINHERIT');
  await admin.query(`CREATE ROLE vnext_pg17_migrator LOGIN NOINHERIT PASSWORD ${quoteLiteral(rolePasswords.migrator)}`);
  await admin.query(`CREATE ROLE vnext_pg17_runtime LOGIN NOINHERIT PASSWORD ${quoteLiteral(rolePasswords.runtime)}`);
  await admin.query(`CREATE ROLE vnext_pg17_verifier LOGIN NOINHERIT PASSWORD ${quoteLiteral(rolePasswords.verifier)}`);
  await admin.query(`CREATE ROLE vnext_pg17_writer LOGIN NOINHERIT PASSWORD ${quoteLiteral(rolePasswords.writer)}`);
  await admin.query('CREATE ROLE vnext_pg17_business_owner NOLOGIN NOINHERIT');
  await admin.query(`CREATE ROLE vnext_pg17_business_migrator LOGIN NOINHERIT PASSWORD ${quoteLiteral(rolePasswords.businessMigrator)}`);
  await admin.query(`CREATE ROLE vnext_pg17_business_verifier LOGIN NOINHERIT PASSWORD ${quoteLiteral(rolePasswords.businessVerifier)}`);
  await admin.query('GRANT vnext_pg17_owner TO vnext_pg17_migrator WITH SET OPTION');
  await admin.query('REVOKE INHERIT OPTION FOR vnext_pg17_owner FROM vnext_pg17_migrator');
  await admin.query('GRANT vnext_pg17_business_owner TO vnext_pg17_business_migrator WITH SET OPTION');
  await admin.query('REVOKE INHERIT OPTION FOR vnext_pg17_business_owner FROM vnext_pg17_business_migrator');
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
    writer: randomToken(24),
    businessMigrator: randomToken(24),
    businessVerifier: randomToken(24),
  };
  let adminClient;
  try {
    const runResult = await runDocker([
      'run', '--rm', '--detach', '--label', label, '--label', DISPOSABLE_OWNER_LABEL, '--label', DISPOSABLE_PROCESS_OWNER_LABEL,
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
    try { await cleanupContainer(state); } catch (_) { /* unavailable below */ }
    throw unavailable();
  }
  await closeClient(adminClient);
}

function createVerifierPool(options) {
  return new Pool({
    ...explicitClientOptions(options),
    max: 2,
    idleTimeoutMillis: 1_000,
  });
}

async function createHandle(runtime, database, clients, pools = {}, ownsDatabase = false) {
  const handle = Object.freeze({});
  handles.set(handle, { runtime, database, clients, pools, ownsDatabase, closed: false, queryTraces: new Map() });
  runtimeState(runtime).handles.add(handle);
  return handle;
}

async function createIsolatedHandle(runtime) {
  const state = runtimeState(runtime);
  if (!state.started || state.cleaned) throw unavailable();
  const database = `vnextpg17_${randomToken(8)}`;
  let admin;
  const clients = {};
  const pools = {};
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
    clients.writer = await connectClient({ ...common, user: 'vnext_pg17_writer', password: state.rolePasswords.writer });
    clients['business-migrator'] = await connectClient({ ...common, user: 'vnext_pg17_business_migrator', password: state.rolePasswords.businessMigrator });
    clients['business-verifier'] = await connectClient({ ...common, user: 'vnext_pg17_business_verifier', password: state.rolePasswords.businessVerifier });
    clients['fixture-provisioner'] = await connectClient({
      ...common,
      user: state.admin.user,
      password: state.admin.password,
    });
    pools.verifier = createVerifierPool({ ...common, user: 'vnext_pg17_verifier', password: state.rolePasswords.verifier });
    return await createHandle(runtime, database, clients, pools, true);
  } catch (_) {
    await closeClient(admin);
    await Promise.all(Object.values(clients).map(closeClient));
    await Promise.all(Object.values(pools).map(pool => pool.end()));
    try { await closeHandles(state); } finally {
      try { await cleanupContainer(state); } catch (_) { /* unavailable below */ }
    }
    throw unavailable();
  }
}

async function createPeerHandle(runtime, originalHandle) {
  const original = handles.get(originalHandle);
  if (!original || original.runtime !== runtime || original.closed) throw invalidHandle();
  const state = runtimeState(runtime);
  const clients = {};
  const pools = {};
  try {
    const common = { ...state.connection, database: original.database };
    clients.verifier = await connectClient({
      ...common,
      user: 'vnext_pg17_verifier',
      password: state.rolePasswords.verifier,
    });
    clients.writer = await connectClient({
      ...common,
      user: 'vnext_pg17_writer',
      password: state.rolePasswords.writer,
    });
    clients['business-migrator'] = await connectClient({
      ...common,
      user: 'vnext_pg17_business_migrator',
      password: state.rolePasswords.businessMigrator,
    });
    clients['business-verifier'] = await connectClient({
      ...common,
      user: 'vnext_pg17_business_verifier',
      password: state.rolePasswords.businessVerifier,
    });
    clients['fixture-provisioner'] = await connectClient({
      ...common,
      user: state.admin.user,
      password: state.admin.password,
    });
    pools.verifier = createVerifierPool({ ...common, user: 'vnext_pg17_verifier', password: state.rolePasswords.verifier });
    return await createHandle(runtime, original.database, clients, pools);
  } catch (_) {
    await Promise.all(Object.values(clients).map(closeClient));
    await Promise.all(Object.values(pools).map(pool => pool.end()));
    throw unavailable();
  }
}

async function disposeHandle(runtime, handle) {
  const handleState = handles.get(handle);
  if (!handleState || handleState.runtime !== runtime || handleState.closed) throw invalidHandle();
  const state = runtimeState(runtime);
  if (handleState.ownsDatabase) {
    for (const candidate of state.handles) {
      const candidateState = handles.get(candidate);
      if (candidate !== handle && candidateState && !candidateState.closed
        && candidateState.database === handleState.database) throw invalidHandle();
    }
  }
  handleState.closed = true;
  await Promise.all(Object.values(handleState.clients).map(closeClient));
  await Promise.all(Object.values(handleState.pools).map(pool => pool.end()));
  state.handles.delete(handle);
  if (!handleState.ownsDatabase) return;
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
    createVNextPg17CopyOnlyRehearsalTarget: handle => createVNextPg17CopyOnlyRehearsalTarget(publicRuntime, handle),
    createVNextPg17CopyOnlyRehearsalFaultPlan: (handle, stage) => createVNextPg17CopyOnlyRehearsalFaultPlan(publicRuntime, handle, stage),
    disposeHandle: handle => disposeHandle(publicRuntime, handle),
    stop: async () => {
      const current = runtimeState(publicRuntime);
      let failed = false;
      try {
        await closeHandles(current);
      } catch (_) {
        failed = true;
      }
      try {
        await cleanupContainer(current);
      } catch (_) {
        failed = true;
      }
      if (failed) throw unavailable();
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

function snapshotBusinessDdlInput(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw migrationInputInvalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('appliedAt') || !keys.includes('appliedBy')) throw migrationInputInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw migrationInputInvalid();
  }
  const { appliedAt, appliedBy } = value;
  let canonicalInstant;
  try {
    canonicalInstant = new Date(appliedAt).toISOString();
  } catch (_) {
    throw migrationInputInvalid();
  }
  if (typeof appliedAt !== 'string' || canonicalInstant !== appliedAt
    || typeof appliedBy !== 'string' || appliedBy.trim() === '') throw migrationInputInvalid();
  return Object.freeze({ appliedAt, appliedBy });
}

async function executeBusinessFoundationDdlPlan(runtime, handle, input) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  const snapshot = snapshotBusinessDdlInput(input);
  const state = handles.get(handle);
  if (state.businessFoundationDdlPoisoned) throw unavailable();
  if (state.businessFoundationDdlBusy) throw invalidHandle();
  const client = state.clients['business-migrator'];
  if (!client) throw invalidHandle();
  const { BUSINESS_FOUNDATION_MIGRATIONS } = require('./businessFoundationManifest');
  const migration = BUSINESS_FOUNDATION_MIGRATIONS[0];
  const trace = state.businessFoundationDdlTrace;
  const record = text => {
    const traceState = businessFoundationDdlTraces.get(trace);
    if (traceState && traceState.armed) traceState.queries.push(text);
  };
  const query = (text, values) => {
    record(text);
    return client.query(text, values).then(result => {
      const planState = businessFoundationDdlFaultPlans.get(state.businessFoundationDdlFaultPlan);
      const stage = text === 'COMMIT' ? 'commit' : text === 'ROLLBACK' ? 'rollback' : null;
      if (stage && planState && planState.pending.delete(stage)) throw new Error(`synthetic business DDL ${stage} fault`);
      return result;
    });
  };
  state.businessFoundationDdlBusy = true;
  try {
    let begun = false;
    let createGranted = false;
    let commitAttempted = false;
    try {
      await query('BEGIN');
      begun = true;
      await query("SET LOCAL TIME ZONE 'UTC'");
      await query('SELECT pg_advisory_xact_lock(73018, 1)');
      await query('SET LOCAL ROLE vnext_pg17_business_owner');
      const stateCheck = await query(
        "SELECT to_regclass('business.business_schema_migrations') AS ledger, to_regclass('public.business_schema_migrations') AS public_shadow",
      );
      const publicShadows = await query(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind <> 'i' AND c.relname = ANY($1::text[])",
        [['business_schema_migrations', 'tenants', 'institutions', 'schools', 'rooms']],
      );
      if (stateCheck.rows.length !== 1 || stateCheck.rows[0].public_shadow !== null || publicShadows.rows.length !== 0) {
        throw businessSchemaDrift();
      }
      if (stateCheck.rows[0].ledger !== null) {
        const ledger = await query(
          'SELECT migration_id, semantic_version, manifest_sha256 FROM business.business_schema_migrations ORDER BY semantic_version',
        );
        if (ledger.rows.length !== 1 || ledger.rows[0].migration_id !== migration.migrationId
          || String(ledger.rows[0].semantic_version) !== String(migration.semanticVersion)
          || ledger.rows[0].manifest_sha256 !== migration.manifestSha256) throw businessSchemaDrift();
        commitAttempted = true;
        await query('COMMIT');
        return Object.freeze({ applied: false });
      }
      const grantCreate = `GRANT CREATE ON DATABASE ${quoteIdentifier(state.database)} TO vnext_pg17_business_owner`;
      record(grantCreate);
      await state.clients['fixture-provisioner'].query(grantCreate);
      createGranted = true;
      await query(migration.sql);
      await query(
        'INSERT INTO business.business_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
        [migration.migrationId, migration.semanticVersion, migration.manifestSha256, snapshot.appliedAt, snapshot.appliedBy],
      );
      const revokeCreate = `REVOKE CREATE ON DATABASE ${quoteIdentifier(state.database)} FROM vnext_pg17_business_owner`;
      record(revokeCreate);
      await state.clients['fixture-provisioner'].query(revokeCreate);
      createGranted = false;
      commitAttempted = true;
      await query('COMMIT');
      return Object.freeze({ applied: true });
    } catch (error) {
      let rollbackConfirmed = !begun;
      let createRevoked = !createGranted;
      if (begun && !commitAttempted) {
        try { await query('ROLLBACK'); rollbackConfirmed = true; } catch (_) { /* poisoned below */ }
      }
      if (createGranted) {
        try {
          const revokeCreate = `REVOKE CREATE ON DATABASE ${quoteIdentifier(state.database)} FROM vnext_pg17_business_owner`;
          record(revokeCreate);
          await state.clients['fixture-provisioner'].query(revokeCreate);
          createGranted = false;
          createRevoked = true;
        } catch (_) { /* poisoned below */ }
      }
      if (commitAttempted || !rollbackConfirmed || !createRevoked) {
        state.businessFoundationDdlPoisoned = true;
        await closeClient(client);
        throw unavailable();
      }
      if (error && (error.code === 'VNEXT_PG17_HANDLE_INVALID' || error.code === 'VNEXT_PG17_MIGRATION_INPUT_INVALID'
        || error.code === 'VNEXT_PG17_SCHEMA_DRIFT')) throw error;
      throw businessSchemaDrift();
    }
  } finally {
    state.businessFoundationDdlBusy = false;
  }
}

function createVNextPg17BusinessFoundationDdlTrace(runtime, handle) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  const trace = Object.freeze({});
  businessFoundationDdlTraces.set(trace, { runtime, handle, armed: false, queries: [] });
  handles.get(handle).businessFoundationDdlTrace = trace;
  return trace;
}

function armVNextPg17BusinessFoundationDdlTrace(trace) {
  const state = businessFoundationDdlTraces.get(trace);
  if (!state || !isVNextPg17DisposableHandleForRuntime(state.runtime, state.handle)) throw invalidHandle();
  state.armed = true;
}

function inspectVNextPg17BusinessFoundationDdlTrace(trace) {
  const state = businessFoundationDdlTraces.get(trace);
  if (!state) throw invalidHandle();
  return Object.freeze({ queries: Object.freeze([...state.queries]) });
}

function createVNextPg17BusinessFoundationDdlFaultPlan(runtime, handle, stages) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle) || !Array.isArray(stages)
    || stages.length === 0 || stages.some(stage => typeof stage !== 'string' || !BUSINESS_FOUNDATION_DDL_FAULT_STAGES.has(stage))) throw invalidHandle();
  const plan = Object.freeze({});
  businessFoundationDdlFaultPlans.set(plan, { runtime, handle, pending: new Set(stages) });
  return plan;
}

function armVNextPg17BusinessFoundationDdlFaultPlan(handle, plan) {
  const planState = businessFoundationDdlFaultPlans.get(plan);
  if (!planState || !isVNextPg17DisposableHandleForRuntime(planState.runtime, handle)
    || planState.handle !== handle || handles.get(handle).runtime !== planState.runtime) throw invalidHandle();
  handles.get(handle).businessFoundationDdlFaultPlan = plan;
}

function createVNextPg17CopyOnlyRehearsalTarget(runtime, handle) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  const target = Object.freeze({});
  copyOnlyRehearsalTargets.set(target, { runtime, handle, busy: false, poisoned: false, queries: [] });
  return target;
}

function inspectVNextPg17CopyOnlyRehearsalTarget(target) {
  const state = copyOnlyRehearsalTargets.get(target);
  if (!state) throw invalidHandle();
  return Object.freeze({ poisoned: state.poisoned, queries: Object.freeze([...state.queries]) });
}

function createVNextPg17CopyOnlyRehearsalFaultPlan(runtime, handle, stage) {
  const stages = typeof stage === 'string' ? [stage] : stage;
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle) || !Array.isArray(stages) || stages.length === 0
    || stages.some(value => !COPY_ONLY_REHEARSAL_STAGES.has(value))) throw invalidHandle();
  const plan = Object.freeze({});
  copyOnlyRehearsalFaultPlans.set(plan, { runtime, handle, stages: new Set(stages) });
  return plan;
}

async function withVNextPg17CopyOnlyRehearsalTarget(target, callback, faultPlan) {
  const targetState = copyOnlyRehearsalTargets.get(target);
  if (!targetState || !isVNextPg17DisposableHandleForRuntime(targetState.runtime, targetState.handle)
    || targetState.busy || typeof callback !== 'function' || types.isProxy(callback)) throw invalidHandle();
  if (targetState.poisoned) throw copyOnlyTargetUnavailable();
  const faultState = faultPlan === undefined ? null : copyOnlyRehearsalFaultPlans.get(faultPlan);
  if (faultPlan !== undefined && (!faultState || faultState.runtime !== targetState.runtime || faultState.handle !== targetState.handle || faultState.stages.size === 0)) throw invalidHandle();
  const client = handles.get(targetState.handle).clients['fixture-provisioner'];
  let begun = false;
  let commitAttempted = false;
  targetState.busy = true;
  const query = async (text, values) => {
    targetState.queries.push(text);
    const result = await client.query(text, values);
    const stage = text === 'COMMIT' ? 'commit'
      : text === 'ROLLBACK' ? 'rollback'
        : text.startsWith('INSERT INTO vnext_control_plane.vnext_authorities') ? 'authorities'
          : text.startsWith('INSERT INTO vnext_control_plane.vnext_accounts') ? 'accounts'
            : text.startsWith('INSERT INTO vnext_control_plane.vnext_trusted_devices') ? 'trustedDevices'
              : text.startsWith('INSERT INTO vnext_control_plane.vnext_device_installations') ? 'installations'
                : text.startsWith('INSERT INTO vnext_control_plane.vnext_account_device_links') ? 'links' : null;
    const historicalStage = text.startsWith('INSERT INTO vnext_control_plane.vnext_capability_catalog') ? 'capabilityCatalog'
      : text.startsWith('INSERT INTO vnext_control_plane.vnext_role_grants') ? 'roleGrants'
        : text.startsWith('INSERT INTO vnext_control_plane.vnext_capability_overrides') ? 'capabilityOverrides'
          : text.startsWith('INSERT INTO vnext_control_plane.vnext_data_scope_grants') ? 'dataScopeGrants' : null;
    const profileStage = text.startsWith('INSERT INTO vnext_control_plane.vnext_profile_bindings') ? 'profileBindings'
      : text.startsWith('INSERT INTO vnext_control_plane.vnext_verified_contacts') ? 'verifiedContacts' : null;
    const evidenceStage = text.startsWith('INSERT INTO vnext_control_plane.vnext_authorization_command_receipts') ? 'receipts'
      : text.startsWith('INSERT INTO vnext_control_plane.vnext_authorization_audit_events') ? 'auditEvents'
        : text.startsWith('INSERT INTO vnext_control_plane.vnext_authorization_outbox_events') ? 'outboxEvents' : null;
    const effectiveStage = stage || historicalStage || profileStage || evidenceStage;
    if (effectiveStage && faultState && faultState.stages.delete(effectiveStage)) {
      if (COPY_ONLY_TERMINAL_STAGES.has(effectiveStage)) {
        targetState.poisoned = true;
        throw copyOnlyTargetUnavailable();
      }
      throw new Error('copy-only rehearsal fault');
    }
    return result;
  };
  try {
    await query('BEGIN ISOLATION LEVEL REPEATABLE READ'); begun = true;
    const catalog = require('./catalogAssertion').createVNextPg17CatalogBoundary(targetState.runtime);
    await catalog.assertQueryFacade(catalog.createVerifierQueryFacade((text, values) => query(text, values)));
    const fields = Object.freeze({ authorities: ['authority_id','status','created_at','updated_at'], accounts: ['account_id','authority_id','status','auth_version','access_version','revocation_version','row_version','created_at','updated_at'], trustedDevices: ['device_id','authority_id','status','hardware_evidence_hash','risk_code','credential_version','risk_version','row_version','created_at','updated_at','revoked_at'], installations: ['installation_id','authority_id','device_id','installation_public_key','key_fingerprint','status','credential_version','row_version','created_at','updated_at','revoked_at'], links: ['link_id','authority_id','account_id','device_id','installation_id','status','auth_version','access_version','row_version','created_at','updated_at','revoked_at'] });
    const relations = Object.freeze({ authorities: 'vnext_authorities', accounts: 'vnext_accounts', trustedDevices: 'vnext_trusted_devices', installations: 'vnext_device_installations', links: 'vnext_account_device_links' });
    const identityKeys = Object.freeze({ authorities: 'authority_id', accounts: 'account_id', trustedDevices: 'device_id', installations: 'installation_id', links: 'link_id' });
    const historicalFields = Object.freeze({ capabilityCatalog: ['capability_id','status','surface_mask','created_at'], roleGrants: ['grant_id','authority_id','account_id','role','status','grant_version','row_version','starts_at','ends_at','revoked_at','granted_by_account_id','created_at','updated_at'], capabilityOverrides: ['override_id','authority_id','account_id','capability_id','effect','status','starts_at','ends_at','row_version','created_at','updated_at','revoked_at'], dataScopeGrants: ['scope_grant_id','authority_id','account_id','scope_type','scope_value_hash','effect','status','starts_at','ends_at','row_version','created_at','updated_at','revoked_at'] });
    const historicalRelations = Object.freeze({ capabilityCatalog: 'vnext_capability_catalog', roleGrants: 'vnext_role_grants', capabilityOverrides: 'vnext_capability_overrides', dataScopeGrants: 'vnext_data_scope_grants' });
    const historicalKeys = Object.freeze({ capabilityCatalog: 'capability_id', roleGrants: 'grant_id', capabilityOverrides: 'override_id', dataScopeGrants: 'scope_grant_id' });
    const profileFields = Object.freeze({ profileBindings: ['binding_id','authority_id','account_id','profile_type','profile_id','status','evidence_hash','row_version','created_at','updated_at','revoked_at'] });
    const profileRelations = Object.freeze({ profileBindings: 'vnext_profile_bindings' });
    const profileKeys = Object.freeze({ profileBindings: 'binding_id' });
    const contactFields = Object.freeze({ verifiedContacts: ['contact_id','authority_id','account_id','contact_type','normalized_value_hash','verification_state','verification_evidence_hash','verified_at','revoked_at','row_version','created_at','updated_at'] });
    const contactRelations = Object.freeze({ verifiedContacts: 'vnext_verified_contacts' });
    const contactKeys = Object.freeze({ verifiedContacts: 'contact_id' });
    const evidenceFields = Object.freeze({
      receipts: ['receipt_id','authority_id','actor_key','actor_account_id','idempotency_key','command_type','target_kind','target_id','canonical_request_sha256','expected_row_version','outcome','result_code','canonical_result_json','canonical_result_sha256','committed_auth_version','committed_access_version','committed_revocation_version','committed_target_row_version','created_at'],
      auditEvents: ['event_id','authority_id','receipt_id','reason_code','context_sha256','created_at'],
      outboxEvents: ['event_id','authority_id','receipt_id','event_type','aggregate_kind','aggregate_id','aggregate_version','canonical_payload_json','payload_sha256','occurred_at'],
    });
    const evidenceRelations = Object.freeze({ receipts: 'vnext_authorization_command_receipts', auditEvents: 'vnext_authorization_audit_events', outboxEvents: 'vnext_authorization_outbox_events' });
    const evidenceKeys = Object.freeze({ receipts: 'receipt_id', auditEvents: 'event_id', outboxEvents: 'event_id' });
    const result = await callback(Object.freeze({
      countAuthorities: async () => Number((await query('SELECT COUNT(*)::int AS count FROM vnext_control_plane.vnext_authorities')).rows[0].count),
      countTargetDataRows: async () => (await query(COPY_ONLY_TARGET_EMPTY_SQL)).rows.map(row => Object.freeze({ relation: row.relation, count: Number(row.count) })),
      readIdentityTopology: async () => {
        const topology = {};
        for (const collection of Object.keys(fields)) {
          const columns = fields[collection];
          const result = await query(`SELECT row_to_json(record) AS row FROM (SELECT ${columns.join(',')} FROM vnext_control_plane.${relations[collection]} ORDER BY ${identityKeys[collection]}) AS record`);
          topology[collection] = Object.freeze(result.rows.map(row => Object.freeze(row.row)));
        }
        if (faultState && faultState.stages.delete('postReadMismatch')) {
          topology.authorities = Object.freeze([Object.freeze({ ...topology.authorities[0], status: 'rehearsal-mismatch' })]);
        }
        return Object.freeze(topology);
      },
      readHistoricalAuthorization: async () => {
        const historical = {};
        for (const collection of Object.keys(historicalFields)) {
          const columns = historicalFields[collection];
          const result = await query(`SELECT row_to_json(record) AS row FROM (SELECT ${columns.join(',')} FROM vnext_control_plane.${historicalRelations[collection]} ORDER BY ${historicalKeys[collection]}) AS record`);
          historical[collection] = Object.freeze(result.rows.map(row => Object.freeze(row.row)));
        }
        if (faultState && faultState.stages.delete('postReadHistoricalMismatch')) {
          historical.capabilityCatalog = Object.freeze([Object.freeze({ ...historical.capabilityCatalog[0], status: 'rehearsal-mismatch' })]);
        }
        return Object.freeze(historical);
      },
      readProfileMetadata: async () => {
        const profile = {};
        for (const collection of Object.keys(profileFields)) {
          const columns = profileFields[collection];
          const result = await query(`SELECT row_to_json(record) AS row FROM (SELECT ${columns.join(',')} FROM vnext_control_plane.${profileRelations[collection]} ORDER BY ${profileKeys[collection]}) AS record`);
          profile[collection] = Object.freeze(result.rows.map(row => Object.freeze(row.row)));
        }
        if (faultState && faultState.stages.delete('postReadProfileMismatch')) {
          profile.profileBindings = Object.freeze([Object.freeze({ ...profile.profileBindings[0], status: 'rehearsal-mismatch' })]);
        }
        return Object.freeze(profile);
      },
      readVerifiedContacts: async () => {
        const contacts = {};
        for (const collection of Object.keys(contactFields)) {
          const columns = contactFields[collection];
          const result = await query(`SELECT row_to_json(record) AS row FROM (SELECT ${columns.join(',')} FROM vnext_control_plane.${contactRelations[collection]} ORDER BY ${contactKeys[collection]}) AS record`);
          contacts[collection] = Object.freeze(result.rows.map(row => Object.freeze(row.row)));
        }
        if (faultState && faultState.stages.delete('postReadContactMismatch')) contacts.verifiedContacts = Object.freeze([Object.freeze({ ...contacts.verifiedContacts[0], verification_state: 'rehearsal-mismatch' })]);
        return Object.freeze(contacts);
      },
      readLinkRevocationEvidence: async () => {
        const evidence = {};
        for (const collection of Object.keys(evidenceFields)) {
          const columns = evidenceFields[collection];
          const result = await query(`SELECT row_to_json(record) AS row FROM (SELECT ${columns.join(',')} FROM vnext_control_plane.${evidenceRelations[collection]} ORDER BY ${evidenceKeys[collection]}) AS record`);
          evidence[collection] = Object.freeze(result.rows.map(row => Object.freeze(row.row)));
        }
        if (faultState && faultState.stages.delete('postReadEvidenceMismatch')) {
          evidence.receipts = Object.freeze([Object.freeze({ ...evidence.receipts[0], result_code: 'rehearsal-mismatch' })]);
        }
        return Object.freeze(evidence);
      },
      insertAuthority: async row => {
        const result = await query('INSERT INTO vnext_control_plane.vnext_authorities(authority_id,status,created_at,updated_at) VALUES($1,$2,$3,$4)', [row.authority_id, row.status, row.created_at, row.updated_at]);
        return result;
      },
      insertFoundation: async (collection, row) => {
        if (!Object.prototype.hasOwnProperty.call(fields, collection) || !row || Object.keys(row).sort().join(',') !== [...fields[collection]].sort().join(',')) throw invalidHandle();
        const columns = fields[collection];
        const result = await query(`INSERT INTO vnext_control_plane.${relations[collection]}(${columns.join(',')}) VALUES(${columns.map((_, index) => '$' + (index + 1)).join(',')})`, columns.map(key => row[key]));
        return result;
      },
      insertHistoricalAuthorization: async (collection, row) => {
        if (!Object.prototype.hasOwnProperty.call(historicalFields, collection) || !row || Object.keys(row).sort().join(',') !== [...historicalFields[collection]].sort().join(',')) throw invalidHandle();
        const columns = historicalFields[collection];
        return query(`INSERT INTO vnext_control_plane.${historicalRelations[collection]}(${columns.join(',')}) VALUES(${columns.map((_, index) => '$' + (index + 1)).join(',')})`, columns.map(key => row[key]));
      },
      insertProfileMetadata: async (collection, row) => {
        if (!Object.prototype.hasOwnProperty.call(profileFields, collection) || !row || Object.keys(row).sort().join(',') !== [...profileFields[collection]].sort().join(',')) throw invalidHandle();
        const columns = profileFields[collection];
        return query(`INSERT INTO vnext_control_plane.${profileRelations[collection]}(${columns.join(',')}) VALUES(${columns.map((_, index) => '$' + (index + 1)).join(',')})`, columns.map(key => row[key]));
      },
      insertVerifiedContact: async (collection, row) => {
        if (!Object.prototype.hasOwnProperty.call(contactFields, collection) || !row || Object.keys(row).sort().join(',') !== [...contactFields[collection]].sort().join(',')) throw invalidHandle();
        const columns = contactFields[collection];
        return query(`INSERT INTO vnext_control_plane.${contactRelations[collection]}(${columns.join(',')}) VALUES(${columns.map((_, index) => '$' + (index + 1)).join(',')})`, columns.map(key => row[key]));
      },
      insertLinkRevocationEvidence: async (collection, row) => {
        if (!Object.prototype.hasOwnProperty.call(evidenceFields, collection) || !row || Object.keys(row).sort().join(',') !== [...evidenceFields[collection]].sort().join(',')) throw invalidHandle();
        const columns = evidenceFields[collection];
        return query(`INSERT INTO vnext_control_plane.${evidenceRelations[collection]}(${columns.join(',')}) VALUES(${columns.map((_, index) => '$' + (index + 1)).join(',')})`, columns.map(key => row[key]));
      },
    }));
    commitAttempted = true;
    await query('COMMIT'); return result;
  } catch (error) {
    if (commitAttempted) targetState.poisoned = true;
    if (begun && !targetState.poisoned) {
      try { await query('ROLLBACK'); } catch (_) { targetState.poisoned = true; }
    }
    if (targetState.poisoned) {
      await client.end().catch(() => {});
      throw copyOnlyTargetUnavailable();
    }
    throw error;
  } finally {
    targetState.busy = false;
  }
}

async function withVNextPg17SyntheticQuery(handle, purpose, callback) {
  if (!isVNextPg17DisposableHandle(handle) || !['migrator', 'runtime', 'verifier', 'writer', 'business-verifier', 'fixture-provisioner'].includes(purpose)
    || typeof callback !== 'function' || types.isProxy(callback)) throw invalidHandle();
  const state = handles.get(handle);
  const client = state.clients[purpose];
  if (!client) throw invalidHandle();
  const trace = state.queryTraces.get(purpose);
  return callback(makeFacade(client, syntheticQueryTraces.get(trace)));
}

function createVNextPg17SyntheticQueryTrace(runtime, handle, purpose) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle) || purpose !== 'verifier') throw invalidHandle();
  const trace = Object.freeze({});
  syntheticQueryTraces.set(trace, { runtime, handle, purpose, armed: false, queries: [] });
  handles.get(handle).queryTraces.set(purpose, trace);
  return trace;
}

function armVNextPg17SyntheticQueryTrace(trace) {
  const state = syntheticQueryTraces.get(trace);
  if (!state || !isVNextPg17DisposableHandleForRuntime(state.runtime, state.handle)) throw invalidHandle();
  state.armed = true;
}

function inspectVNextPg17SyntheticQueryTrace(trace) {
  const state = syntheticQueryTraces.get(trace);
  if (!state) throw invalidHandle();
  return Object.freeze({ queries: Object.freeze([...state.queries]) });
}

function createVNextPg17SyntheticVerifierPool(runtime, handle) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  const pool = Object.freeze({});
  syntheticVerifierPools.set(pool, { runtime, handle });
  return pool;
}

function issueVNextPg17SyntheticTlsBrand(runtime, handle) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  const brand = Object.freeze({});
  syntheticTlsBrands.set(brand, { runtime, handle });
  return brand;
}

function isVNextPg17SyntheticTlsBrandForHandle(brand, runtime, handle) {
  const state = syntheticTlsBrands.get(brand);
  return Boolean(state && state.runtime === runtime && state.handle === handle
    && isVNextPg17DisposableHandleForRuntime(runtime, handle));
}

function isVNextPg17SyntheticTlsBrandForPool(brand, pool) {
  const brandState = syntheticTlsBrands.get(brand);
  const poolState = syntheticVerifierPools.get(pool);
  return Boolean(brandState && poolState && brandState.runtime === poolState.runtime
    && brandState.handle === poolState.handle
    && isVNextPg17DisposableHandleForRuntime(brandState.runtime, brandState.handle));
}

function syntheticVerifierPoolDatabase(pool) {
  const state = syntheticVerifierPools.get(pool);
  if (!state || !isVNextPg17DisposableHandleForRuntime(state.runtime, state.handle)) throw invalidHandle();
  return handles.get(state.handle).database;
}

function isVNextPg17SyntheticVerifierPoolForHandle(pool, handle) {
  const state = syntheticVerifierPools.get(pool);
  return Boolean(state && state.handle === handle
    && isVNextPg17DisposableHandleForRuntime(state.runtime, handle));
}

function createVNextPg17SyntheticVerifierFaultPlan(runtime, handle, stages) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)
    || !Array.isArray(stages) || stages.some(stage => typeof stage !== 'string' || !VERIFIER_FAULT_STAGES.has(stage))) {
    throw invalidHandle();
  }
  const plan = Object.freeze({});
  syntheticVerifierFaultPlans.set(plan, {
    runtime,
    handle,
    pending: new Set(stages),
    queries: [],
    stages: [],
    releaseCount: 0,
    destroyCount: 0,
  });
  return plan;
}

function armVNextPg17SyntheticVerifierFaultPlan(pool, plan) {
  const poolState = syntheticVerifierPools.get(pool);
  const planState = syntheticVerifierFaultPlans.get(plan);
  if (!poolState || !planState || poolState.runtime !== planState.runtime || poolState.handle !== planState.handle
    || !isVNextPg17DisposableHandleForRuntime(poolState.runtime, poolState.handle)) throw invalidHandle();
  poolState.faultPlan = plan;
}

function inspectVNextPg17SyntheticVerifierFaultPlan(plan) {
  const state = syntheticVerifierFaultPlans.get(plan);
  if (!state) throw invalidHandle();
  return Object.freeze({
    destroyCount: state.destroyCount,
    queries: Object.freeze([...state.queries]),
    releaseCount: state.releaseCount,
    stages: Object.freeze([...state.stages]),
  });
}

function verifierQueryStage(text) {
  if (typeof text !== 'string') return 'catalog';
  if (text.startsWith('BEGIN ')) return 'begin';
  if (text.startsWith("SELECT set_config(")) return 'setup';
  if (text.startsWith('SELECT current_database()')) return 'identity';
  if (text.startsWith('SELECT COALESCE((SELECT ssl')) return 'tls';
  if (text === 'COMMIT') return 'commit';
  if (text === 'ROLLBACK') return 'rollback';
  return 'catalog';
}

function recordVerifierFault(poolState, stage, query) {
  const planState = syntheticVerifierFaultPlans.get(poolState.faultPlan);
  if (!planState) return;
  planState.stages.push(stage);
  if (typeof query === 'string') planState.queries.push(query);
  if (stage === 'release') planState.releaseCount += 1;
  if (stage === 'destroy') planState.destroyCount += 1;
  if (planState.pending.delete(stage)) throw new Error(`synthetic verifier ${stage} fault`);
}

async function checkoutVNextPg17SyntheticVerifierLease(poolRef) {
  const poolState = syntheticVerifierPools.get(poolRef);
  if (!poolState || !isVNextPg17DisposableHandleForRuntime(poolState.runtime, poolState.handle)) throw invalidHandle();
  const handle = handles.get(poolState.handle);
  const pool = handle.pools.verifier;
  let client;
  let released = false;
  try {
    client = await pool.connect();
  } catch (_) {
    throw unavailable();
  }
  const release = async () => {
    if (released) throw invalidHandle();
    recordVerifierFault(poolState, 'release');
    released = true;
    client.release();
  };
  return Object.freeze({
    query: (text, values) => {
      if (released) throw invalidHandle();
      recordVerifierFault(poolState, verifierQueryStage(text), text);
      return client.query(text, values);
    },
    release,
    destroy: async () => {
      if (released) throw invalidHandle();
      recordVerifierFault(poolState, 'destroy');
      released = true;
      client.release(true);
    },
  });
}

module.exports = {
  createDisposablePg17Runtime,
  isVNextPg17DisposableHandle,
  isVNextPg17DisposableHandleForRuntime,
  executeBusinessFoundationDdlPlan,
  createVNextPg17BusinessFoundationDdlTrace,
  armVNextPg17BusinessFoundationDdlTrace,
  inspectVNextPg17BusinessFoundationDdlTrace,
  createVNextPg17BusinessFoundationDdlFaultPlan,
  armVNextPg17BusinessFoundationDdlFaultPlan,
  createVNextPg17CopyOnlyRehearsalTarget,
  inspectVNextPg17CopyOnlyRehearsalTarget,
  withVNextPg17CopyOnlyRehearsalTarget,
  withVNextPg17SyntheticQuery,
  createVNextPg17SyntheticQueryTrace,
  armVNextPg17SyntheticQueryTrace,
  inspectVNextPg17SyntheticQueryTrace,
  createVNextPg17SyntheticVerifierPool,
  issueVNextPg17SyntheticTlsBrand,
  isVNextPg17SyntheticTlsBrandForHandle,
  isVNextPg17SyntheticTlsBrandForPool,
  syntheticVerifierPoolDatabase,
  isVNextPg17SyntheticVerifierPoolForHandle,
  checkoutVNextPg17SyntheticVerifierLease,
  createVNextPg17SyntheticVerifierFaultPlan,
  armVNextPg17SyntheticVerifierFaultPlan,
  inspectVNextPg17SyntheticVerifierFaultPlan,
};
