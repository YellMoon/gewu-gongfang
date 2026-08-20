'use strict';

const assert = require('assert');
const packageJson = require('../../package.json');
const {
  EXPECTED_SOURCE_TABLES,
  SOURCE_TABLE_CATALOG,
  assertShadowImportReady,
  validateSourceTableCatalog,
} = require('./sourceTableCatalog');

assert.match(
  packageJson.scripts['test:vnext-migration'],
  /node migration\/vnext\/sourceTableCatalog\.test\.js/,
  'the full migration gate must run the source-table catalog rather than relying on a manual focused command'
);

const expectedTables = Object.freeze([
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

assert.deepStrictEqual(EXPECTED_SOURCE_TABLES, expectedTables, 'the catalog must pin the 99-table structural snapshot exactly');
assert.deepStrictEqual(
  Object.keys(SOURCE_TABLE_CATALOG.tables).sort(),
  expectedTables,
  'every discovered source relation needs one explicit disposition before a cloud write is possible'
);
assert.deepStrictEqual(validateSourceTableCatalog(SOURCE_TABLE_CATALOG), [], 'the checked-in intake catalog must be internally complete');

for (const tableName of ['questions', 'question_contents', 'question_assets', 'question_bank_store_bindings']) {
  assert.strictEqual(
    SOURCE_TABLE_CATALOG.tables[tableName].disposition,
    'quarantine_only',
    `${tableName} must remain quarantined until provenance and the NAS media split are independently verified`
  );
}
for (const tableName of ['desktop_sessions', 'desktop_device_authorizations', 'device_grants', 'device_leases']) {
  assert.notStrictEqual(
    SOURCE_TABLE_CATALOG.tables[tableName].disposition,
    'canonical',
    `${tableName} must never revive an old device/session credential as current cloud authority`
  );
}
for (const tableName of [
  'tenants', 'institutions', 'schools', 'rooms', 'users', 'teachers', 'students', 'courses', 'schedules', 'enrollments',
  'grades', 'payments', 'consumptions', 'asset_accounts', 'personal_asset_categories', 'personal_asset_records', 'subjects', 'chapters',
]) {
  const entry = SOURCE_TABLE_CATALOG.tables[tableName];
  assert.strictEqual(entry.disposition, 'canonical', `${tableName} is a cloud-business candidate, not a control-plane exclusion`);
  assert.strictEqual(entry.mappingState, 'unmapped', `${tableName} cannot be imported before a field-level contract exists`);
  assert.ok(entry.targetDomain, `${tableName} must name its eventual target domain`);
}

assert.throws(
  () => assertShadowImportReady(SOURCE_TABLE_CATALOG),
  error => error && error.code === 'MIGRATION_CATALOG_FIELD_MAPPING_REQUIRED',
  'a structurally complete catalog must still fail closed until every canonical relation has a reviewed field mapping'
);

const falselyMappedCatalog = {
  ...SOURCE_TABLE_CATALOG,
  tables: Object.fromEntries(Object.entries(SOURCE_TABLE_CATALOG.tables).map(([tableName, entry]) => [
    tableName,
    entry.disposition === 'canonical' ? { ...entry, mappingState: 'mapped' } : entry,
  ])),
};
assert.throws(
  () => assertShadowImportReady(falselyMappedCatalog),
  error => error && error.code === 'MIGRATION_SOURCE_CATALOG_INVALID',
  'changing an editable flag must not substitute for field mapping, stable-ID, dependency, invariant, file-boundary, and rollback evidence'
);

for (const tableName of ['desktop_sessions', 'questions']) {
  const targetMappingInjection = {
    ...SOURCE_TABLE_CATALOG,
    tables: {
      ...SOURCE_TABLE_CATALOG.tables,
      [tableName]: {
        ...SOURCE_TABLE_CATALOG.tables[tableName],
        targetDomain: 'illicit_target',
        mappingState: 'mapped',
      },
    },
  };
  assert.ok(
    validateSourceTableCatalog(targetMappingInjection).some(issue => issue.includes(tableName)),
    `${tableName} must reject a target mapping because its current disposition is fail-closed`
  );
}

const missingTableCatalog = {
  ...SOURCE_TABLE_CATALOG,
  tables: { ...SOURCE_TABLE_CATALOG.tables },
};
delete missingTableCatalog.tables.students;
assert.ok(
  validateSourceTableCatalog(missingTableCatalog).some(issue => issue.includes('students')),
  'removing a source relation must be detected rather than silently treated as absent'
);

console.log('vNext source table catalog checks passed');
