'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { canonicalJson } = require('../../shared/migrationBundleProtocol');

function inventoryError(code, cause) {
  return Object.assign(new Error(code), { code, cause });
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function canonicalValue(value) {
  if (value === null || value === undefined) return { type: 'null' };
  if (Buffer.isBuffer(value)) {
    return {
      type: 'blob',
      bytes: value.length,
      sha256: crypto.createHash('sha256').update(value).digest('hex'),
    };
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { type: 'number', value: 'NaN' };
    if (value === Infinity) return { type: 'number', value: 'Infinity' };
    if (value === -Infinity) return { type: 'number', value: '-Infinity' };
    if (Object.is(value, -0)) return { type: 'number', value: '-0' };
    return { type: 'number', value };
  }
  if (typeof value === 'bigint') return { type: 'bigint', value: value.toString() };
  return { type: typeof value, value: String(value) };
}

function canonicalRow(row, columns) {
  const result = {};
  for (const column of columns) result[column] = canonicalValue(row[column]);
  return result;
}

function combinedHash(hashes) {
  const digest = crypto.createHash('sha256');
  for (const hash of hashes.sort()) digest.update(hash, 'ascii').update('\n', 'ascii');
  return digest.digest('hex');
}

function inventoryTable(db, name, includeRowHashes) {
  const escaped = quoteIdentifier(name);
  const columns = db.prepare(`PRAGMA table_info(${escaped})`).all()
    .map(column => ({
      position: Number(column.cid),
      name: String(column.name),
      type: String(column.type || ''),
      notNull: Boolean(column.notnull),
      primaryKeyPosition: Number(column.pk || 0),
    }))
    .sort((left, right) => left.position - right.position);
  const columnNames = columns.map(column => column.name);
  const primaryKeyColumns = columns
    .filter(column => column.primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition)
    .map(column => column.name);
  const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${escaped})`).all().map(row => ({
    id: Number(row.id),
    sequence: Number(row.seq),
    targetTable: String(row.table),
    from: String(row.from),
    to: row.to === null ? null : String(row.to),
    onUpdate: String(row.on_update),
    onDelete: String(row.on_delete),
  })).sort((left, right) => left.id - right.id || left.sequence - right.sequence);
  const rowCount = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${escaped}`).get().count);
  const report = { rowCount, primaryKeyColumns, columns, foreignKeys };
  if (!includeRowHashes) return report;

  const rowHashes = [];
  const primaryKeyHashes = [];
  const statement = db.prepare(`SELECT * FROM ${escaped}`);
  for (const row of statement.iterate()) {
    rowHashes.push(sha256Text(canonicalJson(canonicalRow(row, columnNames))));
    if (primaryKeyColumns.length) {
      primaryKeyHashes.push(sha256Text(canonicalJson(canonicalRow(row, primaryKeyColumns))));
    }
  }
  report.canonicalRowsHash = combinedHash(rowHashes);
  report.primaryKeySetHash = primaryKeyColumns.length ? combinedHash(primaryKeyHashes) : null;
  return report;
}

function inventorySqlite({ dbPath, includeRowHashes = false } = {}) {
  const source = path.resolve(String(dbPath || ''));
  if (!dbPath || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw inventoryError('MIGRATION_SQLITE_SOURCE_MISSING');
  }

  let db;
  try {
    db = new Database(source, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    const quickCheck = db.pragma('quick_check', { simple: true });
    if (quickCheck !== 'ok') throw inventoryError('MIGRATION_SQLITE_INTEGRITY_FAILED');
    const foreignKeyCheckCount = db.pragma('foreign_key_check').length;
    const objects = db.prepare(`SELECT type,name,tbl_name AS tableName
      FROM sqlite_master
      WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%'
      ORDER BY type,name`).all();
    const tableNames = objects.filter(row => row.type === 'table').map(row => String(row.name)).sort();
    const tables = {};
    for (const tableName of tableNames) tables[tableName] = inventoryTable(db, tableName, includeRowHashes);
    const indexes = objects.filter(row => row.type === 'index').map(row => ({
      name: String(row.name),
      tableName: String(row.tableName),
    }));
    const triggers = objects.filter(row => row.type === 'trigger').map(row => ({
      name: String(row.name),
      tableName: String(row.tableName),
    }));
    const baseReport = {
      schemaVersion: 1,
      quickCheck,
      foreignKeyCheckCount,
      tableCount: tableNames.length,
      tables,
      indexes,
      triggers,
    };
    return Object.freeze({
      ...baseReport,
      inventoryHash: sha256Text(canonicalJson(baseReport)),
    });
  } catch (error) {
    if (error && String(error.code || '').startsWith('MIGRATION_SQLITE_')) throw error;
    throw inventoryError('MIGRATION_SQLITE_OPEN_FAILED', error);
  } finally {
    if (db) db.close();
  }
}

module.exports = { inventorySqlite };
