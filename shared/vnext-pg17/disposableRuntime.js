'use strict';

const { spawn } = require('child_process');
const { randomBytes, createHash } = require('crypto');
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
const businessFoundationAdmissionDdlTraces = new WeakMap();
const businessFoundationAdmissionDdlFaultPlans = new WeakMap();
const businessFoundationShadowAdmissionTraces = new WeakMap();
const businessFoundationShadowAdmissionFaultPlans = new WeakMap();
const copyOnlyRehearsalTargets = new WeakMap();
const copyOnlyRehearsalFaultPlans = new WeakMap();
const VERIFIER_FAULT_STAGES = new Set(['begin', 'setup', 'identity', 'tls', 'catalog', 'commit', 'rollback', 'release']);
const COPY_ONLY_REHEARSAL_STAGES = new Set(['authorities', 'accounts', 'trustedDevices', 'installations', 'links', 'capabilityCatalog', 'roleGrants', 'capabilityOverrides', 'dataScopeGrants', 'profileBindings', 'verifiedContacts', 'receipts', 'auditEvents', 'outboxEvents', 'postReadMismatch', 'postReadHistoricalMismatch', 'postReadProfileMismatch', 'postReadContactMismatch', 'postReadEvidenceMismatch', 'commit', 'rollback']);
const COPY_ONLY_TERMINAL_STAGES = new Set(['commit', 'rollback']);
const BUSINESS_FOUNDATION_DDL_FAULT_STAGES = new Set(['commit', 'rollback']);
const BUSINESS_FOUNDATION_ADMISSION_DDL_FAULT_STAGES = new Set(['commit', 'rollback', 'revoke']);
const BUSINESS_FOUNDATION_SHADOW_ADMISSION_FAULT_STAGES = new Set(['preflight', 'preflightCommit', 'writeCommit', 'writeFail', 'rollback', 'reconcileCommit', 'reconcileRollback']);
const BUSINESS_FOUNDATION_SHADOW_RELATIONS = Object.freeze(['tenants', 'institutions', 'schools', 'rooms', 'teachers', 'students', 'courses', 'course_student_pricings', 'schedules', 'schedule_student_overrides']);
const BUSINESS_FOUNDATION_SHADOW_ADMISSION_PREFLIGHT_SQL = "SELECT (SELECT COUNT(*)::text FROM business.tenants) AS tenants, (SELECT COUNT(*)::text FROM business.institutions) AS institutions, (SELECT COUNT(*)::text FROM business.schools) AS schools, (SELECT COUNT(*)::text FROM business.rooms) AS rooms, (SELECT COUNT(*)::text FROM business.teachers) AS teachers, (SELECT COUNT(*)::text FROM business.students) AS students, (SELECT COUNT(*)::text FROM business.courses) AS courses, (SELECT COUNT(*)::text FROM business.course_student_pricings) AS course_student_pricings, (SELECT COUNT(*)::text FROM business.schedules) AS schedules, (SELECT COUNT(*)::text FROM business.schedule_student_overrides) AS schedule_student_overrides, (SELECT COUNT(*)::text FROM migration_admission.migration_batches) AS batches, (SELECT COUNT(*)::text FROM migration_admission.migration_batch_events) AS events, (SELECT COUNT(*)::text FROM migration_admission.migration_quarantine) AS quarantine, (SELECT COUNT(*)::text FROM migration_admission.migration_row_ledger) AS ledger";
const BUSINESS_FOUNDATION_SHADOW_RECONCILIATION_SQL = Object.freeze({
  tenants: 'SELECT id, name, legacy_status AS "legacyStatus", legacy_plan AS "legacyPlan", to_char(legacy_archive_before AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "legacyArchiveBefore", legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.tenants ORDER BY id',
  institutions: 'SELECT id, tenant_id AS "tenantId", name, contact_person_legacy AS "contactPersonLegacy", contact_phone_legacy AS "contactPhoneLegacy", revenue_share::float8 AS "revenueShare", notes, legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.institutions ORDER BY id',
  schools: 'SELECT id, tenant_id AS "tenantId", name, legacy_count AS "legacyCount", legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.schools ORDER BY id',
  rooms: 'SELECT id, tenant_id AS "tenantId", name, address_legacy AS "addressLegacy", legacy_count AS "legacyCount", legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.rooms ORDER BY id',
  teachers: 'SELECT id, tenant_id AS "tenantId", name, phone_legacy AS "phoneLegacy", subject, hourly_rate::float8 AS "hourlyRate", notes, legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.teachers ORDER BY id',
  students: 'SELECT id, tenant_id AS "tenantId", name, phone_legacy AS "phoneLegacy", school_legacy AS "schoolLegacy", grade_year AS "gradeYear", grade_current AS "gradeCurrent", legacy_source_type AS "legacySourceType", institution_id AS "institutionId", parent_name_legacy AS "parentNameLegacy", parent_wechat_legacy AS "parentWechatLegacy", student_source_legacy AS "studentSourceLegacy", legacy_balance_hours::float8 AS "legacyBalanceHours", legacy_balance_money::float8 AS "legacyBalanceMoney", notes, legacy_is_institution_student AS "legacyIsInstitutionStudent", parent_phone_legacy AS "parentPhoneLegacy", parent_phone_normalized_legacy AS "parentPhoneNormalizedLegacy", parent_relation_legacy AS "parentRelationLegacy", legacy_deleted AS "legacyDeleted", to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM business.students ORDER BY id',
  courses: 'SELECT c.id, c.tenant_id AS "tenantId", c.name, c.year, c.semester, c.display_name AS "displayName", c.course_type AS "courseType", c.legacy_source_type AS "legacySourceType", c.institution_id AS "institutionId", c.price_tuition::float8 AS "priceTuition", c.price_teacher::float8 AS "priceTeacher", c.billing_unit AS "billingUnit", c.teacher_fee_mode AS "teacherFeeMode", c.legacy_room_id AS "legacyRoomId", c.room_name_snapshot AS "roomNameSnapshot", c.teacher_id AS "teacherId", c.teacher_name_snapshot AS "teacherNameSnapshot", c.legacy_active AS "legacyActive", c.default_duration_minutes AS "defaultDurationMinutes", c.notes, c.legacy_deleted AS "legacyDeleted", to_char(c.created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(c.updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt", COALESCE((SELECT json_agg(json_build_object(\'studentId\', p.student_id, \'tuition\', p.tuition::float8, \'teacherFee\', p.teacher_fee::float8, \'attendanceStatus\', 1) ORDER BY p.student_id) FROM business.course_student_pricings p WHERE p.tenant_id = c.tenant_id AND p.course_id = c.id), \'[]\'::json) AS "defaultRoster" FROM business.courses c ORDER BY c.id',
  schedules: 'SELECT s.id, s.tenant_id AS "tenantId", s.course_id AS "courseId", to_char(s.start_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "startAt", to_char(s.end_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "endAt", s.recurring_rule_json AS "recurringRule", s.status, s.room_display_snapshot AS "roomDisplay", s.service_type AS "serviceType", s.calculated_tuition::float8 AS "calculatedTuition", s.calculated_teacher_fee::float8 AS "calculatedTeacherFee", s.notes, s.legacy_deleted AS "legacyDeleted", to_char(s.created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt", to_char(s.updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt", CASE WHEN EXISTS (SELECT 1 FROM business.schedule_student_overrides o WHERE o.tenant_id = s.tenant_id AND o.schedule_id = s.id) THEN \'schedule_override\' WHEN EXISTS (SELECT 1 FROM business.course_student_pricings p WHERE p.tenant_id = s.tenant_id AND p.course_id = s.course_id) THEN \'course_default\' ELSE \'none\' END AS "effectiveRosterSource", COALESCE((SELECT json_agg(json_build_object(\'studentId\', o.student_id, \'tuition\', o.tuition::float8, \'teacherFee\', o.teacher_fee::float8, \'attendanceStatus\', o.attendance_status) ORDER BY o.student_id) FROM business.schedule_student_overrides o WHERE o.tenant_id = s.tenant_id AND o.schedule_id = s.id), (SELECT json_agg(json_build_object(\'studentId\', p.student_id, \'tuition\', p.tuition::float8, \'teacherFee\', p.teacher_fee::float8, \'attendanceStatus\', 1) ORDER BY p.student_id) FROM business.course_student_pricings p WHERE p.tenant_id = s.tenant_id AND p.course_id = s.course_id), \'[]\'::json) AS "effectiveRoster" FROM business.schedules s ORDER BY s.id',
});
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

