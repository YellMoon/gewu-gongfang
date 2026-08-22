'use strict';

const { types } = require('util');
const {
  isVNextPg17DisposableHandleForRuntime,
  withVNextPg17SyntheticQuery,
} = require('./disposableRuntime');
const { MIGRATIONS, expectedCatalog, sha256 } = require('./migrationManifest');

const LEDGER_COLUMNS = Object.freeze([
  Object.freeze({ name: 'migration_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
  Object.freeze({ name: 'semantic_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
  Object.freeze({ name: 'manifest_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
  Object.freeze({ name: 'applied_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  Object.freeze({ name: 'applied_by', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
]);
const LEDGER_TRIGGERS = Object.freeze([
  'vnext_schema_migrations_insert_guard',
  'vnext_schema_migrations_no_delete',
  'vnext_schema_migrations_no_update',
]);
const LEDGER_FUNCTIONS = Object.freeze([
  'vnext_authorization_audit_events_no_delete',
  'vnext_authorization_audit_events_no_update',
  'vnext_authorization_command_receipts_no_delete',
  'vnext_authorization_command_receipts_no_update',
  'vnext_authorization_outbox_events_no_delete',
  'vnext_authorization_outbox_events_no_update',
  'vnext_authorization_policy_publications_insert_guard',
  'vnext_authorization_policy_publications_no_delete',
  'vnext_authorization_policy_publications_no_update',
  'vnext_bind_canonical_wechat_identity',
  'vnext_bootstrap_consumptions_insert_guard',
  'vnext_bootstrap_consumptions_no_delete',
  'vnext_bootstrap_consumptions_no_update',
  'vnext_issue_online_identity_assertion',
  'vnext_online_identity_assertion_consumptions_no_delete',
  'vnext_online_identity_assertion_consumptions_no_update',
  'vnext_online_identity_assertions_no_delete',
  'vnext_online_identity_assertions_no_update',
  'vnext_provision_canonical_phone_account',
  'vnext_read_canonical_account_by_verified_contact',
  'vnext_read_desktop_password_by_login_name',
  'vnext_read_desktop_password_by_phone_hash',
  'vnext_recent_reauthentication_events_no_delete',
  'vnext_recent_reauthentication_events_no_update',
  'vnext_recent_reauthentication_events_session_state_match',
  'vnext_register_unified_desktop_online',
  'vnext_schema_migrations_insert_guard',
  'vnext_schema_migrations_no_delete',
  'vnext_schema_migrations_no_update',
  'vnext_sessions_identity_immutable',
  'vnext_sessions_lifecycle_monotonic',
  'vnext_sessions_no_delete',
  'vnext_sessions_parent_state_match',
  'vnext_set_desktop_password_credential',
  'vnext_trust_root_evidence_insert_guard',
  'vnext_trust_root_evidence_no_delete',
  'vnext_trust_root_evidence_no_update',
]);
const COMMAND_FUNCTION_ARGUMENTS = Object.freeze({
  vnext_issue_online_identity_assertion: 'p_assertion_id text, p_authority_id text, p_account_id text, p_device_id text, p_installation_id text, p_installation_public_key text, p_key_fingerprint text, p_audience text, p_nonce_sha256 text, p_canonical_request_sha256 text, p_identity_proof_sha256 text, p_hardware_evidence_sha256 text, p_issued_at timestamp with time zone, p_expires_at timestamp with time zone',
  vnext_provision_canonical_phone_account: 'p_account_id text, p_contact_id text, p_phone_hash text, p_verification_evidence_hash text',
  vnext_bind_canonical_wechat_identity: 'p_authority_id text, p_account_id text, p_openid_contact_id text, p_openid_hash text, p_unionid_contact_id text, p_unionid_hash text, p_verification_evidence_hash text',
  vnext_read_canonical_account_by_verified_contact: 'p_contact_type text, p_contact_hash text',
  vnext_read_desktop_password_by_login_name: 'p_login_name text',
  vnext_read_desktop_password_by_phone_hash: 'p_phone_hash text',
  vnext_register_unified_desktop_online: 'p_assertion_id text, p_idempotency_key text, p_receipt_id text, p_audit_event_id text, p_outbox_event_id text, p_session_id text, p_link_id text, p_session_expires_at timestamp with time zone, p_canonical_result_json text, p_result_sha256 text, p_canonical_payload_json text, p_payload_sha256 text',
  vnext_set_desktop_password_credential: 'p_authority_id text, p_account_id text, p_login_name text, p_password_algorithm text, p_password_salt_base64 text, p_password_hash_base64 text',
});
const LEDGER_CONSTRAINTS = Object.freeze([
  Object.freeze({ name: 'vnext_schema_migrations_applied_at_check', type: 'c', definition: "CHECK (applied_at <> 'infinity'::timestamp with time zone AND applied_at <> '-infinity'::timestamp with time zone)" }),
  Object.freeze({ name: 'vnext_schema_migrations_applied_by_check', type: 'c', definition: "CHECK (btrim(applied_by) <> ''::text)" }),
  Object.freeze({ name: 'vnext_schema_migrations_manifest_sha256_check', type: 'c', definition: "CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'::text)" }),
  Object.freeze({ name: 'vnext_schema_migrations_migration_id_check', type: 'c', definition: "CHECK (btrim(migration_id) <> ''::text)" }),
  Object.freeze({ name: 'vnext_schema_migrations_pkey', type: 'p', definition: 'PRIMARY KEY (migration_id)' }),
  Object.freeze({ name: 'vnext_schema_migrations_semantic_version_check', type: 'c', definition: 'CHECK (semantic_version > 0)' }),
  Object.freeze({ name: 'vnext_schema_migrations_semantic_version_key', type: 'u', definition: 'UNIQUE (semantic_version)' }),
]);
const SYNTHETIC_ROLES = Object.freeze([
  Object.freeze({ name: 'vnext_pg17_identity_verifier', canLogin: true, inherit: false, superuser: false, createRole: false, createDb: false, replication: false, bypassRls: false }),
  Object.freeze({ name: 'vnext_pg17_migrator', canLogin: true, inherit: false, superuser: false, createRole: false, createDb: false, replication: false, bypassRls: false }),
  Object.freeze({ name: 'vnext_pg17_owner', canLogin: false, inherit: false, superuser: false, createRole: false, createDb: false, replication: false, bypassRls: false }),
  Object.freeze({ name: 'vnext_pg17_runtime', canLogin: true, inherit: false, superuser: false, createRole: false, createDb: false, replication: false, bypassRls: false }),
  Object.freeze({ name: 'vnext_pg17_verifier', canLogin: true, inherit: false, superuser: false, createRole: false, createDb: false, replication: false, bypassRls: false }),
  Object.freeze({ name: 'vnext_pg17_writer', canLogin: true, inherit: false, superuser: false, createRole: false, createDb: false, replication: false, bypassRls: false }),
]);
const SYNTHETIC_MEMBERSHIPS = Object.freeze([
  Object.freeze({ member: 'vnext_pg17_migrator', role: 'vnext_pg17_owner', admin: false, inherit: false, set: true }),
]);
const LEDGER_INDEXES = Object.freeze([
  Object.freeze({ name: 'vnext_schema_migrations_pkey', primary: true, unique: true }),
  Object.freeze({ name: 'vnext_schema_migrations_semantic_version_key', primary: false, unique: true }),
]);
const FOUNDATION_COLUMNS = Object.freeze({
  vnext_schema_meta: Object.freeze([
    Object.freeze({ name: 'schema_key', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'schema_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'applied_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_authorities: Object.freeze([
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_accounts: Object.freeze([
    Object.freeze({ name: 'account_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'auth_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'access_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'revocation_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'row_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_authorization_audit_events: Object.freeze([
    Object.freeze({ name: 'event_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'receipt_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'reason_code', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'context_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_authorization_outbox_events: Object.freeze([
    Object.freeze({ name: 'event_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'receipt_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'event_type', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'aggregate_kind', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'aggregate_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'aggregate_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'canonical_payload_json', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'payload_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'occurred_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_authorization_policy_publications: Object.freeze([
    Object.freeze({ name: 'publication_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'receipt_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'policy_revision', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'policy_contract_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'canonical_manifest_json', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'policy_manifest_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'published_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_bootstrap_consumptions: Object.freeze([
    Object.freeze({ name: 'marker_key', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'bootstrap_intent_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'installation_key_fingerprint', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'policy_manifest_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'receipt_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'consumed_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_trust_root_evidence: Object.freeze([
    Object.freeze({ name: 'evidence_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'receipt_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'actor_kind', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'event_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'assertion_evidence_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'backup_id', dataType: 'text', udtName: 'text', nullable: 'YES', collation: 'C' }),
    Object.freeze({ name: 'backup_manifest_sha256', dataType: 'text', udtName: 'text', nullable: 'YES', collation: 'C' }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_recent_reauthentication_events: Object.freeze([
    Object.freeze({ name: 'reauth_event_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'session_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'factor_class', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'evidence_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    ...['account_auth_version', 'account_access_version', 'account_revocation_version', 'device_credential_version', 'device_risk_version', 'installation_credential_version', 'link_auth_version', 'link_access_version', 'link_row_version'].map(name => Object.freeze({ name, dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null })),
    Object.freeze({ name: 'verified_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'expires_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_sessions: Object.freeze([
    ...['session_id', 'authority_id', 'account_id', 'device_id', 'installation_id', 'link_id', 'session_kind', 'status'].map(name => Object.freeze({ name, dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' })),
    Object.freeze({ name: 'issued_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'expires_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'revoked_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
    ...['account_auth_version', 'account_access_version', 'account_revocation_version', 'device_credential_version', 'device_risk_version', 'installation_credential_version', 'link_auth_version', 'link_access_version', 'link_row_version', 'row_version'].map(name => Object.freeze({ name, dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null })),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_authorization_command_receipts: Object.freeze([
    Object.freeze({ name: 'receipt_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'actor_key', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'actor_account_id', dataType: 'text', udtName: 'text', nullable: 'YES', collation: 'C' }),
    Object.freeze({ name: 'idempotency_key', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'command_type', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'target_kind', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'target_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'canonical_request_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'expected_row_version', dataType: 'bigint', udtName: 'int8', nullable: 'YES', collation: null }),
    Object.freeze({ name: 'outcome', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'result_code', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'canonical_result_json', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'canonical_result_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'committed_auth_version', dataType: 'bigint', udtName: 'int8', nullable: 'YES', collation: null }),
    Object.freeze({ name: 'committed_access_version', dataType: 'bigint', udtName: 'int8', nullable: 'YES', collation: null }),
    Object.freeze({ name: 'committed_revocation_version', dataType: 'bigint', udtName: 'int8', nullable: 'YES', collation: null }),
    Object.freeze({ name: 'committed_target_row_version', dataType: 'bigint', udtName: 'int8', nullable: 'YES', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_capability_catalog: Object.freeze([
    Object.freeze({ name: 'capability_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'surface_mask', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_capability_overrides: Object.freeze([
    Object.freeze({ name: 'override_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'account_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'capability_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'effect', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'starts_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'ends_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
    Object.freeze({ name: 'row_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'revoked_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
  ]),
  vnext_data_scope_grants: Object.freeze([
    Object.freeze({ name: 'scope_grant_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'account_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'scope_type', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'scope_value_hash', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'effect', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'starts_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'ends_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
    Object.freeze({ name: 'row_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'revoked_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
  ]),
  vnext_profile_bindings: Object.freeze([
    Object.freeze({ name: 'binding_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'account_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'profile_type', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'profile_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'evidence_hash', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'row_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'revoked_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
  ]),
  vnext_verified_contacts: Object.freeze([
    Object.freeze({ name: 'contact_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'account_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'contact_type', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'normalized_value_hash', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'verification_state', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'verification_evidence_hash', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'verified_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
    Object.freeze({ name: 'revoked_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
    Object.freeze({ name: 'row_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_trusted_devices: Object.freeze([
    Object.freeze({ name: 'device_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'hardware_evidence_hash', dataType: 'text', udtName: 'text', nullable: 'YES', collation: 'C' }),
    Object.freeze({ name: 'risk_code', dataType: 'text', udtName: 'text', nullable: 'YES', collation: 'C' }),
    Object.freeze({ name: 'credential_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'risk_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'row_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'revoked_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
  ]),
  vnext_device_installations: Object.freeze([
    Object.freeze({ name: 'installation_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'device_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'installation_public_key', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'key_fingerprint', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'credential_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'row_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'revoked_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
  ]),
  vnext_account_device_links: Object.freeze([
    Object.freeze({ name: 'link_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'account_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'device_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'installation_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'auth_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'access_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'row_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'revoked_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
  ]),
  vnext_role_grants: Object.freeze([
    Object.freeze({ name: 'grant_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'account_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'role', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'status', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'grant_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'row_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'starts_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'ends_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
    Object.freeze({ name: 'revoked_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'YES', collation: null }),
    Object.freeze({ name: 'granted_by_account_id', dataType: 'text', udtName: 'text', nullable: 'YES', collation: 'C' }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
});
const ONLINE_IDENTITY_COLUMNS = Object.freeze({
  vnext_online_identity_assertions: Object.freeze([
    Object.freeze({ name: 'assertion_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'account_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'device_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'installation_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'installation_public_key', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'key_fingerprint', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'audience', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'nonce_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'canonical_request_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'identity_proof_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'hardware_evidence_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'issued_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }), Object.freeze({ name: 'expires_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }), Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_online_identity_assertion_consumptions: Object.freeze([
    Object.freeze({ name: 'assertion_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'receipt_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }), Object.freeze({ name: 'consumed_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
});
const ONLINE_IDENTITY_COLUMNS_WITH_VERSIONS = Object.freeze({
  vnext_online_identity_assertions: Object.freeze([
    Object.freeze({ name: 'assertion_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'account_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'account_auth_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'account_access_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'account_revocation_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'device_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'installation_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'installation_public_key', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'key_fingerprint', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'audience', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'nonce_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'canonical_request_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'identity_proof_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'hardware_evidence_sha256', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
    Object.freeze({ name: 'issued_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'expires_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
    Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  ]),
  vnext_online_identity_assertion_consumptions: ONLINE_IDENTITY_COLUMNS.vnext_online_identity_assertion_consumptions,
});
const PASSWORD_CREDENTIAL_COLUMNS = Object.freeze([
  Object.freeze({ name: 'authority_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
  Object.freeze({ name: 'account_id', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
  Object.freeze({ name: 'login_name', dataType: 'text', udtName: 'text', nullable: 'YES', collation: 'C' }),
  Object.freeze({ name: 'password_algorithm', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
  Object.freeze({ name: 'password_salt_base64', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
  Object.freeze({ name: 'password_hash_base64', dataType: 'text', udtName: 'text', nullable: 'NO', collation: 'C' }),
  Object.freeze({ name: 'credential_version', dataType: 'bigint', udtName: 'int8', nullable: 'NO', collation: null }),
  Object.freeze({ name: 'created_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
  Object.freeze({ name: 'updated_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', nullable: 'NO', collation: null }),
]);
const PASSWORD_CREDENTIAL_TABLE_NAMES = Object.freeze(['vnext_desktop_password_credentials']);
const PASSWORD_CREDENTIAL_CONSTRAINTS = Object.freeze([
  Object.freeze({ name: 'vnext_desktop_password_credentials_account_id_authority_id_fkey', type: 'f', definition: 'FOREIGN KEY (account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT' }),
  Object.freeze({ name: 'vnext_desktop_password_credentials_authority_id_login_name_key', type: 'u', definition: 'UNIQUE (authority_id, login_name)' }),
  Object.freeze({ name: 'vnext_desktop_password_credentials_check', type: 'c', definition: "CHECK (updated_at <> 'infinity'::timestamp with time zone AND updated_at <> '-infinity'::timestamp with time zone AND updated_at >= created_at)" }),
  Object.freeze({ name: 'vnext_desktop_password_credentials_created_at_check', type: 'c', definition: "CHECK (created_at <> 'infinity'::timestamp with time zone AND created_at <> '-infinity'::timestamp with time zone)" }),
  Object.freeze({ name: 'vnext_desktop_password_credentials_credential_version_check', type: 'c', definition: 'CHECK (credential_version > 0)' }),
  Object.freeze({ name: 'vnext_desktop_password_credentials_login_name_check', type: 'c', definition: "CHECK (login_name IS NULL OR btrim(login_name) <> ''::text AND login_name ~ '^[A-Za-z][A-Za-z0-9._-]{2,63}$'::text)" }),
  Object.freeze({ name: 'vnext_desktop_password_credentials_password_algorithm_check', type: 'c', definition: "CHECK (password_algorithm = 'scrypt-v1'::text)" }),
  Object.freeze({ name: 'vnext_desktop_password_credentials_password_hash_base64_check', type: 'c', definition: "CHECK (password_hash_base64 ~ '^[A-Za-z0-9+/]+={0,2}$'::text)" }),
  Object.freeze({ name: 'vnext_desktop_password_credentials_password_salt_base64_check', type: 'c', definition: "CHECK (password_salt_base64 ~ '^[A-Za-z0-9+/]+={0,2}$'::text)" }),
  Object.freeze({ name: 'vnext_desktop_password_credentials_pkey', type: 'p', definition: 'PRIMARY KEY (authority_id, account_id)' }),
]);
const FOUNDATION_CONSTRAINTS = Object.freeze({
  vnext_schema_meta: Object.freeze({ count: 4, required: Object.freeze(['vnext_schema_meta_pkey', 'vnext_schema_meta_schema_key_check', 'vnext_schema_meta_schema_version_check', 'vnext_schema_meta_applied_at_check']) }),
  vnext_authorities: Object.freeze({ count: 6, required: Object.freeze(['vnext_authorities_pkey', 'vnext_authorities_status_check', 'vnext_authorities_check']) }),
  vnext_accounts: Object.freeze({ count: 13, required: Object.freeze(['vnext_accounts_pkey', 'vnext_accounts_account_id_authority_id_key', 'vnext_accounts_authority_id_fkey', 'vnext_accounts_status_check', 'vnext_accounts_check']) }),
  vnext_authorization_audit_events: Object.freeze({ count: 10, required: Object.freeze(['vnext_authorization_audit_events_pkey', 'vnext_authorization_audit_events_event_id_check', 'vnext_authorization_audit_events_authority_id_check', 'vnext_authorization_audit_events_receipt_id_check', 'vnext_authorization_audit_events_reason_code_check', 'vnext_authorization_audit_events_context_sha256_check', 'vnext_authorization_audit_events_created_at_check', 'vnext_authorization_audit_events_authority_id_receipt_id_key', 'vnext_authorization_audit_events_authority_id_fkey', 'vnext_authorization_audit_events_receipt_id_authority_id_fkey']) }),
  vnext_authorization_outbox_events: Object.freeze({ count: 14, required: Object.freeze(['vnext_authorization_outbox_events_pkey', 'vnext_authorization_outbox_events_event_id_check', 'vnext_authorization_outbox_events_authority_id_check', 'vnext_authorization_outbox_events_receipt_id_check', 'vnext_authorization_outbox_events_event_type_check', 'vnext_authorization_outbox_events_aggregate_kind_check', 'vnext_authorization_outbox_events_aggregate_id_check', 'vnext_authorization_outbox_events_aggregate_version_check', 'vnext_authorization_outbox_events_canonical_payload_json_check', 'vnext_authorization_outbox_events_payload_sha256_check', 'vnext_authorization_outbox_events_occurred_at_check', 'vnext_authorization_outbox_ev_authority_id_receipt_id_event_key', 'vnext_authorization_outbox_events_authority_id_fkey', 'vnext_authorization_outbox_events_receipt_id_authority_id_fkey']) }),
  vnext_authorization_policy_publications: Object.freeze({ count: 13, required: Object.freeze(['vnext_authorization_policy_publications_pkey', 'vnext_authorization_policy_publications_publication_id_check', 'vnext_authorization_policy_publications_authority_id_check', 'vnext_authorization_policy_publications_receipt_id_check', 'vnext_authorization_policy_publications_policy_revision_check', 'vnext_authorization_policy_public_policy_contract_version_check', 'vnext_authorization_policy_public_canonical_manifest_json_check', 'vnext_authorization_policy_publica_policy_manifest_sha256_check', 'vnext_authorization_policy_publications_published_at_check', 'vnext_authorization_policy_pub_authority_id_policy_revision_key', 'vnext_authorization_policy_publicat_authority_id_receipt_id_key', 'vnext_authorization_policy_publications_authority_id_fkey', 'vnext_authorization_policy_publica_receipt_id_authority_id_fkey']) }),
  vnext_bootstrap_consumptions: Object.freeze({ count: 11, required: Object.freeze(['vnext_bootstrap_consumptions_pkey', 'vnext_bootstrap_consumptions_marker_key_check', 'vnext_bootstrap_consumptions_bootstrap_intent_id_key', 'vnext_bootstrap_consumptions_bootstrap_intent_id_check', 'vnext_bootstrap_consumptions_authority_id_key', 'vnext_bootstrap_consumptions_authority_id_check', 'vnext_bootstrap_consumptions_installation_key_fingerprint_check', 'vnext_bootstrap_consumptions_policy_manifest_sha256_check', 'vnext_bootstrap_consumptions_receipt_id_key', 'vnext_bootstrap_consumptions_receipt_id_check', 'vnext_bootstrap_consumptions_consumed_at_check']) }),
  vnext_authorization_command_receipts: Object.freeze({ count: 24, required: Object.freeze(['vnext_authorization_command_receipts_pkey', 'vnext_authorization_command_receipt_receipt_id_authority_id_key', 'vnext_authorization_command_r_authority_id_actor_key_idempo_key', 'vnext_authorization_command_receipts_authority_id_fkey', 'vnext_authorization_command_r_actor_account_id_authority_i_fkey', 'vnext_authorization_command_receipts_outcome_check', 'vnext_authorization_command_receipt_canonical_result_json_check']) }),
  vnext_capability_catalog: Object.freeze({ count: 5, required: Object.freeze(['vnext_capability_catalog_pkey', 'vnext_capability_catalog_capability_id_check', 'vnext_capability_catalog_status_check', 'vnext_capability_catalog_surface_mask_check', 'vnext_capability_catalog_created_at_check']) }),
  vnext_capability_overrides: Object.freeze({ count: 18, required: Object.freeze(['vnext_capability_overrides_pkey', 'vnext_capability_overrides_account_id_authority_id_fkey', 'vnext_capability_overrides_capability_id_fkey', 'vnext_capability_overrides_effect_check', 'vnext_capability_overrides_status_check', 'vnext_capability_overrides_row_version_check', 'vnext_capability_overrides_check2']) }),
  vnext_data_scope_grants: Object.freeze({ count: 18, required: Object.freeze(['vnext_data_scope_grants_pkey', 'vnext_data_scope_grants_account_id_authority_id_fkey', 'vnext_data_scope_grants_scope_type_check', 'vnext_data_scope_grants_effect_check', 'vnext_data_scope_grants_status_check', 'vnext_data_scope_grants_row_version_check', 'vnext_data_scope_grants_check2']) }),
  vnext_profile_bindings: Object.freeze({ count: 15, required: Object.freeze(['vnext_profile_bindings_pkey', 'vnext_profile_bindings_account_id_authority_id_fkey', 'vnext_profile_bindings_profile_type_check', 'vnext_profile_bindings_status_check', 'vnext_profile_bindings_row_version_check', 'vnext_profile_bindings_check1']) }),
  vnext_verified_contacts: Object.freeze({ count: 17, required: Object.freeze(['vnext_verified_contacts_pkey', 'vnext_verified_contacts_authority_id_contact_type_normalize_key', 'vnext_verified_contacts_account_id_authority_id_fkey', 'vnext_verified_contacts_contact_type_check', 'vnext_verified_contacts_verification_state_check', 'vnext_verified_contacts_row_version_check', 'vnext_verified_contacts_check1']) }),
  vnext_trusted_devices: Object.freeze({ count: 16, required: Object.freeze(['vnext_trusted_devices_pkey', 'vnext_trusted_devices_device_id_authority_id_key', 'vnext_trusted_devices_authority_id_fkey', 'vnext_trusted_devices_status_check', 'vnext_trusted_devices_check1']) }),
  vnext_device_installations: Object.freeze({ count: 17, required: Object.freeze(['vnext_device_installations_pkey', 'vnext_device_installations_authority_id_key_fingerprint_key', 'vnext_device_installations_installation_id_device_id_author_key', 'vnext_device_installations_device_id_authority_id_fkey', 'vnext_device_installations_check1']) }),
  vnext_account_device_links: Object.freeze({ count: 20, required: Object.freeze(['vnext_account_device_links_pkey', 'vnext_account_device_links_authority_id_account_id_installa_key', 'vnext_account_device_links_link_id_authority_id_account_id__key', 'vnext_account_device_links_account_id_authority_id_fkey', 'vnext_account_device_links_device_id_authority_id_fkey', 'vnext_account_device_links_installation_id_device_id_autho_fkey', 'vnext_account_device_links_check1']) }),
  vnext_role_grants: Object.freeze({ count: 19, required: Object.freeze(['vnext_role_grants_pkey', 'vnext_role_grants_account_id_authority_id_fkey', 'vnext_role_grants_granted_by_account_id_authority_id_fkey', 'vnext_role_grants_granted_by_account_id_check', 'vnext_role_grants_role_check', 'vnext_role_grants_status_check', 'vnext_role_grants_check2']) }),
  vnext_trust_root_evidence: Object.freeze({ count: 14, required: Object.freeze(['vnext_trust_root_evidence_pkey', 'vnext_trust_root_evidence_authority_id_receipt_id_key', 'vnext_trust_root_evidence_actor_kind_event_id_key', 'vnext_trust_root_evidence_authority_id_fkey', 'vnext_trust_root_evidence_receipt_id_authority_id_fkey', 'vnext_trust_root_evidence_actor_kind_check', 'vnext_trust_root_evidence_check']) }),
  vnext_recent_reauthentication_events: Object.freeze({ count: 20, required: Object.freeze(['vnext_recent_reauthentication_events_pkey', 'vnext_recent_reauthentication_even_session_id_authority_id_fkey', 'vnext_recent_reauthentication_events_factor_class_check', 'vnext_recent_reauthentication_events_evidence_sha256_check', 'vnext_recent_reauthentication_events_check']) }),
  vnext_sessions: Object.freeze({ count: 33, required: Object.freeze(['vnext_sessions_pkey', 'vnext_sessions_session_id_authority_id_key', 'vnext_sessions_account_id_authority_id_fkey', 'vnext_sessions_device_id_authority_id_fkey', 'vnext_sessions_installation_id_device_id_authority_id_fkey', 'vnext_sessions_link_id_authority_id_account_id_device_id_i_fkey', 'vnext_sessions_session_kind_check', 'vnext_sessions_status_check', 'vnext_sessions_check3']) }),
});
const FOUNDATION_CONSTRAINT_DEFINITIONS = Object.freeze({
  vnext_accounts_authority_id_fkey: 'FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_trusted_devices_authority_id_fkey: 'FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_trusted_devices_check1: "CHECK (status = 'revoked'::text AND revoked_at IS NOT NULL OR status <> 'revoked'::text AND revoked_at IS NULL)",
  vnext_device_installations_authority_id_key_fingerprint_key: 'UNIQUE (authority_id, key_fingerprint)',
  vnext_device_installations_installation_id_device_id_author_key: 'UNIQUE (installation_id, device_id, authority_id)',
  vnext_device_installations_device_id_authority_id_fkey: 'FOREIGN KEY (device_id, authority_id) REFERENCES vnext_control_plane.vnext_trusted_devices(device_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_device_installations_check1: "CHECK (status = 'revoked'::text AND revoked_at IS NOT NULL OR status <> 'revoked'::text AND revoked_at IS NULL)",
  vnext_account_device_links_authority_id_account_id_installa_key: 'UNIQUE (authority_id, account_id, installation_id)',
  vnext_account_device_links_link_id_authority_id_account_id__key: 'UNIQUE (link_id, authority_id, account_id, device_id, installation_id)',
  vnext_account_device_links_account_id_authority_id_fkey: 'FOREIGN KEY (account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_account_device_links_device_id_authority_id_fkey: 'FOREIGN KEY (device_id, authority_id) REFERENCES vnext_control_plane.vnext_trusted_devices(device_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_account_device_links_installation_id_device_id_autho_fkey: 'FOREIGN KEY (installation_id, device_id, authority_id) REFERENCES vnext_control_plane.vnext_device_installations(installation_id, device_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_account_device_links_check1: "CHECK (status = 'revoked'::text AND revoked_at IS NOT NULL OR status = 'expired'::text AND revoked_at IS NULL OR status = 'active'::text)",
  vnext_role_grants_account_id_authority_id_fkey: 'FOREIGN KEY (account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_role_grants_granted_by_account_id_authority_id_fkey: 'FOREIGN KEY (granted_by_account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_role_grants_granted_by_account_id_check: "CHECK (granted_by_account_id IS NULL OR btrim(granted_by_account_id) <> ''::text)",
  vnext_role_grants_check2: "CHECK (status = 'active'::text AND revoked_at IS NULL OR status = 'revoked'::text AND revoked_at IS NOT NULL OR status = 'expired'::text AND ends_at IS NOT NULL AND revoked_at IS NULL)",
  vnext_sessions_account_id_authority_id_fkey: 'FOREIGN KEY (account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_sessions_device_id_authority_id_fkey: 'FOREIGN KEY (device_id, authority_id) REFERENCES vnext_control_plane.vnext_trusted_devices(device_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_sessions_installation_id_device_id_authority_id_fkey: 'FOREIGN KEY (installation_id, device_id, authority_id) REFERENCES vnext_control_plane.vnext_device_installations(installation_id, device_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_sessions_link_id_authority_id_account_id_device_id_i_fkey: 'FOREIGN KEY (link_id, authority_id, account_id, device_id, installation_id) REFERENCES vnext_control_plane.vnext_account_device_links(link_id, authority_id, account_id, device_id, installation_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_sessions_check3: "CHECK (status = 'revoked'::text AND revoked_at IS NOT NULL OR (status = ANY (ARRAY['active'::text, 'expired'::text])) AND revoked_at IS NULL)",
  vnext_recent_reauthentication_even_session_id_authority_id_fkey: 'FOREIGN KEY (session_id, authority_id) REFERENCES vnext_control_plane.vnext_sessions(session_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_capability_overrides_account_id_authority_id_fkey: 'FOREIGN KEY (account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_capability_overrides_capability_id_fkey: 'FOREIGN KEY (capability_id) REFERENCES vnext_control_plane.vnext_capability_catalog(capability_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_capability_overrides_check2: "CHECK (status = 'active'::text AND revoked_at IS NULL OR status = 'revoked'::text AND revoked_at IS NOT NULL OR status = 'expired'::text AND ends_at IS NOT NULL AND revoked_at IS NULL)",
  vnext_data_scope_grants_account_id_authority_id_fkey: 'FOREIGN KEY (account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_data_scope_grants_check2: "CHECK (status = 'active'::text AND revoked_at IS NULL OR status = 'revoked'::text AND revoked_at IS NOT NULL OR status = 'expired'::text AND ends_at IS NOT NULL AND revoked_at IS NULL)",
  vnext_profile_bindings_account_id_authority_id_fkey: 'FOREIGN KEY (account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_profile_bindings_check1: "CHECK (status = 'revoked'::text AND revoked_at IS NOT NULL OR (status = ANY (ARRAY['active'::text, 'pending'::text])) AND revoked_at IS NULL)",
  vnext_authorization_command_receipts_authority_id_fkey: 'FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_authorization_audit_events_authority_id_fkey: 'FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_authorization_audit_events_receipt_id_authority_id_fkey: 'FOREIGN KEY (receipt_id, authority_id) REFERENCES vnext_control_plane.vnext_authorization_command_receipts(receipt_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_authorization_outbox_events_authority_id_fkey: 'FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_authorization_outbox_events_receipt_id_authority_id_fkey: 'FOREIGN KEY (receipt_id, authority_id) REFERENCES vnext_control_plane.vnext_authorization_command_receipts(receipt_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_authorization_policy_publications_authority_id_fkey: 'FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_authorization_policy_publica_receipt_id_authority_id_fkey: 'FOREIGN KEY (receipt_id, authority_id) REFERENCES vnext_control_plane.vnext_authorization_command_receipts(receipt_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_authorization_command_r_actor_account_id_authority_i_fkey: 'FOREIGN KEY (actor_account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_verified_contacts_account_id_authority_id_fkey: 'FOREIGN KEY (account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_verified_contacts_check1: "CHECK (verification_state = 'verified'::text AND verified_at IS NOT NULL AND revoked_at IS NULL OR verification_state = 'revoked'::text AND verified_at IS NOT NULL AND revoked_at IS NOT NULL)",
  vnext_trust_root_evidence_authority_id_fkey: 'FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  vnext_trust_root_evidence_receipt_id_authority_id_fkey: 'FOREIGN KEY (receipt_id, authority_id) REFERENCES vnext_control_plane.vnext_authorization_command_receipts(receipt_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
});
const FOUNDATION_CONSTRAINT_CATALOG_SHA256 = '521f02f31b30eb197e29ec9f68f34c3460cccb4a932ed1eabd50df62b4fce5bc';
const FOUNDATION_INDEX_CATALOG_SHA256 = '7cf4086f089e3469aeee8eb0549ae5ba3a766d1b77a036ae84b9df35e0fbe7c7';
const FOUNDATION_INDEX_DEFINITIONS = Object.freeze({
  vnext_capability_overrides_one_active_capability: "CREATE UNIQUE INDEX vnext_capability_overrides_one_active_capability ON vnext_control_plane.vnext_capability_overrides USING btree (authority_id, account_id, capability_id) WHERE (status = 'active'::text)",
  vnext_data_scope_grants_one_active_scope: "CREATE UNIQUE INDEX vnext_data_scope_grants_one_active_scope ON vnext_control_plane.vnext_data_scope_grants USING btree (authority_id, account_id, scope_type, scope_value_hash) WHERE (status = 'active'::text)",
  vnext_profile_bindings_one_active_account_type: "CREATE UNIQUE INDEX vnext_profile_bindings_one_active_account_type ON vnext_control_plane.vnext_profile_bindings USING btree (authority_id, account_id, profile_type) WHERE (status = 'active'::text)",
  vnext_profile_bindings_one_active_profile: "CREATE UNIQUE INDEX vnext_profile_bindings_one_active_profile ON vnext_control_plane.vnext_profile_bindings USING btree (authority_id, profile_type, profile_id) WHERE (status = 'active'::text)",
  vnext_role_grants_one_active_role: "CREATE UNIQUE INDEX vnext_role_grants_one_active_role ON vnext_control_plane.vnext_role_grants USING btree (authority_id, account_id, role) WHERE (status = 'active'::text)",
});
const FOUNDATION_TABLE_NAMES = Object.freeze(Object.keys(FOUNDATION_COLUMNS).sort());
const ONLINE_IDENTITY_TABLE_NAMES = Object.freeze(Object.keys(ONLINE_IDENTITY_COLUMNS_WITH_VERSIONS).sort());
const ONLINE_IDENTITY_CONSTRAINTS = Object.freeze({
  vnext_online_identity_assertions: Object.freeze({ count: 24, required: Object.freeze(['vnext_online_identity_assertions_pkey', 'vnext_online_identity_assertions_authority_id_nonce_sha256_key', 'vnext_online_identity_assertions_account_id_authority_id_fkey', 'vnext_online_identity_assertions_authority_id_fkey', 'vnext_online_identity_assertions_audience_check', 'vnext_online_identity_assertions_account_auth_version_check', 'vnext_online_identity_assertions_account_access_version_check', 'vnext_online_identity_assertio_account_revocation_version_check', 'vnext_online_identity_assertions_check', 'vnext_online_identity_assertions_check1']) }),
  vnext_online_identity_assertion_consumptions: Object.freeze({ count: 7, required: Object.freeze(['vnext_online_identity_assertion_consumptions_pkey', 'vnext_online_identity_assertion_consumptions_assertion_id_fkey', 'vnext_online_identity_assertion_co_receipt_id_authority_id_fkey']) }),
});
const TARGET_RELATION_NAMES = Object.freeze([
  'vnext_schema_migrations',
  ...FOUNDATION_TABLE_NAMES,
  ...ONLINE_IDENTITY_TABLE_NAMES,
  ...PASSWORD_CREDENTIAL_TABLE_NAMES,
]);
const TARGET_TABLE_NAMES = Object.freeze([...TARGET_RELATION_NAMES].sort());
const WRITER_TABLE_NAMES = Object.freeze(TARGET_TABLE_NAMES.filter(name => !ONLINE_IDENTITY_TABLE_NAMES.includes(name) && !PASSWORD_CREDENTIAL_TABLE_NAMES.includes(name)));
const VERIFIER_TABLE_NAMES = Object.freeze(TARGET_TABLE_NAMES.filter(name => !PASSWORD_CREDENTIAL_TABLE_NAMES.includes(name)));
const TARGET_TRIGGERS = Object.freeze([
  Object.freeze({ tableName: 'vnext_online_identity_assertion_consumptions', triggerName: 'vnext_online_identity_assertion_consumptions_no_delete', functionSchema: 'vnext_control_plane', functionName: 'vnext_online_identity_assertion_consumptions_no_delete', enabled: 'O', definition: 'CREATE TRIGGER vnext_online_identity_assertion_consumptions_no_delete BEFORE DELETE ON vnext_control_plane.vnext_online_identity_assertion_consumptions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_online_identity_assertion_consumptions_no_delete()' }),
  Object.freeze({ tableName: 'vnext_online_identity_assertion_consumptions', triggerName: 'vnext_online_identity_assertion_consumptions_no_update', functionSchema: 'vnext_control_plane', functionName: 'vnext_online_identity_assertion_consumptions_no_update', enabled: 'O', definition: 'CREATE TRIGGER vnext_online_identity_assertion_consumptions_no_update BEFORE UPDATE ON vnext_control_plane.vnext_online_identity_assertion_consumptions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_online_identity_assertion_consumptions_no_update()' }),
  Object.freeze({ tableName: 'vnext_online_identity_assertions', triggerName: 'vnext_online_identity_assertions_no_delete', functionSchema: 'vnext_control_plane', functionName: 'vnext_online_identity_assertions_no_delete', enabled: 'O', definition: 'CREATE TRIGGER vnext_online_identity_assertions_no_delete BEFORE DELETE ON vnext_control_plane.vnext_online_identity_assertions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_online_identity_assertions_no_delete()' }),
  Object.freeze({ tableName: 'vnext_online_identity_assertions', triggerName: 'vnext_online_identity_assertions_no_update', functionSchema: 'vnext_control_plane', functionName: 'vnext_online_identity_assertions_no_update', enabled: 'O', definition: 'CREATE TRIGGER vnext_online_identity_assertions_no_update BEFORE UPDATE ON vnext_control_plane.vnext_online_identity_assertions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_online_identity_assertions_no_update()' }),
  Object.freeze({ tableName: 'vnext_authorization_audit_events', triggerName: 'vnext_authorization_audit_events_no_delete', functionSchema: 'vnext_control_plane', functionName: 'vnext_authorization_audit_events_no_delete', enabled: 'O', definition: 'CREATE TRIGGER vnext_authorization_audit_events_no_delete BEFORE DELETE ON vnext_control_plane.vnext_authorization_audit_events FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_delete()' }),
  Object.freeze({ tableName: 'vnext_authorization_audit_events', triggerName: 'vnext_authorization_audit_events_no_update', functionSchema: 'vnext_control_plane', functionName: 'vnext_authorization_audit_events_no_update', enabled: 'O', definition: 'CREATE TRIGGER vnext_authorization_audit_events_no_update BEFORE UPDATE ON vnext_control_plane.vnext_authorization_audit_events FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_update()' }),
  Object.freeze({ tableName: 'vnext_authorization_command_receipts', triggerName: 'vnext_authorization_command_receipts_no_delete', functionSchema: 'vnext_control_plane', functionName: 'vnext_authorization_command_receipts_no_delete', enabled: 'O', definition: 'CREATE TRIGGER vnext_authorization_command_receipts_no_delete BEFORE DELETE ON vnext_control_plane.vnext_authorization_command_receipts FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_delete()' }),
  Object.freeze({ tableName: 'vnext_authorization_command_receipts', triggerName: 'vnext_authorization_command_receipts_no_update', functionSchema: 'vnext_control_plane', functionName: 'vnext_authorization_command_receipts_no_update', enabled: 'O', definition: 'CREATE TRIGGER vnext_authorization_command_receipts_no_update BEFORE UPDATE ON vnext_control_plane.vnext_authorization_command_receipts FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_update()' }),
  Object.freeze({ tableName: 'vnext_authorization_outbox_events', triggerName: 'vnext_authorization_outbox_events_no_delete', functionSchema: 'vnext_control_plane', functionName: 'vnext_authorization_outbox_events_no_delete', enabled: 'O', definition: 'CREATE TRIGGER vnext_authorization_outbox_events_no_delete BEFORE DELETE ON vnext_control_plane.vnext_authorization_outbox_events FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_delete()' }),
  Object.freeze({ tableName: 'vnext_authorization_outbox_events', triggerName: 'vnext_authorization_outbox_events_no_update', functionSchema: 'vnext_control_plane', functionName: 'vnext_authorization_outbox_events_no_update', enabled: 'O', definition: 'CREATE TRIGGER vnext_authorization_outbox_events_no_update BEFORE UPDATE ON vnext_control_plane.vnext_authorization_outbox_events FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_update()' }),
  Object.freeze({ tableName: 'vnext_authorization_policy_publications', triggerName: 'vnext_authorization_policy_publications_insert_guard', functionSchema: 'vnext_control_plane', functionName: 'vnext_authorization_policy_publications_insert_guard', enabled: 'O', definition: 'CREATE TRIGGER vnext_authorization_policy_publications_insert_guard BEFORE INSERT ON vnext_control_plane.vnext_authorization_policy_publications FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_policy_publications_insert_guard()' }),
  Object.freeze({ tableName: 'vnext_authorization_policy_publications', triggerName: 'vnext_authorization_policy_publications_no_delete', functionSchema: 'vnext_control_plane', functionName: 'vnext_authorization_policy_publications_no_delete', enabled: 'O', definition: 'CREATE TRIGGER vnext_authorization_policy_publications_no_delete BEFORE DELETE ON vnext_control_plane.vnext_authorization_policy_publications FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_delete()' }),
  Object.freeze({ tableName: 'vnext_authorization_policy_publications', triggerName: 'vnext_authorization_policy_publications_no_update', functionSchema: 'vnext_control_plane', functionName: 'vnext_authorization_policy_publications_no_update', enabled: 'O', definition: 'CREATE TRIGGER vnext_authorization_policy_publications_no_update BEFORE UPDATE ON vnext_control_plane.vnext_authorization_policy_publications FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_update()' }),
  Object.freeze({ tableName: 'vnext_bootstrap_consumptions', triggerName: 'vnext_bootstrap_consumptions_insert_guard', functionSchema: 'vnext_control_plane', functionName: 'vnext_bootstrap_consumptions_insert_guard', enabled: 'O', definition: 'CREATE TRIGGER vnext_bootstrap_consumptions_insert_guard BEFORE INSERT ON vnext_control_plane.vnext_bootstrap_consumptions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_insert_guard()' }),
  Object.freeze({ tableName: 'vnext_bootstrap_consumptions', triggerName: 'vnext_bootstrap_consumptions_no_delete', functionSchema: 'vnext_control_plane', functionName: 'vnext_bootstrap_consumptions_no_delete', enabled: 'O', definition: 'CREATE TRIGGER vnext_bootstrap_consumptions_no_delete BEFORE DELETE ON vnext_control_plane.vnext_bootstrap_consumptions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_no_delete()' }),
  Object.freeze({ tableName: 'vnext_bootstrap_consumptions', triggerName: 'vnext_bootstrap_consumptions_no_update', functionSchema: 'vnext_control_plane', functionName: 'vnext_bootstrap_consumptions_no_update', enabled: 'O', definition: 'CREATE TRIGGER vnext_bootstrap_consumptions_no_update BEFORE UPDATE ON vnext_control_plane.vnext_bootstrap_consumptions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_no_update()' }),
  Object.freeze({ tableName: 'vnext_recent_reauthentication_events', triggerName: 'vnext_recent_reauthentication_events_no_delete', functionSchema: 'vnext_control_plane', functionName: 'vnext_recent_reauthentication_events_no_delete', enabled: 'O', definition: 'CREATE TRIGGER vnext_recent_reauthentication_events_no_delete BEFORE DELETE ON vnext_control_plane.vnext_recent_reauthentication_events FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_recent_reauthentication_events_no_delete()' }),
  Object.freeze({ tableName: 'vnext_recent_reauthentication_events', triggerName: 'vnext_recent_reauthentication_events_no_update', functionSchema: 'vnext_control_plane', functionName: 'vnext_recent_reauthentication_events_no_update', enabled: 'O', definition: 'CREATE TRIGGER vnext_recent_reauthentication_events_no_update BEFORE UPDATE ON vnext_control_plane.vnext_recent_reauthentication_events FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_recent_reauthentication_events_no_update()' }),
  Object.freeze({ tableName: 'vnext_recent_reauthentication_events', triggerName: 'vnext_recent_reauthentication_events_session_state_match', functionSchema: 'vnext_control_plane', functionName: 'vnext_recent_reauthentication_events_session_state_match', enabled: 'O', definition: 'CREATE TRIGGER vnext_recent_reauthentication_events_session_state_match BEFORE INSERT ON vnext_control_plane.vnext_recent_reauthentication_events FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_recent_reauthentication_events_session_state_match()' }),
  Object.freeze({ tableName: 'vnext_schema_migrations', triggerName: 'vnext_schema_migrations_insert_guard', functionSchema: 'vnext_control_plane', functionName: 'vnext_schema_migrations_insert_guard', enabled: 'O', definition: 'CREATE TRIGGER vnext_schema_migrations_insert_guard BEFORE INSERT ON vnext_control_plane.vnext_schema_migrations FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_insert_guard()' }),
  Object.freeze({ tableName: 'vnext_schema_migrations', triggerName: 'vnext_schema_migrations_no_delete', functionSchema: 'vnext_control_plane', functionName: 'vnext_schema_migrations_no_delete', enabled: 'O', definition: 'CREATE TRIGGER vnext_schema_migrations_no_delete BEFORE DELETE ON vnext_control_plane.vnext_schema_migrations FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()' }),
  Object.freeze({ tableName: 'vnext_schema_migrations', triggerName: 'vnext_schema_migrations_no_update', functionSchema: 'vnext_control_plane', functionName: 'vnext_schema_migrations_no_update', enabled: 'O', definition: 'CREATE TRIGGER vnext_schema_migrations_no_update BEFORE UPDATE ON vnext_control_plane.vnext_schema_migrations FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_update()' }),
  Object.freeze({ tableName: 'vnext_sessions', triggerName: 'vnext_sessions_identity_immutable', functionSchema: 'vnext_control_plane', functionName: 'vnext_sessions_identity_immutable', enabled: 'O', definition: 'CREATE TRIGGER vnext_sessions_identity_immutable BEFORE UPDATE ON vnext_control_plane.vnext_sessions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_sessions_identity_immutable()' }),
  Object.freeze({ tableName: 'vnext_sessions', triggerName: 'vnext_sessions_lifecycle_monotonic', functionSchema: 'vnext_control_plane', functionName: 'vnext_sessions_lifecycle_monotonic', enabled: 'O', definition: 'CREATE TRIGGER vnext_sessions_lifecycle_monotonic BEFORE UPDATE ON vnext_control_plane.vnext_sessions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_sessions_lifecycle_monotonic()' }),
  Object.freeze({ tableName: 'vnext_sessions', triggerName: 'vnext_sessions_no_delete', functionSchema: 'vnext_control_plane', functionName: 'vnext_sessions_no_delete', enabled: 'O', definition: 'CREATE TRIGGER vnext_sessions_no_delete BEFORE DELETE ON vnext_control_plane.vnext_sessions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_sessions_no_delete()' }),
  Object.freeze({ tableName: 'vnext_sessions', triggerName: 'vnext_sessions_parent_state_match', functionSchema: 'vnext_control_plane', functionName: 'vnext_sessions_parent_state_match', enabled: 'O', definition: 'CREATE TRIGGER vnext_sessions_parent_state_match BEFORE INSERT ON vnext_control_plane.vnext_sessions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_sessions_parent_state_match()' }),
  Object.freeze({ tableName: 'vnext_trust_root_evidence', triggerName: 'vnext_trust_root_evidence_insert_guard', functionSchema: 'vnext_control_plane', functionName: 'vnext_trust_root_evidence_insert_guard', enabled: 'O', definition: 'CREATE TRIGGER vnext_trust_root_evidence_insert_guard BEFORE INSERT ON vnext_control_plane.vnext_trust_root_evidence FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_trust_root_evidence_insert_guard()' }),
  Object.freeze({ tableName: 'vnext_trust_root_evidence', triggerName: 'vnext_trust_root_evidence_no_delete', functionSchema: 'vnext_control_plane', functionName: 'vnext_trust_root_evidence_no_delete', enabled: 'O', definition: 'CREATE TRIGGER vnext_trust_root_evidence_no_delete BEFORE DELETE ON vnext_control_plane.vnext_trust_root_evidence FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_trust_root_evidence_no_delete()' }),
  Object.freeze({ tableName: 'vnext_trust_root_evidence', triggerName: 'vnext_trust_root_evidence_no_update', functionSchema: 'vnext_control_plane', functionName: 'vnext_trust_root_evidence_no_update', enabled: 'O', definition: 'CREATE TRIGGER vnext_trust_root_evidence_no_update BEFORE UPDATE ON vnext_control_plane.vnext_trust_root_evidence FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_trust_root_evidence_no_update()' }),
]);

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalidHandle() {
  return codedError('VNEXT_PG17_HANDLE_INVALID', 'vNext PG17 disposable handle is invalid');
}

function schemaDrift() {
  return codedError('VNEXT_PG17_SCHEMA_DRIFT', 'vNext PG17 target catalog differs from its immutable manifest');
}

function inputInvalid() {
  return codedError('VNEXT_PG17_MIGRATION_INPUT_INVALID', 'vNext PG17 migration input is invalid');
}

function snapshotApplyInput(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw inputInvalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('appliedAt') || !keys.includes('appliedBy')) throw inputInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw inputInvalid();
  }
  const { appliedAt, appliedBy } = value;
  if (typeof appliedAt !== 'string' || new Date(appliedAt).toISOString() !== appliedAt
    || typeof appliedBy !== 'string' || appliedBy.trim() === '') throw inputInvalid();
  return Object.freeze({ appliedAt, appliedBy });
}

function createVNextPg17CatalogBoundary(runtime) {
  if (!runtime || typeof runtime !== 'object' || types.isProxy(runtime)) throw invalidHandle();
  const verifierFacadeQueries = new WeakMap();

  async function apply(handle, input) {
    if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
    const snapshot = snapshotApplyInput(input);
    return withVNextPg17SyntheticQuery(handle, 'migrator', async facade => {
      try {
        await facade.query('BEGIN');
        await facade.query("SET LOCAL TIME ZONE 'UTC'");
        await facade.query('SELECT pg_advisory_xact_lock(73017, 1)');
        await facade.query('SET LOCAL ROLE vnext_pg17_owner');
        const existing = await facade.query(
          "SELECT to_regclass('vnext_control_plane.vnext_schema_migrations') AS relation, to_regclass('public.vnext_schema_migrations') AS public_shadow",
        );
        const publicShadows = await facade.query(
          "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind <> 'i' AND c.relname = ANY($1::text[])",
          [TARGET_RELATION_NAMES],
        );
        if (existing.rows[0].public_shadow !== null || publicShadows.rows.length !== 0) throw schemaDrift();
        if (existing.rows[0].relation !== null) {
          const ledger = await facade.query(
            'SELECT migration_id, semantic_version, manifest_sha256 FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version',
          );
          const hasExactLedger = migrations => ledger.rows.length === migrations.length
            && ledger.rows.every((row, index) => row.migration_id === migrations[index].migrationId
              && String(row.semantic_version) === String(migrations[index].semanticVersion)
              && row.manifest_sha256 === migrations[index].manifestSha256);
          if (hasExactLedger(MIGRATIONS)) {
            await facade.query('COMMIT');
            await assertCatalog(handle);
            return Object.freeze({ applied: false });
          }
          if (!hasExactLedger(MIGRATIONS.slice(0, -1))) throw schemaDrift();
          for (const migration of MIGRATIONS.slice(-1)) {
            await facade.query(migration.sql);
            if (migration.postApply) {
              await facade.query(migration.postApply.text, migration.postApply.values(snapshot.appliedAt));
            }
            await facade.query(
              'INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
              [migration.migrationId, migration.semanticVersion, migration.manifestSha256, snapshot.appliedAt, snapshot.appliedBy],
            );
          }
          await assertQueryFacade(createVerifierQueryFacade((text, values) => facade.query(text, values)));
          await facade.query('COMMIT');
          await assertCatalog(handle);
          return Object.freeze({ applied: true });
        }
        for (const migration of MIGRATIONS) {
          await facade.query(migration.sql);
          if (migration.postApply) {
            await facade.query(migration.postApply.text, migration.postApply.values(snapshot.appliedAt));
          }
          await facade.query(
            'INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
            [migration.migrationId, migration.semanticVersion, migration.manifestSha256, snapshot.appliedAt, snapshot.appliedBy],
          );
        }
        await facade.query('GRANT USAGE ON SCHEMA vnext_control_plane TO vnext_pg17_writer');
        await facade.query(`GRANT SELECT ON ${WRITER_TABLE_NAMES.map(name => `vnext_control_plane.${name}`).join(', ')} TO vnext_pg17_writer`);
        await assertQueryFacade(createVerifierQueryFacade((text, values) => facade.query(text, values)));
        await facade.query('COMMIT');
        await assertCatalog(handle);
        return Object.freeze({ applied: true });
      } catch (error) {
        try { await facade.query('ROLLBACK'); } catch (_) { /* no-op */ }
        if (error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT') throw error;
        throw schemaDrift();
      }
    });
  }

  async function assertQueryFacade(verifierFacade) {
    const query = verifierFacadeQueries.get(verifierFacade);
    if (typeof query !== 'function') throw invalidHandle();
    const facade = Object.freeze({ query });
    try {
        const relation = await facade.query(
          "SELECT to_regclass('vnext_control_plane.vnext_schema_migrations') AS relation, to_regclass('public.vnext_schema_migrations') AS public_shadow",
        );
        const publicShadows = await facade.query(
          "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind <> 'i' AND c.relname = ANY($1::text[])",
          [TARGET_RELATION_NAMES],
        );
        if (relation.rows[0].relation !== 'vnext_control_plane.vnext_schema_migrations'
          || relation.rows[0].public_shadow !== null || publicShadows.rows.length !== 0) throw schemaDrift();
        const databaseOwnership = await facade.query(
          'SELECT r.rolname AS database_owner FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE d.datname = current_database()',
        );
        if (databaseOwnership.rows.length !== 1
          || databaseOwnership.rows[0].database_owner !== expectedCatalog.owners.database) throw schemaDrift();
        const ownership = await facade.query(
          "SELECT schema_owner.rolname AS schema_owner, table_owner.rolname AS table_owner FROM pg_namespace n JOIN pg_roles schema_owner ON schema_owner.oid = n.nspowner JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = 'vnext_schema_migrations' JOIN pg_roles table_owner ON table_owner.oid = c.relowner WHERE n.nspname = 'vnext_control_plane' AND c.relkind = 'r'",
        );
        if (ownership.rows.length !== 1
          || ownership.rows[0].schema_owner !== expectedCatalog.owners.schema
          || ownership.rows[0].table_owner !== expectedCatalog.owners.table) throw schemaDrift();
        const relations = await facade.query(
          "SELECT n.nspname || '.' || c.relname AS relation FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'vnext_control_plane' AND c.relkind <> 'i' ORDER BY c.relname",
        );
        if (relations.rows.length !== expectedCatalog.relations.length
          || relations.rows.some((row, index) => row.relation !== expectedCatalog.relations[index])) throw schemaDrift();
        const foundationOwners = await facade.query(
          "SELECT c.relname AS table_name, r.rolname AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner WHERE n.nspname = 'vnext_control_plane' AND c.relname = ANY($1::text[]) AND c.relkind = 'r' ORDER BY c.relname",
          [FOUNDATION_TABLE_NAMES],
        );
        if (foundationOwners.rows.length !== FOUNDATION_TABLE_NAMES.length
          || foundationOwners.rows.some(row => row.owner !== 'vnext_pg17_owner')) throw schemaDrift();
        const foundationColumns = await facade.query(
          "SELECT table_name, column_name, data_type, udt_name, is_nullable, collation_name, column_default FROM information_schema.columns WHERE table_schema = 'vnext_control_plane' AND table_name = ANY($1::text[]) ORDER BY table_name, ordinal_position",
          [FOUNDATION_TABLE_NAMES],
        );
        let foundationOffset = 0;
        for (const tableName of FOUNDATION_TABLE_NAMES) {
          const expectedColumns = FOUNDATION_COLUMNS[tableName];
          const actualColumns = foundationColumns.rows.slice(foundationOffset, foundationOffset + expectedColumns.length);
          foundationOffset += expectedColumns.length;
          if (actualColumns.length !== expectedColumns.length
            || actualColumns.some((row, index) => row.table_name !== tableName
              || row.column_name !== expectedColumns[index].name
              || row.data_type !== expectedColumns[index].dataType
              || row.udt_name !== expectedColumns[index].udtName
              || row.is_nullable !== expectedColumns[index].nullable
              || row.collation_name !== expectedColumns[index].collation
              || row.column_default !== null)) throw schemaDrift();
        }
        if (foundationOffset !== foundationColumns.rows.length) throw schemaDrift();
        const onlineColumns = await facade.query(
          "SELECT table_name, column_name, data_type, udt_name, is_nullable, collation_name, column_default FROM information_schema.columns WHERE table_schema = 'vnext_control_plane' AND table_name = ANY($1::text[]) ORDER BY table_name, ordinal_position",
          [ONLINE_IDENTITY_TABLE_NAMES],
        );
        let onlineOffset = 0;
        for (const tableName of ONLINE_IDENTITY_TABLE_NAMES) {
          const expectedColumns = ONLINE_IDENTITY_COLUMNS_WITH_VERSIONS[tableName];
          const actualColumns = onlineColumns.rows.slice(onlineOffset, onlineOffset + expectedColumns.length);
          onlineOffset += expectedColumns.length;
          if (actualColumns.length !== expectedColumns.length
            || actualColumns.some((row, index) => row.table_name !== tableName
              || row.column_name !== expectedColumns[index].name
              || row.data_type !== expectedColumns[index].dataType
              || row.udt_name !== expectedColumns[index].udtName
              || row.is_nullable !== expectedColumns[index].nullable
              || row.collation_name !== expectedColumns[index].collation
              || row.column_default !== null)) throw schemaDrift();
        }
        if (onlineOffset !== onlineColumns.rows.length) throw schemaDrift();
        const passwordCredentialOwners = await facade.query(
          "SELECT c.relname AS table_name, r.rolname AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner WHERE n.nspname = 'vnext_control_plane' AND c.relname = 'vnext_desktop_password_credentials' AND c.relkind = 'r'",
        );
        if (passwordCredentialOwners.rows.length !== 1 || passwordCredentialOwners.rows[0].owner !== 'vnext_pg17_owner') throw schemaDrift();
        const passwordCredentialColumns = await facade.query(
          "SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type, t.typname AS udt_name, CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable, coll.collname AS collation_name, pg_get_expr(d.adbin, d.adrelid) AS column_default FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_type t ON t.oid = a.atttypid LEFT JOIN pg_collation coll ON coll.oid = a.attcollation LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE n.nspname = 'vnext_control_plane' AND c.relname = 'vnext_desktop_password_credentials' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
        );
        if (passwordCredentialColumns.rows.length !== PASSWORD_CREDENTIAL_COLUMNS.length
          || passwordCredentialColumns.rows.some((row, index) => row.column_name !== PASSWORD_CREDENTIAL_COLUMNS[index].name
            || row.data_type !== PASSWORD_CREDENTIAL_COLUMNS[index].dataType
            || row.udt_name !== PASSWORD_CREDENTIAL_COLUMNS[index].udtName
            || row.is_nullable !== PASSWORD_CREDENTIAL_COLUMNS[index].nullable
            || row.collation_name !== PASSWORD_CREDENTIAL_COLUMNS[index].collation
            || row.column_default !== null)) throw schemaDrift();
        const passwordCredentialConstraints = await facade.query(
          "SELECT con.conname, con.contype, pg_get_constraintdef(con.oid, true) AS definition FROM pg_constraint con WHERE con.conrelid = 'vnext_control_plane.vnext_desktop_password_credentials'::regclass ORDER BY con.conname",
        );
        if (passwordCredentialConstraints.rows.length !== PASSWORD_CREDENTIAL_CONSTRAINTS.length
          || passwordCredentialConstraints.rows.some((row, index) => row.conname !== PASSWORD_CREDENTIAL_CONSTRAINTS[index].name
            || row.contype !== PASSWORD_CREDENTIAL_CONSTRAINTS[index].type
            || row.definition !== PASSWORD_CREDENTIAL_CONSTRAINTS[index].definition)) throw schemaDrift();
        const passwordCredentialColumnPrivileges = await facade.query(
          "SELECT a.attname AS column_name, has_column_privilege('vnext_pg17_verifier', c.oid, a.attname, 'SELECT') AS verifier_select, has_column_privilege('vnext_pg17_verifier', c.oid, a.attname, 'INSERT') AS verifier_insert, has_column_privilege('vnext_pg17_verifier', c.oid, a.attname, 'UPDATE') AS verifier_update, has_column_privilege('vnext_pg17_verifier', c.oid, a.attname, 'REFERENCES') AS verifier_references, has_column_privilege('vnext_pg17_writer', c.oid, a.attname, 'SELECT') AS writer_select, has_column_privilege('vnext_pg17_writer', c.oid, a.attname, 'INSERT') AS writer_insert, has_column_privilege('vnext_pg17_writer', c.oid, a.attname, 'UPDATE') AS writer_update, has_column_privilege('vnext_pg17_writer', c.oid, a.attname, 'REFERENCES') AS writer_references, has_column_privilege('vnext_pg17_identity_verifier', c.oid, a.attname, 'SELECT') AS identity_select, has_column_privilege('vnext_pg17_identity_verifier', c.oid, a.attname, 'INSERT') AS identity_insert, has_column_privilege('vnext_pg17_identity_verifier', c.oid, a.attname, 'UPDATE') AS identity_update, has_column_privilege('vnext_pg17_identity_verifier', c.oid, a.attname, 'REFERENCES') AS identity_references, has_column_privilege('vnext_pg17_runtime', c.oid, a.attname, 'SELECT') AS runtime_select, has_column_privilege('vnext_pg17_runtime', c.oid, a.attname, 'INSERT') AS runtime_insert, has_column_privilege('vnext_pg17_runtime', c.oid, a.attname, 'UPDATE') AS runtime_update, has_column_privilege('vnext_pg17_runtime', c.oid, a.attname, 'REFERENCES') AS runtime_references FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'vnext_control_plane' AND c.relname = 'vnext_desktop_password_credentials' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
        );
        if (passwordCredentialColumnPrivileges.rows.length !== PASSWORD_CREDENTIAL_COLUMNS.length
          || passwordCredentialColumnPrivileges.rows.some((row, index) => row.column_name !== PASSWORD_CREDENTIAL_COLUMNS[index].name
            || row.verifier_select || row.verifier_insert || row.verifier_update || row.verifier_references
            || row.writer_select || row.writer_insert || row.writer_update || row.writer_references
            || row.identity_select || row.identity_insert || row.identity_update || row.identity_references
            || row.runtime_select || row.runtime_insert || row.runtime_update || row.runtime_references)) throw schemaDrift();
        const onlineConstraints = await facade.query(
          "SELECT c.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid, true) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'vnext_control_plane' AND c.relname = ANY($1::text[]) ORDER BY c.relname, con.conname",
          [ONLINE_IDENTITY_TABLE_NAMES],
        );
        for (const [tableName, expected] of Object.entries(ONLINE_IDENTITY_CONSTRAINTS)) {
          const actual = onlineConstraints.rows.filter(row => row.table_name === tableName);
          if (actual.length !== expected.count || expected.required.some(name => !actual.some(row => row.conname === name))) throw schemaDrift();
        }
        const foundationConstraints = await facade.query(
          "SELECT c.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid, true) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'vnext_control_plane' AND c.relname = ANY($1::text[]) ORDER BY c.relname, con.conname",
          [FOUNDATION_TABLE_NAMES],
        );
        if (sha256(JSON.stringify(foundationConstraints.rows)) !== FOUNDATION_CONSTRAINT_CATALOG_SHA256) throw schemaDrift();
        for (const [tableName, expected] of Object.entries(FOUNDATION_CONSTRAINTS)) {
          const actualConstraints = foundationConstraints.rows.filter(row => row.table_name === tableName);
          if (actualConstraints.length !== expected.count
            || expected.required.some(name => !actualConstraints.some(row => row.conname === name))) throw schemaDrift();
        }
        for (const [constraintName, definition] of Object.entries(FOUNDATION_CONSTRAINT_DEFINITIONS)) {
          const constraint = foundationConstraints.rows.find(row => row.conname === constraintName);
          if (!constraint || constraint.definition !== definition) throw schemaDrift();
        }
        const foundationIndexes = await facade.query(
          "SELECT table_relation.relname AS table_name, index_relation.relname AS index_name, i.indisprimary, i.indisunique, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class table_relation ON table_relation.oid = i.indrelid JOIN pg_class index_relation ON index_relation.oid = i.indexrelid JOIN pg_namespace n ON n.oid = table_relation.relnamespace WHERE n.nspname = 'vnext_control_plane' AND table_relation.relname = ANY($1::text[]) ORDER BY table_relation.relname, index_relation.relname",
          [FOUNDATION_TABLE_NAMES],
        );
        if (sha256(JSON.stringify(foundationIndexes.rows)) !== FOUNDATION_INDEX_CATALOG_SHA256) throw schemaDrift();
        for (const [indexName, definition] of Object.entries(FOUNDATION_INDEX_DEFINITIONS)) {
          const index = foundationIndexes.rows.find(row => row.index_name === indexName);
          if (!index || index.definition !== definition || !index.indisunique || index.indisprimary) throw schemaDrift();
        }
        const columns = await facade.query(
          "SELECT column_name, data_type, udt_name, is_nullable, collation_name, column_default FROM information_schema.columns WHERE table_schema = 'vnext_control_plane' AND table_name = 'vnext_schema_migrations' ORDER BY ordinal_position",
        );
        if (columns.rows.length !== LEDGER_COLUMNS.length
          || columns.rows.some((row, index) => row.column_name !== LEDGER_COLUMNS[index].name
            || row.data_type !== LEDGER_COLUMNS[index].dataType
            || row.udt_name !== LEDGER_COLUMNS[index].udtName
            || row.is_nullable !== LEDGER_COLUMNS[index].nullable
            || row.collation_name !== LEDGER_COLUMNS[index].collation
            || row.column_default !== null)) throw schemaDrift();
        const constraints = await facade.query(
          "SELECT conname, contype, pg_get_constraintdef(oid, true) AS definition FROM pg_constraint WHERE conrelid = 'vnext_control_plane.vnext_schema_migrations'::regclass ORDER BY conname",
        );
        if (constraints.rows.length !== LEDGER_CONSTRAINTS.length
          || constraints.rows.some((row, index) => row.conname !== LEDGER_CONSTRAINTS[index].name
            || row.contype !== LEDGER_CONSTRAINTS[index].type
            || row.definition !== LEDGER_CONSTRAINTS[index].definition)) throw schemaDrift();
        const indexes = await facade.query(
          "SELECT index_relation.relname AS index_name, i.indisprimary, i.indisunique FROM pg_index i JOIN pg_class index_relation ON index_relation.oid = i.indexrelid WHERE i.indrelid = 'vnext_control_plane.vnext_schema_migrations'::regclass ORDER BY index_relation.relname",
        );
        if (indexes.rows.length !== LEDGER_INDEXES.length
          || indexes.rows.some((row, index) => row.index_name !== LEDGER_INDEXES[index].name
            || row.indisprimary !== LEDGER_INDEXES[index].primary
            || row.indisunique !== LEDGER_INDEXES[index].unique)) throw schemaDrift();
        const triggers = await facade.query(
          "SELECT c.relname AS table_name, t.tgname AS trigger_name, function_namespace.nspname AS function_schema, p.proname AS function_name, t.tgenabled, pg_get_triggerdef(t.oid, true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace function_namespace ON function_namespace.oid = p.pronamespace WHERE n.nspname = 'vnext_control_plane' AND c.relname = ANY($1::text[]) AND NOT t.tgisinternal ORDER BY c.relname, t.tgname",
          [TARGET_TABLE_NAMES],
        );
        const expectedTriggers = [...TARGET_TRIGGERS].sort((left, right) => `${left.tableName}:${left.triggerName}`.localeCompare(`${right.tableName}:${right.triggerName}`));
        if (triggers.rows.length !== expectedTriggers.length
          || triggers.rows.some((row, index) => row.table_name !== expectedTriggers[index].tableName
            || row.trigger_name !== expectedTriggers[index].triggerName
            || row.function_schema !== expectedTriggers[index].functionSchema
            || row.function_name !== expectedTriggers[index].functionName
            || row.tgenabled !== expectedTriggers[index].enabled
            || row.definition !== expectedTriggers[index].definition)) {
          throw schemaDrift();
        }
        const roles = await facade.query(
          "SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname IN ('vnext_pg17_migrator', 'vnext_pg17_owner', 'vnext_pg17_runtime', 'vnext_pg17_verifier', 'vnext_pg17_writer', 'vnext_pg17_identity_verifier') ORDER BY rolname",
        );
        if (roles.rows.length !== SYNTHETIC_ROLES.length
          || roles.rows.some((row, index) => row.rolname !== SYNTHETIC_ROLES[index].name
            || row.rolcanlogin !== SYNTHETIC_ROLES[index].canLogin
            || row.rolinherit !== SYNTHETIC_ROLES[index].inherit
            || row.rolsuper !== SYNTHETIC_ROLES[index].superuser
            || row.rolcreaterole !== SYNTHETIC_ROLES[index].createRole
            || row.rolcreatedb !== SYNTHETIC_ROLES[index].createDb
            || row.rolreplication !== SYNTHETIC_ROLES[index].replication
            || row.rolbypassrls !== SYNTHETIC_ROLES[index].bypassRls)) throw schemaDrift();
        const memberships = await facade.query(
          "SELECT member_role.rolname AS member, granted_role.rolname AS role, m.admin_option, m.inherit_option, m.set_option FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid = m.member JOIN pg_roles granted_role ON granted_role.oid = m.roleid WHERE member_role.rolname IN ('vnext_pg17_migrator', 'vnext_pg17_owner', 'vnext_pg17_runtime', 'vnext_pg17_verifier', 'vnext_pg17_writer', 'vnext_pg17_identity_verifier') ORDER BY member_role.rolname, granted_role.rolname",
        );
        if (memberships.rows.length !== SYNTHETIC_MEMBERSHIPS.length
          || memberships.rows.some((row, index) => row.member !== SYNTHETIC_MEMBERSHIPS[index].member
            || row.role !== SYNTHETIC_MEMBERSHIPS[index].role
            || row.admin_option !== SYNTHETIC_MEMBERSHIPS[index].admin
            || row.inherit_option !== SYNTHETIC_MEMBERSHIPS[index].inherit
            || row.set_option !== SYNTHETIC_MEMBERSHIPS[index].set)) throw schemaDrift();
        const privileges = await facade.query(
          "SELECT has_schema_privilege('vnext_pg17_verifier', 'vnext_control_plane', 'USAGE') AS schema_usage, has_schema_privilege('vnext_pg17_verifier', 'vnext_control_plane', 'CREATE') AS verifier_schema_create, has_schema_privilege('vnext_pg17_verifier', 'public', 'CREATE') AS verifier_public_create, has_database_privilege('vnext_pg17_verifier', current_database(), 'CREATE') AS verifier_database_create, has_database_privilege('vnext_pg17_verifier', current_database(), 'TEMPORARY') AS verifier_temporary, has_schema_privilege('vnext_pg17_runtime', 'vnext_control_plane', 'USAGE') AS runtime_schema_usage, has_schema_privilege('vnext_pg17_runtime', 'vnext_control_plane', 'CREATE') AS runtime_schema_create, has_schema_privilege('vnext_pg17_runtime', 'public', 'CREATE') AS runtime_public_create, has_database_privilege('vnext_pg17_runtime', current_database(), 'CREATE') AS runtime_database_create, has_database_privilege('vnext_pg17_runtime', current_database(), 'TEMPORARY') AS runtime_temporary, has_schema_privilege('vnext_pg17_identity_verifier', 'vnext_control_plane', 'USAGE') AS identity_schema_usage, has_schema_privilege('vnext_pg17_identity_verifier', 'vnext_control_plane', 'CREATE') AS identity_schema_create, has_schema_privilege('vnext_pg17_identity_verifier', 'public', 'CREATE') AS identity_public_create, has_database_privilege('vnext_pg17_identity_verifier', current_database(), 'CREATE') AS identity_database_create, has_database_privilege('vnext_pg17_identity_verifier', current_database(), 'TEMPORARY') AS identity_temporary",
        );
        const privilege = privileges.rows[0];
        if (!privilege.schema_usage || privilege.verifier_schema_create || privilege.verifier_public_create
          || privilege.verifier_database_create || privilege.verifier_temporary || privilege.runtime_schema_usage
          || privilege.runtime_schema_create || privilege.runtime_public_create
          || privilege.runtime_database_create || privilege.runtime_temporary
          || !privilege.identity_schema_usage || privilege.identity_schema_create || privilege.identity_public_create
          || privilege.identity_database_create || privilege.identity_temporary) {
          throw schemaDrift();
        }
        const writerPrivileges = await facade.query(
          "SELECT has_schema_privilege('vnext_pg17_writer', 'vnext_control_plane', 'USAGE') AS schema_usage, has_schema_privilege('vnext_pg17_writer', 'vnext_control_plane', 'CREATE') AS schema_create, has_schema_privilege('vnext_pg17_writer', 'public', 'CREATE') AS public_create, has_database_privilege('vnext_pg17_writer', current_database(), 'CREATE') AS database_create, has_database_privilege('vnext_pg17_writer', current_database(), 'TEMPORARY') AS temporary",
        );
        const writerPrivilege = writerPrivileges.rows[0];
        if (!writerPrivilege.schema_usage || writerPrivilege.schema_create || writerPrivilege.public_create
          || writerPrivilege.database_create || writerPrivilege.temporary) throw schemaDrift();
        const writerDefaultAcl = await facade.query(
          "SELECT COUNT(*)::text AS count FROM pg_default_acl WHERE defaclrole = 'vnext_pg17_owner'::regrole",
        );
        if (writerDefaultAcl.rows.length !== 1 || writerDefaultAcl.rows[0].count !== '0') throw schemaDrift();
        const targetPrivileges = await facade.query(
          "SELECT c.relname AS table_name, has_table_privilege('vnext_pg17_verifier', c.oid, 'SELECT') AS verifier_select, has_table_privilege('vnext_pg17_verifier', c.oid, 'INSERT') AS verifier_insert, has_table_privilege('vnext_pg17_verifier', c.oid, 'UPDATE') AS verifier_update, has_table_privilege('vnext_pg17_verifier', c.oid, 'DELETE') AS verifier_delete, has_table_privilege('vnext_pg17_verifier', c.oid, 'TRUNCATE') AS verifier_truncate, has_table_privilege('vnext_pg17_verifier', c.oid, 'REFERENCES') AS verifier_references, has_table_privilege('vnext_pg17_verifier', c.oid, 'TRIGGER') AS verifier_trigger, has_table_privilege('vnext_pg17_writer', c.oid, 'SELECT') AS writer_select, has_table_privilege('vnext_pg17_writer', c.oid, 'INSERT') AS writer_insert, has_table_privilege('vnext_pg17_writer', c.oid, 'UPDATE') AS writer_update, has_table_privilege('vnext_pg17_writer', c.oid, 'DELETE') AS writer_delete, has_table_privilege('vnext_pg17_writer', c.oid, 'TRUNCATE') AS writer_truncate, has_table_privilege('vnext_pg17_writer', c.oid, 'REFERENCES') AS writer_references, has_table_privilege('vnext_pg17_writer', c.oid, 'TRIGGER') AS writer_trigger, has_table_privilege('vnext_pg17_identity_verifier', c.oid, 'SELECT') AS identity_select, has_table_privilege('vnext_pg17_identity_verifier', c.oid, 'INSERT') AS identity_insert, has_table_privilege('vnext_pg17_identity_verifier', c.oid, 'UPDATE') AS identity_update, has_table_privilege('vnext_pg17_identity_verifier', c.oid, 'DELETE') AS identity_delete, has_table_privilege('vnext_pg17_identity_verifier', c.oid, 'TRUNCATE') AS identity_truncate, has_table_privilege('vnext_pg17_identity_verifier', c.oid, 'REFERENCES') AS identity_references, has_table_privilege('vnext_pg17_identity_verifier', c.oid, 'TRIGGER') AS identity_trigger, has_table_privilege('vnext_pg17_runtime', c.oid, 'SELECT') AS runtime_select, has_table_privilege('vnext_pg17_runtime', c.oid, 'INSERT') AS runtime_insert, has_table_privilege('vnext_pg17_runtime', c.oid, 'UPDATE') AS runtime_update, has_table_privilege('vnext_pg17_runtime', c.oid, 'DELETE') AS runtime_delete, has_table_privilege('vnext_pg17_runtime', c.oid, 'TRUNCATE') AS runtime_truncate, has_table_privilege('vnext_pg17_runtime', c.oid, 'REFERENCES') AS runtime_references, has_table_privilege('vnext_pg17_runtime', c.oid, 'TRIGGER') AS runtime_trigger FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'vnext_control_plane' AND c.relname = ANY($1::text[]) ORDER BY c.relname",
          [TARGET_TABLE_NAMES],
        );
        if (targetPrivileges.rows.length !== TARGET_TABLE_NAMES.length
          || targetPrivileges.rows.some((row, index) => row.table_name !== TARGET_TABLE_NAMES[index]
            || row.verifier_select !== VERIFIER_TABLE_NAMES.includes(row.table_name) || row.verifier_insert || row.verifier_update || row.verifier_delete
            || row.verifier_truncate || row.verifier_references || row.verifier_trigger
            || row.writer_select !== WRITER_TABLE_NAMES.includes(row.table_name) || row.writer_insert || row.writer_update || row.writer_delete
            || row.writer_truncate || row.writer_references || row.writer_trigger
            || row.identity_select || row.identity_insert || row.identity_update || row.identity_delete || row.identity_truncate || row.identity_references || row.identity_trigger
            || row.runtime_select || row.runtime_insert || row.runtime_update || row.runtime_delete
            || row.runtime_truncate || row.runtime_references || row.runtime_trigger)) throw schemaDrift();
        const functions = await facade.query(
          "SELECT p.proname, p.prokind, pg_get_function_identity_arguments(p.oid) AS arguments, r.rolname AS owner, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) AS definition, EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS public_execute, has_function_privilege('vnext_pg17_runtime', p.oid, 'EXECUTE') AS runtime_execute, has_function_privilege('vnext_pg17_verifier', p.oid, 'EXECUTE') AS verifier_execute, has_function_privilege('vnext_pg17_writer', p.oid, 'EXECUTE') AS writer_execute, has_function_privilege('vnext_pg17_identity_verifier', p.oid, 'EXECUTE') AS identity_verifier_execute FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner WHERE n.nspname = 'vnext_control_plane' ORDER BY p.proname",
        );
        if (functions.rows.length !== LEDGER_FUNCTIONS.length
          || functions.rows.some((row, index) => row.proname !== LEDGER_FUNCTIONS[index]
            || row.prokind !== 'f' || row.owner !== 'vnext_pg17_owner' || !row.prosecdef
            || !Array.isArray(row.proconfig) || row.proconfig.length !== 1
            || row.proconfig[0] !== 'search_path=pg_catalog, pg_temp'
            || row.public_execute || row.runtime_execute || row.verifier_execute
            || row.writer_execute !== (row.proname === 'vnext_register_unified_desktop_online')
            || row.identity_verifier_execute !== (row.proname === 'vnext_issue_online_identity_assertion' || row.proname === 'vnext_provision_canonical_phone_account' || row.proname === 'vnext_bind_canonical_wechat_identity' || row.proname === 'vnext_read_canonical_account_by_verified_contact' || row.proname === 'vnext_set_desktop_password_credential' || row.proname === 'vnext_read_desktop_password_by_phone_hash' || row.proname === 'vnext_read_desktop_password_by_login_name')
            || row.arguments !== (COMMAND_FUNCTION_ARGUMENTS[row.proname] || '')
            || sha256(row.definition) !== expectedCatalog.functionDefinitionSha256[row.proname])) throw schemaDrift();
        const ledger = await facade.query(
          'SELECT migration_id, semantic_version, manifest_sha256 FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version',
        );
        if (ledger.rows.length !== MIGRATIONS.length
          || ledger.rows.some((row, index) => row.migration_id !== MIGRATIONS[index].migrationId
            || String(row.semantic_version) !== String(MIGRATIONS[index].semanticVersion)
            || row.manifest_sha256 !== MIGRATIONS[index].manifestSha256)) throw schemaDrift();
        const schemaMeta = await facade.query(
          "SELECT m.schema_key, m.schema_version::text AS schema_version, m.applied_at = (SELECT applied_at FROM vnext_control_plane.vnext_schema_migrations WHERE semantic_version = 2) AS applied_at_matches FROM vnext_control_plane.vnext_schema_meta m ORDER BY m.schema_key",
        );
        if (schemaMeta.rows.length !== 1
          || schemaMeta.rows[0].schema_key !== 'control-plane-reference'
          || schemaMeta.rows[0].schema_version !== '5'
          || !schemaMeta.rows[0].applied_at_matches) throw schemaDrift();
      return Object.freeze({ asserted: true });
    } catch (error) {
      if (error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT') throw error;
      throw schemaDrift();
    }
  }

  function createVerifierQueryFacade(query) {
    if (typeof query !== 'function' || types.isProxy(query)) throw invalidHandle();
    const facade = Object.freeze({});
    verifierFacadeQueries.set(facade, query);
    return facade;
  }

  async function assertCatalog(handle) {
    if (!isVNextPg17DisposableHandleForRuntime(runtime, handle)) throw invalidHandle();
    return withVNextPg17SyntheticQuery(handle, 'verifier', facade =>
      assertQueryFacade(createVerifierQueryFacade((text, values) => facade.query(text, values))));
  }

  return Object.freeze({ apply, assert: assertCatalog, assertQueryFacade, createVerifierQueryFacade });
}

module.exports = { createVNextPg17CatalogBoundary };
