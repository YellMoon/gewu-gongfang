'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { canonicalJson } = require('../../shared/migrationBundleProtocol');
const {
  createSourceRecoveryPackage,
  verifySourceRecoveryPackage,
  restoreSourceRecoveryPackage,
} = require('./sourceRecoveryPackage');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function rehashManifest(manifest) {
  manifest.packageHash = crypto.createHash('sha256').update(canonicalJson({
    schemaVersion: manifest.schemaVersion,
    components: manifest.components,
    files: manifest.files,
  }), 'utf8').digest('hex');
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-source-recovery-'));
  let db;
  try {
    const sourceUserData = path.join(root, 'source-user-data');
    const sourceQuestionRoot = path.join(root, 'source-question-files');
    const outputRoot = path.join(root, 'output');
    const restoreRoot = path.join(root, 'restore');
    fs.mkdirSync(path.join(sourceUserData, 'data'), { recursive: true });
    fs.mkdirSync(sourceQuestionRoot);
    fs.mkdirSync(outputRoot);
    const sourceDb = path.join(sourceUserData, 'data', 'scheduling.db');
    db = new Database(sourceDb);
    db.pragma('journal_mode = WAL');
    db.exec("CREATE TABLE records(id TEXT PRIMARY KEY, value TEXT); INSERT INTO records VALUES('r1','keep');");
    fs.writeFileSync(path.join(sourceUserData, 'gewugongfang.config.json'), '{"safe":true}', 'utf8');
    fs.writeFileSync(path.join(sourceUserData, 'desktop-identity-v2.bin'), 'opaque-legacy-material', 'utf8');
    fs.writeFileSync(path.join(sourceUserData, '本地说明.txt'), 'preserve unicode path', 'utf8');
    fs.mkdirSync(path.join(sourceQuestionRoot, 'nested'));
    const sourceQuestion = path.join(sourceQuestionRoot, 'nested', 'question.bin');
    fs.writeFileSync(sourceQuestion, Buffer.from([1, 2, 3, 4]));
    const packagePath = path.join(outputRoot, 'package');

    await assert.rejects(
      () => createSourceRecoveryPackage({ sourceDb, sourceUserData, sourceQuestionRoot, packagePath }),
      error => error && error.code === 'SOURCE_RECOVERY_EXIT_CONFIRMATION_REQUIRED',
    );

    const result = await createSourceRecoveryPackage({
      sourceDb, sourceUserData, sourceQuestionRoot, packagePath, sourceApplicationExited: true,
    });
    assert.match(result.packageHash, /^[a-f0-9]{64}$/);
    assert.ok(fs.existsSync(path.join(packagePath, 'database', 'scheduling.sqlite')));
    assert.ok(fs.existsSync(path.join(packagePath, 'desktop', 'gewugongfang.config.json')));
    assert.ok(fs.existsSync(path.join(packagePath, 'desktop', '本地说明.txt')));
    assert.ok(fs.existsSync(path.join(packagePath, 'questions', 'nested', 'question.bin')));
    assert.strictEqual(fs.readFileSync(path.join(packagePath, 'desktop', 'desktop-identity-v2.bin'), 'utf8'), 'opaque-legacy-material');
    assert.strictEqual(sha256(path.join(packagePath, 'questions', 'nested', 'question.bin')), sha256(sourceQuestion));
    assert.ok(!fs.existsSync(`${packagePath}.partial`));

    const verified = verifySourceRecoveryPackage({ packagePath });
    assert.strictEqual(verified.packageHash, result.packageHash);
    const manifest = JSON.parse(fs.readFileSync(path.join(packagePath, 'manifest.json'), 'utf8'));
    assert.strictEqual(manifest.schemaVersion, 2);
    assert.strictEqual(manifest.components.questionFiles.provided, true);
    assert.strictEqual(manifest.components.database.restoreRelativePath, 'user-data/data/scheduling.db');
    fs.writeFileSync(path.join(packagePath, 'desktop', 'unexpected.bin'), 'not listed', 'utf8');
    assert.throws(
      () => verifySourceRecoveryPackage({ packagePath }),
      error => error && error.code === 'SOURCE_RECOVERY_UNEXPECTED_FILE',
    );
    fs.unlinkSync(path.join(packagePath, 'desktop', 'unexpected.bin'));
    const originalManifest = fs.readFileSync(path.join(packagePath, 'manifest.json'), 'utf8');
    const malformedManifest = JSON.parse(originalManifest);
    malformedManifest.components.database.tableRowCount = 'not-a-number';
    fs.writeFileSync(path.join(packagePath, 'manifest.json'), JSON.stringify(malformedManifest), 'utf8');
    assert.throws(
      () => verifySourceRecoveryPackage({ packagePath }),
      error => error && error.code === 'SOURCE_RECOVERY_MANIFEST_INVALID',
    );
    fs.writeFileSync(path.join(packagePath, 'manifest.json'), originalManifest, 'utf8');
    const inventoryMismatchManifest = JSON.parse(originalManifest);
    inventoryMismatchManifest.components.database.inventoryHash = '0'.repeat(64);
    rehashManifest(inventoryMismatchManifest);
    fs.writeFileSync(path.join(packagePath, 'manifest.json'), canonicalJson(inventoryMismatchManifest), 'utf8');
    assert.throws(
      () => verifySourceRecoveryPackage({ packagePath }),
      error => error && error.code === 'SOURCE_RECOVERY_SNAPSHOT_INVENTORY_MISMATCH',
    );
    fs.writeFileSync(path.join(packagePath, 'manifest.json'), originalManifest, 'utf8');
    const nonStringDirectoryManifest = JSON.parse(originalManifest);
    nonStringDirectoryManifest.components.desktop.directories = [{}];
    fs.writeFileSync(path.join(packagePath, 'manifest.json'), JSON.stringify(nonStringDirectoryManifest), 'utf8');
    assert.throws(
      () => verifySourceRecoveryPackage({ packagePath }),
      error => error && error.code === 'SOURCE_RECOVERY_MANIFEST_INVALID',
    );
    const absentQuestionMetadataManifest = JSON.parse(originalManifest);
    absentQuestionMetadataManifest.components.questionFiles = { provided: false, directories: [''] };
    fs.writeFileSync(path.join(packagePath, 'manifest.json'), JSON.stringify(absentQuestionMetadataManifest), 'utf8');
    assert.throws(
      () => verifySourceRecoveryPackage({ packagePath }),
      error => error && error.code === 'SOURCE_RECOVERY_MANIFEST_INVALID',
    );
    fs.writeFileSync(path.join(packagePath, 'manifest.json'), originalManifest, 'utf8');
    const restored = restoreSourceRecoveryPackage({ packagePath, restorePath: restoreRoot });
    assert.match(restored.restorePathHash, /^[a-f0-9]{64}$/);
    assert.ok(fs.existsSync(path.join(restoreRoot, 'user-data', 'data', 'scheduling.db')));
    assert.ok(fs.existsSync(path.join(restoreRoot, 'user-data', '本地说明.txt')));
    assert.strictEqual(fs.readFileSync(path.join(restoreRoot, 'question-files', 'nested', 'question.bin')).toString('hex'), '01020304');
    const restoredDb = new Database(path.join(restoreRoot, 'user-data', 'data', 'scheduling.db'), { readonly: true });
    assert.strictEqual(restoredDb.prepare('SELECT value FROM records WHERE id=?').get('r1').value, 'keep');
    restoredDb.close();
    assert.throws(
      () => restoreSourceRecoveryPackage({ packagePath, restorePath: restoreRoot }),
      error => error && error.code === 'SOURCE_RECOVERY_RESTORE_TARGET_EXISTS',
    );
    const toctouRestoreRoot = path.join(root, 'restore-toctou');
    const toctouManifest = JSON.parse(originalManifest);
    toctouManifest.components.database.restoreRelativePath = '../../outside.db';
    const replacementManifestPath = path.join(root, 'replacement-manifest.json');
    const originalManifestPath = path.join(root, 'original-manifest.json');
    fs.writeFileSync(replacementManifestPath, JSON.stringify(toctouManifest), 'utf8');
    const toctou = restoreSourceRecoveryPackage({
      packagePath,
      restorePath: toctouRestoreRoot,
      testHooks: { afterVerification() {
        fs.renameSync(path.join(packagePath, 'manifest.json'), originalManifestPath);
        fs.renameSync(replacementManifestPath, path.join(packagePath, 'manifest.json'));
      } },
    });
    assert.match(toctou.restorePathHash, /^[a-f0-9]{64}$/);
    assert.ok(fs.existsSync(path.join(toctouRestoreRoot, 'user-data', 'data', 'scheduling.db')));
    assert.ok(!fs.existsSync(path.join(root, 'outside.db')));
    fs.renameSync(path.join(packagePath, 'manifest.json'), replacementManifestPath);
    fs.renameSync(originalManifestPath, path.join(packagePath, 'manifest.json'));
    await assert.rejects(
      () => createSourceRecoveryPackage({
        sourceDb, sourceUserData, packagePath: path.join(sourceUserData, 'bad'), sourceApplicationExited: true,
      }),
      error => error && error.code === 'MIGRATION_OUTPUT_OVERLAPS_SOURCE',
    );

    const changedOutput = path.join(outputRoot, 'changed-package');
    await assert.rejects(
      () => createSourceRecoveryPackage({
        sourceDb, sourceUserData, packagePath: changedOutput, sourceApplicationExited: true,
        testHooks: { afterSourceScan() { fs.writeFileSync(path.join(sourceUserData, 'late.txt'), 'late', 'utf8'); } },
      }),
      error => error && error.code === 'SOURCE_RECOVERY_SOURCE_CHANGED',
    );
    assert.ok(fs.existsSync(`${changedOutput}.partial`, 'failed package evidence must be retained'));
    assert.ok(fs.existsSync(path.join(`${changedOutput}.partial`, 'FAILED')));
    const changedDbOutput = path.join(outputRoot, 'changed-db-package');
    await assert.rejects(
      () => createSourceRecoveryPackage({
        sourceDb, sourceUserData, packagePath: changedDbOutput, sourceApplicationExited: true,
        testHooks: { afterSourceScan() { db.prepare("INSERT INTO records VALUES('r2', 'changed')").run(); } },
      }),
      error => error && error.code === 'SOURCE_RECOVERY_SOURCE_CHANGED',
    );
    assert.ok(fs.existsSync(path.join(`${changedDbOutput}.partial`, 'FAILED')));
    const snapshotChangedOutput = path.join(outputRoot, 'snapshot-changed-package');
    await assert.rejects(
      () => createSourceRecoveryPackage({
        sourceDb, sourceUserData, packagePath: snapshotChangedOutput, sourceApplicationExited: true,
        testHooks: { afterSnapshot() { db.prepare("INSERT INTO records VALUES('r3', 'snapshot-changed')").run(); } },
      }),
      error => error && error.code === 'SOURCE_RECOVERY_SOURCE_CHANGED',
    );
    assert.ok(fs.existsSync(path.join(`${snapshotChangedOutput}.partial`, 'FAILED')));

    const emptyQuestionRoot = path.join(root, 'empty-question-files');
    fs.mkdirSync(emptyQuestionRoot);
    const emptyQuestionPackage = path.join(outputRoot, 'empty-question-package');
    const noQuestionPackage = path.join(outputRoot, 'no-question-package');
    await createSourceRecoveryPackage({ sourceDb, sourceUserData, sourceQuestionRoot: emptyQuestionRoot, packagePath: emptyQuestionPackage, sourceApplicationExited: true });
    await createSourceRecoveryPackage({ sourceDb, sourceUserData, packagePath: noQuestionPackage, sourceApplicationExited: true });
    const explicitEmptyManifest = JSON.parse(fs.readFileSync(path.join(emptyQuestionPackage, 'manifest.json'), 'utf8'));
    const noQuestionManifest = JSON.parse(fs.readFileSync(path.join(noQuestionPackage, 'manifest.json'), 'utf8'));
    assert.strictEqual(explicitEmptyManifest.components.questionFiles.provided, true);
    assert.deepStrictEqual(explicitEmptyManifest.components.questionFiles.directories, ['']);
    assert.deepStrictEqual(noQuestionManifest.components.questionFiles, { provided: false });
    const overlapQuestionRoot = path.join(sourceUserData, 'overlap-question-files');
    fs.mkdirSync(overlapQuestionRoot);
    await assert.rejects(
      () => createSourceRecoveryPackage({ sourceDb, sourceUserData, sourceQuestionRoot: overlapQuestionRoot, packagePath: path.join(outputRoot, 'overlap-question-package'), sourceApplicationExited: true }),
      error => error && error.code === 'SOURCE_RECOVERY_SOURCE_OVERLAP',
    );
    const reparseUserData = path.join(root, 'reparse-user-data');
    fs.symlinkSync(sourceUserData, reparseUserData, 'junction');
    await assert.rejects(
      () => createSourceRecoveryPackage({
        sourceDb: path.join(reparseUserData, 'data', 'scheduling.db'), sourceUserData: reparseUserData,
        packagePath: path.join(outputRoot, 'reparse-package'), sourceApplicationExited: true,
      }),
      error => error && error.code === 'SOURCE_RECOVERY_REPARSE_POINT',
    );
  } finally {
    if (db) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('source recovery package checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