function canonicalHashConflict() {
  return codedError('VNEXT_PG17_ADMISSION_CANONICAL_HASH_CONFLICT', 'vNext PG17 admission source canonical hash conflicts with the stored row ledger');
}

function reconciliationMismatch() {
  return codedError('VNEXT_PG17_ADMISSION_RECONCILIATION_MISMATCH', 'vNext PG17 admission reconciliation does not match the target');
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
  await admin.query(`CREATE ROLE vnext_pg17_identity_verifier LOGIN NOINHERIT PASSWORD ${quoteLiteral(rolePasswords.identityVerifier)}`);
  await admin.query('CREATE ROLE vnext_pg17_business_owner NOLOGIN NOINHERIT');
  await admin.query(`CREATE ROLE vnext_pg17_business_migrator LOGIN NOINHERIT PASSWORD ${quoteLiteral(rolePasswords.businessMigrator)}`);
  await admin.query(`CREATE ROLE vnext_pg17_business_verifier LOGIN NOINHERIT PASSWORD ${quoteLiteral(rolePasswords.businessVerifier)}`);
  await admin.query('CREATE ROLE vnext_pg17_migration_admission_owner NOLOGIN NOINHERIT');
  await admin.query(`CREATE ROLE vnext_pg17_migration_admission_migrator LOGIN NOINHERIT PASSWORD ${quoteLiteral(rolePasswords.migrationAdmissionMigrator)}`);
  await admin.query(`CREATE ROLE vnext_pg17_migration_admission_verifier LOGIN NOINHERIT PASSWORD ${quoteLiteral(rolePasswords.migrationAdmissionVerifier)}`);
  await admin.query('GRANT vnext_pg17_owner TO vnext_pg17_migrator WITH SET OPTION');
  await admin.query('REVOKE INHERIT OPTION FOR vnext_pg17_owner FROM vnext_pg17_migrator');
  await admin.query('GRANT vnext_pg17_business_owner TO vnext_pg17_business_migrator WITH SET OPTION');
  await admin.query('REVOKE INHERIT OPTION FOR vnext_pg17_business_owner FROM vnext_pg17_business_migrator');
  await admin.query('GRANT vnext_pg17_migration_admission_owner TO vnext_pg17_migration_admission_migrator WITH SET OPTION');
  await admin.query('REVOKE INHERIT OPTION FOR vnext_pg17_migration_admission_owner FROM vnext_pg17_migration_admission_migrator');
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
    identityVerifier: randomToken(24),
    businessMigrator: randomToken(24),
    businessVerifier: randomToken(24),
    migrationAdmissionMigrator: randomToken(24),
    migrationAdmissionVerifier: randomToken(24),
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
    clients['identity-verifier'] = await connectClient({ ...common, user: 'vnext_pg17_identity_verifier', password: state.rolePasswords.identityVerifier });
    clients['business-migrator'] = await connectClient({ ...common, user: 'vnext_pg17_business_migrator', password: state.rolePasswords.businessMigrator });
    clients['business-verifier'] = await connectClient({ ...common, user: 'vnext_pg17_business_verifier', password: state.rolePasswords.businessVerifier });
    clients['migration-admission-migrator'] = await connectClient({ ...common, user: 'vnext_pg17_migration_admission_migrator', password: state.rolePasswords.migrationAdmissionMigrator });
    clients['migration-admission-verifier'] = await connectClient({ ...common, user: 'vnext_pg17_migration_admission_verifier', password: state.rolePasswords.migrationAdmissionVerifier });
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
    clients['identity-verifier'] = await connectClient({
      ...common,
      user: 'vnext_pg17_identity_verifier',
      password: state.rolePasswords.identityVerifier,
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
    clients['migration-admission-migrator'] = await connectClient({
      ...common,
      user: 'vnext_pg17_migration_admission_migrator',
      password: state.rolePasswords.migrationAdmissionMigrator,
    });
    clients['migration-admission-verifier'] = await connectClient({
      ...common,
      user: 'vnext_pg17_migration_admission_verifier',
      password: state.rolePasswords.migrationAdmissionVerifier,
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
  if (state.businessFoundationDdlPoisoned || state.businessFoundationShadowAdmissionPoisoned) throw unavailable();
  if (state.businessFoundationDdlBusy) throw invalidHandle();
  const client = state.clients['business-migrator'];
  if (!client) throw invalidHandle();
  const { BUSINESS_FOUNDATION_MIGRATIONS } = require('./businessFoundationManifest');
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
        [['business_schema_migrations', 'tenants', 'institutions', 'schools', 'rooms', 'teachers', 'students', 'courses', 'course_student_pricings', 'schedules', 'schedule_student_overrides']],
      );
      if (stateCheck.rows.length !== 1 || stateCheck.rows[0].public_shadow !== null || publicShadows.rows.length !== 0) {
        throw businessSchemaDrift();
      }
      let appliedMigrations = [];
      if (stateCheck.rows[0].ledger !== null) {
        const ledger = await query(
          'SELECT migration_id, semantic_version, manifest_sha256 FROM business.business_schema_migrations ORDER BY semantic_version',
        );
        if (ledger.rows.length > BUSINESS_FOUNDATION_MIGRATIONS.length
          || ledger.rows.some((row, index) => row.migration_id !== BUSINESS_FOUNDATION_MIGRATIONS[index].migrationId
            || String(row.semantic_version) !== String(BUSINESS_FOUNDATION_MIGRATIONS[index].semanticVersion)
            || row.manifest_sha256 !== BUSINESS_FOUNDATION_MIGRATIONS[index].manifestSha256)) throw businessSchemaDrift();
        if (ledger.rows.length > 0 && ledger.rows.length < BUSINESS_FOUNDATION_MIGRATIONS.length) throw businessSchemaDrift();
        appliedMigrations = ledger.rows;
        if (ledger.rows.length === BUSINESS_FOUNDATION_MIGRATIONS.length) {
          commitAttempted = true;
          await query('COMMIT');
          return Object.freeze({ applied: false });
        }
      } else {
        const grantCreate = `GRANT CREATE ON DATABASE ${quoteIdentifier(state.database)} TO vnext_pg17_business_owner`;
        record(grantCreate);
        await state.clients['fixture-provisioner'].query(grantCreate);
        createGranted = true;
      }
      for (const migration of BUSINESS_FOUNDATION_MIGRATIONS.slice(appliedMigrations.length)) {
        await query(migration.sql);
        await query(
          'INSERT INTO business.business_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
          [migration.migrationId, migration.semanticVersion, migration.manifestSha256, snapshot.appliedAt, snapshot.appliedBy],
        );
      }
      if (createGranted) {
        const revokeCreate = `REVOKE CREATE ON DATABASE ${quoteIdentifier(state.database)} FROM vnext_pg17_business_owner`;
        record(revokeCreate);
        await state.clients['fixture-provisioner'].query(revokeCreate);
        createGranted = false;
      }
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

async function readBusinessFoundationZeroSeedCounts(runtime, handle) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  const state = handles.get(handle);
  if (state.businessFoundationDdlPoisoned || state.businessFoundationShadowAdmissionPoisoned) throw unavailable();
  const client = state.clients['business-migrator'];
  if (!client) throw invalidHandle();
  let begun = false;
  let commitAttempted = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    begun = true;
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query('SELECT pg_advisory_xact_lock(73018, 1)');
    await client.query('SET LOCAL ROLE vnext_pg17_business_owner');
    const counts = await client.query(
      "SELECT 'course_student_pricings'::text AS relation, COUNT(*)::text AS count FROM business.course_student_pricings UNION ALL SELECT 'courses'::text AS relation, COUNT(id)::text AS count FROM business.courses UNION ALL SELECT 'institutions'::text AS relation, COUNT(id)::text AS count FROM business.institutions UNION ALL SELECT 'rooms'::text AS relation, COUNT(id)::text AS count FROM business.rooms UNION ALL SELECT 'schedule_student_overrides'::text AS relation, COUNT(*)::text AS count FROM business.schedule_student_overrides UNION ALL SELECT 'schedules'::text AS relation, COUNT(id)::text AS count FROM business.schedules UNION ALL SELECT 'schools'::text AS relation, COUNT(id)::text AS count FROM business.schools UNION ALL SELECT 'students'::text AS relation, COUNT(id)::text AS count FROM business.students UNION ALL SELECT 'teachers'::text AS relation, COUNT(id)::text AS count FROM business.teachers UNION ALL SELECT 'tenants'::text AS relation, COUNT(id)::text AS count FROM business.tenants ORDER BY relation",
    );
    commitAttempted = true;
    await client.query('COMMIT');
    return Object.freeze(counts.rows.map(row => Object.freeze({ relation: row.relation, count: row.count })));
  } catch (_) {
    if (begun && !commitAttempted) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        state.businessFoundationDdlPoisoned = true;
        await closeClient(client);
        throw unavailable();
      }
    }
    if (commitAttempted) {
      state.businessFoundationDdlPoisoned = true;
      await closeClient(client);
    }
    throw unavailable();
  }
}

