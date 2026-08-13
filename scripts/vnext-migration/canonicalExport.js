'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { canonicalJson } = require('../../shared/migrationBundleProtocol');
const {
  canonicalSourceRow,
  hashCanonicalRecord,
} = require('../../migration/vnext/canonicalTypes');
const { validateSourceTableCatalog } = require('../../migration/vnext/sourceTableCatalog');
const { assertSafeOutputRoot, resolveExistingFile } = require('./pathSafety');
const { PLAINTEXT_FIXTURE_TOKEN } = require('./canonicalExportTestSupport');

function exportError(code, cause) {
  return Object.assign(new Error(code), { code, cause });
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function writeNdjson(filePath, records) {
  const content = records.length ? `${records.map(record => canonicalJson(record)).join('\n')}\n` : '';
  fs.writeFileSync(filePath, content, { encoding: 'utf8', flag: 'wx' });
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function exportCanonicalSnapshot({ snapshotPath, outputRoot, catalog, plaintextFixtureToken } = {}) {
  if (plaintextFixtureToken !== PLAINTEXT_FIXTURE_TOKEN) {
    throw exportError('MIGRATION_CANONICAL_ENCRYPTION_REQUIRED');
  }
  const snapshot = resolveExistingFile(snapshotPath);
  const tempRoot = fs.realpathSync(require('os').tmpdir());
  if (!snapshot.startsWith(`${tempRoot}${path.sep}`)) {
    throw exportError('MIGRATION_CANONICAL_PLAINTEXT_FIXTURE_PATH_FORBIDDEN');
  }
  if (!outputRoot) throw exportError('MIGRATION_CANONICAL_OUTPUT_REQUIRED');
  const requested = path.resolve(outputRoot);
  if (fs.existsSync(requested)) throw exportError('MIGRATION_CANONICAL_OUTPUT_EXISTS');
  const safeOutput = assertSafeOutputRoot(requested);

  let db;
  let completed = false;
  const partial = `${safeOutput}.partial`;
  try {
    db = new Database(snapshot, { readonly: true, fileMustExist: true });
    db.defaultSafeIntegers(true);
    db.pragma('query_only = ON');
    db.exec('BEGIN');
    const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map(row => String(row.name));
    validateSourceTableCatalog({
      inventory: { schemaVersion: 1, tableCount: tableNames.length, tables: tableNames.map(name => ({ name })) },
      catalog,
    });
    for (const directory of ['canonical', 'archive', 'local_partition', 'rebuildable_cache', 'quarantine']) {
      fs.mkdirSync(path.join(partial, directory), { recursive: true });
    }

    const counts = {
      sourceTableCount: tableNames.length,
      sourceRowCount: 0,
      canonicalRowCount: 0,
      archiveRowCount: 0,
      localPartitionRowCount: 0,
      rebuildableCacheRowCount: 0,
      quarantineRowCount: 0,
    };
    const fileHashes = {};
    for (const entry of [...catalog.tables].sort((left, right) => left.sourceTable.localeCompare(right.sourceTable))) {
      const escaped = quoteIdentifier(entry.sourceTable);
      const columns = db.prepare(`PRAGMA table_info(${escaped})`).all()
        .sort((left, right) => Number(left.cid) - Number(right.cid))
        .map(column => String(column.name));
      const rows = db.prepare(`SELECT * FROM ${escaped}`).all();
      counts.sourceRowCount += rows.length;
      let records;
      if (entry.disposition === 'archive' || entry.disposition === 'rebuildable_cache') {
        records = rows.map(row => ({
          sourceTable: entry.sourceTable,
          recordHash: hashCanonicalRecord(canonicalSourceRow(row, columns)),
        }));
      } else {
        records = rows.map(row => {
          const record = canonicalSourceRow(row, columns);
          return {
            sourceTable: entry.sourceTable,
            target: entry.target,
            transformerId: entry.transformerId,
            recordHash: hashCanonicalRecord(record),
            record,
          };
        });
      }
      const directory = entry.disposition === 'quarantine_only' ? 'quarantine' : entry.disposition;
      const fileName = `${entry.sourceTable}.ndjson`;
      const relativePath = `${directory}/${fileName}`;
      fileHashes[relativePath] = writeNdjson(path.join(partial, directory, fileName), records);
      if (entry.disposition === 'canonical') counts.canonicalRowCount += rows.length;
      else if (entry.disposition === 'archive') counts.archiveRowCount += rows.length;
      else if (entry.disposition === 'local_partition') counts.localPartitionRowCount += rows.length;
      else if (entry.disposition === 'rebuildable_cache') counts.rebuildableCacheRowCount += rows.length;
      else counts.quarantineRowCount += rows.length;
    }
    db.exec('ROLLBACK');
    db.close();
    db = null;
    const exportHash = crypto.createHash('sha256').update(canonicalJson({ counts, fileHashes }), 'utf8').digest('hex');
    const report = { schemaVersion: 1, ...counts, exportHash, fileHashes };
    fs.writeFileSync(path.join(partial, 'export-report.json'), `${canonicalJson(report)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(partial, safeOutput);
    completed = true;
    return Object.freeze({ ...counts, exportHash });
  } catch (error) {
    if (error && String(error.code || '').startsWith('MIGRATION_')) throw error;
    throw exportError('MIGRATION_CANONICAL_EXPORT_FAILED', error);
  } finally {
    if (db) {
      try { db.exec('ROLLBACK'); } catch (_) { /* connection closes below */ }
      db.close();
    }
    if (!completed && fs.existsSync(partial)) {
      try { fs.writeFileSync(path.join(partial, 'FAILED'), 'incomplete\n', { encoding: 'utf8', flag: 'wx' }); } catch (_) { /* preserve evidence */ }
    }
  }
}

module.exports = { exportCanonicalSnapshot };
