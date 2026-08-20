'use strict';

const assert = require('assert');
const { execFile } = require('child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  createDisposablePg17Runtime,
  withVNextPg17SyntheticQuery,
  createVNextPg17SyntheticQueryTrace,
  armVNextPg17SyntheticQueryTrace,
  inspectVNextPg17SyntheticQueryTrace,
} = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { createVNextPg17FirstAuthorityBootstrapMutation } = require('./firstAuthorityBootstrapMutation');
const { createVNextPg17TrustedSessionVerifierBoundary } = require('./trustedSessionVerifierBoundary');
const { createVNextPg17AccessContextResolver } = require('./accessContextResolver');
const { expectedCatalog } = require('./migrationManifest');

const BOOTSTRAP_NOW = '2026-08-15T00:00:00.000Z';
const NOW = '2026-08-15T00:01:00.000Z';
const LOCAL_DOCKER_HOST = process.platform === 'win32'
  ? 'npipe:////./pipe/docker_engine'
  : 'unix:///var/run/docker.sock';
const DISPOSABLE_OWNER_LABEL = `com.gewu.vnext-pg17-disposable-owner=${process.pid}`;

function runDocker(args) {
  return new Promise((resolve, reject) => {
    execFile('docker', ['--host', LOCAL_DOCKER_HOST, ...args], { windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function ownedContainerIds() {
  const output = await runDocker(['ps', '--all', '--quiet', '--no-trunc', '--filter', `label=${DISPOSABLE_OWNER_LABEL}`]);
  return output.trim() === '' ? [] : output.trim().split(/\r?\n/).sort();
}

function manifest() {
  return { contractVersion: 1, capabilities: [
    { capabilityId: 'access.manage', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'device.revoke', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] },
  ], roleDefaults: { super_admin: ['access.manage', 'device.revoke', 'user.review'], teacher: [], student: [] } };
}

async function fixture(runtime, {
  includeReauthentication = true,
  sessionKind = 'online',
  sessionStatus = 'active',
  issuedAt = BOOTSTRAP_NOW,
  expiresAt = '2026-08-15T01:00:00.000Z',
  revokedAt = null,
  reauthenticationVerifiedAt = BOOTSTRAP_NOW,
  reauthenticationExpiresAt = '2026-08-15T00:10:00.000Z',
  extraReauthenticationEvents = [],
  policyManifest = manifest(),
} = {}) {
  const handle = await runtime.createIsolatedHandle();
  const catalog = createVNextPg17CatalogBoundary(runtime);
  await catalog.apply(handle, { appliedAt: BOOTSTRAP_NOW, appliedBy: 'access-context-test' });
  const policy = require('../vNextAuthorizationPolicyReference');
  const policyHash = crypto.createHash('sha256').update(policy.canonicalizePolicyManifest(policyManifest), 'utf8').digest('hex');
  const bootstrapBoundary = require('../vNextTrustRootVerifierBoundaryReference').createVNextTrustRootVerifierBoundaryReference({
    databaseBinding: handle,
    verifyBootstrapPresentation: () => ({ kind: 'deployment_bootstrap', bootstrapIntentId: 'bootstrap-intent-1', authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1', installationPublicKey: 'public-key-1', installationKeyFingerprint: 'a'.repeat(64), policyManifestSha256: policyHash, expiresAt: '2026-08-15T00:04:00.000Z', approvalVersion: 1, assertionEvidenceSha256: 'b'.repeat(64) }),
    verifyRecoveryPresentation: () => { throw new Error('unused'); }, now: () => BOOTSTRAP_NOW,
  });
  const bootstrapAssertion = await bootstrapBoundary.verifyBootstrap(null);
  const bootstrap = createVNextPg17FirstAuthorityBootstrapMutation({ runtime, handle, verifierBoundary: bootstrapBoundary, now: () => BOOTSTRAP_NOW, idFactory: kind => `bootstrap-${kind}` });
  await bootstrap.execute(bootstrapAssertion, { type: 'authority.bootstrap', bootstrapIntentId: 'bootstrap-intent-1', authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1', installationPublicKey: 'public-key-1', installationKeyFingerprint: 'a'.repeat(64), policyManifest, idempotencyKey: 'bootstrap-key-1', reasonCode: 'bootstrap' });
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    await facade.query("INSERT INTO vnext_control_plane.vnext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,revoked_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES('session-1','authority-1','account-1','device-1','installation-1','bootstrap-bootstrap-link',$1,$2,$3,$4,$5,1,1,1,1,1,1,1,1,1,1,$3,$3)", [sessionKind, sessionStatus, issuedAt, expiresAt, revokedAt]);
    const insertReauthentication = ({ eventId, factorClass = 'passkey', verifiedAt, expiresAt }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_recent_reauthentication_events(reauth_event_id,authority_id,session_id,factor_class,evidence_sha256,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,verified_at,expires_at,created_at) VALUES($1,$2,$3,$4,repeat(\'c\',64),1,1,1,1,1,1,1,1,1,$5,$6,$5)',
      [eventId, 'authority-1', 'session-1', factorClass, verifiedAt, expiresAt],
    );
    if (includeReauthentication) await insertReauthentication({ eventId: 'reauth-1', verifiedAt: reauthenticationVerifiedAt, expiresAt: reauthenticationExpiresAt });
    for (const event of extraReauthenticationEvents) await insertReauthentication(event);
  });
  const boundary = createVNextPg17TrustedSessionVerifierBoundary({ databaseBinding: handle, verifyPresentation: () => ({ sessionId: 'session-1' }) });
  return { handle, boundary, assertion: await boundary.verify(null) };
}

async function expectUnavailable(action) {
  await assert.rejects(action, error => error?.code === 'VNEXT_PG17_ACCESS_CONTEXT_UNAVAILABLE');
}

function isReadOnlyTraceStatement(query) {
  if (['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT', 'ROLLBACK'].includes(query)) return true;
  if (typeof query !== 'string' || !query.startsWith('SELECT ') || query.includes(';')) return false;
  const withoutStrings = query.replace(/'(?:''|[^'])*'/g, '');
  return !/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|SET\s+ROLE|CALL|DO|COPY)\b/i.test(withoutStrings);
}

function assertResolverReadOnlyQueries(queries, terminal, { requireDomainQueries = true } = {}) {
  assert.strictEqual(queries.filter(query => query === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY').length, 1);
  assert.strictEqual(queries.at(-1), terminal);
  assert.strictEqual(queries.filter(query => query === 'COMMIT').length, terminal === 'COMMIT' ? 1 : 0);
  assert.strictEqual(queries.filter(query => query === 'ROLLBACK').length, terminal === 'ROLLBACK' ? 1 : 0);
  assert.strictEqual(queries.every(isReadOnlyTraceStatement), true);
  assert.strictEqual(queries.some(query => query.includes('WHERE s.session_id=$1')), true);
  if (requireDomainQueries) {
    assert.strictEqual(queries.some(query => query.includes('vnext_role_grants WHERE authority_id=$1 AND account_id=$2')), true);
    assert.strictEqual(queries.some(query => query.includes('vnext_capability_overrides WHERE authority_id=$1 AND account_id=$2')), true);
    assert.strictEqual(queries.some(query => query.includes('vnext_data_scope_grants WHERE authority_id=$1 AND account_id=$2')), true);
    assert.strictEqual(queries.some(query => query.includes('vnext_recent_reauthentication_events WHERE authority_id=$1 AND session_id=$2') && query.includes('ORDER BY expires_at DESC LIMIT 1')), true);
  }
  assert.strictEqual(queries.some(query => /\bvnext_control_plane\.vnext_capability_catalog\b/.test(query)), false);
  return queries;
}

function assertResolverReadOnlyTrace(trace, terminal, options) {
  const queries = inspectVNextPg17SyntheticQueryTrace(trace).queries;
  assert.strictEqual(Object.isFrozen(queries), true);
  return assertResolverReadOnlyQueries(queries, terminal, options);
}

async function targetRowsSnapshot(handle) {
  return withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const snapshot = {};
    for (const relation of expectedCatalog.relations) {
      const result = await facade.query(`SELECT row_to_json(item)::text AS row FROM ${relation} item ORDER BY row_to_json(item)::text`);
      snapshot[relation] = result.rows.map(item => item.row);
    }
    return snapshot;
  });
}

async function provisionPolicyReadRows(handle, {
  revokeBootstrapRole = false,
  roles = [],
  capabilities = [],
  overrides = [],
  scopes = [],
} = {}) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    if (revokeBootstrapRole) {
      await facade.query("UPDATE vnext_control_plane.vnext_role_grants SET status='revoked', revoked_at=$1, updated_at=$1 WHERE authority_id='authority-1' AND account_id='account-1' AND role='super_admin'", [NOW]);
    }
    for (const [capabilityId, status = 'active'] of capabilities) {
      await facade.query('INSERT INTO vnext_control_plane.vnext_capability_catalog(capability_id,status,surface_mask,created_at) VALUES($1,$2,$3,$4)', [capabilityId, status, 'desktop', BOOTSTRAP_NOW]);
    }
    for (const { grantId, role, status = 'active', startsAt = BOOTSTRAP_NOW, endsAt = null, revokedAt = null } of roles) {
      await facade.query('INSERT INTO vnext_control_plane.vnext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,ends_at,revoked_at,granted_by_account_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,1,$6,$7,$8,NULL,$9,$9)', [grantId, 'authority-1', 'account-1', role, status, startsAt, endsAt, revokedAt, BOOTSTRAP_NOW]);
    }
    for (const { overrideId, capabilityId, effect, status = 'active', startsAt = BOOTSTRAP_NOW, endsAt = null, revokedAt = null } of overrides) {
      await facade.query('INSERT INTO vnext_control_plane.vnext_capability_overrides(override_id,authority_id,account_id,capability_id,effect,status,starts_at,ends_at,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9,$10)', [overrideId, 'authority-1', 'account-1', capabilityId, effect, status, startsAt, endsAt, BOOTSTRAP_NOW, revokedAt]);
    }
    for (const { scopeGrantId, scopeType = 'teacher_profile', scopeValueHash, effect, status = 'active', startsAt = BOOTSTRAP_NOW, endsAt = null, revokedAt = null } of scopes) {
      await facade.query('INSERT INTO vnext_control_plane.vnext_data_scope_grants(scope_grant_id,authority_id,account_id,scope_type,scope_value_hash,effect,status,starts_at,ends_at,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$10,$11)', [scopeGrantId, 'authority-1', 'account-1', scopeType, scopeValueHash, effect, status, startsAt, endsAt, BOOTSTRAP_NOW, revokedAt]);
    }
  });
}

async function resolvePolicyReadContext(runtime, { fixtureOptions, rows, unavailable = false }) {
  const current = await fixture(runtime, fixtureOptions);
  try {
    await provisionPolicyReadRows(current.handle, rows);
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: current.handle, verifierBoundary: current.boundary, surface: 'desktop', now: () => NOW });
    const before = await targetRowsSnapshot(current.handle);
    const trace = createVNextPg17SyntheticQueryTrace(runtime, current.handle, 'verifier');
    armVNextPg17SyntheticQueryTrace(trace);
    const context = unavailable
      ? await expectUnavailable(() => resolver.resolve(current.assertion))
      : await resolver.resolve(current.assertion);
    assertResolverReadOnlyTrace(trace, unavailable ? 'ROLLBACK' : 'COMMIT', { requireDomainQueries: !unavailable });
    assert.deepStrictEqual(await targetRowsSnapshot(current.handle), before);
    return context;
  } finally {
    await runtime.disposeHandle(current.handle);
  }
}

async function resolveReauthenticationContext(runtime, fixtureOptions) {
  const current = await fixture(runtime, fixtureOptions);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: current.handle, verifierBoundary: current.boundary, surface: 'desktop', now: () => NOW });
    const before = await targetRowsSnapshot(current.handle);
    const trace = createVNextPg17SyntheticQueryTrace(runtime, current.handle, 'verifier');
    armVNextPg17SyntheticQueryTrace(trace);
    const context = await resolver.resolve(current.assertion);
    assertResolverReadOnlyTrace(trace, 'COMMIT');
    assert.deepStrictEqual(await targetRowsSnapshot(current.handle), before);
    return context;
  } finally {
    await runtime.disposeHandle(current.handle);
  }
}