async function poisonBusinessFoundationAdmissionDatabase(runtime, database) {
  const state = runtimeState(runtime);
  const clients = [];
  for (const candidate of state.handles) {
    const candidateState = handles.get(candidate);
    if (!candidateState || candidateState.closed || candidateState.database !== database) continue;
    candidateState.businessFoundationAdmissionDdlPoisoned = true;
    clients.push(candidateState.clients['migration-admission-migrator']);
    clients.push(candidateState.clients['migration-admission-verifier']);
  }
  await Promise.all(clients.map(closeClient));
}

async function poisonBusinessFoundationShadowAdmissionDatabase(runtime, database) {
  const state = runtimeState(runtime);
  const clients = [];
  for (const candidate of state.handles) {
    const candidateState = handles.get(candidate);
    if (!candidateState || candidateState.closed || candidateState.database !== database) continue;
    candidateState.businessFoundationShadowAdmissionPoisoned = true;
    clients.push(candidateState.clients['fixture-provisioner']);
    clients.push(candidateState.clients['business-migrator']);
    clients.push(candidateState.clients['business-verifier']);
    clients.push(candidateState.clients['migration-admission-migrator']);
    clients.push(candidateState.clients['migration-admission-verifier']);
  }
  await Promise.all(clients.map(closeClient));
}

async function executeBusinessFoundationAdmissionDdlPlan(runtime, handle, input) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  const snapshot = snapshotBusinessDdlInput(input);
  const state = handles.get(handle);
  if (state.businessFoundationAdmissionDdlBusy || state.businessFoundationAdmissionDdlPoisoned || state.businessFoundationShadowAdmissionPoisoned) throw unavailable();
  const client = state.clients['migration-admission-migrator'];
  if (!client) throw invalidHandle();
  const { BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS } = require('./businessFoundationAdmissionManifest');
  const migrations = BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS;
  const trace = state.businessFoundationAdmissionDdlTrace;
  const record = text => {
    const traceState = businessFoundationAdmissionDdlTraces.get(trace);
    if (traceState && traceState.armed) traceState.queries.push(text);
  };
  const query = (text, values) => {
    record(text);
    return client.query(text, values).then(result => {
      const planState = businessFoundationAdmissionDdlFaultPlans.get(state.businessFoundationAdmissionDdlFaultPlan);
      const stage = text === 'COMMIT' ? 'commit' : text === 'ROLLBACK' ? 'rollback' : null;
      if (stage && planState && planState.pending.delete(stage)) throw new Error(`synthetic admission DDL ${stage} fault`);
      return result;
    });
  };
  const fixtureQuery = (text, values) => {
    record(text);
    return state.clients['fixture-provisioner'].query(text, values).then(result => {
      const planState = businessFoundationAdmissionDdlFaultPlans.get(state.businessFoundationAdmissionDdlFaultPlan);
      if (/^REVOKE CREATE ON DATABASE /u.test(text) && planState && planState.pending.delete('revoke')) {
        throw new Error('synthetic admission DDL revoke fault');
      }
      return result;
    });
  };
  state.businessFoundationAdmissionDdlBusy = true;
  let begun = false;
  let createGranted = false;
  let commitAttempted = false;
  let revokeAttempted = false;
  try {
    await query('BEGIN');
    begun = true;
    await query("SET LOCAL TIME ZONE 'UTC'");
    await query('SELECT pg_advisory_xact_lock(73018, 2)');
    await query('SET LOCAL ROLE vnext_pg17_migration_admission_owner');
    const stateCheck = await query(
      "SELECT to_regnamespace('migration_admission') AS schema_name, to_regclass('migration_admission.migration_admission_schema_migrations') AS ledger, to_regclass('public.migration_admission_schema_migrations') AS public_shadow",
    );
    const publicShadows = await query(
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind <> 'i' AND c.relname = ANY($1::text[])",
      [['migration_admission_schema_migrations', 'migration_batches', 'migration_batch_events', 'migration_quarantine', 'migration_row_ledger']],
    );
    if (stateCheck.rows.length !== 1 || stateCheck.rows[0].public_shadow !== null || publicShadows.rows.length !== 0) throw businessSchemaDrift();
    let pendingMigrations;
    if (stateCheck.rows[0].ledger !== null) {
      const ledger = await query('SELECT migration_id, semantic_version, manifest_sha256 FROM migration_admission.migration_admission_schema_migrations ORDER BY semantic_version');
      if (ledger.rows.length > migrations.length || ledger.rows.some((row, index) => row.migration_id !== migrations[index].migrationId
        || String(row.semantic_version) !== String(migrations[index].semanticVersion)
        || row.manifest_sha256 !== migrations[index].manifestSha256)) throw businessSchemaDrift();
      if (ledger.rows.length !== migrations.length) throw businessSchemaDrift();
      commitAttempted = true;
      await query('COMMIT');
      return Object.freeze({ applied: false });
    } else {
      if (stateCheck.rows[0].schema_name !== null) throw businessSchemaDrift();
      const grantCreate = `GRANT CREATE ON DATABASE ${quoteIdentifier(state.database)} TO vnext_pg17_migration_admission_owner`;
      await fixtureQuery(grantCreate);
      createGranted = true;
      pendingMigrations = migrations;
    }
    for (const migration of pendingMigrations) {
      await query(migration.sql);
      await query(
        'INSERT INTO migration_admission.migration_admission_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
        [migration.migrationId, migration.semanticVersion, migration.manifestSha256, snapshot.appliedAt, snapshot.appliedBy],
      );
    }
    if (createGranted) {
      const revokeCreate = `REVOKE CREATE ON DATABASE ${quoteIdentifier(state.database)} FROM vnext_pg17_migration_admission_owner`;
      revokeAttempted = true;
      await fixtureQuery(revokeCreate);
      revokeAttempted = false;
      createGranted = false;
    }
    commitAttempted = true;
    await query('COMMIT');
    return Object.freeze({ applied: true });
  } catch (error) {
    let rollbackConfirmed = !begun;
    let createRevoked = !createGranted;
    if (begun && !commitAttempted) {
      try { await query('ROLLBACK'); rollbackConfirmed = true; } catch (_) { /* poison below */ }
    }
    if (createGranted && !revokeAttempted) {
      try {
        await fixtureQuery(`REVOKE CREATE ON DATABASE ${quoteIdentifier(state.database)} FROM vnext_pg17_migration_admission_owner`);
        createGranted = false;
        createRevoked = true;
      } catch (_) { /* poison below */ }
    }
    if (commitAttempted || revokeAttempted || !rollbackConfirmed || !createRevoked) {
      await poisonBusinessFoundationAdmissionDatabase(runtime, state.database);
      throw unavailable();
    }
    if (error && (error.code === 'VNEXT_PG17_HANDLE_INVALID' || error.code === 'VNEXT_PG17_MIGRATION_INPUT_INVALID' || error.code === 'VNEXT_PG17_SCHEMA_DRIFT')) throw error;
    throw businessSchemaDrift();
  } finally {
    state.businessFoundationAdmissionDdlBusy = false;
  }
}

