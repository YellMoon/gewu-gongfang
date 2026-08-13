'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalJson } = require('../../shared/migrationBundleProtocol');
const { assertDisjointPaths, assertSafeOutputRoot, resolveExistingDirectory, resolveExistingFile, summarizePath } = require('./pathSafety');
const { createSqliteSnapshot, verifySqliteSnapshot } = require('./sqliteSnapshot');
const { inventorySqlite } = require('./sqliteInventory');

function recoveryError(code, cause) {
  return Object.assign(new Error(code), { code, cause });
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes;
    do {
      bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes) hash.update(buffer.subarray(0, bytes));
    } while (bytes);
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}

function hashObject(value) {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function comparablePath(value) {
  const normalized = path.normalize(path.resolve(value)).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isWithin(root, candidate) {
  const parent = comparablePath(root);
  const child = comparablePath(candidate);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function validateRelativePath(value) {
  const text = String(value || '');
  if (!text || text.includes('\\') || text.startsWith('/') || text.includes('\0')) return false;
  return text.split('/').every(segment => segment && segment !== '.' && segment !== '..');
}

function assertNotReparseRoot(value, code) {
  const resolved = path.resolve(String(value || ''));
  if (!fs.existsSync(resolved) || fs.lstatSync(resolved).isSymbolicLink()) throw recoveryError(code);
}

function assertNoSourceReparseAncestor(value) {
  let current = path.resolve(String(value || ''));
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const root = path.parse(current).root;
  while (true) {
    if (fs.lstatSync(current).isSymbolicLink()) throw recoveryError('SOURCE_RECOVERY_REPARSE_POINT');
    if (comparablePath(current) === comparablePath(root)) break;
    current = path.dirname(current);
  }
}

function assertIndependentSourceRoots({ db, userData, questionRoot }) {
  assertNoSourceReparseAncestor(db);
  assertNoSourceReparseAncestor(userData);
  if (questionRoot) assertNoSourceReparseAncestor(questionRoot);
  assertNotReparseRoot(db, 'SOURCE_RECOVERY_REPARSE_POINT');
  assertNotReparseRoot(userData, 'SOURCE_RECOVERY_REPARSE_POINT');
  if (questionRoot) assertNotReparseRoot(questionRoot, 'SOURCE_RECOVERY_REPARSE_POINT');
  if (questionRoot && (isWithin(userData, questionRoot) || isWithin(questionRoot, userData))) {
    throw recoveryError('SOURCE_RECOVERY_SOURCE_OVERLAP');
  }
  if (!isWithin(userData, db) && questionRoot && isWithin(questionRoot, db)) {
    throw recoveryError('SOURCE_RECOVERY_SOURCE_OVERLAP');
  }
}

function listTree(root, { exclude = new Set() } = {}) {
  const resolvedRoot = resolveExistingDirectory(root);
  const files = [];
  const directories = [];
  const queue = [''];
  while (queue.length) {
    const relativeDirectory = queue.shift();
    const directory = path.join(resolvedRoot, relativeDirectory);
    if (fs.lstatSync(directory).isSymbolicLink()) throw recoveryError('SOURCE_RECOVERY_REPARSE_POINT');
    directories.push(relativeDirectory.replace(/\\/g, '/'));
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      const absolute = path.join(resolvedRoot, relative);
      if (entry.isSymbolicLink()) throw recoveryError('SOURCE_RECOVERY_REPARSE_POINT');
      if (entry.isDirectory()) { queue.push(relative); continue; }
      if (!entry.isFile()) throw recoveryError('SOURCE_RECOVERY_UNSUPPORTED_ENTRY');
      const real = fs.realpathSync(absolute);
      if (!isWithin(resolvedRoot, real)) throw recoveryError('SOURCE_RECOVERY_REPARSE_POINT');
      if (exclude.has(comparablePath(real))) continue;
      const metadata = fs.statSync(real);
      files.push({ relativePath: relative.replace(/\\/g, '/'), bytes: metadata.size, mtimeMs: metadata.mtimeMs, sha256: sha256File(real), absolutePath: real });
    }
  }
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  directories.sort();
  return { root: resolvedRoot, directories, files };
}

function publicTree(tree) {
  return {
    directories: tree.directories,
    files: tree.files.map(({ relativePath, bytes, mtimeMs, sha256 }) => ({ relativePath, bytes, mtimeMs, sha256 })),
  };
}

function assertTreeEquivalent(before, after) {
  if (canonicalJson(publicTree(before)) !== canonicalJson(publicTree(after))) throw recoveryError('SOURCE_RECOVERY_SOURCE_CHANGED');
}

function copyTree(tree, targetRoot, packagePrefix) {
  const records = [];
  for (const relativeDirectory of tree.directories) fs.mkdirSync(path.join(targetRoot, ...relativeDirectory.split('/')), { recursive: true });
  for (const file of tree.files) {
    const now = fs.statSync(file.absolutePath);
    if (now.size !== file.bytes || now.mtimeMs !== file.mtimeMs || sha256File(file.absolutePath) !== file.sha256) {
      throw recoveryError('SOURCE_RECOVERY_SOURCE_CHANGED');
    }
    const destination = path.join(targetRoot, ...file.relativePath.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file.absolutePath, destination, fs.constants.COPYFILE_EXCL);
    if (sha256File(destination) !== file.sha256) throw recoveryError('SOURCE_RECOVERY_COPY_HASH_MISMATCH');
    records.push({ path: `${packagePrefix}/${file.relativePath}`, bytes: file.bytes, sha256: file.sha256 });
  }
  return records;
}

function sqliteSourceFingerprint(db) {
  // The WAL and shared-memory files may legitimately change while a read-only
  // backup runs. Compare the canonical database contents instead, so a real
  // committed write is rejected without treating journal housekeeping as data.
  const report = inventorySqlite({ dbPath: db, includeRowHashes: true });
  return {
    inventoryHash: report.inventoryHash,
    tableCount: report.tableCount,
    tables: Object.fromEntries(Object.entries(report.tables).map(([name, table]) => [name, {
      rowCount: table.rowCount,
      primaryKeySetHash: table.primaryKeySetHash,
      canonicalRowsHash: table.canonicalRowsHash,
    }])),
  };
}

function readManifest(packagePath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(packagePath, 'manifest.json'), 'utf8'));
    if (!manifest || manifest.schemaVersion !== 2 || !manifest.components || !Array.isArray(manifest.files)
      || !/^[a-f0-9]{64}$/.test(String(manifest.packageHash || ''))
      || JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(['components', 'files', 'packageHash', 'schemaVersion'])) throw new Error('invalid');
    return manifest;
  } catch (error) { throw recoveryError('SOURCE_RECOVERY_MANIFEST_INVALID', error); }
}

function assertManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || !manifest.components || typeof manifest.components !== 'object' || Array.isArray(manifest.components)) {
    throw recoveryError('SOURCE_RECOVERY_MANIFEST_INVALID');
  }
  const components = manifest.components;
  const database = components.database;
  const desktop = components.desktop;
  const questionFiles = components.questionFiles;
  if (!database || typeof database !== 'object' || Array.isArray(database)
    || !desktop || typeof desktop !== 'object' || Array.isArray(desktop)
    || !questionFiles || typeof questionFiles !== 'object' || Array.isArray(questionFiles)
    || !/^[a-f0-9]{64}$/.test(String(database.sourcePathHash || ''))
    || !/^[a-f0-9]{64}$/.test(String(database.snapshotHash || ''))
    || !validateRelativePath(database.restoreRelativePath)
    || (!database.restoreRelativePath.startsWith('user-data/') && database.restoreRelativePath !== 'external-database/scheduling.db')
    || !/^[a-f0-9]{64}$/.test(String(database.inventoryHash || ''))
    || !Number.isSafeInteger(database.tableRowCount) || database.tableRowCount < 0
    || !/^[a-f0-9]{64}$/.test(String(desktop.sourcePathHash || ''))
    || !Array.isArray(desktop.directories)
    || typeof questionFiles.provided !== 'boolean'
    || (questionFiles.provided && (!/^[a-f0-9]{64}$/.test(String(questionFiles.sourcePathHash || '')) || !Array.isArray(questionFiles.directories)))
    || (!questionFiles.provided && Object.keys(questionFiles).length !== 1)) {
    throw recoveryError('SOURCE_RECOVERY_MANIFEST_INVALID');
  }
  if (JSON.stringify(Object.keys(components).sort()) !== JSON.stringify(['database', 'desktop', 'questionFiles'])
    || JSON.stringify(Object.keys(database).sort()) !== JSON.stringify(['inventoryHash', 'restoreRelativePath', 'snapshotHash', 'sourcePathHash', 'tableRowCount'])
    || JSON.stringify(Object.keys(desktop).sort()) !== JSON.stringify(['directories', 'sourcePathHash'])
    || (questionFiles.provided && JSON.stringify(Object.keys(questionFiles).sort()) !== JSON.stringify(['directories', 'provided', 'sourcePathHash']))) {
    throw recoveryError('SOURCE_RECOVERY_MANIFEST_INVALID');
  }
  const declaredDirectories = [...desktop.directories, ...(questionFiles.provided ? questionFiles.directories : [])];
  if (declaredDirectories.some(directory => typeof directory !== 'string' || (directory !== '' && !validateRelativePath(directory)))
    || !desktop.directories.includes('')
    || (questionFiles.provided && !questionFiles.directories.includes(''))
    || new Set(desktop.directories).size !== desktop.directories.length
    || (questionFiles.provided && new Set(questionFiles.directories).size !== questionFiles.directories.length)) {
    throw recoveryError('SOURCE_RECOVERY_MANIFEST_INVALID');
  }
  if (!manifest.files.every(file => file && typeof file === 'object' && !Array.isArray(file)
    && JSON.stringify(Object.keys(file).sort()) === JSON.stringify(['bytes', 'path', 'sha256'])
    && typeof file.path === 'string' && typeof file.sha256 === 'string'
    && Number.isSafeInteger(file.bytes) && file.bytes >= 0)) {
    throw recoveryError('SOURCE_RECOVERY_MANIFEST_INVALID');
  }
  const databaseRecord = manifest.files.find(file => file.path === 'database/scheduling.sqlite');
  if (!databaseRecord || databaseRecord.sha256 !== database.snapshotHash) throw recoveryError('SOURCE_RECOVERY_MANIFEST_INVALID');
  if (new Set(manifest.files.map(file => file.path)).size !== manifest.files.length) throw recoveryError('SOURCE_RECOVERY_MANIFEST_INVALID');
  for (const file of manifest.files) {
    if (file.path !== 'database/scheduling.sqlite'
      && !file.path.startsWith('desktop/')
      && !(questionFiles.provided && file.path.startsWith('questions/'))) {
      throw recoveryError('SOURCE_RECOVERY_MANIFEST_INVALID');
    }
  }
}

