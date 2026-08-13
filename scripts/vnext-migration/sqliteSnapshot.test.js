'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createSqliteSnapshot, verifySqliteSnapshot } = require('./sqliteSnapshot');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

(async () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-vnext-snapshot-source-'));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-vnext-snapshot-output-'));
  let writer;
  try {
    const sourcePath = path.join(sourceRoot, 'source.sqlite');
    writer = new Database(sourcePath);
    writer.pragma('journal_mode = WAL');
    writer.pragma('wal_autocheckpoint = 0');
    writer.exec('CREATE TABLE records(id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE INDEX records_value_idx ON records(value);');
    writer.prepare('INSERT INTO records(id,value) VALUES(?,?)').run('r1', 'before');
    let postWriterState = null;

    const snapshotPath = path.join(outputRoot, 'snapshot.sqlite');
    let wroteDuringBackup = false;
    const result = await createSqliteSnapshot({
      sourcePath,
      snapshotPath,
      testHooks: {
        onBackupProgress() {
          if (wroteDuringBackup) return;
          writer.prepare('INSERT INTO records(id,value) VALUES(?,?)').run('r2', 'during');
          wroteDuringBackup = true;
          postWriterState = {
            db: sha256(sourcePath),
            wal: sha256(`${sourcePath}-wal`),
            shmBytes: fs.statSync(`${sourcePath}-shm`).size,
          };
        },
      },
    });

    assert.strictEqual(wroteDuringBackup, true);
    assert.ok(fs.existsSync(snapshotPath));
    assert.ok(!fs.existsSync(`${snapshotPath}.partial`));
    assert.match(result.snapshotHash, /^[a-f0-9]{64}$/);
    assert.strictEqual(result.quickCheck, 'ok');
    assert.strictEqual(result.foreignKeyCheckCount, 0);
    assert.ok([1, 2].includes(result.tableRowCount));
    assert.deepStrictEqual({
      db: sha256(sourcePath),
      wal: sha256(`${sourcePath}-wal`),
      shmBytes: fs.statSync(`${sourcePath}-shm`).size,
    }, postWriterState, 'after the concurrent writer returns, online backup must not change DB/WAL or resize SHM');

    const verified = verifySqliteSnapshot({ snapshotPath, expectedSnapshotHash: result.snapshotHash });
    assert.strictEqual(verified.inventoryHash, result.inventoryHash);
    assert.strictEqual(verified.tableRowCount, result.tableRowCount);

    const staticSourcePath = path.join(sourceRoot, 'static.sqlite');
    const staticDb = new Database(staticSourcePath);
    staticDb.exec('CREATE TABLE stable(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO stable(value) VALUES (\'unchanged\')');
    staticDb.close();
    const staticBefore = sha256(staticSourcePath);
    await createSqliteSnapshot({
      sourcePath: staticSourcePath,
      snapshotPath: path.join(outputRoot, 'static-snapshot.sqlite'),
    });
    assert.strictEqual(sha256(staticSourcePath), staticBefore, 'snapshot must not mutate a quiet source');

    assert.throws(
      () => verifySqliteSnapshot({ snapshotPath, expectedSnapshotHash: '0'.repeat(64) }),
      error => error && error.code === 'MIGRATION_SNAPSHOT_HASH_MISMATCH',
    );
    await assert.rejects(
      () => createSqliteSnapshot({ sourcePath, snapshotPath }),
      error => error && error.code === 'MIGRATION_SNAPSHOT_ALREADY_EXISTS',
    );
    await assert.rejects(
      () => createSqliteSnapshot({ sourcePath, snapshotPath: path.join(sourceRoot, 'overlap.sqlite') }),
      error => error && error.code === 'MIGRATION_OUTPUT_OVERLAPS_SOURCE',
    );
    await assert.rejects(
      () => createSqliteSnapshot({
        sourcePath,
        snapshotPath: path.join(outputRoot, 'no-space.sqlite'),
        minimumFreeBytes: Number.MAX_SAFE_INTEGER,
      }),
      error => error && error.code === 'MIGRATION_SNAPSHOT_INSUFFICIENT_SPACE',
    );

    const interruptedPath = path.join(outputRoot, 'interrupted.sqlite');
    fs.writeFileSync(`${interruptedPath}.partial`, 'evidence', 'utf8');
    await assert.rejects(
      () => createSqliteSnapshot({ sourcePath, snapshotPath: interruptedPath }),
      error => error && error.code === 'MIGRATION_SNAPSHOT_PARTIAL_EXISTS',
    );
    assert.strictEqual(fs.readFileSync(`${interruptedPath}.partial`, 'utf8'), 'evidence');

    console.log('recoverable SQLite snapshot checks passed');
  } finally {
    if (writer) writer.close();
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