function stableSha256(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function projectCoreSchedulingRows(core) {
  const numeric = value => value === null ? null : Number(value);
  const roster = rows => Object.freeze([...rows]
    .sort((left, right) => left.studentId.localeCompare(right.studentId))
    .map(row => Object.freeze({ studentId: row.studentId, tuition: numeric(row.tuition), teacherFee: numeric(row.teacherFee), attendanceStatus: row.attendanceStatus })));
  const teachers = core.teachers.map(source => Object.freeze({
    id: source.id, tenantId: source.tenant_id, name: source.name, phoneLegacy: source.phone, subject: source.subject,
    hourlyRate: numeric(source.hourly_rate), notes: source.notes, legacyDeleted: source.deleted === 1, createdAt: source.created_at, updatedAt: source.updated_at,
  }));
  const students = core.students.map(source => Object.freeze({
    id: source.id, tenantId: source.tenant_id, name: source.name, phoneLegacy: source.phone, schoolLegacy: source.school,
    gradeYear: source.grade_year, gradeCurrent: source.grade_current, legacySourceType: source.source_type, institutionId: source.institution_id,
    parentNameLegacy: source.parent_name, parentWechatLegacy: source.parent_wechat, studentSourceLegacy: source.student_source,
    legacyBalanceHours: numeric(source.balance_hours), legacyBalanceMoney: numeric(source.balance_money), notes: source.notes,
    legacyIsInstitutionStudent: source.is_institution_student === 1, parentPhoneLegacy: source.parent_phone,
    parentPhoneNormalizedLegacy: source.parent_phone_normalized, parentRelationLegacy: source.parent_relation,
    legacyDeleted: source.deleted === 1, createdAt: source.created_at, updatedAt: source.updated_at,
  }));
  const courses = core.courses.map(source => Object.freeze({
    id: source.id, tenantId: source.tenant_id, name: source.name, year: source.year, semester: source.semester,
    displayName: source.display_name, courseType: source.type, legacySourceType: source.source_type, institutionId: source.institution_id,
    priceTuition: numeric(source.price_tuition), priceTeacher: numeric(source.price_teacher), billingUnit: source.billing_unit,
    teacherFeeMode: source.teacher_fee_mode, legacyRoomId: source.room_id, roomNameSnapshot: source.room_name,
    teacherId: source.teacher_id, teacherNameSnapshot: source.teacher_name, legacyActive: source.active === 1,
    defaultDurationMinutes: source.default_duration_minutes, notes: source.notes, legacyDeleted: source.deleted === 1,
    createdAt: source.created_at, updatedAt: source.updated_at, defaultRoster: roster(source.defaultRoster),
  }));
  const schedules = core.schedules.map(source => Object.freeze({ ...source, calculatedTuition: numeric(source.calculatedTuition), calculatedTeacherFee: numeric(source.calculatedTeacherFee), effectiveRoster: roster(source.effectiveRoster) }));
  return Object.freeze({ teachers: Object.freeze(teachers), students: Object.freeze(students), courses: Object.freeze(courses), schedules: Object.freeze(schedules) });
}

function expectedShadowRows(snapshot) {
  const expected = [];
  for (const relation of ['tenants', 'institutions', 'schools', 'rooms']) {
    for (const row of snapshot[relation]) expected.push(Object.freeze({ relation, row, targetRow: row, sourcePrimaryKeySha256: stableSha256(`${relation}:${row.id}`), canonicalSourceSha256: stableSha256(row), targetLogicalSha256: stableSha256(row) }));
  }
  const core = projectCoreSchedulingRows(snapshot.coreScheduling);
  for (const relation of ['teachers', 'students', 'courses', 'schedules']) {
    const sources = snapshot.coreScheduling[relation];
    const targets = core[relation];
    for (let index = 0; index < sources.length; index += 1) expected.push(Object.freeze({ relation, row: targets[index], targetRow: targets[index], sourcePrimaryKeySha256: stableSha256(`${relation}:${sources[index].id}`), canonicalSourceSha256: stableSha256(sources[index]), targetLogicalSha256: stableSha256(targets[index]) }));
  }
  for (const quarantine of snapshot.coreScheduling.quarantines) expected.push(Object.freeze({
    relation: 'schedules', row: null, targetRow: null, sourcePrimaryKeySha256: stableSha256(`schedules:${quarantine.scheduleId}`),
    canonicalSourceSha256: stableSha256(quarantine), targetLogicalSha256: null, outcome: 'quarantined', outcomeCode: quarantine.outcome,
  }));
  return Object.freeze(expected);
}

async function assertBusinessFoundationShadowTargetMatchesLedger(query, ledgerRows) {
  if (ledgerRows.some(row => !Object.prototype.hasOwnProperty.call(BUSINESS_FOUNDATION_SHADOW_RECONCILIATION_SQL, row.source_relation))) throw reconciliationMismatch();
  const relationCounts = {};
  for (const relation of ['tenants', 'institutions', 'schools', 'rooms', 'teachers', 'students', 'courses', 'schedules']) {
    const target = await query(BUSINESS_FOUNDATION_SHADOW_RECONCILIATION_SQL[relation]);
    const expected = ledgerRows.filter(row => row.source_relation === relation && row.outcome === 'admitted');
    if (target.rows.length !== expected.length) throw reconciliationMismatch();
    relationCounts[relation] = target.rows.length;
    for (const row of target.rows) {
      const sourceKeyHash = stableSha256(`${relation}:${row.id}`);
      const stored = expected.find(candidate => candidate.source_primary_key_sha256 === sourceKeyHash);
      const logical = stableSha256(row);
      if (!stored || stored.target_id !== row.id
        || stored.target_logical_sha256 !== logical || stored.outcome !== 'admitted' || stored.outcome_code !== 'ADMITTED') {
        throw reconciliationMismatch();
      }
    }
  }
  return Object.freeze(relationCounts);
}

async function executeBusinessFoundationShadowAdmissionPlan(runtime, handle, snapshot) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle) || !snapshot || typeof snapshot !== 'object') throw invalidHandle();
  const state = handles.get(handle);
  if (state.businessFoundationShadowAdmissionBusy || state.businessFoundationShadowAdmissionPoisoned) throw unavailable();
  const client = state.clients['fixture-provisioner'];
  if (!client) throw invalidHandle();
  const trace = state.businessFoundationShadowAdmissionTrace;
  let writeTransaction = false;
  const record = text => {
    const traceState = businessFoundationShadowAdmissionTraces.get(trace);
    if (traceState && traceState.armed) traceState.queries.push(text);
  };
  const query = (text, values) => {
    record(text);
    return client.query(text, values).then(result => {
      const planState = businessFoundationShadowAdmissionFaultPlans.get(state.businessFoundationShadowAdmissionFaultPlan);
      const stage = text === BUSINESS_FOUNDATION_SHADOW_ADMISSION_PREFLIGHT_SQL ? 'preflight'
        : text === 'COMMIT' ? (writeTransaction ? 'writeCommit' : 'preflightCommit')
          : text === 'ROLLBACK' ? 'rollback' : null;
      if (stage && planState && planState.pending.delete(stage)) throw new Error(`synthetic business shadow admission ${stage} fault`);
      if (writeTransaction && text.startsWith('INSERT INTO migration_admission.migration_batches ') && planState && planState.pending.delete('writeFail')) {
        throw new Error('synthetic business shadow admission write fault');
      }
      return result;
    });
  };
  state.businessFoundationShadowAdmissionBusy = true;
  const relations = BUSINESS_FOUNDATION_SHADOW_RELATIONS;
  const coreRows = projectCoreSchedulingRows(snapshot.coreScheduling);
  const relationCounts = Object.freeze({
    tenants: snapshot.tenants.length, institutions: snapshot.institutions.length, schools: snapshot.schools.length, rooms: snapshot.rooms.length,
    teachers: coreRows.teachers.length, students: coreRows.students.length, courses: coreRows.courses.length,
    course_student_pricings: coreRows.courses.reduce((count, row) => count + row.defaultRoster.length, 0), schedules: coreRows.schedules.length,
    schedule_student_overrides: coreRows.schedules.reduce((count, row) => count + (row.effectiveRosterSource === 'schedule_override' ? row.effectiveRoster.length : 0), 0),
  });
  const expectedRows = expectedShadowRows(snapshot);
  const quarantineRows = expectedRows.filter(row => row.outcome === 'quarantined');
  let begun = false;
  let commitAttempted = false;
  try {
    await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    begun = true;
    await query("SET LOCAL TIME ZONE 'UTC'");
    const preflight = await query(BUSINESS_FOUNDATION_SHADOW_ADMISSION_PREFLIGHT_SQL);
    if (preflight.rows.length !== 1) throw businessSchemaDrift();
    const preflightCounts = preflight.rows[0];
    const isFresh = Object.values(preflightCounts).every(value => value === '0');
    if (!isFresh) {
      const existingBatch = await query(
        'SELECT batch_request_sha256 FROM migration_admission.migration_batches WHERE batch_id = $1',
        [snapshot.batch.batchId],
      );
      const storedLedger = await query(
        'SELECT source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code FROM migration_admission.migration_row_ledger WHERE batch_id = $1 ORDER BY source_relation, source_primary_key_sha256',
        [snapshot.batch.batchId],
      );
      if (existingBatch.rows.length !== 1 || existingBatch.rows[0].batch_request_sha256 !== snapshot.batch.batchRequestSha256
        || preflightCounts.batches !== '1' || preflightCounts.events !== '2' || preflightCounts.quarantine !== String(quarantineRows.length)
        || preflightCounts.ledger !== String(expectedRows.length)
        || relations.some(relation => preflightCounts[relation] !== String(relationCounts[relation]))
        || storedLedger.rows.length !== expectedRows.length) throw businessSchemaDrift();
      for (const expected of expectedRows) {
        const stored = storedLedger.rows.find(row => row.source_relation === expected.relation && row.source_primary_key_sha256 === expected.sourcePrimaryKeySha256);
        if (!stored) throw businessSchemaDrift();
        if (stored.canonical_source_sha256 !== expected.canonicalSourceSha256) throw canonicalHashConflict();
        if (expected.outcome === 'quarantined') {
          if (stored.target_id !== null || stored.target_logical_sha256 !== null || stored.outcome !== 'quarantined' || stored.outcome_code !== expected.outcomeCode) throw businessSchemaDrift();
        } else if (stored.target_id !== expected.targetRow.id || stored.target_logical_sha256 !== expected.targetLogicalSha256
          || stored.outcome !== 'admitted' || stored.outcome_code !== 'ADMITTED') throw businessSchemaDrift();
      }
      await assertBusinessFoundationShadowTargetMatchesLedger(query, storedLedger.rows);
      commitAttempted = true;
      await query('COMMIT');
      return Object.freeze({ admitted: false, replayed: true, relationCounts });
    }
    commitAttempted = true;
    await query('COMMIT');
    begun = false;
    commitAttempted = false;
    await query('BEGIN');
    begun = true;
    writeTransaction = true;
    await query("SET LOCAL TIME ZONE 'UTC'");
    const writePreflight = await query(BUSINESS_FOUNDATION_SHADOW_ADMISSION_PREFLIGHT_SQL);
    if (writePreflight.rows.length !== 1 || Object.values(writePreflight.rows[0]).some(value => value !== '0')) throw businessSchemaDrift();
    await query('SET LOCAL ROLE vnext_pg17_migration_admission_owner');
    const batch = snapshot.batch;
    await query('INSERT INTO migration_admission.migration_batches (batch_id, source_snapshot_sha256, source_inventory_before_sha256, source_inventory_after_sha256, source_catalog_sha256, source_contract_sha256, source_schema_sha256, business_manifest_sha256, mapper_set_sha256, consent_sha256, shadow_target_identity_sha256, batch_request_sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)', [batch.batchId, batch.sourceSnapshotSha256, batch.sourceInventoryBeforeSha256, batch.sourceInventoryAfterSha256, batch.sourceCatalogSha256, batch.sourceContractSha256, batch.sourceSchemaSha256, batch.businessManifestSha256, batch.mapperSetSha256, batch.consentSha256, batch.shadowTargetIdentitySha256, batch.batchRequestSha256, batch.createdAt]);
    await query('INSERT INTO migration_admission.migration_batch_events (batch_id, event_sequence, status, event_code, event_sha256, created_at) VALUES ($1, 1, \'prepared\', \'PREPARED\', $2, $3)', [batch.batchId, stableSha256({ batchId: batch.batchId, sequence: 1, status: 'prepared', code: 'PREPARED', createdAt: batch.createdAt }), batch.createdAt]);
    await query('INSERT INTO migration_admission.migration_batch_events (batch_id, event_sequence, status, event_code, event_sha256, created_at) VALUES ($1, 2, \'running\', \'RUNNING\', $2, $3)', [batch.batchId, stableSha256({ batchId: batch.batchId, sequence: 2, status: 'running', code: 'RUNNING', createdAt: batch.createdAt }), batch.createdAt]);
    await query('SET LOCAL ROLE NONE');
    await query('SET LOCAL ROLE vnext_pg17_business_owner');
    for (const row of snapshot.tenants) await query('INSERT INTO business.tenants (id, name, legacy_status, legacy_plan, legacy_archive_before, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [row.id, row.name, row.legacyStatus, row.legacyPlan, row.legacyArchiveBefore, row.legacyDeleted, row.createdAt, row.updatedAt]);
    for (const row of snapshot.institutions) await query('INSERT INTO business.institutions (id, tenant_id, name, contact_person_legacy, contact_phone_legacy, revenue_share, notes, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [row.id, row.tenantId, row.name, row.contactPersonLegacy, row.contactPhoneLegacy, row.revenueShare, row.notes, row.legacyDeleted, row.createdAt, row.updatedAt]);
    for (const row of snapshot.schools) await query('INSERT INTO business.schools (id, tenant_id, name, legacy_count, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [row.id, row.tenantId, row.name, row.legacyCount, row.legacyDeleted, row.createdAt, row.updatedAt]);
    for (const row of snapshot.rooms) await query('INSERT INTO business.rooms (id, tenant_id, name, address_legacy, legacy_count, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [row.id, row.tenantId, row.name, row.addressLegacy, row.legacyCount, row.legacyDeleted, row.createdAt, row.updatedAt]);
    for (const row of coreRows.teachers) await query('INSERT INTO business.teachers (id, tenant_id, name, phone_legacy, subject, hourly_rate, notes, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [row.id, row.tenantId, row.name, row.phoneLegacy, row.subject, row.hourlyRate, row.notes, row.legacyDeleted, row.createdAt, row.updatedAt]);
    for (const row of coreRows.students) await query('INSERT INTO business.students (id, tenant_id, name, phone_legacy, school_legacy, grade_year, grade_current, legacy_source_type, institution_id, parent_name_legacy, parent_wechat_legacy, student_source_legacy, legacy_balance_hours, legacy_balance_money, notes, legacy_is_institution_student, parent_phone_legacy, parent_phone_normalized_legacy, parent_relation_legacy, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)', [row.id, row.tenantId, row.name, row.phoneLegacy, row.schoolLegacy, row.gradeYear, row.gradeCurrent, row.legacySourceType, row.institutionId, row.parentNameLegacy, row.parentWechatLegacy, row.studentSourceLegacy, row.legacyBalanceHours, row.legacyBalanceMoney, row.notes, row.legacyIsInstitutionStudent, row.parentPhoneLegacy, row.parentPhoneNormalizedLegacy, row.parentRelationLegacy, row.legacyDeleted, row.createdAt, row.updatedAt]);
    for (const row of coreRows.courses) await query('INSERT INTO business.courses (id, tenant_id, name, year, semester, display_name, course_type, legacy_source_type, institution_id, price_tuition, price_teacher, billing_unit, teacher_fee_mode, legacy_room_id, room_name_snapshot, teacher_id, teacher_name_snapshot, legacy_active, default_duration_minutes, notes, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)', [row.id, row.tenantId, row.name, row.year, row.semester, row.displayName, row.courseType, row.legacySourceType, row.institutionId, row.priceTuition, row.priceTeacher, row.billingUnit, row.teacherFeeMode, row.legacyRoomId, row.roomNameSnapshot, row.teacherId, row.teacherNameSnapshot, row.legacyActive, row.defaultDurationMinutes, row.notes, row.legacyDeleted, row.createdAt, row.updatedAt]);
    for (const row of coreRows.courses) for (const pricing of row.defaultRoster) await query('INSERT INTO business.course_student_pricings (tenant_id, course_id, student_id, tuition, teacher_fee) VALUES ($1, $2, $3, $4, $5)', [row.tenantId, row.id, pricing.studentId, pricing.tuition, pricing.teacherFee]);
    for (const row of coreRows.schedules) await query('INSERT INTO business.schedules (id, tenant_id, course_id, start_at, end_at, recurring_rule_json, status, room_display_snapshot, service_type, calculated_tuition, calculated_teacher_fee, notes, legacy_deleted, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)', [row.id, row.tenantId, row.courseId, row.startAt, row.endAt, row.recurringRule, row.status, row.roomDisplay, row.serviceType, row.calculatedTuition, row.calculatedTeacherFee, row.notes, row.legacyDeleted, row.createdAt, row.updatedAt]);
    for (const row of coreRows.schedules) if (row.effectiveRosterSource === 'schedule_override') for (const pricing of row.effectiveRoster) await query('INSERT INTO business.schedule_student_overrides (tenant_id, schedule_id, student_id, attendance_status, tuition, teacher_fee) VALUES ($1, $2, $3, $4, $5, $6)', [row.tenantId, row.id, pricing.studentId, pricing.attendanceStatus, pricing.tuition, pricing.teacherFee]);
    await query('SET LOCAL ROLE NONE');
    await query('SET LOCAL ROLE vnext_pg17_migration_admission_owner');
    for (const expected of expectedRows) {
      if (expected.outcome === 'quarantined') {
        await query('INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, NULL, NULL, \'quarantined\', $5, $6)', [batch.batchId, expected.relation, expected.sourcePrimaryKeySha256, expected.canonicalSourceSha256, expected.outcomeCode, batch.createdAt]);
        await query('INSERT INTO migration_admission.migration_quarantine (batch_id, source_relation, source_primary_key_sha256, reason_code, sealed_artifact_reference_sha256, created_at) VALUES ($1, $2, $3, $4, NULL, $5)', [batch.batchId, expected.relation, expected.sourcePrimaryKeySha256, expected.outcomeCode, batch.createdAt]);
      } else {
        await query('INSERT INTO migration_admission.migration_row_ledger (batch_id, source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, \'admitted\', \'ADMITTED\', $7)', [batch.batchId, expected.relation, expected.sourcePrimaryKeySha256, expected.canonicalSourceSha256, expected.targetRow.id, expected.targetLogicalSha256, batch.createdAt]);
      }
    }
    commitAttempted = true;
    await query('COMMIT');
    state.businessFoundationShadowAdmissionStarted = true;
    return Object.freeze({ admitted: true, relationCounts });
  } catch (error) {
    if (commitAttempted) {
      await poisonBusinessFoundationShadowAdmissionDatabase(runtime, state.database);
      throw unavailable();
    }
    if (begun) {
      try { await query('ROLLBACK'); } catch (_) { await poisonBusinessFoundationShadowAdmissionDatabase(runtime, state.database); throw unavailable(); }
    }
    if (error && (error.code === 'VNEXT_PG17_SCHEMA_DRIFT' || error.code === 'VNEXT_PG17_ADMISSION_CANONICAL_HASH_CONFLICT' || error.code === 'VNEXT_PG17_ADMISSION_RECONCILIATION_MISMATCH')) throw error;
    throw businessSchemaDrift();
  } finally {
    state.businessFoundationShadowAdmissionBusy = false;
  }
}

async function destroyBusinessFoundationShadowAdmissionTarget(runtime, handle) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  const state = handles.get(handle);
  if (state.businessFoundationShadowAdmissionPoisoned) throw unavailable();
  if (!state.ownsDatabase || !state.businessFoundationShadowAdmissionStarted) throw invalidHandle();
  await disposeHandle(runtime, handle);
  return Object.freeze({ destroyed: true });
}

async function reconcileBusinessFoundationShadowAdmission(runtime, handle, batchId) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle) || typeof batchId !== 'string' || batchId.trim() === '') throw invalidHandle();
  const state = handles.get(handle);
  if (state.businessFoundationShadowAdmissionBusy || state.businessFoundationShadowAdmissionPoisoned) throw unavailable();
  const client = state.clients['fixture-provisioner'];
  if (!client) throw invalidHandle();
  const trace = state.businessFoundationShadowAdmissionTrace;
  const record = text => {
    const traceState = businessFoundationShadowAdmissionTraces.get(trace);
    if (traceState && traceState.armed) traceState.queries.push(text);
  };
  const query = (text, values) => {
    record(text);
    return client.query(text, values).then(result => {
      const planState = businessFoundationShadowAdmissionFaultPlans.get(state.businessFoundationShadowAdmissionFaultPlan);
      const stage = text === 'COMMIT' ? 'reconcileCommit' : text === 'ROLLBACK' ? 'reconcileRollback' : null;
      if (stage && planState && planState.pending.delete(stage)) throw new Error(`synthetic business shadow reconciliation ${stage} fault`);
      return result;
    });
  };
  state.businessFoundationShadowAdmissionBusy = true;
  let begun = false;
  let commitAttempted = false;
  try {
    await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    begun = true;
    await query("SET LOCAL TIME ZONE 'UTC'");
    const batch = await query('SELECT batch_id FROM migration_admission.migration_batches WHERE batch_id = $1', [batchId]);
    const ledger = await query(
      'SELECT source_relation, source_primary_key_sha256, canonical_source_sha256, target_id, target_logical_sha256, outcome, outcome_code FROM migration_admission.migration_row_ledger WHERE batch_id = $1 ORDER BY source_relation, source_primary_key_sha256',
      [batchId],
    );
    if (batch.rows.length !== 1 || ledger.rows.length === 0) throw reconciliationMismatch();
    const relationCounts = await assertBusinessFoundationShadowTargetMatchesLedger(query, ledger.rows);
    commitAttempted = true;
    await query('COMMIT');
    return Object.freeze({ reconciled: true, relationCounts: Object.freeze(relationCounts) });
  } catch (error) {
    if (commitAttempted) {
      await poisonBusinessFoundationShadowAdmissionDatabase(runtime, state.database);
      throw unavailable();
    }
    if (begun) {
      try { await query('ROLLBACK'); } catch (_) { await poisonBusinessFoundationShadowAdmissionDatabase(runtime, state.database); throw unavailable(); }
    }
    if (error && error.code === 'VNEXT_PG17_ADMISSION_RECONCILIATION_MISMATCH') throw error;
    throw reconciliationMismatch();
  } finally {
    state.businessFoundationShadowAdmissionBusy = false;
  }
}

