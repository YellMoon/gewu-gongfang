'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { inventoryOpenSqlite, inventorySqlite } = require('./sqliteInventory');
const {
  assertDisjointPaths,
  assertSafeOutputRoot,
  resolveExistingFile,
} = require('./pathSafety');

function snapshotError(code, cause) {
  return Object.assign(new Error(code), { code, cause });
}

function hashFile(filePath) {
  const digest = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(handle);
  }
  return digest.digest('hex');
}

function summarizeInventory(report) {
  const tableRowCount = Object.values(report.tables)
    .reduce((sum, table) => sum + Number(table.rowCount), 0);
  return {
    quickCheck: report.quickCheck,
    foreignKeyCheckCount: report.foreignKeyCheckCount,
    tableCount: report.tableCount,
    tableRowCount,
    inventoryHash: report.inventoryHash,
  };
}

function assertEquivalentInventories(source, snapshot) {
  if (source.inventoryHash !== snapshot.inventoryHash) {
    throw snapshotError('MIGRATION_SNAPSHOT_INVENTORY_MISMATCH');
  }
  const sourceTables = Object.keys(source.tables).sort();
  const snapshotTables = Object.keys(snapshot.tables).sort();
  if (JSON.stringify(sourceTables) !== JSON.stringify(snapshotTables)) {
    throw snapshotError('MIGRATION_SNAPSHOT_INVENTORY_MISMATCH');
  }
  for (const tableName of sourceTables) {
    const left = source.tables[tableName];
    const right = snapshot.tables[tableName];
    if (left.rowCount !== right.rowCount
      || left.primaryKeySetHash !== right.primaryKeySetHash
      || left.canonicalRowsHash !== right.canonicalRowsHash) {
      throw snapshotError('MIGRATION_SNAPSHOT_INVENTORY_MISMATCH');
    }
  }
}

function verifySqliteSnapshot({ snapshotPath, expectedSnapshotHash } = {}) {
  const resolved = resolveExistingFile(snapshotPath);
  const snapshotHash = hashFile(resolved);
  if (expectedSnapshotHash && snapshotHash !== expectedSnapshotHash) {
    throw snapshotError('MIGRATION_SNAPSHOT_HASH_MISMATCH');
  }
  const report = inventorySqlite({ dbPath: resolved, includeRowHashes: true });
  return Object.freeze({ snapshotHash, ...summarizeInventory(report) });
}

function assertFreeSpace({ sourcePath, targetParent, minimumFreeBytes }) {
  const stats = fs.statfsSync(targetParent);
  const available = Number(stats.bavail) * Number(stats.bsize);
  const required = minimumFreeBytes === undefined
    ? (fs.statSync(sourcePath).size * 2) + (16 * 1024 * 1024)
    : Number(minimumFreeBytes);
  if (!Number.isSafeInteger(required) || required < 0) {
    throw snapshotError('MIGRATION_SNAPSHOT_SPACE_REQUIREMENT_INVALID');
  }
  if (!Number.isFinite(available) || available < required) {
    throw snapshotError('MIGRATION_SNAPSHOT_INSUFFICIENT_SPACE');
  }
}

async function createSqliteSnapshot({ sourcePath, snapshotPath, minimumFreeBytes, testHooks = {} } = {}) {
  const source = resolveExistingFile(sourcePath);
  const requested = path.resolve(String(snapshotPath || ''));
  if (!snapshotPath) throw snapshotError('MIGRATION_SNAPSHOT_PATH_REQUIRED');
  if (fs.existsSync(requested)) throw snapshotError('MIGRATION_SNAPSHOT_ALREADY_EXISTS');
  const partialPath = `${requested}.partial`;
  if (fs.existsSync(partialPath)) throw snapshotError('MIGRATION_SNAPSHOT_PARTIAL_EXISTS');
  const safeTarget = assertSafeOutputRoot(requested);
  assertDisjointPaths({ sources: [source, path.dirname(source)], output: safeTarget });
  assertFreeSpace({ sourcePath: source, targetParent: path.dirname(safeTarget), minimumFreeBytes });

  let db;
  let completed = false;
  try {
    db = new Database(source, { readonly: true, fileMustExist: true });
    db.defaultSafeIntegers(true);
    db.pragma('query_only = ON');
    db.exec('BEGIN');
    db.pragma('schema_version', { simple: true });
    const sourceInventory = inventoryOpenSqlite(db, { includeRowHashes: true });
    await db.backup(partialPath, {
      progress(progress) {
        if (typeof testHooks.onBackupProgress === 'function') testHooks.onBackupProgress(progress);
        return 100;
      },
    });
    db.exec('ROLLBACK');
    db.close();
    db = null;

    const partialVerification = verifySqliteSnapshot({ snapshotPath: partialPath });
    const snapshotInventory = inventorySqlite({ dbPath: partialPath, includeRowHashes: true });
    assertEquivalentInventories(sourceInventory, snapshotInventory);
    fs.renameSync(partialPath, safeTarget);
    completed = true;
    const finalVerification = verifySqliteSnapshot({
      snapshotPath: safeTarget,
      expectedSnapshotHash: partialVerification.snapshotHash,
    });
    return Object.freeze(finalVerification);
  } catch (error) {
    if (error && String(error.code || '').startsWith('MIGRATION_')) throw error;
    throw snapshotError('MIGRATION_SNAPSHOT_CREATE_FAILED', error);
  } finally {
    if (db) db.close();
    if (!completed && fs.existsSync(partialPath)) {
      try {
        fs.writeFileSync(`${partialPath}.failed`, 'incomplete\n', { encoding: 'utf8', flag: 'wx' });
      } catch (_) {
        // Preserve the partial snapshot and marker for explicit operator review.
      }
    }
  }
}

module.exports = { createSqliteSnapshot, verifySqliteSnapshot };
