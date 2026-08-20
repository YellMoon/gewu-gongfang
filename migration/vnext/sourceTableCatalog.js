'use strict';

const EXPECTED_SOURCE_TABLES = Object.freeze([
  'account_memberships', 'asset_accounts', 'authority_accounts', 'authority_command_ledger', 'authority_command_receipts',
  'authority_device_control_mirror_versions', 'authority_metadata', 'authority_migration_ledger', 'authority_projection_versions',
  'authority_role_applications', 'authority_role_bindings', 'authority_role_mirror_versions', 'authority_runtime_host_epochs',
  'authority_scoped_projections', 'authorization_audit_log', 'authorization_migrations', 'chapters', 'consumptions', 'courses',
  'data_archive_jobs', 'desktop_device_activations', 'desktop_device_authorizations', 'desktop_device_pairings',
  'desktop_device_session_challenges', 'desktop_identity_challenges', 'desktop_sessions', 'desktop_single_user_pairing_grants',
  'desktop_single_user_pairing_requests', 'desktop_sync_batch_backups', 'device_grants', 'device_leases', 'enrollments', 'grades',
  'host_commands', 'host_heartbeats', 'host_receipts', 'host_recovery_deliveries', 'host_recovery_factors', 'host_transfers',
  'identity_provisioning_receipts', 'import_batches', 'import_items', 'institutions', 'knowledge_point_rollups', 'knowledge_points',
  'miniapp_login_attempts', 'miniapp_login_events', 'miniapp_role_applications', 'miniapp_tasks', 'miniapp_wechat_binding_requests',
  'model_points', 'operation_audit_log', 'outbox_events', 'paper_artifacts', 'paper_completion_outbox', 'paper_jobs', 'payments',
  'personal_asset_categories', 'personal_asset_records', 'primary_host_epochs', 'primary_host_operation_challenges',
  'primary_host_preflight_proofs', 'question_assets', 'question_bank_delete_operations', 'question_bank_storage_audit',
  'question_bank_store_bindings', 'question_contents', 'question_knowledge_points', 'question_model_points',
  'question_taxonomy_nodes', 'questions', 'readonly_snapshots', 'relay_authorization_nonces', 'role_application_mirrors',
  'role_grant_mirrors', 'rooms', 'schedules', 'schema_migrations', 'schools', 'search_index_jobs', 'students', 'subjects',
  'sync_audit_log', 'sync_authorizations', 'sync_conflicts', 'sync_delivery_scope', 'sync_devices', 'sync_log',
  'sync_record_provenance', 'sync_rejections', 'taxonomy_deletion_backups', 'taxonomy_nodes', 'taxonomy_state',
  'taxonomy_systems', 'teachers', 'tenants', 'user_role_grants', 'users', 'vector_embeddings',
].sort());

const VALID_DISPOSITIONS = new Set(['canonical', 'archive', 'local_partition', 'rebuildable_cache', 'quarantine_only']);
const MAPPING_FIELDS = Object.freeze([
  'dependencyOrder',
  'fileReferenceFields',
  'invariants',
  'rollbackProof',
  'sourceFields',
  'stableIdStrategy',
  'targetEntity',
  'targetSchema',
  'transformerId',
].sort());

function catalogError(code) {
  return Object.assign(new Error(code), { code });
}

function add(entries, names, disposition, rationale, targetDomain = null) {
  for (const sourceTable of names) {
    entries[sourceTable] = Object.freeze({
      disposition,
      rationale,
      targetDomain,
      mappingState: disposition === 'canonical' ? 'unmapped' : null,
    });
  }
}

function fieldMapping({ targetEntity, dependencyOrder, transformerId, sourceFields, invariants }) {
  return Object.freeze({
    targetSchema: 'business',
    targetEntity,
    stableIdStrategy: 'preserve source primary-key text exactly',
    dependencyOrder,
    transformerId,
    sourceFields: Object.freeze({ ...sourceFields }),
    invariants: Object.freeze([...invariants].sort()),
    fileReferenceFields: Object.freeze([]),
    rollbackProof: 'delete only the verified shadow batch after source/target reconciliation',
  });
}