function snapshotUnifiedDesktopOnlineInput(value, fields) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw migrationInputInvalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || fields.some(field => !keys.includes(field))) throw migrationInputInvalid();
  const snapshot = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string' || descriptor.value.trim() === '') throw migrationInputInvalid();
    snapshot[field] = descriptor.value;
  }
  for (const field of ['issuedAt', 'expiresAt', 'occurredAt', 'sessionExpiresAt']) {
    if (Object.prototype.hasOwnProperty.call(snapshot, field) && new Date(snapshot[field]).toISOString() !== snapshot[field]) throw migrationInputInvalid();
  }
  return Object.freeze(snapshot);
}

async function issueVNextPg17OnlineIdentityAssertion(runtime, handle, input) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  const snapshot = snapshotUnifiedDesktopOnlineInput(input, ['assertionId', 'authorityId', 'accountId', 'deviceId', 'installationId', 'installationPublicKey', 'keyFingerprint', 'audience', 'nonceSha256', 'canonicalRequestSha256', 'identityProofSha256', 'hardwareEvidenceSha256', 'issuedAt', 'expiresAt']);
  const state = handles.get(handle);
  const client = state.clients['identity-verifier'];
  if (!client) throw invalidHandle();
  try {
    await client.query('SELECT vnext_control_plane.vnext_issue_online_identity_assertion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [snapshot.assertionId, snapshot.authorityId, snapshot.accountId, snapshot.deviceId, snapshot.installationId, snapshot.installationPublicKey, snapshot.keyFingerprint, snapshot.audience, snapshot.nonceSha256, snapshot.canonicalRequestSha256, snapshot.identityProofSha256, snapshot.hardwareEvidenceSha256, snapshot.issuedAt, snapshot.expiresAt]);
    return Object.freeze({ issued: true });
  } catch (_) { throw unavailable(); }
}

