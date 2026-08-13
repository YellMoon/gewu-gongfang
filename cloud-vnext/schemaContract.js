'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIGRATION_NAMES = Object.freeze([
  '0001_extensions_roles.sql',
  '0002_identity_access.sql',
  '0003_business.sql',
  '0004_question_storage.sql',
  '0005_audit_outbox_migration.sql',
]);

const REQUIRED_TABLES = Object.freeze([
  'identity.tenants', 'identity.accounts', 'identity.profiles', 'identity.verified_contacts',
  'identity.external_identities', 'access.roles', 'access.capabilities', 'access.account_roles',
  'access.devices', 'access.installations', 'access.account_device_links', 'access.activation_evidence',
  'business.institutions', 'business.schools', 'business.teachers', 'business.students',
  'business.courses', 'business.schedules', 'business.payments', 'business.consumptions',
  'business.asset_accounts', 'question.questions', 'question.question_contents',
  'question.taxonomy_nodes', 'storage.file_objects', 'storage.file_versions',
  'storage.file_verification_receipts', 'storage.storage_jobs', 'audit.authorization_events',
  'audit.operation_events', 'audit.outbox_events', 'migration.batches',
  'migration.source_snapshots', 'migration.record_ledger', 'migration.quarantine_records',
  'migration.restore_receipts',
]);

function contractError(code) {
  return Object.assign(new Error(code), { code });
}

function loadMigrations(directory) {
  const migrations = MIGRATION_NAMES.map(name => {
    const filePath = path.join(directory, name);
    if (!fs.existsSync(filePath)) throw contractError('VNEXT_SCHEMA_MIGRATION_MISSING');
    return Object.freeze({ name, sql: fs.readFileSync(filePath, 'utf8') });
  });
  const extras = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter(name => name.endsWith('.sql') && !MIGRATION_NAMES.includes(name))
    : [];
  if (extras.length) throw contractError('VNEXT_SCHEMA_MIGRATION_UNEXPECTED');
  return Object.freeze(migrations);
}

function validateSchemaContract(migrations) {
  if (!Array.isArray(migrations) || migrations.map(item => item.name).join('|') !== MIGRATION_NAMES.join('|')) {
    throw contractError('VNEXT_SCHEMA_MIGRATION_ORDER_INVALID');
  }
  const sql = migrations.map(item => item.sql).join('\n').toLowerCase();
  const schemas = [...sql.matchAll(/create\s+schema\s+if\s+not\s+exists\s+([a-z][a-z0-9_]*)/g)]
    .map(match => match[1]).filter(value => value !== 'public').sort();
  const uniqueSchemas = [...new Set(schemas)];
  const tables = [...sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)/g)]
    .map(match => match[1]);
  const tableSet = new Set(tables);
  if (tableSet.size !== tables.length) throw contractError('VNEXT_SCHEMA_TABLE_DUPLICATE');
  const missingRequiredTables = REQUIRED_TABLES.filter(table => !tableSet.has(table));

  const unindexedForeignKeys = [];
  for (const match of sql.matchAll(/--\s*fk-index:\s*([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)\(([a-z][a-z0-9_]*)\)/g)) {
    const [, table, column] = match;
    const escapedTable = table.replace('.', '\\.');
    const indexPattern = new RegExp(`create\\s+index\\s+if\\s+not\\s+exists\\s+[a-z0-9_]+\\s+on\\s+${escapedTable}\\s*\\(\\s*${column}\\s*\\)`);
    if (!indexPattern.test(sql)) unindexedForeignKeys.push(`${table}(${column})`);
  }
  const referenceCount = [...sql.matchAll(/\breferences\s+[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\s*\(/g)].length;
  const fkMarkerCount = [...sql.matchAll(/--\s*fk-index:/g)].length;
  if (referenceCount !== fkMarkerCount) unindexedForeignKeys.push(`marker-count:${fkMarkerCount}/${referenceCount}`);

  const forbiddenPatterns = [];
  for (const [label, pattern] of [
    ['serial', /\b(?:smallserial|serial|bigserial)\b/],
    ['timestamp-without-time-zone', /timestamp\s+without\s+time\s+zone/],
    ['grant-all', /grant\s+all/],
    ['public-create', /grant\s+create\s+on\s+schema\s+public/],
  ]) if (pattern.test(sql)) forbiddenPatterns.push(label);

  return Object.freeze({
    schemas: Object.freeze(uniqueSchemas),
    tableCount: tables.length,
    tables: Object.freeze([...tableSet].sort()),
    missingRequiredTables: Object.freeze(missingRequiredTables),
    unindexedForeignKeys: Object.freeze(unindexedForeignKeys),
    forbiddenPatterns: Object.freeze(forbiddenPatterns),
    contractHash: crypto.createHash('sha256').update(sql, 'utf8').digest('hex'),
  });
}

module.exports = { loadMigrations, validateSchemaContract };
