'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const {
  V_NEXT_CONTROL_PLANE_REFERENCE_TABLES,
  assertVNextControlPlaneReferenceSchema,
  bootstrapVNextControlPlaneReference,
} = require('./vNextControlPlaneReferenceKernel');
const HASH = 'a'.repeat(64);

function vNextTables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vNext_%' ORDER BY name")
    .all().map(row => row.name);
}

const db = new Database(':memory:');
try {
  db.exec('CREATE TABLE legacy_guard(id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO legacy_guard VALUES(\'legacy-1\',\'unchanged\');');
  const beforeLegacySql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='legacy_guard'").get().sql;
  const result = bootstrapVNextControlPlaneReference(db);
  assert.strictEqual(result.schemaVersion, 4);
  assert.deepStrictEqual(result.tables, V_NEXT_CONTROL_PLANE_REFERENCE_TABLES);
  assert.deepStrictEqual(vNextTables(db), V_NEXT_CONTROL_PLANE_REFERENCE_TABLES);
  assert.deepStrictEqual(
    db.prepare('PRAGMA table_info(vNext_authorization_audit_events)').all().map(row => row.name),
    ['event_id','authority_id','receipt_id','reason_code','context_sha256','created_at'],
    'audit must derive command identity and outcome from its immutable receipt',
  );
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM vNext_authorities').get().count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM vNext_accounts').get().count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM vNext_role_grants').get().count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_audit_events').get().count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_command_receipts').get().count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_outbox_events').get().count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM vNext_sessions').get().count, 0, 'bootstrap must not seed sessions');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM vNext_recent_reauthentication_events').get().count, 0, 'bootstrap must not seed reauth events');
  assert.deepStrictEqual(
    db.prepare('SELECT schema_key,schema_version FROM vNext_schema_meta').all(),
    [{ schema_key: 'control-plane-reference', schema_version: 4 }],
  );
  assert.strictEqual(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='legacy_guard'").get().sql, beforeLegacySql);
  assert.deepStrictEqual(db.prepare('SELECT * FROM legacy_guard').all(), [{ id: 'legacy-1', value: 'unchanged' }]);
  assert.deepStrictEqual(bootstrapVNextControlPlaneReference(db), result, 'reapplication must be an explicit deterministic no-op');

  assert.throws(
    () => db.prepare("INSERT INTO vNext_authorities(authority_id,status,created_at,updated_at) VALUES(NULL,'active','2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run(),
    /NOT NULL constraint failed/,
  );
  assert.throws(
    () => db.prepare("INSERT INTO vNext_authorities(authority_id,status,created_at,updated_at) VALUES(' ','active','2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run(),
    /CHECK constraint failed/,
  );
  db.prepare("INSERT INTO vNext_authorities(authority_id,status,created_at,updated_at) VALUES('authority-1','active','2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run();
  db.prepare("INSERT INTO vNext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES('account-1','authority-1','active',1,1,1,1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run();
  assert.throws(
    () => db.prepare("INSERT INTO vNext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,created_at,updated_at) VALUES('grant-admin','authority-1','account-1','admin','active',1,1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare("INSERT INTO vNext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,created_at,updated_at) VALUES('grant-orphan','authority-1','missing-account','teacher','active',1,1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run(),
    /FOREIGN KEY constraint failed/,
  );
  db.prepare("INSERT INTO vNext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at) VALUES('device-1','authority-1','active',1,1,1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run();
  assert.throws(
    () => db.prepare("INSERT INTO vNext_device_installations(installation_id,authority_id,device_id,status,credential_version,row_version,created_at,updated_at) VALUES('install-empty','authority-1','device-1','active',1,1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run(),
    /NOT NULL constraint failed/,
  );
  db.prepare("INSERT INTO vNext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at) VALUES('install-1','authority-1','device-1','public-key-1','fingerprint-1','active',1,1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run();
  assert.throws(
    () => db.prepare("INSERT INTO vNext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at) VALUES('bad-link','authority-1','account-1','wrong-device','install-1','active',1,1,1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run(),
    /FOREIGN KEY constraint failed/,
  );
  db.prepare("INSERT INTO vNext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at) VALUES('link-1','authority-1','account-1','device-1','install-1','active',1,1,1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run();
  const sessionColumns = 'session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at';
  const sessionValues = "'session-online','authority-1','account-1','device-1','install-1','link-1','online','active','2026-08-14T00:00:00.000Z','2026-08-14T08:00:00.000Z',1,1,1,1,1,1,1,1,1,1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z'";
  db.prepare(`INSERT INTO vNext_sessions(${sessionColumns}) VALUES(${sessionValues})`).run();
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM vNext_sessions').get().count, 1, 'bootstrap must never seed session rows');
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_sessions(${sessionColumns}) VALUES(${sessionValues.replace("'authority-1'", "'authority-2'").replace("'session-online'", "'session-cross-authority'")})`).run(),
    /(FOREIGN KEY constraint failed|VNEXT_SESSION_PARENT_STATE_INVALID)/,
  );
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_sessions(${sessionColumns}) VALUES(${sessionValues.replace("'session-online'", "'session-forged-parent-version'").replace(',1,1,1,1,1,1,1,1,1,1,', ',999,1,1,1,1,1,1,1,1,1,')})`).run(),
    /VNEXT_SESSION_PARENT_STATE_INVALID/,
  );
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_sessions(${sessionColumns}) VALUES(${sessionValues.replace("'session-online'", "'session-fractional'").replace(',1,1,1,1,1,1,1,1,1,1,', ',1.5,1,1,1,1,1,1,1,1,1,')})`).run(),
    /(CHECK constraint failed|VNEXT_SESSION_PARENT_STATE_INVALID)/,
  );
  db.prepare(`INSERT INTO vNext_sessions(${sessionColumns}) VALUES(${sessionValues.replace("'session-online'", "'session-initialization'").replace("'online'", "'initialization'")})`).run();
  const reauthColumns = 'reauth_event_id,authority_id,session_id,factor_class,evidence_sha256,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,verified_at,expires_at,created_at';
  const reauthValues = `'reauth-1','authority-1','session-online','passkey','${HASH}',1,1,1,1,1,1,1,1,1,'2026-08-14T00:01:00.000Z','2026-08-14T00:16:00.000Z','2026-08-14T00:01:00.000Z'`;
  db.prepare(`INSERT INTO vNext_recent_reauthentication_events(${reauthColumns}) VALUES(${reauthValues})`).run();
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_recent_reauthentication_events(${reauthColumns}) VALUES(${reauthValues.replace("'reauth-1'", "'reauth-initialization'").replace("'session-online'", "'session-initialization'")})`).run(),
    /VNEXT_REAUTH_ONLINE_SESSION_REQUIRED/,
  );
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_recent_reauthentication_events(${reauthColumns}) VALUES(${reauthValues.replace("'reauth-1'", "'reauth-device-proof'").replace("'passkey'", "'device_proof'")})`).run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_recent_reauthentication_events(${reauthColumns}) VALUES(${reauthValues.replace("'reauth-1'", "'reauth-uppercase'").replace(`'${HASH}'`, `'${'A'.repeat(64)}'`)})`).run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_recent_reauthentication_events(${reauthColumns}) VALUES(${reauthValues.replace("'reauth-1'", "'reauth-short-hash'").replace(`'${HASH}'`, `'${'a'.repeat(63)}'`)})`).run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_recent_reauthentication_events(${reauthColumns}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('reauth-blob','authority-1','session-online','passkey',Buffer.alloc(64),1,1,1,1,1,1,1,1,1,'2026-08-14T00:01:00.000Z','2026-08-14T00:16:00.000Z','2026-08-14T00:01:00.000Z'),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_recent_reauthentication_events(${reauthColumns}) VALUES(${reauthValues.replace("'reauth-1'", "'reauth-fractional'").replace(',1,1,1,1,1,1,1,1,1,', ',1.5,1,1,1,1,1,1,1,1,')})`).run(),
    /(CHECK constraint failed|VNEXT_REAUTH_SESSION_STATE_INVALID)/,
  );
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_recent_reauthentication_events(${reauthColumns}) VALUES(${reauthValues.replace("'reauth-1'", "'reauth-before-session'").replace("'2026-08-14T00:01:00.000Z'", "'2026-08-13T23:59:00.000Z'")})`).run(),
    /VNEXT_REAUTH_SESSION_STATE_INVALID/,
  );
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_recent_reauthentication_events(${reauthColumns}) VALUES(${reauthValues.replace("'reauth-1'", "'reauth-after-session'").replace("'2026-08-14T00:16:00.000Z'", "'2026-08-14T09:00:00.000Z'")})`).run(),
    /VNEXT_REAUTH_SESSION_STATE_INVALID/,
  );
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_recent_reauthentication_events(${reauthColumns}) VALUES(${reauthValues.replace("'reauth-1'", "'reauth-reversed-window'").replace("'2026-08-14T00:16:00.000Z'", "'2026-08-14T00:00:30.000Z'")})`).run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_recent_reauthentication_events(${reauthColumns}) VALUES(${reauthValues.replace("'reauth-1'", "'reauth-version-mismatch'").replace(',1,1,1,1,1,1,1,1,1,', ',2,1,1,1,1,1,1,1,1,')})`).run(),
    /VNEXT_REAUTH_SESSION_STATE_INVALID/,
  );
  db.prepare("UPDATE vNext_accounts SET status='disabled',auth_version=2,row_version=2,updated_at='2026-08-14T00:02:00.000Z' WHERE account_id='account-1'").run();
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_recent_reauthentication_events(${reauthColumns}) VALUES(${reauthValues.replace("'reauth-1'", "'reauth-disabled-parent'")})`).run(),
    /VNEXT_REAUTH_CURRENT_PARENT_INVALID/,
  );
  db.prepare("UPDATE vNext_accounts SET status='active',auth_version=1,row_version=1,updated_at='2026-08-14T00:00:00.000Z' WHERE account_id='account-1'").run();
  db.prepare("UPDATE vNext_sessions SET status='revoked',revoked_at='2026-08-14T00:02:00.000Z',row_version=2,updated_at='2026-08-14T00:02:00.000Z' WHERE session_id='session-online'").run();
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_recent_reauthentication_events(${reauthColumns}) VALUES(${reauthValues.replace("'reauth-1'", "'reauth-revoked-session'")})`).run(),
    /VNEXT_REAUTH_SESSION_STATE_INVALID/,
  );
  assert.throws(
    () => db.prepare("UPDATE vNext_sessions SET session_kind='online' WHERE session_id='session-initialization'").run(),
    /vNext session identity is immutable/,
  );
  assert.throws(
    () => db.prepare("UPDATE vNext_sessions SET link_row_version=999 WHERE session_id='session-online'").run(),
    /vNext session identity is immutable/,
  );
  assert.throws(
    () => db.prepare("UPDATE vNext_sessions SET created_at='2026-08-14T00:01:00.000Z' WHERE session_id='session-online'").run(),
    /vNext session identity is immutable/,
  );
  assert.throws(
    () => db.prepare("UPDATE vNext_sessions SET status='active',revoked_at=NULL,row_version=3,updated_at='2026-08-14T00:03:00.000Z' WHERE session_id='session-online'").run(),
    /vNext session lifecycle is immutable/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM vNext_sessions WHERE session_id='session-initialization'").run(),
    /vNext session is append-only/,
  );
  const beforeAssert = { foreignKeys: db.pragma('foreign_keys', { simple: true }), sessions: db.prepare('SELECT COUNT(*) AS count FROM vNext_sessions').get().count, reauth: db.prepare('SELECT COUNT(*) AS count FROM vNext_recent_reauthentication_events').get().count };
  assertVNextControlPlaneReferenceSchema(db);
  assert.deepStrictEqual({ foreignKeys: db.pragma('foreign_keys', { simple: true }), sessions: db.prepare('SELECT COUNT(*) AS count FROM vNext_sessions').get().count, reauth: db.prepare('SELECT COUNT(*) AS count FROM vNext_recent_reauthentication_events').get().count }, beforeAssert, 'public assertion must be read-only');
  assert.throws(() => db.prepare("UPDATE vNext_recent_reauthentication_events SET factor_class='password' WHERE reauth_event_id='reauth-1'").run(), /vNext reauth event is append-only/);
  assert.throws(() => db.prepare("DELETE FROM vNext_recent_reauthentication_events WHERE reauth_event_id='reauth-1'").run(), /vNext reauth event is append-only/);
  assert.throws(
    () => db.prepare("INSERT INTO vNext_capability_overrides(override_id,authority_id,account_id,capability_id,effect,status,starts_at,row_version,created_at,updated_at) VALUES('override-unknown','authority-1','account-1','access.manage','deny','active','2026-08-14T00:00:00.000Z',1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run(),
    /FOREIGN KEY constraint failed/,
  );
  db.prepare("INSERT INTO vNext_capability_catalog(capability_id,status,surface_mask,created_at) VALUES('access.manage','active','desktop','2026-08-14T00:00:00.000Z')").run();
  db.prepare("INSERT INTO vNext_capability_overrides(override_id,authority_id,account_id,capability_id,effect,status,starts_at,row_version,created_at,updated_at) VALUES('override-1','authority-1','account-1','access.manage','deny','active','2026-08-14T00:00:00.000Z',1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run();
  assert.throws(
    () => db.prepare("INSERT INTO vNext_capability_overrides(override_id,authority_id,account_id,capability_id,effect,status,starts_at,row_version,created_at,updated_at) VALUES('override-conflict','authority-1','account-1','access.manage','allow','active','2026-08-14T00:00:00.000Z',1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run(),
    /UNIQUE constraint failed/,
  );
  db.prepare("INSERT INTO vNext_profile_bindings(binding_id,authority_id,account_id,profile_type,profile_id,status,evidence_hash,row_version,created_at,updated_at,revoked_at) VALUES('binding-old','authority-1','account-1','teacher','profile-1','revoked','evidence-1',1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run();
  db.prepare("INSERT INTO vNext_profile_bindings(binding_id,authority_id,account_id,profile_type,profile_id,status,evidence_hash,row_version,created_at,updated_at) VALUES('binding-new','authority-1','account-1','teacher','profile-1','active','evidence-2',1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run();
  db.prepare("INSERT INTO vNext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES('account-2','authority-1','active',1,1,1,1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run();
  assert.throws(
    () => db.prepare("INSERT INTO vNext_profile_bindings(binding_id,authority_id,account_id,profile_type,profile_id,status,evidence_hash,row_version,created_at,updated_at) VALUES('binding-clone','authority-1','account-2','teacher','profile-1','active','evidence-3',1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run(),
    /UNIQUE constraint failed/,
  );
  assert.throws(
    () => db.prepare("INSERT INTO vNext_verified_contacts(contact_id,authority_id,account_id,contact_type,normalized_value_hash,verification_state,verification_evidence_hash,row_version,created_at,updated_at) VALUES('contact-invalid','authority-1','account-1','phone','contact-hash','verified','evidence',1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare("INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,created_at) VALUES('receipt-bad-hash','authority-1','account:account-1','account-1','bad-key','role.grant','account','account-1','not-a-sha256',0,'accepted','ROLE_GRANTED','{}','not-a-sha256','2026-08-14T00:00:00.000Z')").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare("INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,outcome,result_code,canonical_result_json,canonical_result_sha256,created_at) VALUES('receipt-upper-hash','authority-1','system','upper-key','role.grant','account','account-1',?, 'accepted','ROLE_GRANTED','{}',?,'2026-08-14T00:00:00.000Z')").run('A'.repeat(64), 'A'.repeat(64)),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare("INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,outcome,result_code,canonical_result_json,canonical_result_sha256,created_at) VALUES('receipt-blob-hash','authority-1','system','blob-key','role.grant','account','account-1',?, 'accepted','ROLE_GRANTED','{}',?,'2026-08-14T00:00:00.000Z')").run(Buffer.alloc(64), Buffer.alloc(64)),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare("INSERT INTO vNext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES('account-fraction','authority-1','active',1.5,1,1,1,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run(),
    /CHECK constraint failed/,
  );
  db.prepare(`INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,created_at) VALUES('receipt-1','authority-1','account:account-1','account-1','key-1','role.grant','account','account-1','${HASH}',0,'accepted','ROLE_GRANTED','{}','${HASH}','2026-08-14T00:00:00.000Z')`).run();
  const policyResult = `{"authorityId":"authority-1","code":"POLICY_PUBLISHED","policyContractVersion":1,"policyManifestSha256":"${HASH}","policyRevision":1,"publicationId":"policy-publication-1","status":"accepted"}`;
  db.prepare(`INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_target_row_version,created_at) VALUES('policy-receipt-1','authority-1','system','policy-key-1','authorization_policy.publish','authorization_policy','authority-1','${HASH}',0,'accepted','POLICY_PUBLISHED',?,'${HASH}',1,'2026-08-14T00:00:00.000Z')`).run(policyResult);
  db.prepare(`INSERT INTO vNext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES('policy-publication-1','authority-1','policy-receipt-1',1,1,'{}','${HASH}','2026-08-14T00:00:00.000Z')`).run();
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM vNext_authorization_policy_publications').get().count, 1);
  const policyResult2 = `{"authorityId":"authority-1","code":"POLICY_PUBLISHED","policyContractVersion":1,"policyManifestSha256":"${'b'.repeat(64)}","policyRevision":2,"publicationId":"policy-publication-2","status":"accepted"}`;
  db.prepare(`INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_target_row_version,created_at) VALUES('policy-receipt-2','authority-1','system','policy-key-2','authorization_policy.publish','authorization_policy','authority-1','${HASH}',1,'accepted','POLICY_PUBLISHED',?,'${HASH}',2,'2026-08-14T00:01:00.000Z')`).run(policyResult2);
  db.prepare(`INSERT INTO vNext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES('policy-publication-2','authority-1','policy-receipt-2',2,1,'{"revision":2}','${'b'.repeat(64)}','2026-08-14T00:01:00.000Z')`).run();
  const policyResult3 = `{"authorityId":"authority-1","code":"POLICY_PUBLISHED","policyContractVersion":1,"policyManifestSha256":"${HASH}","policyRevision":3,"publicationId":"policy-publication-3","status":"accepted"}`;
  db.prepare(`INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_target_row_version,created_at) VALUES('policy-receipt-3','authority-1','system','policy-key-3','authorization_policy.publish','authorization_policy','authority-1','${HASH}',2,'accepted','POLICY_PUBLISHED',?,'${HASH}',3,'2026-08-14T00:02:00.000Z')`).run(policyResult3);
  db.prepare(`INSERT INTO vNext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES('policy-publication-3','authority-1','policy-receipt-3',3,1,'{}','${HASH}','2026-08-14T00:02:00.000Z')`).run();
  assert.strictEqual(db.prepare('SELECT MAX(policy_revision) AS revision FROM vNext_authorization_policy_publications WHERE authority_id=?').get('authority-1').revision, 3, 'current policy derives from highest revision');
  const policyResult4 = `{"authorityId":"authority-1","code":"POLICY_PUBLISHED","policyContractVersion":1,"policyManifestSha256":"${HASH}","policyRevision":4,"publicationId":"policy-publication-4","status":"accepted"}`;
  db.prepare(`INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_target_row_version,created_at) VALUES('policy-receipt-4','authority-1','system','policy-key-4','authorization_policy.publish','authorization_policy','authority-1','${HASH}',3,'accepted','POLICY_PUBLISHED',?,'${HASH}',4,'2026-08-14T00:03:00.000Z')`).run(policyResult4);
  assert.throws(() => db.prepare(`INSERT INTO vNext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES('policy-publication-4','authority-1','policy-receipt-4',4,1,'{}','${HASH}','2026-08-14T00:03:00.000Z')`).run(), /VNEXT_POLICY_UNCHANGED/);
  const booleanPolicyResult = `{"authorityId":"authority-1","code":"POLICY_PUBLISHED","policyContractVersion":true,"policyManifestSha256":"${'c'.repeat(64)}","policyRevision":true,"publicationId":"policy-publication-boolean","status":"accepted"}`;
  db.prepare(`INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_target_row_version,created_at) VALUES('policy-receipt-boolean','authority-1','system','policy-key-boolean','authorization_policy.publish','authorization_policy','authority-1','${HASH}',3,'accepted','POLICY_PUBLISHED',?,'${HASH}',4,'2026-08-14T00:03:00.000Z')`).run(booleanPolicyResult);
  assert.throws(() => db.prepare(`INSERT INTO vNext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES('policy-publication-boolean','authority-1','policy-receipt-boolean',4,1,'{}','${'c'.repeat(64)}','2026-08-14T00:03:00.000Z')`).run(), /VNEXT_POLICY_PUBLICATION_RECEIPT_INVALID/);
  const stringPolicyResult = `{"authorityId":"authority-1","code":"POLICY_PUBLISHED","policyContractVersion":"1","policyManifestSha256":"${'d'.repeat(64)}","policyRevision":"4","publicationId":"policy-publication-string","status":"accepted"}`;
  db.prepare(`INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_target_row_version,created_at) VALUES('policy-receipt-string','authority-1','system','policy-key-string','authorization_policy.publish','authorization_policy','authority-1','${HASH}',3,'accepted','POLICY_PUBLISHED',?,'${HASH}',4,'2026-08-14T00:03:00.000Z')`).run(stringPolicyResult);
  assert.throws(() => db.prepare(`INSERT INTO vNext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES('policy-publication-string','authority-1','policy-receipt-string',4,1,'{}','${'d'.repeat(64)}','2026-08-14T00:03:00.000Z')`).run(), /VNEXT_POLICY_PUBLICATION_RECEIPT_INVALID/);
  assert.throws(() => db.prepare(`INSERT INTO vNext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES('policy-publication-jump','authority-1','receipt-1',5,1,'{}','${HASH}','2026-08-14T00:03:00.000Z')`).run(), /VNEXT_POLICY_REVISION_CONFLICT/);
  assert.throws(() => db.prepare("UPDATE vNext_authorization_policy_publications SET policy_revision=2 WHERE publication_id='policy-publication-1'").run(), /vNext policy publication is append-only/);
  assert.throws(() => db.prepare("DELETE FROM vNext_authorization_policy_publications WHERE publication_id='policy-publication-1'").run(), /vNext policy publication is append-only/);
  db.prepare(`INSERT INTO vNext_authorization_audit_events(event_id,authority_id,receipt_id,reason_code,context_sha256,created_at) VALUES('audit-1','authority-1','receipt-1','operator_reason','${HASH}','2026-08-14T00:00:00.000Z')`).run();
  assert.throws(() => db.prepare("UPDATE vNext_authorization_audit_events SET reason_code='other_reason' WHERE event_id='audit-1'").run(), /vNext audit is append-only/);
  assert.throws(() => db.prepare("DELETE FROM vNext_authorization_audit_events WHERE event_id='audit-1'").run(), /vNext audit is append-only/);
  assert.throws(() => db.prepare("UPDATE vNext_authorization_command_receipts SET outcome='rejected' WHERE receipt_id='receipt-1'").run(), /vNext command receipt is append-only/);
  assert.throws(() => db.prepare("DELETE FROM vNext_authorization_command_receipts WHERE receipt_id='receipt-1'").run(), /vNext command receipt is append-only/);
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,outcome,result_code,canonical_result_json,canonical_result_sha256,created_at) VALUES('receipt-duplicate','authority-1','account:account-1','account-1','key-1','role.grant','account','account-1','${HASH}','accepted','ROLE_GRANTED','{}','${HASH}','2026-08-14T00:00:00.000Z')`).run(),
    /UNIQUE constraint failed/,
  );
  db.prepare(`INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,outcome,result_code,canonical_result_json,canonical_result_sha256,created_at) VALUES('receipt-system','authority-1','system','key-1','link.revoke','account_device_link','link-1','${HASH}','accepted','LINK_REVOKED','{}','${HASH}','2026-08-14T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO vNext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES('outbox-1','authority-1','receipt-1','authorization.changed','account','account-1',1,'{}','${HASH}','2026-08-14T00:00:00.000Z')`).run();
  assert.throws(() => db.prepare("UPDATE vNext_authorization_outbox_events SET canonical_payload_json='{\"forged\":true}' WHERE event_id='outbox-1'").run(), /vNext outbox event is append-only/);
  assert.throws(() => db.prepare("DELETE FROM vNext_authorization_outbox_events WHERE event_id='outbox-1'").run(), /vNext outbox event is append-only/);
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES('outbox-bad-json','authority-1','receipt-1','authorization.changed','account','account-1',1,'not-json','${HASH}','2026-08-14T00:00:00.000Z')`).run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES('outbox-bad-version','authority-1','receipt-1','authorization.invalid','account','account-1',1.5,'{}','${HASH}','2026-08-14T00:00:00.000Z')`).run(),
    /CHECK constraint failed/,
  );
  db.prepare("INSERT INTO vNext_authorities(authority_id,status,created_at,updated_at) VALUES('authority-2','active','2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z')").run();
  assert.throws(
    () => db.prepare(`INSERT INTO vNext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES('outbox-cross-authority','authority-2','receipt-1','authorization.changed','account','account-1',1,'{}','${HASH}','2026-08-14T00:00:00.000Z')`).run(),
    /FOREIGN KEY constraint failed/,
  );
  const allSql = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name LIKE 'vNext_%'").all().map(row => row.sql).join('\n');
  assert.ok(!/token|secret|password_hash|refresh|bearer|license|primary_host|host_receipt/i.test(allSql));
} finally {
  db.close();
}

const failing = new Database(':memory:');
try {
  assert.throws(
    () => bootstrapVNextControlPlaneReference(failing, { testHooks: { afterStatement({ index }) { if (index === 3) throw new Error('inject bootstrap failure'); } } }),
    /inject bootstrap failure/,
  );
  assert.deepStrictEqual(vNextTables(failing), [], 'failed bootstrap must leave no partial vNext tables');
} finally {
  failing.close();
}

const drift = new Database(':memory:');
try {
  drift.exec('CREATE TABLE vNext_accounts(account_id TEXT PRIMARY KEY)');
  assert.throws(() => bootstrapVNextControlPlaneReference(drift), /VNEXT_REFERENCE_SCHEMA_DRIFT/);
  assert.deepStrictEqual(vNextTables(drift), ['vNext_accounts']);
} finally {
  drift.close();
}

const semanticDrift = new Database(':memory:');
try {
  bootstrapVNextControlPlaneReference(semanticDrift);
  semanticDrift.pragma('foreign_keys = OFF');
  semanticDrift.exec('DROP TABLE vNext_accounts; CREATE TABLE vNext_accounts(account_id TEXT NOT NULL PRIMARY KEY CHECK(length(trim(account_id))>0), authority_id TEXT NOT NULL CHECK(length(trim(authority_id))>0), status TEXT NOT NULL CHECK(status IN (\'active\',\'disabled\',\'revoked\')), auth_version INTEGER NOT NULL CHECK(auth_version>=1), access_version INTEGER NOT NULL CHECK(access_version>=1), revocation_version INTEGER NOT NULL CHECK(revocation_version>=1), row_version INTEGER NOT NULL CHECK(row_version>=1), created_at TEXT NOT NULL CHECK(julianday(created_at) IS NOT NULL), updated_at TEXT NOT NULL CHECK(julianday(updated_at) IS NOT NULL), CHECK(updated_at>=created_at), UNIQUE(account_id,authority_id))');
  assert.throws(() => bootstrapVNextControlPlaneReference(semanticDrift), /VNEXT_REFERENCE_SCHEMA_DRIFT/);
} finally {
  semanticDrift.close();
}

const v1Reference = new Database(':memory:');
try {
  v1Reference.exec("CREATE TABLE vNext_schema_meta(schema_key TEXT NOT NULL PRIMARY KEY CHECK(length(trim(schema_key))>0) CHECK(schema_key='control-plane-reference'), schema_version INTEGER NOT NULL CHECK(schema_version=1), applied_at TEXT NOT NULL CHECK(julianday(applied_at) IS NOT NULL)); INSERT INTO vNext_schema_meta VALUES('control-plane-reference',1,'2026-08-14T00:00:00.000Z')");
  assert.throws(() => bootstrapVNextControlPlaneReference(v1Reference), /VNEXT_REFERENCE_SCHEMA_DRIFT/);
  assert.deepStrictEqual(vNextTables(v1Reference), ['vNext_schema_meta'], 'v1 must be explicitly rejected rather than silently upgraded');
} finally {
  v1Reference.close();
}

const v2Reference = new Database(':memory:');
try {
  v2Reference.exec("CREATE TABLE vNext_schema_meta(schema_key TEXT NOT NULL PRIMARY KEY CHECK(length(trim(schema_key))>0) CHECK(schema_key='control-plane-reference'), schema_version INTEGER NOT NULL CHECK(schema_version=2), applied_at TEXT NOT NULL CHECK(julianday(applied_at) IS NOT NULL)); INSERT INTO vNext_schema_meta VALUES('control-plane-reference',2,'2026-08-14T00:00:00.000Z')");
  assert.throws(() => bootstrapVNextControlPlaneReference(v2Reference), /VNEXT_REFERENCE_SCHEMA_DRIFT/);
  assert.deepStrictEqual(vNextTables(v2Reference), ['vNext_schema_meta'], 'v2 must be explicitly rejected rather than silently upgraded');
} finally {
  v2Reference.close();
}

const v3Reference = new Database(':memory:');
try {
  v3Reference.exec("CREATE TABLE vNext_schema_meta(schema_key TEXT NOT NULL PRIMARY KEY CHECK(length(trim(schema_key))>0) CHECK(schema_key='control-plane-reference'), schema_version INTEGER NOT NULL CHECK(schema_version=3), applied_at TEXT NOT NULL CHECK(julianday(applied_at) IS NOT NULL)); INSERT INTO vNext_schema_meta VALUES('control-plane-reference',3,'2026-08-14T00:00:00.000Z')");
  assert.throws(() => bootstrapVNextControlPlaneReference(v3Reference), /VNEXT_REFERENCE_SCHEMA_DRIFT/);
  assert.deepStrictEqual(vNextTables(v3Reference), ['vNext_schema_meta'], 'v3 must be explicitly rejected rather than silently upgraded');
} finally {
  v3Reference.close();
}

const sessionSemanticDrift = new Database(':memory:');
try {
  bootstrapVNextControlPlaneReference(sessionSemanticDrift);
  sessionSemanticDrift.pragma('foreign_keys = OFF');
  const sessionSql = sessionSemanticDrift.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='vNext_sessions'").get().sql;
  sessionSemanticDrift.exec('DROP TABLE vNext_sessions; ' + sessionSql.replace(", FOREIGN KEY(link_id,authority_id,account_id,device_id,installation_id) REFERENCES vNext_account_device_links(link_id,authority_id,account_id,device_id,installation_id)", ''));
  assert.throws(() => bootstrapVNextControlPlaneReference(sessionSemanticDrift), /VNEXT_REFERENCE_SCHEMA_DRIFT/);
} finally {
  sessionSemanticDrift.close();
}

const indexDrift = new Database(':memory:');
try {
  bootstrapVNextControlPlaneReference(indexDrift);
  indexDrift.exec("DROP INDEX vNext_role_grants_one_active_role; CREATE UNIQUE INDEX vNext_role_grants_one_active_role ON vNext_role_grants(authority_id,account_id) WHERE status='active'");
  assert.throws(() => bootstrapVNextControlPlaneReference(indexDrift), /VNEXT_REFERENCE_SCHEMA_DRIFT/);
} finally {
  indexDrift.close();
}

const foreignNamedObjectDrift = new Database(':memory:');
try {
  bootstrapVNextControlPlaneReference(foreignNamedObjectDrift);
  foreignNamedObjectDrift.exec("CREATE INDEX foreign_named_index ON vNext_accounts(status); CREATE TRIGGER foreign_named_trigger BEFORE INSERT ON vNext_authorization_outbox_events BEGIN SELECT 1; END");
  assert.throws(() => bootstrapVNextControlPlaneReference(foreignNamedObjectDrift), /VNEXT_REFERENCE_SCHEMA_DRIFT/);
} finally {
  foreignNamedObjectDrift.close();
}

const triggerDrift = new Database(':memory:');
try {
  bootstrapVNextControlPlaneReference(triggerDrift);
  triggerDrift.exec('DROP TRIGGER vNext_authorization_audit_events_no_update; CREATE TRIGGER vNext_authorization_audit_events_no_update BEFORE UPDATE ON vNext_authorization_audit_events BEGIN SELECT 1; END');
  assert.throws(() => bootstrapVNextControlPlaneReference(triggerDrift), /VNEXT_REFERENCE_SCHEMA_DRIFT/);
} finally {
  triggerDrift.close();
}

const nowFailure = new Database(':memory:');
try {
  assert.throws(() => bootstrapVNextControlPlaneReference(nowFailure, { now() { throw new Error('clock unavailable'); } }), /clock unavailable/);
  assert.deepStrictEqual(vNextTables(nowFailure), [], 'clock failure must roll back every reference object');
} finally {
  nowFailure.close();
}

const outerTransaction = new Database(':memory:');
try {
  outerTransaction.pragma('foreign_keys = OFF');
  outerTransaction.exec('BEGIN');
  assert.throws(() => bootstrapVNextControlPlaneReference(outerTransaction), /VNEXT_REFERENCE_FOREIGN_KEYS_REQUIRED/);
  outerTransaction.exec('ROLLBACK');
  assert.deepStrictEqual(vNextTables(outerTransaction), []);
} finally {
  outerTransaction.close();
}

const readonlyAssertion = new Database(':memory:');
try {
  bootstrapVNextControlPlaneReference(readonlyAssertion);
  readonlyAssertion.pragma('foreign_keys = OFF');
  const before = readonlyAssertion.pragma('foreign_keys', { simple: true });
  assert.throws(() => assertVNextControlPlaneReferenceSchema(readonlyAssertion), /VNEXT_REFERENCE_FOREIGN_KEYS_REQUIRED/);
  assert.strictEqual(readonlyAssertion.pragma('foreign_keys', { simple: true }), before, 'public assertion must not enable foreign keys');
  assert.strictEqual(readonlyAssertion.prepare('SELECT COUNT(*) AS count FROM vNext_sessions').get().count, 0);
  assert.strictEqual(readonlyAssertion.prepare('SELECT COUNT(*) AS count FROM vNext_recent_reauthentication_events').get().count, 0);
} finally {
  readonlyAssertion.close();
}

console.log('vNext control-plane reference kernel checks passed');