async function provisionVNextPg17CanonicalPhoneAccount(runtime, handle, input) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  const snapshot = snapshotUnifiedDesktopOnlineInput(input, ['accountId', 'contactId', 'phoneHash', 'verificationEvidenceHash']);
  const state = handles.get(handle);
  const client = state.clients['identity-verifier'];
  if (!client) throw invalidHandle();
  try {
    const result = await client.query(
      'SELECT authority_id AS "authorityId", account_id AS "accountId" FROM vnext_control_plane.vnext_provision_canonical_phone_account($1,$2,$3,$4)',
      [snapshot.accountId, snapshot.contactId, snapshot.phoneHash, snapshot.verificationEvidenceHash],
    );
    if (result.rows.length !== 1 || typeof result.rows[0].authorityId !== 'string' || typeof result.rows[0].accountId !== 'string') throw unavailable();
    return Object.freeze({ authorityId: result.rows[0].authorityId, accountId: result.rows[0].accountId, replayed: result.rows[0].accountId !== snapshot.accountId });
  } catch (_) { throw unavailable(); }
}

function snapshotCanonicalWechatContactInput(value) {
  const fields = ['authorityId', 'accountId', 'openidContactId', 'openidHash', 'unionidContactId', 'unionidHash', 'verificationEvidenceHash'];
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw migrationInputInvalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || fields.some(field => !keys.includes(field))) throw migrationInputInvalid();
  const snapshot = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !('value' in descriptor)) throw migrationInputInvalid();
    snapshot[field] = descriptor.value;
  }
  for (const field of ['authorityId', 'accountId', 'openidContactId']) {
    if (typeof snapshot[field] !== 'string' || snapshot[field].trim() === '') throw migrationInputInvalid();
  }
  for (const field of ['openidHash', 'verificationEvidenceHash']) {
    if (typeof snapshot[field] !== 'string' || !/^[0-9a-f]{64}$/u.test(snapshot[field])) throw migrationInputInvalid();
  }
  if ((snapshot.unionidContactId === null) !== (snapshot.unionidHash === null)) throw migrationInputInvalid();
  if (snapshot.unionidContactId !== null && (typeof snapshot.unionidContactId !== 'string' || snapshot.unionidContactId.trim() === '' || typeof snapshot.unionidHash !== 'string' || !/^[0-9a-f]{64}$/u.test(snapshot.unionidHash))) throw migrationInputInvalid();
  return Object.freeze(snapshot);
}

