'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  loadMigrations,
  validateSchemaContract,
} = require('./schemaContract');

const migrationsDir = path.join(__dirname, 'migrations');
const migrations = loadMigrations(migrationsDir);
const result = validateSchemaContract(migrations);
const sourceCatalog = require('../migration/vnext/source-table-catalog.json');

assert.deepStrictEqual(migrations.map(item => item.name), [
  '0001_extensions_roles.sql',
  '0002_identity_access.sql',
  '0003_business.sql',
  '0004_question_storage.sql',
  '0005_audit_outbox_migration.sql',
]);
assert.deepStrictEqual(result.schemas, [
  'access', 'audit', 'business', 'identity', 'migration', 'question', 'storage',
]);
assert.ok(result.tableCount >= 45);
assert.deepStrictEqual(result.missingRequiredTables, []);
assert.deepStrictEqual(
  [...new Set(sourceCatalog.canonical.map(entry => entry.target))]
    .filter(target => !result.tables.includes(target))
    .sort(),
  [],
);
assert.deepStrictEqual(result.unindexedForeignKeys, []);
assert.deepStrictEqual(result.forbiddenPatterns, []);
assert.ok(result.contractHash.match(/^[a-f0-9]{64}$/));

const sql = migrations.map(item => item.sql).join('\n').toLowerCase();
assert.ok(sql.includes('numeric(20, 4)'));
assert.ok(sql.includes('timestamptz'));
assert.ok(sql.includes('revoke all on schema'));
assert.ok(sql.includes('migration.record_ledger'));
assert.ok(sql.includes('migration.quarantine_records'));
assert.ok(sql.includes('audit.outbox_events'));
assert.ok(sql.includes('storage.file_verification_receipts'));
assert.ok(sql.includes("check (status <> 'verified' or verified_receipt_id is not null)"));
assert.ok(sql.includes("check (status <> 'active' or activation_evidence_id is not null)"));
assert.ok(!sql.includes(' serial '));
assert.ok(!sql.includes('timestamp without time zone'));
assert.ok(!sql.includes('grant all'));

console.log('PostgreSQL vNext schema contract checks passed');
