'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assertDisjointPaths,
  assertSafeOutputRoot,
  resolveExistingDirectory,
  resolveExistingFile,
  summarizePath,
} = require('./pathSafety');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-vnext-path-safety-'));
try {
  const source = path.join(root, '格物数据');
  const nested = path.join(source, 'nested');
  const sourceFile = path.join(source, 'scheduling.db');
  const output = path.join(root, 'migration-output');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(sourceFile, 'fixture', 'utf8');

  assert.strictEqual(resolveExistingDirectory(source), fs.realpathSync(source));
  assert.strictEqual(resolveExistingFile(sourceFile), fs.realpathSync(sourceFile));
  assert.throws(
    () => resolveExistingDirectory(path.join(root, 'missing')),
    error => error && error.code === 'MIGRATION_SOURCE_DIRECTORY_MISSING',
  );
  assert.throws(
    () => resolveExistingFile(path.join(root, 'missing.db')),
    error => error && error.code === 'MIGRATION_SOURCE_FILE_MISSING',
  );
  assert.throws(
    () => resolveExistingFile(source),
    error => error && error.code === 'MIGRATION_SOURCE_FILE_REQUIRED',
  );

  assert.throws(
    () => assertDisjointPaths({ sources: [source], output: source }),
    error => error && error.code === 'MIGRATION_OUTPUT_OVERLAPS_SOURCE',
  );
  assert.throws(
    () => assertDisjointPaths({ sources: [source], output: nested }),
    error => error && error.code === 'MIGRATION_OUTPUT_OVERLAPS_SOURCE',
  );
  assert.throws(
    () => assertDisjointPaths({ sources: [nested], output: source }),
    error => error && error.code === 'MIGRATION_OUTPUT_OVERLAPS_SOURCE',
  );
  assert.deepStrictEqual(assertDisjointPaths({ sources: [source], output }), {
    sources: [fs.realpathSync(source)],
    output: path.resolve(output),
  });

  const caseVariant = source.toUpperCase();
  if (process.platform === 'win32') {
    assert.throws(
      () => assertDisjointPaths({ sources: [source], output: caseVariant }),
      error => error && error.code === 'MIGRATION_OUTPUT_OVERLAPS_SOURCE',
    );
  }

  assert.throws(
    () => assertSafeOutputRoot(path.parse(root).root),
    error => error && error.code === 'MIGRATION_OUTPUT_ROOT_FORBIDDEN',
  );
  assert.throws(
    () => assertSafeOutputRoot(root),
    error => error && error.code === 'MIGRATION_OUTPUT_ALREADY_EXISTS',
  );
  assert.strictEqual(assertSafeOutputRoot(output), path.resolve(output));

  const junction = path.join(root, 'source-alias');
  let junctionCreated = false;
  try {
    fs.symlinkSync(source, junction, 'junction');
    junctionCreated = true;
  } catch (_) {
    junctionCreated = false;
  }
  if (junctionCreated) {
    assert.throws(
      () => assertSafeOutputRoot(path.join(junction, 'bundle')),
      error => error && error.code === 'MIGRATION_OUTPUT_REPARSE_ANCESTOR',
    );
  }

  const summary = summarizePath(sourceFile, 'authority-db');
  assert.strictEqual(summary.label, 'authority-db');
  assert.match(summary.pathHash, /^[a-f0-9]{64}$/);
  assert.deepStrictEqual(Object.keys(summary).sort(), ['label', 'pathHash']);
  assert.ok(!JSON.stringify(summary).includes('格物数据'));
  assert.ok(!JSON.stringify(summary).includes(root));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('migration path safety checks passed');