async function bindVNextPg17CanonicalWechatIdentity(runtime, handle, input) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  const snapshot = snapshotCanonicalWechatContactInput(input);
  const state = handles.get(handle);
  const client = state.clients['identity-verifier'];
  if (!client) throw invalidHandle();
  try {
    const result = await client.query(
      'SELECT authority_id AS "authorityId", account_id AS "accountId", openid_contact_id AS "openidContactId", unionid_contact_id AS "unionidContactId" FROM vnext_control_plane.vnext_bind_canonical_wechat_identity($1,$2,$3,$4,$5,$6,$7)',
      [snapshot.authorityId, snapshot.accountId, snapshot.openidContactId, snapshot.openidHash, snapshot.unionidContactId, snapshot.unionidHash, snapshot.verificationEvidenceHash],
    );
    if (result.rows.length !== 1 || Object.keys(result.rows[0]).length !== 4 || Object.values(result.rows[0]).some(value => value !== null && (typeof value !== 'string' || value.trim() === ''))) throw unavailable();
    return Object.freeze(result.rows[0]);
  } catch (_) { throw unavailable(); }
}

async function readVNextPg17CanonicalAccountByVerifiedContact(runtime, handle, input) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  if (!input || typeof input !== 'object' || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) throw migrationInputInvalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 2 || !keys.includes('contactType') || !keys.includes('contactHash')) throw migrationInputInvalid();
  const contactType = Object.getOwnPropertyDescriptor(input, 'contactType');
  const contactHash = Object.getOwnPropertyDescriptor(input, 'contactHash');
  if (!contactType || !contactHash || !('value' in contactType) || !('value' in contactHash)
    || !['wechat_openid', 'wechat_unionid'].includes(contactType.value)
    || typeof contactHash.value !== 'string' || !/^[0-9a-f]{64}$/u.test(contactHash.value)) throw migrationInputInvalid();
  const state = handles.get(handle);
  const client = state.clients['identity-verifier'];
  if (!client) throw invalidHandle();
  try {
    const result = await client.query(
      'SELECT authority_id AS "authorityId", account_id AS "accountId", phone_hash AS "phoneHmac" FROM vnext_control_plane.vnext_read_canonical_account_by_verified_contact($1,$2)',
      [contactType.value, contactHash.value],
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1 || Object.keys(result.rows[0]).length !== 3 || typeof result.rows[0].authorityId !== 'string' || typeof result.rows[0].accountId !== 'string' || typeof result.rows[0].phoneHmac !== 'string' || !/^[0-9a-f]{64}$/u.test(result.rows[0].phoneHmac)) throw unavailable();
    return Object.freeze(result.rows[0]);
  } catch (_) { throw unavailable(); }
}

