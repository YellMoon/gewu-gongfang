'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { inventoryFiles } = require('./fileInventory');

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-vnext-file-inventory-'));
  try {
    const nestedName = '\u7ae0\u8282\u4e00';
    const firstName = '\u9898\u56fe.png';
    const duplicateName = '\u9898\u56fe\u526f\u672c.PNG';
    const emptyName = '\u7a7a\u767d.txt';
    const nested = path.join(root, nestedName);
    fs.mkdirSync(nested, { recursive: true });
    const first = path.join(root, firstName);
    const duplicate = path.join(nested, duplicateName);
    const empty = path.join(nested, emptyName);
    fs.writeFileSync(first, Buffer.from([1, 2, 3, 4]));
    fs.writeFileSync(duplicate, Buffer.from([1, 2, 3, 4]));
    fs.writeFileSync(empty, Buffer.alloc(0));

    let symlinkCreated = false;
    const symlink = path.join(root, 'outside-link');
    try {
      fs.symlinkSync(os.tmpdir(), symlink, 'junction');
      symlinkCreated = true;
    } catch (_) {
      symlinkCreated = false;
    }

    const before = [first, duplicate, empty].map(filePath => ({
      hash: hashFile(filePath), bytes: fs.statSync(filePath).size, mtimeMs: fs.statSync(filePath).mtimeMs,
    }));
    const report = await inventoryFiles({ root, maxFiles: 10, maxBytes: 1024 });
    const after = [first, duplicate, empty].map(filePath => ({
      hash: hashFile(filePath), bytes: fs.statSync(filePath).size, mtimeMs: fs.statSync(filePath).mtimeMs,
    }));

    assert.strictEqual(report.fileCount, 3);
    assert.strictEqual(report.totalBytes, 8);
    assert.deepStrictEqual(before, after);
    assert.deepStrictEqual(report.files.map(file => file.extension).sort(), ['.png', '.png', '.txt']);
    assert.ok(report.files.every(file => /^[a-f0-9]{64}$/.test(file.relativePathHash)));
    assert.ok(report.files.every(file => /^[a-f0-9]{64}$/.test(file.contentHash)));
    assert.strictEqual(report.duplicateContentGroups.length, 1);
    assert.strictEqual(report.duplicateContentGroups[0].count, 2);
    assert.strictEqual(report.duplicateContentGroups[0].bytesEach, 4);
    assert.strictEqual(report.unresolved.some(item => item.code === 'MIGRATION_FILE_REPARSE_POINT_SKIPPED'), symlinkCreated);
    assert.match(report.inventoryHash, /^[a-f0-9]{64}$/);

    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes(root));
    assert.ok(!serialized.includes(firstName));
    assert.ok(!serialized.includes(nestedName));

    const repeated = await inventoryFiles({ root, maxFiles: 10, maxBytes: 1024 });
    assert.strictEqual(repeated.inventoryHash, report.inventoryHash);
    const raceRoot = path.join(root, 'race-root');
    const raceNested = path.join(raceRoot, 'nested');
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-vnext-outside-'));
    fs.mkdirSync(raceNested, { recursive: true });
    fs.writeFileSync(path.join(raceNested, 'inside.txt'), 'inside', 'utf8');
    fs.writeFileSync(path.join(outsideRoot, 'outside.txt'), 'outside', 'utf8');
    let raceCreated = false;
    try {
      await assert.rejects(
        () => inventoryFiles({
          root: raceRoot,
          maxFiles: 10,
          maxBytes: 1024,
          testHooks: {
            afterDirectoryQueued(relativePath) {
              if (relativePath !== 'nested' || raceCreated) return;
              fs.rmSync(raceNested, { recursive: true });
              fs.symlinkSync(outsideRoot, raceNested, 'junction');
              raceCreated = true;
            },
          },
        }),
        error => error && error.code === 'MIGRATION_FILE_BOUNDARY_VIOLATION',
      );
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
    await assert.rejects(() => inventoryFiles({ root, maxFiles: 2, maxBytes: 1024 }),
      error => error && error.code === 'MIGRATION_FILE_COUNT_LIMIT_EXCEEDED');
    await assert.rejects(() => inventoryFiles({ root, maxFiles: 10, maxBytes: 7 }),
      error => error && error.code === 'MIGRATION_FILE_BYTES_LIMIT_EXCEEDED');
    await assert.rejects(() => inventoryFiles({ root: path.join(root, 'missing') }),
      error => error && error.code === 'MIGRATION_FILE_ROOT_MISSING');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('file migration inventory checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
