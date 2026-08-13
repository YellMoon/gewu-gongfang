'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { inventorySqlite } = require('./sqliteInventory');

function hashFile(filePath) {
  return fs.existsSync(filePath)
    ? crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
    : null;
}

function sourceState(dbPath) {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map(filePath => ({
    suffix: filePath.slice(dbPath.length),
    exists: fs.existsSync(filePath),
    bytes: fs.existsSync(filePath) ? fs.statSync(filePath).size : null,
    mtimeMs: fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : null,
    hash: hashFile(filePath),
  }));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-vnext-sqlite-inventory-'));
let db;
try {
  const dbPath = path.join(root, '格物数据库.sqlite');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 0');
  db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT NOT NULL, payload BLOB);
    CREATE TABLE students(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), balance REAL NOT NULL);
    CREATE TABLE audit_without_pk(event TEXT NOT NULL, value INTEGER NOT NULL);
    CREATE INDEX idx_students_user ON students(user_id);
    CREATE TRIGGER trg_students_insert AFTER INSERT ON students BEGIN
      INSERT INTO audit_without_pk(event,value) VALUES('student-created',NEW.balance);
    END;
  `);
  db.prepare('INSERT INTO users(id,name,payload) VALUES(?,?,?)').run('u2', '老师乙', Buffer.from([1, 2, 3]));
  db.prepare('INSERT INTO users(id,name,payload) VALUES(?,?,?)').run('u1', '老师甲', Buffer.from('private-payload'));
  db.prepare('INSERT INTO students(id,user_id,balance) VALUES(?,?,?)').run('s1', 'u1', 123.5);

  const before = sourceState(dbPath);
  const report = inventorySqlite({ dbPath, includeRowHashes: true });
  const after = sourceState(dbPath);

  assert.strictEqual(report.quickCheck, 'ok');
  assert.strictEqual(report.foreignKeyCheckCount, 0);
  assert.strictEqual(report.tables.users.rowCount, 2);
  assert.strictEqual(report.tables.students.rowCount, 1);
  assert.strictEqual(report.tables.audit_without_pk.rowCount, 1);
  assert.deepStrictEqual(report.tables.users.primaryKeyColumns, ['id']);
  assert.deepStrictEqual(report.tables.audit_without_pk.primaryKeyColumns, []);
  assert.match(report.tables.users.primaryKeySetHash, /^[a-f0-9]{64}$/);
  assert.match(report.tables.users.canonicalRowsHash, /^[a-f0-9]{64}$/);
  assert.match(report.tables.audit_without_pk.canonicalRowsHash, /^[a-f0-9]{64}$/);
  assert.strictEqual(report.indexes.some(index => index.name === 'idx_students_user'), true);
  assert.strictEqual(report.triggers.some(trigger => trigger.name === 'trg_students_insert'), true);
  assert.strictEqual(report.tables.users.columns.find(column => column.name === 'payload').type, 'BLOB');
  assert.deepStrictEqual(
    before.filter(row => row.suffix !== '-shm'),
    after.filter(row => row.suffix !== '-shm'),
    'read-only inventory must not mutate DB or WAL bytes/mtimes',
  );
  const shmBefore = before.find(row => row.suffix === '-shm');
  const shmAfter = after.find(row => row.suffix === '-shm');
  assert.deepStrictEqual(
    { exists: shmAfter.exists, bytes: shmAfter.bytes, mtimeMs: shmAfter.mtimeMs },
    { exists: shmBefore.exists, bytes: shmBefore.bytes, mtimeMs: shmBefore.mtimeMs },
    'SQLite may update transient SHM lock bytes during a read, but must not create, delete, resize, or retime it',
  );

  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes('老师甲'));
  assert.ok(!serialized.includes('老师乙'));
  assert.ok(!serialized.includes('private-payload'));
  assert.ok(!serialized.includes(dbPath));

  const repeated = inventorySqlite({ dbPath, includeRowHashes: true });
  assert.strictEqual(repeated.inventoryHash, report.inventoryHash);
  assert.strictEqual(repeated.tables.users.canonicalRowsHash, report.tables.users.canonicalRowsHash);

  db.close();
  db = null;

  const corruptPath = path.join(root, 'corrupt.sqlite');
  fs.writeFileSync(corruptPath, 'not-a-sqlite-database', 'utf8');
  assert.throws(
    () => inventorySqlite({ dbPath: corruptPath }),
    error => error && error.code === 'MIGRATION_SQLITE_OPEN_FAILED',
  );
  assert.throws(
    () => inventorySqlite({ dbPath: path.join(root, 'missing.sqlite') }),
    error => error && error.code === 'MIGRATION_SQLITE_SOURCE_MISSING',
  );
} finally {
  if (db) db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('SQLite migration inventory checks passed');