async function registerVNextPg17UnifiedDesktopOnline(runtime, handle, input) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  const snapshot = snapshotUnifiedDesktopOnlineInput(input, ['assertionId', 'idempotencyKey', 'receiptId', 'auditEventId', 'outboxEventId', 'sessionId', 'linkId', 'sessionExpiresAt', 'canonicalResultJson', 'resultSha256', 'canonicalPayloadJson', 'payloadSha256']);
  const state = handles.get(handle);
  const client = state.clients.writer;
  if (!client) throw invalidHandle();
  try {
    const result = await client.query('SELECT receipt_id AS "receiptId", session_id AS "sessionId", replayed FROM vnext_control_plane.vnext_register_unified_desktop_online($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [snapshot.assertionId, snapshot.idempotencyKey, snapshot.receiptId, snapshot.auditEventId, snapshot.outboxEventId, snapshot.sessionId, snapshot.linkId, snapshot.sessionExpiresAt, snapshot.canonicalResultJson, snapshot.resultSha256, snapshot.canonicalPayloadJson, snapshot.payloadSha256]);
    if (result.rows.length !== 1 || typeof result.rows[0].receiptId !== 'string' || typeof result.rows[0].sessionId !== 'string' || typeof result.rows[0].replayed !== 'boolean') throw unavailable();
    return Object.freeze({ receiptId: result.rows[0].receiptId, sessionId: result.rows[0].sessionId, replayed: result.rows[0].replayed });
  } catch (_) { throw unavailable(); }
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

function createVNextPg17BusinessFoundationAdmissionDdlTrace(runtime, handle) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  const trace = Object.freeze({});
  businessFoundationAdmissionDdlTraces.set(trace, { runtime, handle, armed: false, queries: [] });
  handles.get(handle).businessFoundationAdmissionDdlTrace = trace;
  return trace;
}

function armVNextPg17BusinessFoundationAdmissionDdlTrace(trace) {
  const state = businessFoundationAdmissionDdlTraces.get(trace);
  if (!state || !isVNextPg17DisposableHandleForRuntime(state.runtime, state.handle)) throw invalidHandle();
  state.armed = true;
}

function inspectVNextPg17BusinessFoundationAdmissionDdlTrace(trace) {
  const state = businessFoundationAdmissionDdlTraces.get(trace);
  if (!state) throw invalidHandle();
  return Object.freeze({ queries: Object.freeze([...state.queries]) });
}

function createVNextPg17BusinessFoundationAdmissionDdlFaultPlan(runtime, handle, stages) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle) || !Array.isArray(stages)
    || stages.length === 0 || stages.some(stage => typeof stage !== 'string' || !BUSINESS_FOUNDATION_ADMISSION_DDL_FAULT_STAGES.has(stage))) throw invalidHandle();
  const plan = Object.freeze({});
  businessFoundationAdmissionDdlFaultPlans.set(plan, { runtime, handle, pending: new Set(stages) });
  return plan;
}

function armVNextPg17BusinessFoundationAdmissionDdlFaultPlan(handle, plan) {
  const planState = businessFoundationAdmissionDdlFaultPlans.get(plan);
  if (!planState || !isVNextPg17DisposableHandleForRuntime(planState.runtime, handle)
    || planState.handle !== handle || handles.get(handle).runtime !== planState.runtime) throw invalidHandle();
  handles.get(handle).businessFoundationAdmissionDdlFaultPlan = plan;
}

function createVNextPg17BusinessFoundationShadowAdmissionTrace(runtime, handle) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
  const trace = Object.freeze({});
  businessFoundationShadowAdmissionTraces.set(trace, { runtime, handle, armed: false, queries: [] });
  handles.get(handle).businessFoundationShadowAdmissionTrace = trace;
  return trace;
}

function armVNextPg17BusinessFoundationShadowAdmissionTrace(trace) {
  const state = businessFoundationShadowAdmissionTraces.get(trace);
  if (!state || !isVNextPg17DisposableHandleForRuntime(state.runtime, state.handle)) throw invalidHandle();
  state.armed = true;
}

function inspectVNextPg17BusinessFoundationShadowAdmissionTrace(trace) {
  const state = businessFoundationShadowAdmissionTraces.get(trace);
  if (!state) throw invalidHandle();
  return Object.freeze({ queries: Object.freeze([...state.queries]) });
}

function createVNextPg17BusinessFoundationShadowAdmissionFaultPlan(runtime, handle, stages) {
  if (!isVNextPg17DisposableHandleForRuntime(runtime, handle) || !Array.isArray(stages)
    || stages.length === 0 || stages.some(stage => typeof stage !== 'string' || !BUSINESS_FOUNDATION_SHADOW_ADMISSION_FAULT_STAGES.has(stage))) throw invalidHandle();
  const plan = Object.freeze({});
  businessFoundationShadowAdmissionFaultPlans.set(plan, { runtime, handle, pending: new Set(stages) });
  return plan;
}

function armVNextPg17BusinessFoundationShadowAdmissionFaultPlan(handle, plan) {
  const planState = businessFoundationShadowAdmissionFaultPlans.get(plan);
  if (!planState || !isVNextPg17DisposableHandleForRuntime(planState.runtime, handle)
    || planState.handle !== handle || handles.get(handle).runtime !== planState.runtime) throw invalidHandle();
  handles.get(handle).businessFoundationShadowAdmissionFaultPlan = plan;
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
  if (!isVNextPg17DisposableHandle(handle) || !['migrator', 'runtime', 'verifier', 'writer', 'identity-verifier', 'business-verifier', 'migration-admission-verifier', 'fixture-provisioner'].includes(purpose)
    || typeof callback !== 'function' || types.isProxy(callback)) throw invalidHandle();
  const state = handles.get(handle);
  if (state.businessFoundationShadowAdmissionPoisoned) throw unavailable();
  if (purpose === 'migration-admission-verifier' && state.businessFoundationAdmissionDdlPoisoned) throw unavailable();
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
  readBusinessFoundationZeroSeedCounts,
  executeBusinessFoundationAdmissionDdlPlan,
  executeBusinessFoundationShadowAdmissionPlan,
  destroyBusinessFoundationShadowAdmissionTarget,
  reconcileBusinessFoundationShadowAdmission,
  issueVNextPg17OnlineIdentityAssertion,
  provisionVNextPg17CanonicalPhoneAccount,
  bindVNextPg17CanonicalWechatIdentity,
  readVNextPg17CanonicalAccountByVerifiedContact,
  registerVNextPg17UnifiedDesktopOnline,
  createVNextPg17BusinessFoundationDdlTrace,
  armVNextPg17BusinessFoundationDdlTrace,
  inspectVNextPg17BusinessFoundationDdlTrace,
  createVNextPg17BusinessFoundationDdlFaultPlan,
  armVNextPg17BusinessFoundationDdlFaultPlan,
  createVNextPg17BusinessFoundationAdmissionDdlTrace,
  armVNextPg17BusinessFoundationAdmissionDdlTrace,
  inspectVNextPg17BusinessFoundationAdmissionDdlTrace,
  createVNextPg17BusinessFoundationAdmissionDdlFaultPlan,
  armVNextPg17BusinessFoundationAdmissionDdlFaultPlan,
  createVNextPg17BusinessFoundationShadowAdmissionTrace,
  armVNextPg17BusinessFoundationShadowAdmissionTrace,
  inspectVNextPg17BusinessFoundationShadowAdmissionTrace,
  createVNextPg17BusinessFoundationShadowAdmissionFaultPlan,
  armVNextPg17BusinessFoundationShadowAdmissionFaultPlan,
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
