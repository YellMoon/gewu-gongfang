'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const { bootstrapVNextControlPlaneReference } = require('./vNextControlPlaneReferenceKernel');
const policy = require('./vNextAuthorizationPolicyReference');
const { createVNextTrustedSessionVerifierBoundary } = require('./vNextTrustedSessionVerifierBoundaryReference');
const { createVNextAccessContextResolverReference, isVNextAccessContextResolverReference } = require('./vNextAccessContextResolverReference');

const NOW = '2026-08-14T01:00:00.000Z';
const HASH = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const H = 'a'.repeat(64);

function expectUnavailable(action) {
  assert.throws(action, error => error && error.code === 'VNEXT_ACCESS_CONTEXT_UNAVAILABLE' && error.message === 'VNEXT_ACCESS_CONTEXT_UNAVAILABLE');
}

function vNextFingerprint(db) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vNext_%' ORDER BY name").all().map(row => row.name);
  return JSON.stringify({ transaction: db.inTransaction, foreignKeys: db.pragma('foreign_keys', { simple: true }), rows: names.map(name => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]) });
}

function createFixture({ sessionKind = 'online', sessionStatus = 'active', publication = 'valid', role = 'super_admin', scopeEffect = 'deny', reauth = true } = {}) {
  const db = new Database(':memory:');
  bootstrapVNextControlPlaneReference(db);
  const t = '2026-08-14T00:00:00.000Z';
  db.prepare("INSERT INTO vNext_authorities VALUES(?,?,?,?)").run('authority-1','active',t,t);
  db.prepare("INSERT INTO vNext_accounts VALUES(?,?,?,?,?,?,?,?,?)").run('account-1','authority-1','active',1,1,1,1,t,t);
  db.prepare("INSERT INTO vNext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run('device-1','authority-1','active',1,1,1,t,t);
  db.prepare("INSERT INTO vNext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('install-1','authority-1','device-1','key-1','fingerprint-1','active',1,1,t,t);
  db.prepare("INSERT INTO vNext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run('link-1','authority-1','account-1','device-1','install-1','active',1,1,1,t,t);
  db.prepare("INSERT INTO vNext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('session-1','authority-1','account-1','device-1','install-1','link-1',sessionKind,sessionStatus,t,'2026-08-14T08:00:00.000Z',1,1,1,1,1,1,1,1,1,1,t,t);
  if (role) db.prepare("INSERT INTO vNext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('role-1','authority-1','account-1',role,'active',1,1,t,t,t);
  db.prepare("INSERT INTO vNext_capability_catalog(capability_id,status,surface_mask,created_at) VALUES(?,?,?,?)").run('user.review','active','desktop',t);
  db.prepare("INSERT INTO vNext_capability_overrides(override_id,authority_id,account_id,capability_id,effect,status,starts_at,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('override-1','authority-1','account-1','user.review','deny','active',t,1,t,t);
  db.prepare("INSERT INTO vNext_data_scope_grants(scope_grant_id,authority_id,account_id,scope_type,scope_value_hash,effect,status,starts_at,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run('scope-1','authority-1','account-1','school',H,scopeEffect,'active',t,1,t,t);
  if (reauth && sessionKind === 'online' && sessionStatus === 'active') db.prepare("INSERT INTO vNext_recent_reauthentication_events(reauth_event_id,authority_id,session_id,factor_class,evidence_sha256,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,verified_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('reauth-1','authority-1','session-1','passkey',H,1,1,1,1,1,1,1,1,1,'2026-08-14T00:55:00.000Z','2026-08-14T01:10:00.000Z','2026-08-14T00:55:00.000Z');
  if (publication !== 'none') {
    const manifest = policy.DEFAULT_POLICY_MANIFEST;
    const canonical = publication === 'noncanonical' ? JSON.stringify(JSON.parse(policy.canonicalizePolicyManifest(manifest)), null, 2) : policy.canonicalizePolicyManifest(manifest);
    const manifestHash = publication === 'bad-hash' ? 'b'.repeat(64) : policy.policyManifestSha256(manifest);
    const result = JSON.stringify({ authorityId: 'authority-1', code: 'POLICY_PUBLISHED', policyContractVersion: 1, policyManifestSha256: manifestHash, policyRevision: 1, publicationId: 'publication-1', status: 'accepted' });
    db.prepare("INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_target_row_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('receipt-1','authority-1','system','publication-1','authorization_policy.publish','authorization_policy','authority-1',H,0,'accepted','POLICY_PUBLISHED',result,H,1,t);
    db.prepare("INSERT INTO vNext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES(?,?,?,?,?,?,?,?)").run('publication-1','authority-1','receipt-1',1,1,canonical,manifestHash,t);
  }
  const boundary = createVNextTrustedSessionVerifierBoundary({ verifyPresentation: () => ({ sessionId: 'session-1' }) });
  const resolver = createVNextAccessContextResolverReference({ db, verifierBoundary: boundary, surface: 'desktop', now: () => NOW });
  return { db, boundary, resolver };
}

(async () => {
  const { db, boundary, resolver } = createFixture();
  const assertion = await boundary.verify({ neverReturned: 'presentation' });
  assert.strictEqual(isVNextAccessContextResolverReference(resolver), true, 'only the real resolver factory output is branded');
  assert.strictEqual(isVNextAccessContextResolverReference({ resolve: resolver.resolve }), false, 'a copied resolve method is not a resolver');
  assert.strictEqual(isVNextAccessContextResolverReference({ resolve() {} }), false, 'a look-alike resolver is not trusted');
  assert.strictEqual(isVNextAccessContextResolverReference(createVNextAccessContextResolverReference({ db, verifierBoundary: boundary, surface: 'desktop', now: () => NOW })), true, 'a second real factory output is branded');
  const before = { changes: db.totalChanges, fingerprint: vNextFingerprint(db) };
  const context = resolver.resolve(assertion);
  assert.deepStrictEqual(context, {
    authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'install-1', linkId: 'link-1', sessionId: 'session-1', surface: 'desktop', policyRevision: 1, policyManifestSha256: policy.policyManifestSha256(policy.DEFAULT_POLICY_MANIFEST), roles: ['super_admin'], capabilityIds: ['access.manage','device.revoke'], capabilitySha256: HASH('["access.manage","device.revoke"]'), scopes: [], scopeSha256: HASH('[]'), reauthenticatedUntil: '2026-08-14T01:10:00.000Z',
  });
  assert.ok(Object.isFrozen(context) && Object.isFrozen(context.roles) && Object.isFrozen(context.capabilityIds) && Object.isFrozen(context.scopes));
  assert.deepStrictEqual({ changes: db.totalChanges, fingerprint: vNextFingerprint(db) }, before, 'resolver is read-only');
  expectUnavailable(() => resolver.resolve('session-1'));
  expectUnavailable(() => createVNextAccessContextResolverReference({ db, verifierBoundary: boundary, surface: 'desktop', now: () => NOW }).resolve({}));
  const forgedBoundary = Object.freeze({ unwrap: sessionId => ({ sessionId }) });
  expectUnavailable(() => createVNextAccessContextResolverReference({ db, verifierBoundary: forgedBoundary, surface: 'desktop', now: () => NOW }));
  expectUnavailable(() => createVNextAccessContextResolverReference({ db: {}, verifierBoundary: boundary, surface: 'desktop' }));
  for (const invalidConfig of [
    Object.create({ db, verifierBoundary: boundary, surface: 'desktop' }),
    { db, verifierBoundary: boundary, surface: 'desktop', unexpected: true },
    Object.defineProperty({ db, verifierBoundary: boundary, surface: 'desktop' }, 'now', { get() { throw new Error('detail'); } }),
    new Proxy({ db, verifierBoundary: boundary, surface: 'desktop' }, {}),
  ]) expectUnavailable(() => createVNextAccessContextResolverReference(invalidConfig));
  expectUnavailable(() => createVNextAccessContextResolverReference({ db, verifierBoundary: boundary, surface: 'desktop', now: () => 1 }).resolve(assertion));
  db.prepare("UPDATE vNext_accounts SET access_version=2,row_version=2,updated_at='2026-08-14T01:01:00.000Z' WHERE account_id='account-1'").run();
  expectUnavailable(() => resolver.resolve(assertion));
  db.close();

  for (const options of [{ sessionKind: 'initialization' }, { sessionStatus: 'expired' }, { publication: 'none' }, { publication: 'noncanonical' }, { publication: 'bad-hash' }]) {
    const fixture = createFixture(options);
    const handle = await fixture.boundary.verify(null);
    expectUnavailable(() => fixture.resolver.resolve(handle));
    fixture.db.close();
  }

  const miniapp = createFixture();
  const miniResolver = createVNextAccessContextResolverReference({ db: miniapp.db, verifierBoundary: miniapp.boundary, surface: 'miniapp', now: () => NOW });
  const miniContext = miniResolver.resolve(await miniapp.boundary.verify(null));
  assert.deepStrictEqual(miniContext.capabilityIds, []);
  miniapp.db.close();

  const visitor = createFixture({ role: null, scopeEffect: 'allow', reauth: false });
  const visitorContext = visitor.resolver.resolve(await visitor.boundary.verify(null));
  assert.deepStrictEqual(visitorContext.roles, ['visitor']);
  assert.deepStrictEqual(visitorContext.capabilityIds, []);
  assert.deepStrictEqual(visitorContext.scopes, [{ scopeType: 'school', scopeValueHash: H }]);
  assert.ok(Object.isFrozen(visitorContext.scopes[0]));
  assert.strictEqual(visitorContext.reauthenticatedUntil, null);
  visitor.db.close();

  for (const [table, column, where] of [
    ['vNext_accounts', 'auth_version', "account_id='account-1'"], ['vNext_accounts', 'access_version', "account_id='account-1'"], ['vNext_accounts', 'revocation_version', "account_id='account-1'"],
    ['vNext_trusted_devices', 'credential_version', "device_id='device-1'"], ['vNext_trusted_devices', 'risk_version', "device_id='device-1'"], ['vNext_device_installations', 'credential_version', "installation_id='install-1'"],
    ['vNext_account_device_links', 'auth_version', "link_id='link-1'"], ['vNext_account_device_links', 'access_version', "link_id='link-1'"], ['vNext_account_device_links', 'row_version', "link_id='link-1'"],
  ]) {
    const fixture = createFixture(); const handle = await fixture.boundary.verify(null);
    fixture.db.prepare(`UPDATE ${table} SET ${column}=2 WHERE ${where}`).run();
    expectUnavailable(() => fixture.resolver.resolve(handle)); fixture.db.close();
  }

  for (const currentNow of ['2026-08-13T23:59:59.999Z', '2026-08-14T08:00:00.000Z']) {
    const fixture = createFixture(); const handle = await fixture.boundary.verify(null);
    const timed = createVNextAccessContextResolverReference({ db: fixture.db, verifierBoundary: fixture.boundary, surface: 'desktop', now: () => currentNow });
    expectUnavailable(() => timed.resolve(handle)); fixture.db.close();
  }

  for (const [table, where, status] of [
    ['vNext_authorities', "authority_id='authority-1'", 'disabled'], ['vNext_accounts', "account_id='account-1'", 'disabled'], ['vNext_trusted_devices', "device_id='device-1'", 'risk_limited'], ['vNext_device_installations', "installation_id='install-1'", 'retired'], ['vNext_account_device_links', "link_id='link-1'", 'expired'],
  ]) {
    const fixture = createFixture();
    const handle = await fixture.boundary.verify(null);
    fixture.db.prepare(`UPDATE ${table} SET status=? WHERE ${where}`).run(status);
    expectUnavailable(() => fixture.resolver.resolve(handle));
    fixture.db.close();
  }
  console.log('vNext AccessContext resolver reference checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
