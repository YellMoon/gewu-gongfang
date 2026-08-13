'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { canonicalJson } = require('../../shared/migrationBundleProtocol');

const DISPOSITIONS = Object.freeze([
  'canonical', 'archive', 'local_partition', 'rebuildable_cache', 'quarantine_only',
]);

function catalogError(code) {
  return Object.assign(new Error(code), { code });
}

function expandCatalog(document) {
  if (!document || document.schemaVersion !== 1) throw catalogError('MIGRATION_SOURCE_CATALOG_SCHEMA_INVALID');
  const tables = [];
  for (const entry of document.canonical || []) {
    tables.push({
      sourceTable: entry.sourceTable,
      disposition: 'canonical',
      target: entry.target,
      stableIdStrategy: 'preserve-text',
      dependencyOrder: entry.dependencyOrder,
      transformerId: entry.transformerId,
      aggregateInvariants: entry.aggregateInvariants || ['row_count', 'primary_key_set', 'canonical_hash'],
      fileReferenceFields: entry.fileReferenceFields || [],
      reason: null,
    });
  }
  for (const disposition of DISPOSITIONS.filter(value => value !== 'canonical')) {
    const group = document[disposition] || {};
    for (const sourceTable of group.sourceTables || []) {
      tables.push({
        sourceTable,
        disposition,
        target: null,
        stableIdStrategy: null,
        dependencyOrder: null,
        transformerId: null,
        aggregateInvariants: [],
        fileReferenceFields: [],
        reason: group.reason,
      });
    }
  }
  tables.sort((left, right) => left.sourceTable.localeCompare(right.sourceTable));
  return Object.freeze({ schemaVersion: 1, tables: Object.freeze(tables.map(Object.freeze)) });
}

function loadSourceTableCatalog(filePath) {
  try {
    return expandCatalog(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    if (error && String(error.code || '').startsWith('MIGRATION_')) throw error;
    throw catalogError('MIGRATION_SOURCE_CATALOG_INVALID');
  }
}

function validateEntry(entry) {
  if (!entry || !/^[a-z][a-z0-9_]*$/.test(String(entry.sourceTable || ''))
    || !DISPOSITIONS.includes(entry.disposition)) {
    throw catalogError('MIGRATION_SOURCE_CATALOG_ENTRY_INVALID');
  }
  if (entry.disposition === 'canonical') {
    if (!/^(identity|access|business|question|storage|audit|migration)\.[a-z][a-z0-9_]*$/.test(String(entry.target || ''))
      || entry.stableIdStrategy !== 'preserve-text'
      || !Number.isInteger(entry.dependencyOrder) || entry.dependencyOrder < 0
      || !/^[a-z][a-z0-9_.-]*$/.test(String(entry.transformerId || ''))
      || !Array.isArray(entry.aggregateInvariants) || entry.aggregateInvariants.length === 0
      || !Array.isArray(entry.fileReferenceFields) || entry.reason !== null) {
      throw catalogError('MIGRATION_SOURCE_CATALOG_ENTRY_INVALID');
    }
  } else if (entry.target !== null || entry.transformerId !== null
    || entry.dependencyOrder !== null || typeof entry.reason !== 'string' || entry.reason.length < 12) {
    throw catalogError('MIGRATION_SOURCE_CATALOG_ENTRY_INVALID');
  }
}

function validateSourceTableCatalog({ inventory, catalog } = {}) {
  if (!inventory || inventory.schemaVersion !== 1 || !Array.isArray(inventory.tables)) {
    throw catalogError('MIGRATION_SOURCE_INVENTORY_INVALID');
  }
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.tables)) {
    throw catalogError('MIGRATION_SOURCE_CATALOG_INVALID');
  }
  const seen = new Set();
  for (const entry of catalog.tables) {
    validateEntry(entry);
    if (seen.has(entry.sourceTable)) throw catalogError('MIGRATION_SOURCE_TABLE_DUPLICATE');
    seen.add(entry.sourceTable);
  }
  const inventoryNames = inventory.tables.map(table => String(table.name || '')).sort();
  const unclassified = inventoryNames.filter(name => !seen.has(name));
  if (unclassified.length) throw catalogError('MIGRATION_SOURCE_TABLE_UNCLASSIFIED');
  const inventorySet = new Set(inventoryNames);
  const unknownCatalogTables = [...seen].filter(name => !inventorySet.has(name)).sort();
  if (unknownCatalogTables.length) throw catalogError('MIGRATION_SOURCE_CATALOG_UNKNOWN_TABLE');
  if (Number(inventory.tableCount) !== inventoryNames.length) {
    throw catalogError('MIGRATION_SOURCE_INVENTORY_COUNT_MISMATCH');
  }
  return Object.freeze({
    tableCount: inventoryNames.length,
    unclassified: Object.freeze([]),
    unknownCatalogTables: Object.freeze([]),
    catalogHash: crypto.createHash('sha256').update(canonicalJson(catalog), 'utf8').digest('hex'),
  });
}

function evaluateCriticalSourceReadiness({ declarations, criticalSourceIds } = {}) {
  if (!Array.isArray(declarations) || !Array.isArray(criticalSourceIds) || criticalSourceIds.length === 0) {
    throw catalogError('MIGRATION_CRITICAL_SOURCE_POLICY_INVALID');
  }
  const byId = new Map();
  for (const source of declarations) {
    if (!source || typeof source.sourceId !== 'string' || byId.has(source.sourceId)) {
      throw catalogError('MIGRATION_SOURCE_DECLARATION_INVALID');
    }
    byId.set(source.sourceId, source);
  }
  const blockers = criticalSourceIds.map(sourceId => {
    const source = byId.get(sourceId);
    if (!source) return { sourceId, code: 'MIGRATION_CRITICAL_SOURCE_UNDECLARED' };
    if (source.availability !== 'available') return { sourceId, code: 'MIGRATION_CRITICAL_SOURCE_UNAVAILABLE' };
    return null;
  }).filter(Boolean).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  return Object.freeze({ ready: blockers.length === 0, blockers: Object.freeze(blockers.map(Object.freeze)) });
}

module.exports = {
  DISPOSITIONS,
  loadSourceTableCatalog,
  evaluateCriticalSourceReadiness,
  validateSourceTableCatalog,
};
