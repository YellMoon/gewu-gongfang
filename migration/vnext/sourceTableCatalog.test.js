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
assert.match(
  packageJson.scripts['test:vnext-migration'],
  /node shared\/vnext-pg17\/coreSchedulingSourceContract\.test\.js/,
  'the full migration gate must run the core scheduling source contract rather than relying on a manual focused command'
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

const expectedFoundationMappings = Object.freeze({
  tenants: Object.freeze({
    targetEntity: 'tenants', dependencyOrder: 1, transformerId: 'legacy_tenant_v1',
    sourceFields: Object.freeze({
      archive_before: 'legacy_archive_before', created_at: 'created_at', deleted: 'legacy_deleted', id: 'id',
      name: 'name', plan: 'legacy_plan', status: 'legacy_status', updated_at: 'updated_at',
    }),
  }),
  institutions: Object.freeze({
    targetEntity: 'institutions', dependencyOrder: 2, transformerId: 'legacy_institution_v1',
    sourceFields: Object.freeze({
      contact_person: 'contact_person_legacy', contact_phone: 'contact_phone_legacy', created_at: 'created_at',
      deleted: 'legacy_deleted', id: 'id', name: 'name', notes: 'notes', revenue_share: 'revenue_share',
      tenant_id: 'tenant_id', updated_at: 'updated_at',
    }),
  }),
  schools: Object.freeze({
    targetEntity: 'schools', dependencyOrder: 3, transformerId: 'legacy_school_v1',
    sourceFields: Object.freeze({
      count: 'legacy_count', created_at: 'created_at', deleted: 'legacy_deleted', id: 'id', name: 'name',
      tenant_id: 'tenant_id', updated_at: 'updated_at',
    }),
  }),
  rooms: Object.freeze({
    targetEntity: 'rooms', dependencyOrder: 4, transformerId: 'legacy_room_v1',
    sourceFields: Object.freeze({
      address: 'address_legacy', count: 'legacy_count', created_at: 'created_at', deleted: 'legacy_deleted',
      id: 'id', name: 'name', tenant_id: 'tenant_id', updated_at: 'updated_at',
    }),
  }),
  teachers: Object.freeze({
    targetEntity: 'teachers', dependencyOrder: 5, transformerId: 'legacy_teacher_v1',
    sourceFields: Object.freeze({
      created_at: 'created_at', deleted: 'legacy_deleted', hourly_rate: 'hourly_rate', id: 'id', name: 'name',
      notes: 'notes_restricted', phone: 'phone_restricted', subject: 'subject', tenant_id: 'tenant_id',
      updated_at: 'updated_at',
    }),
  }),
  students: Object.freeze({
    targetEntity: 'students', dependencyOrder: 6, transformerId: 'legacy_student_v1',
    sourceFields: Object.freeze({
      balance_hours: 'legacy_balance_hours', balance_money: 'legacy_balance_money', created_at: 'created_at',
      deleted: 'legacy_deleted', grade_current: 'grade_current', grade_year: 'grade_year', id: 'id',
      institution_id: 'institution_id', is_institution_student: 'legacy_is_institution_student', name: 'name',
      notes: 'notes_restricted', parent_name: 'parent_name_restricted', parent_phone: 'parent_phone_restricted',
      parent_phone_normalized: 'parent_phone_normalized_restricted', parent_relation: 'parent_relation_restricted',
      parent_wechat: 'parent_wechat_restricted', phone: 'phone_restricted', school: 'school_legacy',
      source_type: 'legacy_source_type', student_source: 'student_source_legacy', tenant_id: 'tenant_id',
      updated_at: 'updated_at',
    }),
  }),
  courses: Object.freeze({
    targetEntity: 'courses', dependencyOrder: 7, transformerId: 'legacy_course_v1',
    sourceFields: Object.freeze({
      active: 'legacy_active', billing_unit: 'billing_unit', created_at: 'created_at',
      default_duration_minutes: 'default_duration_minutes', deleted: 'legacy_deleted', display_name: 'display_name',
      id: 'id', institution_id: 'institution_id', name: 'name', notes: 'notes_restricted',
      price_teacher: 'price_teacher', price_tuition: 'price_tuition', room_id: 'legacy_room_id_snapshot',
      room_name: 'room_name_snapshot', semester: 'semester', source_type: 'legacy_source_type',
      student_pricings: 'course_student_pricings', teacher_fee_mode: 'teacher_fee_mode', teacher_id: 'teacher_id',
      teacher_name: 'teacher_name_snapshot', tenant_id: 'tenant_id', type: 'course_type', updated_at: 'updated_at', year: 'year',
    }),
  }),
  schedules: Object.freeze({
    targetEntity: 'schedules', dependencyOrder: 8, transformerId: 'legacy_schedule_v1',
    sourceFields: Object.freeze({
      calculated_teacher_fee: 'saved_calculated_teacher_fee', calculated_tuition: 'saved_calculated_tuition',
      course_id: 'course_id', created_at: 'created_at', deleted: 'legacy_deleted', end_time: 'end_time', id: 'id',
      notes: 'notes_restricted', recurring_rule: 'recurring_rule_json', room: 'room_display_snapshot',
      service_type: 'service_type', start_time: 'start_time', status: 'schedule_status',
      student_ids: 'legacy_student_ids_json', student_pricings: 'schedule_student_overrides', tenant_id: 'tenant_id',
      updated_at: 'updated_at',
    }),
  }),
});

for (const [tableName, expected] of Object.entries(expectedFoundationMappings)) {
  const mapping = SOURCE_TABLE_CATALOG.tables[tableName].fieldMapping;
  assert.strictEqual(mapping.targetSchema, 'business', `${tableName} is only a proposed cloud-business logical contract`);
  assert.strictEqual(mapping.targetEntity, expected.targetEntity, `${tableName} must pin its reviewed target entity`);
  assert.strictEqual(mapping.dependencyOrder, expected.dependencyOrder, `${tableName} must pin its reviewed dependency order`);
  assert.strictEqual(mapping.transformerId, expected.transformerId, `${tableName} must pin its reviewed transformer`);
  assert.deepStrictEqual(mapping.sourceFields, expected.sourceFields, `${tableName} must pin every recorded legacy source-to-target field mapping exactly`);
}

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
  const foundationMapped = ['tenants', 'institutions', 'schools', 'rooms', 'teachers', 'students', 'courses', 'schedules'].includes(tableName);
  assert.strictEqual(entry.mappingState, foundationMapped ? 'mapped' : 'unmapped', `${tableName} must have the expected field-mapping admission state`);
  assert.ok(entry.targetDomain, `${tableName} must name its eventual target domain`);
  if (foundationMapped) {
    assert.ok(entry.fieldMapping, `${tableName} must carry a field-level contract before it can be marked mapped`);
    assert.strictEqual(entry.fieldMapping.targetSchema, 'business', `${tableName} must target the cloud business schema`);
  }
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

const forgedMapping = Object.freeze({
  targetSchema: 'business',
  targetEntity: 'forged_entity',
  stableIdStrategy: 'forged stable id',
  dependencyOrder: 1,
  transformerId: 'forged_transformer',
  sourceFields: Object.freeze({ forged: 'forged' }),
  invariants: Object.freeze(['forged invariant']),
  fileReferenceFields: Object.freeze([]),
  rollbackProof: 'forged rollback proof',
});
const fullyForgedCatalog = {
  ...SOURCE_TABLE_CATALOG,
  tables: Object.fromEntries(Object.entries(SOURCE_TABLE_CATALOG.tables).map(([tableName, entry]) => [
    tableName,
    entry.disposition === 'canonical' ? { ...entry, mappingState: 'mapped', fieldMapping: forgedMapping } : entry,
  ])),
};
assert.throws(
  () => assertShadowImportReady(fullyForgedCatalog),
  error => error && error.code === 'MIGRATION_SOURCE_CATALOG_INVALID',
  'an arbitrary complete-looking mapping contract must not admit an unmapped business table or replace a reviewed foundation mapping'
);

for (const [tableName, fieldMappingMutation] of [
  ['tenants', mapping => ({ ...mapping, sourceFields: { ...mapping.sourceFields, forged: 'forged' } })],
  ['institutions', mapping => ({ ...mapping, sourceFields: { ...mapping.sourceFields, contact_phone: 'notes' } })],
  ['schools', mapping => ({ ...mapping, dependencyOrder: 99 })],
  ['rooms', mapping => ({ ...mapping, transformerId: 'forged_transformer' })],
]) {
  const mapping = SOURCE_TABLE_CATALOG.tables[tableName].fieldMapping;
  const mutatedFoundationCatalog = {
    ...SOURCE_TABLE_CATALOG,
    tables: {
      ...SOURCE_TABLE_CATALOG.tables,
      [tableName]: { ...SOURCE_TABLE_CATALOG.tables[tableName], fieldMapping: fieldMappingMutation(mapping) },
    },
  };
  assert.throws(
    () => assertShadowImportReady(mutatedFoundationCatalog),
    error => error && error.code === 'MIGRATION_SOURCE_CATALOG_INVALID',
    `${tableName} must reject a source-column, entity, dependency, or transformer change before any shadow import is allowed`
  );
}

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