function freezeManifest(manifest) {
  for (const file of manifest.files) Object.freeze(file);
  Object.freeze(manifest.files);
  Object.freeze(manifest.components.database);
  Object.freeze(manifest.components.desktop.directories);
  Object.freeze(manifest.components.desktop);
  if (manifest.components.questionFiles.provided) Object.freeze(manifest.components.questionFiles.directories);
  Object.freeze(manifest.components.questionFiles);
  Object.freeze(manifest.components);
  return Object.freeze(manifest);
}

function verifySourceRecoveryPackage({ packagePath, includeManifest = false } = {}) {
  const root = resolveExistingDirectory(packagePath);
  const manifest = readManifest(root);
  assertManifestShape(manifest);
  const expectedHash = hashObject({ schemaVersion: manifest.schemaVersion, components: manifest.components, files: manifest.files });
  if (expectedHash !== manifest.packageHash) throw recoveryError('SOURCE_RECOVERY_MANIFEST_HASH_MISMATCH');
  const expectedPaths = new Set(['manifest.json']);
  for (const file of manifest.files) {
    if (!file || !validateRelativePath(file.path) || !/^[a-f0-9]{64}$/.test(String(file.sha256 || ''))
      || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || expectedPaths.has(file.path)) throw recoveryError('SOURCE_RECOVERY_MANIFEST_INVALID');
    expectedPaths.add(file.path);
    const absolute = path.join(root, ...file.path.split('/'));
    if (!isWithin(root, absolute) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw recoveryError('SOURCE_RECOVERY_FILE_MISSING');
    if (fs.statSync(absolute).size !== file.bytes || sha256File(absolute) !== file.sha256) throw recoveryError('SOURCE_RECOVERY_FILE_HASH_MISMATCH');
  }
  const actual = listTree(root).files.map(file => file.relativePath);
  if (actual.length !== expectedPaths.size || actual.some(file => !expectedPaths.has(file))) throw recoveryError('SOURCE_RECOVERY_UNEXPECTED_FILE');
  const actualDirectories = listTree(root).directories;
  const expectedDirectories = [
    '',
    'database',
    'desktop',
    ...manifest.components.desktop.directories.map(directory => directory ? `desktop/${directory}` : 'desktop'),
    ...(manifest.components.questionFiles.provided
      ? ['questions', ...manifest.components.questionFiles.directories.map(directory => directory ? `questions/${directory}` : 'questions')]
      : []),
  ].sort();
  if (canonicalJson(actualDirectories) !== canonicalJson([...new Set(expectedDirectories)].sort())) {
    throw recoveryError('SOURCE_RECOVERY_UNEXPECTED_DIRECTORY');
  }
  const snapshot = verifySqliteSnapshot({ snapshotPath: path.join(root, 'database', 'scheduling.sqlite'), expectedSnapshotHash: manifest.components.database.snapshotHash });
  if (snapshot.inventoryHash !== manifest.components.database.inventoryHash
    || snapshot.tableRowCount !== manifest.components.database.tableRowCount) {
    throw recoveryError('SOURCE_RECOVERY_SNAPSHOT_INVENTORY_MISMATCH');
  }
  const result = { packageHash: manifest.packageHash, fileCount: manifest.files.length, snapshotHash: snapshot.snapshotHash };
  if (includeManifest) result.manifest = freezeManifest(manifest);
  return Object.freeze(result);
}

function sourceDbRestoreRelativePath(db, userData) {
  if (isWithin(userData, db)) return `user-data/${path.relative(userData, db).replace(/\\/g, '/')}`;
  return 'external-database/scheduling.db';
}

async function createSourceRecoveryPackage({ sourceDb, sourceUserData, sourceQuestionRoot, packagePath, sourceApplicationExited, testHooks = {} } = {}) {
  if (sourceApplicationExited !== true) throw recoveryError('SOURCE_RECOVERY_EXIT_CONFIRMATION_REQUIRED');
  assertNotReparseRoot(sourceDb, 'SOURCE_RECOVERY_REPARSE_POINT');
  assertNotReparseRoot(sourceUserData, 'SOURCE_RECOVERY_REPARSE_POINT');
  if (sourceQuestionRoot) assertNotReparseRoot(sourceQuestionRoot, 'SOURCE_RECOVERY_REPARSE_POINT');
  const db = resolveExistingFile(sourceDb);
  const userData = resolveExistingDirectory(sourceUserData);
  const questionRoot = sourceQuestionRoot ? resolveExistingDirectory(sourceQuestionRoot) : null;
  assertIndependentSourceRoots({ db, userData, questionRoot });
  const target = assertSafeOutputRoot(packagePath);
  const sources = [db, userData];
  if (questionRoot) sources.push(questionRoot);
  assertDisjointPaths({ sources, output: target });
  const partial = `${target}.partial`;
  if (fs.existsSync(partial)) throw recoveryError('SOURCE_RECOVERY_PARTIAL_EXISTS');
  const excluded = new Set([comparablePath(db), comparablePath(`${db}-wal`), comparablePath(`${db}-shm`)]);
  const beforeDesktop = listTree(userData, { exclude: excluded });
  const beforeQuestions = questionRoot ? listTree(questionRoot) : null;
  const beforeDb = sqliteSourceFingerprint(db);
  if (typeof testHooks.afterSourceScan === 'function') testHooks.afterSourceScan();
  let complete = false;
  try {
    fs.mkdirSync(partial, { recursive: false });
    fs.mkdirSync(path.join(partial, 'database'));
    const sqlite = await createSqliteSnapshot({ sourcePath: db, snapshotPath: path.join(partial, 'database', 'scheduling.sqlite') });
    if (typeof testHooks.afterSnapshot === 'function') testHooks.afterSnapshot();
    if (beforeDb.inventoryHash !== sqlite.inventoryHash) throw recoveryError('SOURCE_RECOVERY_SOURCE_CHANGED');
    const files = [{ path: 'database/scheduling.sqlite', bytes: fs.statSync(path.join(partial, 'database', 'scheduling.sqlite')).size, sha256: sqlite.snapshotHash }];
    files.push(...copyTree(beforeDesktop, path.join(partial, 'desktop'), 'desktop'));
    if (beforeQuestions) files.push(...copyTree(beforeQuestions, path.join(partial, 'questions'), 'questions'));
    assertTreeEquivalent(beforeDesktop, listTree(userData, { exclude: excluded }));
    if (beforeQuestions) assertTreeEquivalent(beforeQuestions, listTree(questionRoot));
    if (canonicalJson(beforeDb) !== canonicalJson(sqliteSourceFingerprint(db))) throw recoveryError('SOURCE_RECOVERY_SOURCE_CHANGED');
    files.sort((a, b) => a.path.localeCompare(b.path));
    const manifest = {
      schemaVersion: 2,
      components: {
        database: { sourcePathHash: summarizePath(db, 'database').pathHash, snapshotHash: sqlite.snapshotHash, inventoryHash: sqlite.inventoryHash, tableRowCount: sqlite.tableRowCount, restoreRelativePath: sourceDbRestoreRelativePath(db, userData) },
        desktop: { sourcePathHash: summarizePath(userData, 'desktop-user-data').pathHash, directories: beforeDesktop.directories },
        questionFiles: beforeQuestions ? { provided: true, sourcePathHash: summarizePath(questionRoot, 'question-files').pathHash, directories: beforeQuestions.directories } : { provided: false },
      },
      files,
    };
    manifest.packageHash = hashObject({ schemaVersion: manifest.schemaVersion, components: manifest.components, files: manifest.files });
    fs.writeFileSync(path.join(partial, 'manifest.json'), `${canonicalJson(manifest)}\n`, { encoding: 'utf8', flag: 'wx' });
    verifySourceRecoveryPackage({ packagePath: partial });
    fs.renameSync(partial, target);
    complete = true;
    return verifySourceRecoveryPackage({ packagePath: target });
  } catch (error) {
    if (error?.code) throw error;
    throw recoveryError('SOURCE_RECOVERY_CREATE_FAILED', error);
  } finally {
    if (!complete && fs.existsSync(partial)) {
      try { fs.writeFileSync(path.join(partial, 'FAILED'), 'incomplete\n', { encoding: 'utf8', flag: 'wx' }); } catch (_) { /* evidence retained */ }
    }
  }
}

function copyRecordedFile(packageRoot, record, targetRoot, prefix) {
  if (!record.path.startsWith(`${prefix}/`)) return;
  const relative = record.path.slice(prefix.length + 1);
  const source = path.join(packageRoot, ...record.path.split('/'));
  const target = path.join(targetRoot, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  if (fs.statSync(target).size !== record.bytes || sha256File(target) !== record.sha256) {
    throw recoveryError('SOURCE_RECOVERY_RESTORE_COPY_HASH_MISMATCH');
  }
}

function restoreSourceRecoveryPackage({ packagePath, restorePath, testHooks = {} } = {}) {
  const verified = verifySourceRecoveryPackage({ packagePath, includeManifest: true });
  const source = resolveExistingDirectory(packagePath);
  const requested = path.resolve(String(restorePath || ''));
  if (fs.existsSync(requested)) throw recoveryError('SOURCE_RECOVERY_RESTORE_TARGET_EXISTS');
  const target = assertSafeOutputRoot(restorePath);
  assertDisjointPaths({ sources: [source], output: target });
  const partial = `${target}.partial`;
  if (fs.existsSync(partial)) throw recoveryError('SOURCE_RECOVERY_RESTORE_PARTIAL_EXISTS');
  const manifest = verified.manifest;
  let complete = false;
  try {
    if (typeof testHooks.afterVerification === 'function') testHooks.afterVerification();
    fs.mkdirSync(partial, { recursive: false });
    const userData = path.join(partial, 'user-data');
    for (const directory of manifest.components.desktop.directories) fs.mkdirSync(path.join(userData, ...directory.split('/')), { recursive: true });
    for (const record of manifest.files) copyRecordedFile(source, record, userData, 'desktop');
    const dbTarget = path.join(partial, ...manifest.components.database.restoreRelativePath.split('/'));
    fs.mkdirSync(path.dirname(dbTarget), { recursive: true });
    fs.copyFileSync(path.join(source, 'database', 'scheduling.sqlite'), dbTarget, fs.constants.COPYFILE_EXCL);
    if (sha256File(dbTarget) !== manifest.components.database.snapshotHash) {
      throw recoveryError('SOURCE_RECOVERY_RESTORE_COPY_HASH_MISMATCH');
    }
    if (manifest.components.questionFiles.provided) {
      const questions = path.join(partial, 'question-files');
      for (const directory of manifest.components.questionFiles.directories) fs.mkdirSync(path.join(questions, ...directory.split('/')), { recursive: true });
      for (const record of manifest.files) copyRecordedFile(source, record, questions, 'questions');
    }
    verifySqliteSnapshot({ snapshotPath: dbTarget, expectedSnapshotHash: manifest.components.database.snapshotHash });
    fs.renameSync(partial, target);
    complete = true;
    return Object.freeze({ restorePathHash: summarizePath(target, 'restore-target').pathHash, packageHash: verified.packageHash });
  } catch (error) {
    if (error?.code) throw error;
    throw recoveryError('SOURCE_RECOVERY_RESTORE_FAILED', error);
  } finally {
    if (!complete && fs.existsSync(partial)) {
      try { fs.writeFileSync(path.join(partial, 'FAILED'), 'incomplete\n', { encoding: 'utf8', flag: 'wx' }); } catch (_) { /* evidence retained */ }
    }
  }
}

module.exports = { createSourceRecoveryPackage, verifySourceRecoveryPackage, restoreSourceRecoveryPackage };