function admitMappedCanonical(entries, sourceTable, mapping) {
  const entry = entries[sourceTable];
  if (!entry || entry.disposition !== 'canonical') throw catalogError('MIGRATION_CATALOG_MAPPING_TARGET_INVALID');
  entries[sourceTable] = Object.freeze({ ...entry, mappingState: 'mapped', fieldMapping: mapping });
}

const APPROVED_MAPPED_CONTRACTS = Object.freeze({
  tenants: fieldMapping({
    targetEntity: 'tenants',
    dependencyOrder: 1,
    transformerId: 'legacy_tenant_v1',
    sourceFields: {
      archive_before: 'legacy_archive_before', created_at: 'created_at', deleted: 'legacy_deleted', id: 'id',
      name: 'name', plan: 'legacy_plan', status: 'legacy_status', updated_at: 'updated_at',
    },
    invariants: [
      'id is nonblank and stable',
      'legacy deleted flag is preserved without erasing the row',
      'timestamps parse as UTC or quarantine the row',
    ],
  }),
  institutions: fieldMapping({
    targetEntity: 'institutions',
    dependencyOrder: 2,
    transformerId: 'legacy_institution_v1',
    sourceFields: {
      contact_person: 'contact_person_legacy', contact_phone: 'contact_phone_legacy', created_at: 'created_at',
      deleted: 'legacy_deleted', id: 'id', name: 'name', notes: 'notes', revenue_share: 'revenue_share',
      tenant_id: 'tenant_id', updated_at: 'updated_at',
    },
    invariants: [
      'id is nonblank and stable',
      'tenant_id resolves to an admitted tenant or quarantines the row',
      'timestamps parse as UTC or quarantine the row',
    ],
  }),
  schools: fieldMapping({
    targetEntity: 'schools',
    dependencyOrder: 3,
    transformerId: 'legacy_school_v1',
    sourceFields: {
      count: 'legacy_count', created_at: 'created_at', deleted: 'legacy_deleted', id: 'id', name: 'name',
      tenant_id: 'tenant_id', updated_at: 'updated_at',
    },
    invariants: [
      'id is nonblank and stable',
      'legacy count is preserved without inferring its business meaning',
      'tenant_id resolves to an admitted tenant or quarantines the row',
    ],
  }),
  rooms: fieldMapping({
    targetEntity: 'rooms',
    dependencyOrder: 4,
    transformerId: 'legacy_room_v1',
    sourceFields: {
      address: 'address_legacy', count: 'legacy_count', created_at: 'created_at', deleted: 'legacy_deleted',
      id: 'id', name: 'name', tenant_id: 'tenant_id', updated_at: 'updated_at',
    },
    invariants: [
      'id is nonblank and stable',
      'legacy count is preserved without inferring its business meaning',
      'tenant_id resolves to an admitted tenant or quarantines the row',
    ],
  }),
});

