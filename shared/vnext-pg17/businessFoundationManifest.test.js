'use strict';

const assert = require('assert');
const { SOURCE_TABLE_CATALOG } = require('../../migration/vnext/sourceTableCatalog');
const {
  BUSINESS_FOUNDATION_MIGRATIONS,
  EXPECTED_BUSINESS_CORE_SCHEDULING_MANIFEST_SHA256,
  EXPECTED_BUSINESS_FOUNDATION_MANIFEST_SHA256,
  expectedBusinessFoundationCatalog,
  sha256,
} = require('./businessFoundationManifest');

async function runBusinessFoundationManifestCases() {
assert.deepStrictEqual(
  BUSINESS_FOUNDATION_MIGRATIONS.map(migration => [migration.migrationId, migration.semanticVersion]),
  [['business-foundation-1', 1], ['business-core-scheduling-2', 2]],
  'the business schema must add the core scheduling relations as its independent second DDL migration'
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
  'business.course_student_pricings',
  'business.courses',
  'business.institutions',
  'business.rooms',
  'business.schedule_student_overrides',
  'business.schedules',
  'business.schools',
  'business.students',
  'business.teachers',
  'business.tenants',
]);

const schedulingMigration = BUSINESS_FOUNDATION_MIGRATIONS[1];
assert.ok(schedulingMigration, 'the core scheduling migration must exist');
assert.strictEqual(
  schedulingMigration.manifestSha256,
  EXPECTED_BUSINESS_CORE_SCHEDULING_MANIFEST_SHA256,
  'the core scheduling DDL hash must be independently frozen'
);
assert.strictEqual(
  sha256(schedulingMigration.sql),
  EXPECTED_BUSINESS_CORE_SCHEDULING_MANIFEST_SHA256,
  'the frozen core scheduling SQL must match its independently expected hash'
);
assert.match(schedulingMigration.sql, /CREATE TABLE business\.teachers \(/);
assert.match(schedulingMigration.sql, /CREATE TABLE business\.students \(/);
assert.match(schedulingMigration.sql, /CREATE TABLE business\.courses \(/);
assert.match(schedulingMigration.sql, /CREATE TABLE business\.course_student_pricings \(/);
assert.match(schedulingMigration.sql, /CREATE TABLE business\.schedules \(/);
assert.match(schedulingMigration.sql, /CREATE TABLE business\.schedule_student_overrides \(/);
assert.match(schedulingMigration.sql, /legacy_room_id/);
assert.doesNotMatch(schedulingMigration.sql, /REFERENCES business\.rooms/);

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
}

if (require.main === module) {
  runBusinessFoundationManifestCases().then(() => {
    console.log('vNext business foundation manifest checks passed');
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { runBusinessFoundationManifestCases };
