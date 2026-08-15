'use strict';

const assert = require('assert');
const {
  FIRST_MIGRATION,
  FOUNDATION_IDENTITY_DEVICE_MIGRATION,
  ROLE_GRANTS_MIGRATION,
  CAPABILITY_CATALOG_MIGRATION,
  CAPABILITY_OVERRIDES_MIGRATION,
  DATA_SCOPE_GRANTS_MIGRATION,
  PROFILE_BINDINGS_MIGRATION,
  VERIFIED_CONTACTS_MIGRATION,
  AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION,
  AUTHORIZATION_AUDIT_EVENTS_MIGRATION,
  AUTHORIZATION_OUTBOX_EVENTS_MIGRATION,
  BOOTSTRAP_CONSUMPTIONS_MIGRATION,
  AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION,
  TRUST_ROOT_EVIDENCE_MIGRATION,
  MIGRATIONS,
  expectedCatalog,
  sha256,
} = require('./migrationManifest');

async function runManifestCases() {
  assert.strictEqual(FIRST_MIGRATION.semanticVersion, 1);
  assert.ok(Object.isFrozen(MIGRATIONS));
  assert.ok(Object.isFrozen(FOUNDATION_IDENTITY_DEVICE_MIGRATION));
  assert.match(FIRST_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.ok(expectedCatalog.relations.includes('vnext_control_plane.vnext_schema_migrations'));
  assert.deepStrictEqual(expectedCatalog.triggers, [
    'vnext_schema_migrations_insert_guard',
    'vnext_schema_migrations_no_delete',
    'vnext_schema_migrations_no_update',
    'vnext_authorization_command_receipts_no_delete',
    'vnext_authorization_command_receipts_no_update',
    'vnext_authorization_audit_events_no_delete',
    'vnext_authorization_audit_events_no_update',
    'vnext_authorization_outbox_events_no_delete',
    'vnext_authorization_outbox_events_no_update',
    'vnext_bootstrap_consumptions_insert_guard',
    'vnext_bootstrap_consumptions_no_delete',
    'vnext_bootstrap_consumptions_no_update',
    'vnext_authorization_policy_publications_insert_guard',
    'vnext_authorization_policy_publications_no_delete',
    'vnext_authorization_policy_publications_no_update',
    'vnext_trust_root_evidence_insert_guard',
    'vnext_trust_root_evidence_no_delete',
    'vnext_trust_root_evidence_no_update',
  ]);
  assert.strictEqual(sha256(FIRST_MIGRATION.sql), FIRST_MIGRATION.manifestSha256);
  assert.deepStrictEqual(MIGRATIONS.map(migration => migration.semanticVersion), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.strictEqual(FOUNDATION_IDENTITY_DEVICE_MIGRATION.migrationId, 'vnext-pg17-foundation-identity-device-2');
  assert.match(FOUNDATION_IDENTITY_DEVICE_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(
    sha256(FOUNDATION_IDENTITY_DEVICE_MIGRATION.sql),
    FOUNDATION_IDENTITY_DEVICE_MIGRATION.manifestSha256,
  );
  assert.ok(Object.isFrozen(ROLE_GRANTS_MIGRATION));
  assert.strictEqual(ROLE_GRANTS_MIGRATION.migrationId, 'vnext-pg17-role-grants-3');
  assert.strictEqual(ROLE_GRANTS_MIGRATION.semanticVersion, 3);
  assert.match(ROLE_GRANTS_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(sha256(ROLE_GRANTS_MIGRATION.sql), ROLE_GRANTS_MIGRATION.manifestSha256);
  assert.match(ROLE_GRANTS_MIGRATION.sql, /CREATE UNIQUE INDEX vnext_role_grants_one_active_role/);
  assert.match(ROLE_GRANTS_MIGRATION.sql, /granted_by_account_id IS NULL OR btrim\(granted_by_account_id\) <> ''/);
  assert.ok(Object.isFrozen(CAPABILITY_CATALOG_MIGRATION));
  assert.strictEqual(CAPABILITY_CATALOG_MIGRATION.migrationId, 'vnext-pg17-capability-catalog-4');
  assert.strictEqual(CAPABILITY_CATALOG_MIGRATION.semanticVersion, 4);
  assert.match(CAPABILITY_CATALOG_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(sha256(CAPABILITY_CATALOG_MIGRATION.sql), CAPABILITY_CATALOG_MIGRATION.manifestSha256);
  assert.match(CAPABILITY_CATALOG_MIGRATION.sql, /CREATE TABLE vnext_control_plane\.vnext_capability_catalog/);
  assert.match(CAPABILITY_CATALOG_MIGRATION.sql, /btrim\(surface_mask\) <> ''/);
  assert.ok(Object.isFrozen(CAPABILITY_OVERRIDES_MIGRATION));
  assert.strictEqual(CAPABILITY_OVERRIDES_MIGRATION.migrationId, 'vnext-pg17-capability-overrides-5');
  assert.strictEqual(CAPABILITY_OVERRIDES_MIGRATION.semanticVersion, 5);
  assert.match(CAPABILITY_OVERRIDES_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(sha256(CAPABILITY_OVERRIDES_MIGRATION.sql), CAPABILITY_OVERRIDES_MIGRATION.manifestSha256);
  assert.match(CAPABILITY_OVERRIDES_MIGRATION.sql, /CREATE UNIQUE INDEX vnext_capability_overrides_one_active_capability/);
  assert.match(CAPABILITY_OVERRIDES_MIGRATION.sql, /FOREIGN KEY \(account_id, authority_id\)/);
  assert.match(CAPABILITY_OVERRIDES_MIGRATION.sql, /FOREIGN KEY \(capability_id\)/);
  assert.ok(Object.isFrozen(DATA_SCOPE_GRANTS_MIGRATION));
  assert.strictEqual(DATA_SCOPE_GRANTS_MIGRATION.migrationId, 'vnext-pg17-data-scope-grants-6');
  assert.strictEqual(DATA_SCOPE_GRANTS_MIGRATION.semanticVersion, 6);
  assert.match(DATA_SCOPE_GRANTS_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(sha256(DATA_SCOPE_GRANTS_MIGRATION.sql), DATA_SCOPE_GRANTS_MIGRATION.manifestSha256);
  assert.match(DATA_SCOPE_GRANTS_MIGRATION.sql, /CREATE TABLE vnext_control_plane\.vnext_data_scope_grants/);
  assert.match(DATA_SCOPE_GRANTS_MIGRATION.sql, /CREATE UNIQUE INDEX vnext_data_scope_grants_one_active_scope/);
  assert.match(DATA_SCOPE_GRANTS_MIGRATION.sql, /FOREIGN KEY \(account_id, authority_id\)/);
  assert.ok(Object.isFrozen(PROFILE_BINDINGS_MIGRATION));
  assert.strictEqual(PROFILE_BINDINGS_MIGRATION.migrationId, 'vnext-pg17-profile-bindings-7');
  assert.strictEqual(PROFILE_BINDINGS_MIGRATION.semanticVersion, 7);
  assert.match(PROFILE_BINDINGS_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(sha256(PROFILE_BINDINGS_MIGRATION.sql), PROFILE_BINDINGS_MIGRATION.manifestSha256);
  assert.match(PROFILE_BINDINGS_MIGRATION.sql, /CREATE TABLE vnext_control_plane\.vnext_profile_bindings/);
  assert.match(PROFILE_BINDINGS_MIGRATION.sql, /CREATE UNIQUE INDEX vnext_profile_bindings_one_active_account_type/);
  assert.match(PROFILE_BINDINGS_MIGRATION.sql, /CREATE UNIQUE INDEX vnext_profile_bindings_one_active_profile/);
  assert.ok(Object.isFrozen(VERIFIED_CONTACTS_MIGRATION));
  assert.strictEqual(VERIFIED_CONTACTS_MIGRATION.migrationId, 'vnext-pg17-verified-contacts-8');
  assert.strictEqual(VERIFIED_CONTACTS_MIGRATION.semanticVersion, 8);
  assert.match(VERIFIED_CONTACTS_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(sha256(VERIFIED_CONTACTS_MIGRATION.sql), VERIFIED_CONTACTS_MIGRATION.manifestSha256);
  assert.match(VERIFIED_CONTACTS_MIGRATION.sql, /CREATE TABLE vnext_control_plane\.vnext_verified_contacts/);
  assert.match(VERIFIED_CONTACTS_MIGRATION.sql, /UNIQUE \(authority_id, contact_type, normalized_value_hash\)/);
  assert.match(VERIFIED_CONTACTS_MIGRATION.sql, /FOREIGN KEY \(account_id, authority_id\)/);
  assert.ok(Object.isFrozen(AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION));
  assert.strictEqual(AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION.migrationId, 'vnext-pg17-authorization-command-receipts-9');
  assert.strictEqual(AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION.semanticVersion, 9);
  assert.match(AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(sha256(AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION.sql), AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION.manifestSha256);
  assert.match(AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION.sql, /CREATE TABLE vnext_control_plane\.vnext_authorization_command_receipts/);
  assert.match(AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION.sql, /IS JSON WITH UNIQUE KEYS/);
  assert.match(AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION.sql, /CREATE TRIGGER vnext_authorization_command_receipts_no_update/);
  assert.match(AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION.sql, /CREATE TRIGGER vnext_authorization_command_receipts_no_delete/);
  assert.ok(Object.isFrozen(AUTHORIZATION_AUDIT_EVENTS_MIGRATION));
  assert.strictEqual(AUTHORIZATION_AUDIT_EVENTS_MIGRATION.migrationId, 'vnext-pg17-authorization-audit-events-10');
  assert.strictEqual(AUTHORIZATION_AUDIT_EVENTS_MIGRATION.semanticVersion, 10);
  assert.match(AUTHORIZATION_AUDIT_EVENTS_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(sha256(AUTHORIZATION_AUDIT_EVENTS_MIGRATION.sql), AUTHORIZATION_AUDIT_EVENTS_MIGRATION.manifestSha256);
  assert.match(AUTHORIZATION_AUDIT_EVENTS_MIGRATION.sql, /CREATE TABLE vnext_control_plane\.vnext_authorization_audit_events/);
  assert.match(AUTHORIZATION_AUDIT_EVENTS_MIGRATION.sql, /FOREIGN KEY\(receipt_id, authority_id\)/);
  assert.match(AUTHORIZATION_AUDIT_EVENTS_MIGRATION.sql, /CREATE TRIGGER vnext_authorization_audit_events_no_update/);
  assert.match(AUTHORIZATION_AUDIT_EVENTS_MIGRATION.sql, /CREATE TRIGGER vnext_authorization_audit_events_no_delete/);
  assert.ok(Object.isFrozen(AUTHORIZATION_OUTBOX_EVENTS_MIGRATION));
  assert.strictEqual(AUTHORIZATION_OUTBOX_EVENTS_MIGRATION.migrationId, 'vnext-pg17-authorization-outbox-events-11');
  assert.strictEqual(AUTHORIZATION_OUTBOX_EVENTS_MIGRATION.semanticVersion, 11);
  assert.match(AUTHORIZATION_OUTBOX_EVENTS_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(sha256(AUTHORIZATION_OUTBOX_EVENTS_MIGRATION.sql), AUTHORIZATION_OUTBOX_EVENTS_MIGRATION.manifestSha256);
  assert.match(AUTHORIZATION_OUTBOX_EVENTS_MIGRATION.sql, /CREATE TABLE vnext_control_plane\.vnext_authorization_outbox_events/);
  assert.match(AUTHORIZATION_OUTBOX_EVENTS_MIGRATION.sql, /IS JSON WITH UNIQUE KEYS/);
  assert.match(AUTHORIZATION_OUTBOX_EVENTS_MIGRATION.sql, /FOREIGN KEY\(receipt_id, authority_id\)/);
  assert.match(AUTHORIZATION_OUTBOX_EVENTS_MIGRATION.sql, /CREATE TRIGGER vnext_authorization_outbox_events_no_update/);
  assert.match(AUTHORIZATION_OUTBOX_EVENTS_MIGRATION.sql, /CREATE TRIGGER vnext_authorization_outbox_events_no_delete/);
  assert.ok(Object.isFrozen(BOOTSTRAP_CONSUMPTIONS_MIGRATION));
  assert.strictEqual(BOOTSTRAP_CONSUMPTIONS_MIGRATION.migrationId, 'vnext-pg17-bootstrap-consumptions-12');
  assert.strictEqual(BOOTSTRAP_CONSUMPTIONS_MIGRATION.semanticVersion, 12);
  assert.match(BOOTSTRAP_CONSUMPTIONS_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(sha256(BOOTSTRAP_CONSUMPTIONS_MIGRATION.sql), BOOTSTRAP_CONSUMPTIONS_MIGRATION.manifestSha256);
  assert.match(BOOTSTRAP_CONSUMPTIONS_MIGRATION.sql, /CREATE TABLE vnext_control_plane\.vnext_bootstrap_consumptions/);
  for (const column of ['marker_key', 'bootstrap_intent_id', 'authority_id', 'installation_key_fingerprint', 'policy_manifest_sha256', 'receipt_id', 'consumed_at']) {
    assert.match(BOOTSTRAP_CONSUMPTIONS_MIGRATION.sql, new RegExp(`\\b${column}\\b`));
  }
  assert.match(BOOTSTRAP_CONSUMPTIONS_MIGRATION.sql, /marker_key = 'single-authority-bootstrap'/);
  assert.doesNotMatch(BOOTSTRAP_CONSUMPTIONS_MIGRATION.sql, /FOREIGN KEY/);
  assert.match(BOOTSTRAP_CONSUMPTIONS_MIGRATION.sql, /json_object_keys/);
  assert.match(BOOTSTRAP_CONSUMPTIONS_MIGRATION.sql, /policyContractVersion/);
  assert.match(BOOTSTRAP_CONSUMPTIONS_MIGRATION.sql, /policyRevision/);
  assert.match(BOOTSTRAP_CONSUMPTIONS_MIGRATION.sql, /CREATE TRIGGER vnext_bootstrap_consumptions_insert_guard/);
  assert.match(BOOTSTRAP_CONSUMPTIONS_MIGRATION.sql, /CREATE TRIGGER vnext_bootstrap_consumptions_no_update/);
  assert.match(BOOTSTRAP_CONSUMPTIONS_MIGRATION.sql, /CREATE TRIGGER vnext_bootstrap_consumptions_no_delete/);
  assert.ok(Object.isFrozen(AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION));
  assert.strictEqual(AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION.migrationId, 'vnext-pg17-authorization-policy-publications-13');
  assert.strictEqual(AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION.semanticVersion, 13);
  assert.match(AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(sha256(AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION.sql), AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION.manifestSha256);
  assert.match(AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION.sql, /CREATE TABLE vnext_control_plane\.vnext_authorization_policy_publications/);
  for (const column of ['publication_id', 'authority_id', 'receipt_id', 'policy_revision', 'policy_contract_version', 'canonical_manifest_json', 'policy_manifest_sha256', 'published_at']) {
    assert.match(AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION.sql, new RegExp(`\\b${column}\\b`));
  }
  assert.match(AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION.sql, /IS JSON OBJECT WITH UNIQUE KEYS/);
  assert.match(AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION.sql, /vnext_bootstrap_consumptions/);
  assert.match(AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION.sql, /CREATE TRIGGER vnext_authorization_policy_publications_insert_guard/);
  assert.match(AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION.sql, /CREATE TRIGGER vnext_authorization_policy_publications_no_update/);
  assert.match(AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION.sql, /CREATE TRIGGER vnext_authorization_policy_publications_no_delete/);
  assert.ok(Object.isFrozen(TRUST_ROOT_EVIDENCE_MIGRATION));
  assert.strictEqual(TRUST_ROOT_EVIDENCE_MIGRATION.migrationId, 'vnext-pg17-trust-root-evidence-14');
  assert.strictEqual(TRUST_ROOT_EVIDENCE_MIGRATION.semanticVersion, 14);
  assert.match(TRUST_ROOT_EVIDENCE_MIGRATION.manifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(sha256(TRUST_ROOT_EVIDENCE_MIGRATION.sql), TRUST_ROOT_EVIDENCE_MIGRATION.manifestSha256);
  assert.match(TRUST_ROOT_EVIDENCE_MIGRATION.sql, /CREATE TABLE vnext_control_plane\.vnext_trust_root_evidence/);
  for (const column of ['evidence_id', 'authority_id', 'receipt_id', 'actor_kind', 'event_id', 'assertion_evidence_sha256', 'backup_id', 'backup_manifest_sha256', 'created_at']) {
    assert.match(TRUST_ROOT_EVIDENCE_MIGRATION.sql, new RegExp(`\\b${column}\\b`));
  }
  assert.match(TRUST_ROOT_EVIDENCE_MIGRATION.sql, /deployment_bootstrap/);
  assert.match(TRUST_ROOT_EVIDENCE_MIGRATION.sql, /owner_recovery_event/);
  assert.match(TRUST_ROOT_EVIDENCE_MIGRATION.sql, /vnext_bootstrap_consumptions/);
  assert.match(TRUST_ROOT_EVIDENCE_MIGRATION.sql, /authority\.owner_recover/);
  assert.match(TRUST_ROOT_EVIDENCE_MIGRATION.sql, /CREATE TRIGGER vnext_trust_root_evidence_insert_guard/);
  assert.match(TRUST_ROOT_EVIDENCE_MIGRATION.sql, /CREATE TRIGGER vnext_trust_root_evidence_no_update/);
  assert.match(TRUST_ROOT_EVIDENCE_MIGRATION.sql, /CREATE TRIGGER vnext_trust_root_evidence_no_delete/);
  assert.deepStrictEqual(expectedCatalog.relations, [
    'vnext_control_plane.vnext_account_device_links',
    'vnext_control_plane.vnext_accounts',
    'vnext_control_plane.vnext_authorities',
    'vnext_control_plane.vnext_authorization_audit_events',
    'vnext_control_plane.vnext_authorization_command_receipts',
    'vnext_control_plane.vnext_authorization_outbox_events',
    'vnext_control_plane.vnext_authorization_policy_publications',
    'vnext_control_plane.vnext_bootstrap_consumptions',
    'vnext_control_plane.vnext_capability_catalog',
    'vnext_control_plane.vnext_capability_overrides',
    'vnext_control_plane.vnext_data_scope_grants',
    'vnext_control_plane.vnext_device_installations',
    'vnext_control_plane.vnext_profile_bindings',
    'vnext_control_plane.vnext_role_grants',
    'vnext_control_plane.vnext_schema_meta',
    'vnext_control_plane.vnext_schema_migrations',
    'vnext_control_plane.vnext_trust_root_evidence',
    'vnext_control_plane.vnext_trusted_devices',
    'vnext_control_plane.vnext_verified_contacts',
  ]);
}

if (require.main === module) {
  runManifestCases().then(() => {
    console.log('vNext PG17 migration manifest checks passed');
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { runManifestCases };