function buildCatalogTables() {
  const tables = {};
  add(tables, ['tenants'], 'canonical', 'tenant boundary requires field-level tenancy mapping', 'tenancy');
  add(tables, ['institutions', 'schools', 'rooms'], 'canonical', 'organization and location records are cloud business candidates', 'organization');
  add(tables, ['users'], 'canonical', 'legacy account rows require identity-evidence mapping before cloud account creation', 'identity');
  add(tables, ['teachers', 'students'], 'canonical', 'person profiles are cloud business candidates with explicit privacy mapping required', 'profiles');
  add(tables, ['courses', 'schedules', 'enrollments', 'grades'], 'canonical', 'teaching records are cloud business candidates', 'teaching');
  add(tables, ['payments', 'consumptions'], 'canonical', 'financial and consumption records require exact-decimal field mapping', 'finance');
  add(tables, ['asset_accounts', 'personal_asset_categories', 'personal_asset_records'], 'canonical', 'personal-asset schema is a cloud business candidate although this source currently has no rows', 'personal_assets');
  add(tables, ['subjects', 'chapters'], 'canonical', 'curriculum reference records are cloud business candidates', 'curriculum');

  add(tables, [
    'questions', 'question_contents', 'question_assets', 'question_bank_delete_operations', 'question_bank_storage_audit',
    'question_bank_store_bindings', 'question_knowledge_points', 'question_model_points', 'question_taxonomy_nodes',
    'knowledge_point_rollups', 'knowledge_points', 'model_points', 'taxonomy_deletion_backups', 'taxonomy_nodes',
    'taxonomy_state', 'taxonomy_systems',
  ], 'quarantine_only', 'question-labelled relation requires provenance review and a structured-text versus NAS-rich-media mapping before admission');

  add(tables, [
    'account_memberships', 'user_role_grants', 'authority_accounts', 'authority_role_applications', 'authority_role_bindings',
    'desktop_device_activations', 'desktop_device_authorizations', 'desktop_device_pairings',
    'desktop_device_session_challenges', 'desktop_identity_challenges', 'desktop_sessions',
    'desktop_single_user_pairing_grants', 'desktop_single_user_pairing_requests', 'device_grants', 'device_leases',
    'primary_host_epochs', 'primary_host_operation_challenges', 'primary_host_preflight_proofs',
    'relay_authorization_nonces', 'sync_authorizations', 'sync_devices',
  ], 'archive', 'legacy authority, device, session, or credential evidence must not create a current cloud credential');

  add(tables, [
    'authority_command_ledger', 'authority_command_receipts', 'authority_device_control_mirror_versions', 'authority_metadata',
    'authority_migration_ledger', 'authority_projection_versions', 'authority_role_mirror_versions',
    'authority_runtime_host_epochs', 'authority_scoped_projections', 'authorization_audit_log', 'authorization_migrations',
    'host_commands', 'host_heartbeats', 'host_receipts', 'host_recovery_deliveries', 'host_recovery_factors',
    'host_transfers', 'identity_provisioning_receipts', 'miniapp_login_attempts', 'miniapp_login_events',
    'miniapp_role_applications', 'miniapp_tasks', 'miniapp_wechat_binding_requests', 'operation_audit_log',
    'outbox_events', 'role_application_mirrors', 'role_grant_mirrors', 'sync_audit_log', 'sync_conflicts',
    'sync_delivery_scope', 'sync_log', 'sync_record_provenance', 'sync_rejections',
  ], 'archive', 'legacy control-plane history may be retained as evidence but cannot be replayed as the new authority protocol');

  add(tables, [
    'data_archive_jobs', 'desktop_sync_batch_backups', 'import_batches', 'import_items', 'paper_artifacts',
    'paper_completion_outbox', 'paper_jobs', 'readonly_snapshots', 'schema_migrations', 'search_index_jobs', 'vector_embeddings',
  ], 'rebuildable_cache', 'derived job, cache, index, export, or prior-import state is rebuilt or separately archived after canonical data is verified');

  for (const [sourceTable, mapping] of Object.entries(APPROVED_MAPPED_CONTRACTS)) {
    admitMappedCanonical(tables, sourceTable, mapping);
  }

  return Object.freeze(tables);
}

