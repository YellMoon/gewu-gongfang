'use strict';

const assert = require('assert');
const { SOURCE_TABLE_CATALOG } = require('../../migration/vnext/sourceTableCatalog');
const {
  BUSINESS_FOUNDATION_MIGRATIONS,
  EXPECTED_BUSINESS_FOUNDATION_MANIFEST_SHA256,
  expectedBusinessFoundationCatalog,
  sha256,
} = require('./businessFoundationManifest');

assert.deepStrictEqual(
  BUSINESS_FOUNDATION_MIGRATIONS.map(migration => [migration.migrationId, migration.semanticVersion]),
  [['business-foundation-1', 1]],
  'the business schema has one independent initial DDL migration'
);
assert.strictEqual(
  BUSINESS_FOUNDATION_MIGRATIONS[0].manifestSha256,
  EXPECTED_BUSINESS_FOUNDATION_MANIFEST_SHA256,
  'the business migration hash must be independently frozen'
);
assert.strictEqual(
  sha256(BUSINESS_FOUNDATION_MIGRATIONS[0].sql),
  EXPECTED_BUSINESS_FOUNDATION_MANIFEST_SHA256,
  'the frozen business SQL must match its independently expected hash'
);
assert.deepStrictEqual(expectedBusinessFoundationCatalog.relations, [
  'business.business_schema_migrations',
  'business.institutions',
  'business.rooms',
  'business.schools',
  'business.tenants',
]);

const expectedSourceTargets = Object.freeze({
  tenants: Object.freeze({
    archive_before: 'legacy_archive_before', created_at: 'created_at', deleted: 'legacy_deleted', id: 'id',
    name: 'name', plan: 'legacy_plan', status: 'legacy_status', updated_at: 'updated_at',
  }),
  institutions: Object.freeze({
    contact_person: 'contact_person_legacy', contact_phone: 'contact_phone_legacy', created_at: 'created_at',
    deleted: 'legacy_deleted', id: 'id', name: 'name', notes: 'notes', revenue_share: 'revenue_share',
    tenant_id: 'tenant_id', updated_at: 'updated_at',
  }),
  schools: Object.freeze({
    count: 'legacy_count', created_at: 'created_at', deleted: 'legacy_deleted', id: 'id', name: 'name',
    tenant_id: 'tenant_id', updated_at: 'updated_at',
  }),
  rooms: Object.freeze({
    address: 'address_legacy', count: 'legacy_count', created_at: 'created_at', deleted: 'legacy_deleted',
    id: 'id', name: 'name', tenant_id: 'tenant_id', updated_at: 'updated_at',
  }),
});

for (const [sourceTable, sourceFields] of Object.entries(expectedSourceTargets)) {
  const entry = SOURCE_TABLE_CATALOG.tables[sourceTable];
  assert.strictEqual(entry.mappingState, 'mapped');
  assert.deepStrictEqual(entry.fieldMapping.sourceFields, sourceFields);
}

console.log('vNext business foundation manifest checks passed');
