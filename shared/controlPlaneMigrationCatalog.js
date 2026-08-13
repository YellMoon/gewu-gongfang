'use strict';

const CATALOG_SCHEMA_VERSION = 1;
const CATALOG_MODE = 'control-plane-catalog-only';
const TABLE_RULES = Object.freeze({
  users: {
    disposition: 'candidate_evidence',
    required: ['id', 'status', 'identity_kind', 'auth_version'],
    admitted: ['id', 'wechat_openid', 'wechat_unionid', 'status', 'login_enabled', 'identity_kind', 'auth_version', 'disabled_at', 'review_status', 'reviewed_by', 'reviewed_at', 'is_super_admin_identity', 'deleted', 'created_at', 'updated_at'],
  },
  user_role_grants: {
    disposition: 'restricted_legacy_grant_evidence',
    required: ['user_id', 'role', 'status', 'source'],
    admitted: ['user_id', 'role', 'subject_type', 'subject_id', 'status', 'source', 'granted_by', 'created_at', 'updated_at', 'revoked_at'],
  },
  authority_accounts: {
    disposition: 'candidate_evidence',
    required: ['user_id', 'authority_id', 'status'],
    admitted: ['user_id', 'authority_id', 'status', 'created_at', 'updated_at'],
  },
  authority_role_bindings: {
    disposition: 'candidate_evidence',
    required: ['binding_id', 'authority_id', 'user_id', 'role', 'status'],
    admitted: ['binding_id', 'authority_id', 'user_id', 'role', 'subject_type', 'subject_id', 'status', 'grant_version', 'granted_by', 'created_at', 'updated_at', 'revoked_at'],
  },
  teachers: { disposition: 'profile_reference_only', required: ['id'], admitted: ['id'] },
  students: { disposition: 'profile_reference_only', required: ['id'], admitted: ['id'] },
  desktop_device_authorizations: {
    disposition: 'archived_reauthentication_required',
    required: ['id', 'device_id', 'user_id', 'public_key', 'key_fingerprint', 'status', 'credential_version'],
    admitted: ['id', 'device_id', 'user_id', 'public_key', 'key_fingerprint', 'status', 'credential_version', 'last_seen_at', 'revoked_at'],
  },
  desktop_sessions: {
    disposition: 'archived_inert_session_evidence',
    required: ['user_id', 'device_id', 'authorization_id', 'status', 'credential_version'],
    admitted: ['user_id', 'device_id', 'authorization_id', 'active_role', 'auth_version', 'credential_version', 'status', 'issued_at', 'expires_at', 'revoke_reason', 'revoked_at'],
  },
  authorization_audit_log: {
    disposition: 'candidate_audit_evidence',
    required: ['id', 'action', 'created_at'],
    admitted: ['id', 'actor_user_id', 'target_user_id', 'action', 'created_at'],
  },
  miniapp_login_events: {
    disposition: 'candidate_identity_event_evidence',
    required: ['id', 'result_code', 'created_at'],
    admitted: ['id', 'user_id', 'identity_kind', 'result_code', 'miniapp_version', 'platform', 'created_at'],
  },
});

const EXCLUDED_TABLES = Object.freeze(new Set([
  'desktop_identity_challenges', 'desktop_device_activations', 'desktop_device_session_challenges',
  'primary_host_operation_challenges', 'primary_host_epochs', 'host_commands', 'host_receipts',
  'host_heartbeats', 'authority_command_ledger', 'authority_command_receipts',
  'sync_authorizations', 'sync_conflicts', 'sync_rejections', 'outbox_events', 'desktop_sync_batch_backups',
]));

function catalogError(code) {
  return Object.assign(new Error(code), { code });
}

function normalizedColumns(table) {
  if (!table || typeof table !== 'object' || !Array.isArray(table.columns)) {
    throw catalogError('CONTROL_PLANE_CATALOG_INVENTORY_INVALID');
  }
  const values = table.columns.map(column => column && typeof column.name === 'string' ? column.name : null);
  if (values.some(value => !value) || new Set(values).size !== values.length) {
    throw catalogError('CONTROL_PLANE_CATALOG_INVENTORY_INVALID');
  }
  return values.sort();
}

function tableEntry(tableName, table) {
  const columns = normalizedColumns(table);
  const rule = Object.hasOwn(TABLE_RULES, tableName) ? TABLE_RULES[tableName] : null;
  if (!rule) {
    return Object.freeze({
      tableName,
      disposition: EXCLUDED_TABLES.has(tableName) ? 'intentionally_excluded' : 'intentionally_excluded',
      admittedColumns: Object.freeze([]),
      deniedColumns: Object.freeze(columns),
    });
  }
  const missingRequiredColumns = rule.required.filter(column => !columns.includes(column)).sort();
  if (missingRequiredColumns.length) {
    return Object.freeze({
      tableName,
      disposition: 'unresolved_schema_drift',
      admittedColumns: Object.freeze([]),
      deniedColumns: Object.freeze(columns),
      missingRequiredColumns: Object.freeze(missingRequiredColumns),
    });
  }
  const admitted = rule.admitted.filter(column => columns.includes(column)).sort();
  const denied = columns.filter(column => !admitted.includes(column)).sort();
  return Object.freeze({ tableName, disposition: rule.disposition, admittedColumns: Object.freeze(admitted), deniedColumns: Object.freeze(denied) });
}

function buildControlPlaneMigrationCatalog({ inventory } = {}) {
  if (!inventory || typeof inventory !== 'object' || !inventory.tables || typeof inventory.tables !== 'object' || Array.isArray(inventory.tables)) {
    throw catalogError('CONTROL_PLANE_CATALOG_INVENTORY_INVALID');
  }
  const tables = Object.keys(inventory.tables).sort().map(name => tableEntry(name, inventory.tables[name]));
  return Object.freeze({ schemaVersion: CATALOG_SCHEMA_VERSION, mode: CATALOG_MODE, tables: Object.freeze(tables) });
}

module.exports = { CATALOG_MODE, CATALOG_SCHEMA_VERSION, buildControlPlaneMigrationCatalog };