function isNonBlankText(value) {
  return typeof value === 'string' && value.trim() === value && value.length > 0;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function hasApprovedMappingContract(tableName, mapping) {
  const approved = APPROVED_MAPPED_CONTRACTS[tableName];
  return Boolean(approved) && JSON.stringify(stableValue(mapping)) === JSON.stringify(stableValue(approved));
}

function mappingIssues(tableName, mapping) {
  const issues = [];
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return [`canonical table missing field mapping: ${tableName}`];
  const keys = Object.keys(mapping).sort();
  if (JSON.stringify(keys) !== JSON.stringify(MAPPING_FIELDS)) return [`canonical table field mapping shape invalid: ${tableName}`];
  for (const field of ['targetSchema', 'targetEntity', 'stableIdStrategy', 'transformerId', 'rollbackProof']) {
    if (!isNonBlankText(mapping[field])) issues.push(`canonical table mapping ${field} invalid: ${tableName}`);
  }
  if (!Number.isSafeInteger(mapping.dependencyOrder) || mapping.dependencyOrder < 1) {
    issues.push(`canonical table mapping dependencyOrder invalid: ${tableName}`);
  }
  if (!mapping.sourceFields || typeof mapping.sourceFields !== 'object' || Array.isArray(mapping.sourceFields)
    || Object.keys(mapping.sourceFields).length === 0
    || Object.values(mapping.sourceFields).some(value => !isNonBlankText(value))) {
    issues.push(`canonical table mapping sourceFields invalid: ${tableName}`);
  }
  for (const arrayField of ['invariants', 'fileReferenceFields']) {
    const value = mapping[arrayField];
    if (!Array.isArray(value) || (arrayField === 'invariants' && value.length === 0)
      || value.some(item => !isNonBlankText(item))
      || JSON.stringify([...value].sort()) !== JSON.stringify(value)
      || new Set(value).size !== value.length) {
      issues.push(`canonical table mapping ${arrayField} invalid: ${tableName}`);
    }
  }
  return issues;
}

const SOURCE_TABLE_CATALOG = Object.freeze({
  schemaVersion: 1,
  sourceInventoryHash: '08460a7fe152f0f9d30c0abac732ee4b57355e3bbf7494024ffe68c6f9e581a2',
  tables: buildCatalogTables(),
});

function validateSourceTableCatalog(catalog) {
  const issues = [];
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return ['catalog must be an object'];
  if (catalog.schemaVersion !== 1) issues.push('schemaVersion must be 1');
  if (!/^[a-f0-9]{64}$/.test(String(catalog.sourceInventoryHash || ''))) issues.push('sourceInventoryHash must be lowercase sha256');
  const tables = catalog.tables;
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) return [...issues, 'tables must be an object'];
  const actualNames = Object.keys(tables).sort();
  for (const tableName of EXPECTED_SOURCE_TABLES) {
    if (!Object.prototype.hasOwnProperty.call(tables, tableName)) issues.push(`missing source table: ${tableName}`);
  }
  for (const tableName of actualNames) {
    if (!EXPECTED_SOURCE_TABLES.includes(tableName)) issues.push(`unrecognized source table: ${tableName}`);
    const entry = tables[tableName];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push(`invalid catalog entry: ${tableName}`);
      continue;
    }
    if (!VALID_DISPOSITIONS.has(entry.disposition)) issues.push(`invalid disposition: ${tableName}`);
    if (!String(entry.rationale || '').trim()) issues.push(`missing rationale: ${tableName}`);
    if (entry.disposition === 'canonical') {
      if (!String(entry.targetDomain || '').trim()) issues.push(`canonical table missing target domain: ${tableName}`);
      if (!['unmapped', 'mapped'].includes(entry.mappingState)) issues.push(`canonical table has invalid mapping state: ${tableName}`);
      if (entry.mappingState === 'mapped') {
        issues.push(...mappingIssues(tableName, entry.fieldMapping));
        if (!hasApprovedMappingContract(tableName, entry.fieldMapping)) {
          issues.push(`canonical table field mapping is not an approved logical contract: ${tableName}`);
        }
      } else if (Object.prototype.hasOwnProperty.call(entry, 'fieldMapping')) {
        issues.push(`unmapped canonical table cannot declare a field mapping: ${tableName}`);
      }
    } else if (entry.targetDomain !== null || entry.mappingState !== null || Object.prototype.hasOwnProperty.call(entry, 'fieldMapping')) {
      issues.push(`noncanonical table cannot declare a target mapping: ${tableName}`);
    }
  }
  return Object.freeze(issues);
}

function assertShadowImportReady(catalog) {
  const issues = validateSourceTableCatalog(catalog);
  if (issues.length) throw catalogError('MIGRATION_SOURCE_CATALOG_INVALID');
  const incomplete = Object.entries(catalog.tables)
    .filter(([, entry]) => entry.disposition === 'canonical' && entry.mappingState !== 'mapped')
    .map(([tableName]) => tableName);
  if (incomplete.length) throw catalogError('MIGRATION_CATALOG_FIELD_MAPPING_REQUIRED');
  return true;
}

module.exports = {
  EXPECTED_SOURCE_TABLES,
  SOURCE_TABLE_CATALOG,
  assertShadowImportReady,
  validateSourceTableCatalog,
};
