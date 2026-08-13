'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { canonicalJson } = require('../../shared/migrationBundleProtocol');
const { canonicalSourceRow, hashCanonicalRecord } = require('../../migration/vnext/canonicalTypes');
const { validateSourceTableCatalog } = require('../../migration/vnext/sourceTableCatalog');
const { resolveExistingFile } = require('./pathSafety');
const { createSealedMigrationBundle } = require('./sealedMigrationBundle');

const CLASSIFICATION_BY_DISPOSITION = Object.freeze({
  canonical: 'business',
  archive: 'archive',
  local_partition: 'offline',
  rebuildable_cache: 'archive',
  quarantine_only: 'archive',
});

function exportError(code, cause) {
  return Object.assign(new Error(code), { code, cause });
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function createSealedBundleFromSnapshot({
  snapshotPath, bundlePath, catalog, sourceSnapshotHash, sourceInventoryHash,
  catalogHash, bundleId, environment, signingPrivateKey, encryptionKey,
  maximumRows = 1_000_000,
} = {}) {
  const snapshot = resolveExistingFile(snapshotPath);
  let db;
  let transactionOpen = false;
  try {
    db = new Database(snapshot, { readonly: true, fileMustExist: true });
    db.defaultSafeIntegers(true);
    db.pragma('query_only = ON');
    db.exec('BEGIN');
    transactionOpen = true;
    const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map(row => String(row.name));
    validateSourceTableCatalog({
      inventory: { schemaVersion: 1, tableCount: tableNames.length, tables: tableNames.map(name => ({ name })) },
      catalog,
    });
    let totalRows = 0;
    const payloads = [];
    for (const entry of [...catalog.tables].sort((a, b) => a.sourceTable.localeCompare(b.sourceTable))) {
      const escaped = quoteIdentifier(entry.sourceTable);
      const columns = db.prepare(`PRAGMA table_info(${escaped})`).all()
        .sort((a, b) => Number(a.cid) - Number(b.cid));
      const names = columns.map(column => String(column.name));
      const primaryKeyColumns = columns.filter(column => Number(column.pk) > 0)
        .sort((a, b) => Number(a.pk) - Number(b.pk)).map(column => String(column.name));
      const rows = db.prepare(`SELECT * FROM ${escaped}`).all();
      totalRows += rows.length;
      if (!Number.isSafeInteger(maximumRows) || maximumRows < 1 || totalRows > maximumRows) {
        throw exportError('MIGRATION_SEALED_EXPORT_ROW_LIMIT_EXCEEDED');
      }
      if (rows.length && primaryKeyColumns.length === 0) throw exportError('MIGRATION_CANONICAL_PRIMARY_KEY_REQUIRED');
      const records = rows.map(row => {
        const record = canonicalSourceRow(row, names);
        const sourceRecordKey = canonicalJson(canonicalSourceRow(row, primaryKeyColumns));
        const common = { sourceTable: entry.sourceTable, sourceRecordKey, recordHash: hashCanonicalRecord(record), record };
        return entry.disposition === 'canonical'
          ? { ...common, target: entry.target, transformerId: entry.transformerId }
          : { ...common, disposition: entry.disposition };
      }).sort((a, b) => a.sourceRecordKey.localeCompare(b.sourceRecordKey));
      if (records.length) payloads.push({
        relativePath: `${CLASSIFICATION_BY_DISPOSITION[entry.disposition]}/${entry.sourceTable}.ndjson`,
        classification: CLASSIFICATION_BY_DISPOSITION[entry.disposition],
        records,
      });
    }
    db.exec('ROLLBACK');
    transactionOpen = false;
    const result = createSealedMigrationBundle({
      bundlePath, bundleId, environment, sourceSnapshotHash, sourceInventoryHash, catalogHash,
      signingPrivateKey, encryptionKey, payloads: payloads.length ? payloads : [{
        relativePath: 'reports/empty.ndjson', classification: 'ledger', records: [],
      }],
    });
    return Object.freeze({ ...result, totalRows, payloadCount: payloads.length });
  } catch (error) {
    if (error && String(error.code || '').startsWith('MIGRATION_')) throw error;
    throw exportError('MIGRATION_SEALED_EXPORT_FAILED', error);
  } finally {
    if (db) {
      if (transactionOpen) { try { db.exec('ROLLBACK'); } catch (_) { /* closes below */ } }
      db.close();
    }
  }
}

module.exports = { createSealedBundleFromSnapshot };