async function runAccessContextResolverCases(runtime) {
  assert.throws(() => assertResolverReadOnlyQueries([
    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'ROLLBACK', 'SELECT 1', 'COMMIT',
  ], 'COMMIT'));
  assert.throws(() => assertResolverReadOnlyQueries([
    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT', 'SELECT 1', 'ROLLBACK',
  ], 'ROLLBACK'));
  assert.match(
    fs.readFileSync(path.join(__dirname, 'accessContextResolver.js'), 'utf8'),
    /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/,
  );
  const current = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: current.handle, verifierBoundary: current.boundary, surface: 'desktop', now: () => NOW });
    const before = await targetRowsSnapshot(current.handle);
    const trace = createVNextPg17SyntheticQueryTrace(runtime, current.handle, 'verifier');
    armVNextPg17SyntheticQueryTrace(trace);
    const context = await resolver.resolve(current.assertion);
    assert.strictEqual(context.authorityId, 'authority-1');
    assert.deepStrictEqual(context.roles, ['super_admin']);
    assert.deepStrictEqual(context.capabilityIds, ['access.manage', 'device.revoke', 'user.review']);
    assert.strictEqual(context.reauthenticatedUntil, '2026-08-15T00:10:00.000Z');
    assert.strictEqual(Object.isFrozen(context), true);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(context, 'factorClass'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(context, 'evidenceSha256'), false);
    assertResolverReadOnlyTrace(trace, 'COMMIT');
    assert.deepStrictEqual(await targetRowsSnapshot(current.handle), before);
  } finally {
    await runtime.disposeHandle(current.handle);
  }

  const miniapp = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: miniapp.handle, verifierBoundary: miniapp.boundary, surface: 'miniapp', now: () => NOW });
    const context = await resolver.resolve(miniapp.assertion);
    assert.deepStrictEqual(context.capabilityIds, []);
  } finally {
    await runtime.disposeHandle(miniapp.handle);
  }

  const opaqueScope = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: opaqueScope.handle, verifierBoundary: opaqueScope.boundary, surface: 'desktop', now: () => NOW });
    await withVNextPg17SyntheticQuery(opaqueScope.handle, 'fixture-provisioner', facade => facade.query(
      "INSERT INTO vnext_control_plane.vnext_data_scope_grants(scope_grant_id,authority_id,account_id,scope_type,scope_value_hash,effect,status,starts_at,ends_at,row_version,created_at,updated_at,revoked_at) VALUES('scope-opaque-1','authority-1','account-1','teacher_profile','opaque-scope','allow','active',$1,NULL,1,$1,$1,NULL)",
      [BOOTSTRAP_NOW],
    ));
    const context = await resolver.resolve(opaqueScope.assertion);
    assert.deepStrictEqual(context.scopes, [{ scopeType: 'teacher_profile', scopeValueHash: 'opaque-scope' }]);
  } finally {
    await runtime.disposeHandle(opaqueScope.handle);
  }

  const teacherManifest = { contractVersion: 1, capabilities: [
    { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] },
  ], roleDefaults: { super_admin: [], teacher: ['user.review'], student: [] } };
  const activeTeacher = await resolvePolicyReadContext(runtime, {
    fixtureOptions: { policyManifest: teacherManifest },
    rows: { revokeBootstrapRole: true, roles: [{ grantId: 'teacher-active-1', role: 'teacher' }] },
  });
  assert.deepStrictEqual(activeTeacher.roles, ['teacher']);
  assert.deepStrictEqual(activeTeacher.capabilityIds, ['user.review']);

  for (const role of [
    { grantId: 'teacher-revoked-1', role: 'teacher', status: 'revoked', revokedAt: NOW },
    { grantId: 'teacher-expired-1', role: 'teacher', status: 'expired', endsAt: NOW },
  ]) {
    const visitor = await resolvePolicyReadContext(runtime, {
      fixtureOptions: { policyManifest: teacherManifest },
      rows: { revokeBootstrapRole: true, roles: [role] },
    });
    assert.deepStrictEqual(visitor.roles, ['visitor']);
    assert.deepStrictEqual(visitor.capabilityIds, []);
  }

  const deniedCapability = await resolvePolicyReadContext(runtime, {
    rows: { capabilities: [['access.manage']], overrides: [{ overrideId: 'deny-access-manage-1', capabilityId: 'access.manage', effect: 'deny' }] },
  });
  assert.deepStrictEqual(deniedCapability.capabilityIds, ['device.revoke', 'user.review']);

  for (const override of [
    { overrideId: 'future-allow-1', capabilityId: 'user.review', effect: 'allow', startsAt: '2026-08-15T00:02:00.000Z' },
    { overrideId: 'ended-allow-1', capabilityId: 'user.review', effect: 'allow', startsAt: BOOTSTRAP_NOW, endsAt: NOW },
    { overrideId: 'revoked-allow-1', capabilityId: 'user.review', effect: 'allow', status: 'revoked', revokedAt: NOW },
    { overrideId: 'expired-allow-1', capabilityId: 'user.review', effect: 'allow', status: 'expired', endsAt: NOW },
  ]) {
    const ignoredOverride = await resolvePolicyReadContext(runtime, {
      rows: { revokeBootstrapRole: true, capabilities: [['user.review']], overrides: [override] },
    });
    assert.deepStrictEqual(ignoredOverride.roles, ['visitor']);
    assert.deepStrictEqual(ignoredOverride.capabilityIds, []);
  }

  const effectiveScope = await resolvePolicyReadContext(runtime, {
    rows: { scopes: [{ scopeGrantId: 'scope-opaque-current-1', scopeValueHash: 'opaque:scope', effect: 'allow' }] },
  });
  assert.deepStrictEqual(effectiveScope.scopes, [{ scopeType: 'teacher_profile', scopeValueHash: 'opaque:scope' }]);

  const scopedDeny = await resolvePolicyReadContext(runtime, {
    rows: { scopes: [
      { scopeGrantId: 'scope-opaque-allow-1', scopeValueHash: 'opaque:allow', effect: 'allow' },
      { scopeGrantId: 'scope-opaque-deny-1', scopeValueHash: 'opaque:deny', effect: 'deny' },
    ] },
  });
  assert.deepStrictEqual(scopedDeny.scopes, [{ scopeType: 'teacher_profile', scopeValueHash: 'opaque:allow' }]);

  for (const scope of [
    { scopeGrantId: 'scope-future-1', scopeValueHash: 'opaque-future', effect: 'allow', startsAt: '2026-08-15T00:02:00.000Z' },
    { scopeGrantId: 'scope-ended-1', scopeValueHash: 'opaque-ended', effect: 'allow', startsAt: BOOTSTRAP_NOW, endsAt: NOW },
    { scopeGrantId: 'scope-revoked-1', scopeValueHash: 'opaque-revoked', effect: 'allow', status: 'revoked', revokedAt: NOW },
    { scopeGrantId: 'scope-expired-1', scopeValueHash: 'opaque-expired', effect: 'allow', status: 'expired', endsAt: NOW },
    { scopeGrantId: 'scope-deny-1', scopeValueHash: 'opaque-deny', effect: 'deny' },
  ]) {
    const ignoredScope = await resolvePolicyReadContext(runtime, { rows: { scopes: [scope] } });
    assert.deepStrictEqual(ignoredScope.scopes, []);
  }

  await resolvePolicyReadContext(runtime, {
    rows: { capabilities: [['access.unknown']], overrides: [{ overrideId: 'unknown-capability-1', capabilityId: 'access.unknown', effect: 'allow' }] },
    unavailable: true,
  });

  const retiredManifest = { contractVersion: 1, capabilities: [
    { capabilityId: 'access.manage', status: 'retired', allowedSurfaces: ['desktop'] },
  ], roleDefaults: { super_admin: ['access.manage'], teacher: [], student: [] } };
  const retiredCapability = await resolvePolicyReadContext(runtime, { fixtureOptions: { policyManifest: retiredManifest }, rows: {} });
  assert.deepStrictEqual(retiredCapability.capabilityIds, []);

  const withoutReauth = await fixture(runtime, { includeReauthentication: false });
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: withoutReauth.handle, verifierBoundary: withoutReauth.boundary, surface: 'desktop', now: () => NOW });
    const context = await resolver.resolve(withoutReauth.assertion);
    assert.strictEqual(context.reauthenticatedUntil, null);
  } finally {
    await runtime.disposeHandle(withoutReauth.handle);
  }

  const latestReauthentication = await resolveReauthenticationContext(runtime, {
    includeReauthentication: false,
    extraReauthenticationEvents: [
      { eventId: 'reauth-password-1', factorClass: 'password', verifiedAt: BOOTSTRAP_NOW, expiresAt: '2026-08-15T00:05:00.000Z' },
      { eventId: 'reauth-passkey-1', factorClass: 'passkey', verifiedAt: NOW, expiresAt: '2026-08-15T00:20:00.000Z' },
      { eventId: 'reauth-contact-1', factorClass: 'verified_contact', verifiedAt: BOOTSTRAP_NOW, expiresAt: '2026-08-15T00:15:00.000Z' },
    ],
  });
  assert.strictEqual(latestReauthentication.reauthenticatedUntil, '2026-08-15T00:20:00.000Z');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(latestReauthentication, 'factorClass'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(latestReauthentication, 'evidenceSha256'), false);

  for (const [factorClass, expiresAt] of [
    ['password', '2026-08-15T00:05:00.000Z'],
    ['passkey', '2026-08-15T00:10:00.000Z'],
    ['verified_contact', '2026-08-15T00:15:00.000Z'],
  ]) {
    const context = await resolveReauthenticationContext(runtime, {
      includeReauthentication: false,
      extraReauthenticationEvents: [{ eventId: `reauth-${factorClass}-only`, factorClass, verifiedAt: BOOTSTRAP_NOW, expiresAt }],
    });
    assert.strictEqual(context.reauthenticatedUntil, expiresAt);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(context, 'factorClass'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(context, 'evidenceSha256'), false);
  }

  const verifiedAtBoundary = await resolveReauthenticationContext(runtime, { reauthenticationVerifiedAt: NOW });
  assert.strictEqual(verifiedAtBoundary.reauthenticatedUntil, '2026-08-15T00:10:00.000Z');

  const expiresAtBoundary = await resolveReauthenticationContext(runtime, { reauthenticationExpiresAt: NOW });
  assert.strictEqual(expiresAtBoundary.reauthenticatedUntil, null);

  const futureOnlyReauthentication = await resolveReauthenticationContext(runtime, {
    includeReauthentication: false,
    extraReauthenticationEvents: [
      { eventId: 'reauth-future-1', factorClass: 'passkey', verifiedAt: '2026-08-15T00:02:00.000Z', expiresAt: '2026-08-15T00:10:00.000Z' },
    ],
  });
  assert.strictEqual(futureOnlyReauthentication.reauthenticatedUntil, null);

  for (const options of [
    { reauthenticationExpiresAt: NOW },
    { reauthenticationVerifiedAt: '2026-08-15T00:02:00.000Z', reauthenticationExpiresAt: '2026-08-15T00:10:00.000Z' },
  ]) {
    const staleReauthentication = await fixture(runtime, options);
    try {
      const resolver = createVNextPg17AccessContextResolver({ runtime, handle: staleReauthentication.handle, verifierBoundary: staleReauthentication.boundary, surface: 'desktop', now: () => NOW });
      const context = await resolver.resolve(staleReauthentication.assertion);
      assert.strictEqual(context.reauthenticatedUntil, null);
    } finally {
      await runtime.disposeHandle(staleReauthentication.handle);
    }
  }

  const expired = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: expired.handle, verifierBoundary: expired.boundary, surface: 'desktop', now: () => '2026-08-15T01:00:00.000Z' });
    await expectUnavailable(() => resolver.resolve(expired.assertion));
  } finally {
    await runtime.disposeHandle(expired.handle);
  }

  for (const options of [
    { includeReauthentication: false, sessionKind: 'initialization' },
    { includeReauthentication: false, sessionStatus: 'expired' },
    { includeReauthentication: false, sessionStatus: 'revoked', revokedAt: '2026-08-15T00:01:00.000Z' },
    { includeReauthentication: false, issuedAt: '2026-08-15T00:02:00.000Z' },
  ]) {
    const invalidSession = await fixture(runtime, options);
    try {
      const resolver = createVNextPg17AccessContextResolver({ runtime, handle: invalidSession.handle, verifierBoundary: invalidSession.boundary, surface: 'desktop', now: () => NOW });
      await expectUnavailable(() => resolver.resolve(invalidSession.assertion));
    } finally {
      await runtime.disposeHandle(invalidSession.handle);
    }
  }

  const malformedPolicy = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: malformedPolicy.handle, verifierBoundary: malformedPolicy.boundary, surface: 'desktop', now: () => NOW });
    await withVNextPg17SyntheticQuery(malformedPolicy.handle, 'fixture-provisioner', async facade => {
      await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications DISABLE TRIGGER vnext_authorization_policy_publications_no_update');
      try {
        await facade.query("UPDATE vnext_control_plane.vnext_authorization_policy_publications SET canonical_manifest_json='{}' WHERE authority_id='authority-1' AND policy_revision=1");
      } finally {
        await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications ENABLE TRIGGER vnext_authorization_policy_publications_no_update');
      }
    });
    const beforeFailure = await targetRowsSnapshot(malformedPolicy.handle);
    const failureTrace = createVNextPg17SyntheticQueryTrace(runtime, malformedPolicy.handle, 'verifier');
    armVNextPg17SyntheticQueryTrace(failureTrace);
    await expectUnavailable(() => resolver.resolve(malformedPolicy.assertion));
    assertResolverReadOnlyTrace(failureTrace, 'ROLLBACK', { requireDomainQueries: false });
    assert.deepStrictEqual(await targetRowsSnapshot(malformedPolicy.handle), beforeFailure);
    const policyModule = require('../vNextAuthorizationPolicyReference');
    const canonicalManifest = policyModule.canonicalizePolicyManifest(manifest());
    await withVNextPg17SyntheticQuery(malformedPolicy.handle, 'fixture-provisioner', async facade => {
      await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications DISABLE TRIGGER vnext_authorization_policy_publications_no_update');
      try {
        await facade.query("UPDATE vnext_control_plane.vnext_authorization_policy_publications SET canonical_manifest_json=$1 WHERE authority_id='authority-1' AND policy_revision=1", [canonicalManifest]);
      } finally {
        await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications ENABLE TRIGGER vnext_authorization_policy_publications_no_update');
      }
    });
    const recoveryTrace = createVNextPg17SyntheticQueryTrace(runtime, malformedPolicy.handle, 'verifier');
    armVNextPg17SyntheticQueryTrace(recoveryTrace);
    const recovered = await resolver.resolve(malformedPolicy.assertion);
    assert.strictEqual(recovered.authorityId, 'authority-1');
    assertResolverReadOnlyTrace(recoveryTrace, 'COMMIT');
  } finally {
    await runtime.disposeHandle(malformedPolicy.handle);
  }

  const catalogDrift = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: catalogDrift.handle, verifierBoundary: catalogDrift.boundary, surface: 'desktop', now: () => NOW });
    const before = await targetRowsSnapshot(catalogDrift.handle);
    await withVNextPg17SyntheticQuery(catalogDrift.handle, 'fixture-provisioner', facade => facade.query(
      'CREATE INDEX vnext_access_context_unexpected_index ON vnext_control_plane.vnext_sessions(session_kind)',
    ));
    await expectUnavailable(() => resolver.resolve(catalogDrift.assertion));
    assert.deepStrictEqual(await targetRowsSnapshot(catalogDrift.handle), before);
  } finally {
    await runtime.disposeHandle(catalogDrift.handle);
  }

  const stale = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: stale.handle, verifierBoundary: stale.boundary, surface: 'desktop', now: () => NOW });
    await expectUnavailable(() => resolver.resolve({}));
    await withVNextPg17SyntheticQuery(stale.handle, 'fixture-provisioner', facade => facade.query("UPDATE vnext_control_plane.vnext_accounts SET access_version=2, updated_at='2026-08-15T00:01:00.000Z' WHERE authority_id='authority-1' AND account_id='account-1'"));
    await expectUnavailable(() => resolver.resolve(stale.assertion));
  } finally {
    await runtime.disposeHandle(stale.handle);
  }

  const parentsAndVectors = await fixture(runtime);
  try {
    const resolver = createVNextPg17AccessContextResolver({ runtime, handle: parentsAndVectors.handle, verifierBoundary: parentsAndVectors.boundary, surface: 'desktop', now: () => NOW });
    const cases = [
      ["UPDATE vnext_control_plane.vnext_authorities SET status='disabled' WHERE authority_id='authority-1'", "UPDATE vnext_control_plane.vnext_authorities SET status='active' WHERE authority_id='authority-1'"],
      ["UPDATE vnext_control_plane.vnext_accounts SET status='disabled' WHERE authority_id='authority-1' AND account_id='account-1'", "UPDATE vnext_control_plane.vnext_accounts SET status='active' WHERE authority_id='authority-1' AND account_id='account-1'"],
      ["UPDATE vnext_control_plane.vnext_trusted_devices SET status='risk_limited' WHERE authority_id='authority-1' AND device_id='device-1'", "UPDATE vnext_control_plane.vnext_trusted_devices SET status='active' WHERE authority_id='authority-1' AND device_id='device-1'"],
      ["UPDATE vnext_control_plane.vnext_device_installations SET status='retired' WHERE authority_id='authority-1' AND device_id='device-1' AND installation_id='installation-1'", "UPDATE vnext_control_plane.vnext_device_installations SET status='active' WHERE authority_id='authority-1' AND device_id='device-1' AND installation_id='installation-1'"],
      ["UPDATE vnext_control_plane.vnext_account_device_links SET status='expired' WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'", "UPDATE vnext_control_plane.vnext_account_device_links SET status='active' WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'"],
      ["UPDATE vnext_control_plane.vnext_accounts SET auth_version=2 WHERE authority_id='authority-1' AND account_id='account-1'", "UPDATE vnext_control_plane.vnext_accounts SET auth_version=1 WHERE authority_id='authority-1' AND account_id='account-1'"],
      ["UPDATE vnext_control_plane.vnext_accounts SET access_version=2 WHERE authority_id='authority-1' AND account_id='account-1'", "UPDATE vnext_control_plane.vnext_accounts SET access_version=1 WHERE authority_id='authority-1' AND account_id='account-1'"],
      ["UPDATE vnext_control_plane.vnext_accounts SET revocation_version=2 WHERE authority_id='authority-1' AND account_id='account-1'", "UPDATE vnext_control_plane.vnext_accounts SET revocation_version=1 WHERE authority_id='authority-1' AND account_id='account-1'"],
      ["UPDATE vnext_control_plane.vnext_trusted_devices SET credential_version=2 WHERE authority_id='authority-1' AND device_id='device-1'", "UPDATE vnext_control_plane.vnext_trusted_devices SET credential_version=1 WHERE authority_id='authority-1' AND device_id='device-1'"],
      ["UPDATE vnext_control_plane.vnext_trusted_devices SET risk_version=2 WHERE authority_id='authority-1' AND device_id='device-1'", "UPDATE vnext_control_plane.vnext_trusted_devices SET risk_version=1 WHERE authority_id='authority-1' AND device_id='device-1'"],
      ["UPDATE vnext_control_plane.vnext_device_installations SET credential_version=2 WHERE authority_id='authority-1' AND device_id='device-1' AND installation_id='installation-1'", "UPDATE vnext_control_plane.vnext_device_installations SET credential_version=1 WHERE authority_id='authority-1' AND device_id='device-1' AND installation_id='installation-1'"],
      ["UPDATE vnext_control_plane.vnext_account_device_links SET auth_version=2 WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'", "UPDATE vnext_control_plane.vnext_account_device_links SET auth_version=1 WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'"],
      ["UPDATE vnext_control_plane.vnext_account_device_links SET access_version=2 WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'", "UPDATE vnext_control_plane.vnext_account_device_links SET access_version=1 WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'"],
      ["UPDATE vnext_control_plane.vnext_account_device_links SET row_version=2 WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'", "UPDATE vnext_control_plane.vnext_account_device_links SET row_version=1 WHERE authority_id='authority-1' AND link_id='bootstrap-bootstrap-link'"],
    ];
    for (const [change, restore] of cases) {
      await withVNextPg17SyntheticQuery(parentsAndVectors.handle, 'fixture-provisioner', facade => facade.query(change));
      await expectUnavailable(() => resolver.resolve(parentsAndVectors.assertion));
      await withVNextPg17SyntheticQuery(parentsAndVectors.handle, 'fixture-provisioner', facade => facade.query(restore));
    }
  } finally {
    await runtime.disposeHandle(parentsAndVectors.handle);
  }
}

if (require.main === module) {
  runStandaloneCases().catch(error => { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; });
}

async function runStandaloneCases() {
  const containerBaseline = await ownedContainerIds();
  const runtime = createDisposablePg17Runtime();
  let completed = false;
  try {
    await runtime.start();
    await runAccessContextResolverCases(runtime);
    completed = true;
  } finally {
    try {
      await runtime.stop();
    } finally {
      assert.deepStrictEqual(await ownedContainerIds(), containerBaseline);
    }
  }
  if (completed) process.stdout.write('vNext PG17 AccessContext resolver checks passed\n');
}

module.exports = { runAccessContextResolverCases };
