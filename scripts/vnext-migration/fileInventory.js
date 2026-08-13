'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalJson } = require('../../shared/migrationBundleProtocol');

function fileError(code) {
  return Object.assign(new Error(code), { code });
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const digest = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(digest.digest('hex')));
  });
}

function safeExtension(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(extension) ? extension : '';
}

function comparablePath(value) {
  const normalized = path.normalize(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isWithinRoot(root, candidate) {
  const rootPath = comparablePath(root);
  const candidatePath = comparablePath(candidate);
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

function assertEntryBoundary(sourceRoot, absolutePath) {
  const metadata = fs.lstatSync(absolutePath);
  if (metadata.isSymbolicLink()) throw fileError('MIGRATION_FILE_BOUNDARY_VIOLATION');
  const realPath = fs.realpathSync(absolutePath);
  if (!isWithinRoot(sourceRoot, realPath)) throw fileError('MIGRATION_FILE_BOUNDARY_VIOLATION');
  return { metadata, realPath };
}

async function inventoryFiles({ root, maxFiles = 100000, maxBytes = 1024 ** 4, testHooks = {} } = {}) {
  const sourceRoot = path.resolve(String(root || ''));
  if (!root || !fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw fileError('MIGRATION_FILE_ROOT_MISSING');
  }
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) throw fileError('MIGRATION_FILE_COUNT_LIMIT_INVALID');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw fileError('MIGRATION_FILE_BYTES_LIMIT_INVALID');
  const realSourceRoot = fs.realpathSync(sourceRoot);

  const candidates = [];
  const unresolved = [];
  const queue = [''];
  while (queue.length) {
    const relativeDirectory = queue.shift();
    const absoluteDirectory = path.join(sourceRoot, relativeDirectory);
    assertEntryBoundary(realSourceRoot, absoluteDirectory);
    const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      const absolutePath = path.join(sourceRoot, relativePath);
      if (entry.isSymbolicLink()) {
        unresolved.push({
          code: 'MIGRATION_FILE_REPARSE_POINT_SKIPPED',
          relativePathHash: sha256Text(relativePath.replace(/\\/g, '/')),
        });
        continue;
      }
      if (entry.isDirectory()) {
        queue.push(relativePath);
        if (typeof testHooks.afterDirectoryQueued === 'function') testHooks.afterDirectoryQueued(relativePath);
        continue;
      }
      if (!entry.isFile()) {
        unresolved.push({
          code: 'MIGRATION_FILE_UNSUPPORTED_ENTRY_SKIPPED',
          relativePathHash: sha256Text(relativePath.replace(/\\/g, '/')),
        });
        continue;
      }
      candidates.push({ relativePath, absolutePath });
      if (candidates.length > maxFiles) throw fileError('MIGRATION_FILE_COUNT_LIMIT_EXCEEDED');
    }
  }

  candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const files = [];
  let totalBytes = 0;
  for (const candidate of candidates) {
    const opened = assertEntryBoundary(realSourceRoot, candidate.absolutePath);
    if (!opened.metadata.isFile()) throw fileError('MIGRATION_FILE_BOUNDARY_VIOLATION');
    const before = fs.statSync(opened.realPath);
    totalBytes += before.size;
    if (totalBytes > maxBytes) throw fileError('MIGRATION_FILE_BYTES_LIMIT_EXCEEDED');
    const contentHash = await hashFile(opened.realPath);
    const afterBoundary = assertEntryBoundary(realSourceRoot, candidate.absolutePath);
    if (afterBoundary.realPath !== opened.realPath) throw fileError('MIGRATION_FILE_BOUNDARY_VIOLATION');
    const after = fs.statSync(afterBoundary.realPath);
    const relative = candidate.relativePath.replace(/\\/g, '/');
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      unresolved.push({ code: 'MIGRATION_FILE_CHANGED_DURING_SCAN', relativePathHash: sha256Text(relative) });
      continue;
    }
    files.push({
      relativePathHash: sha256Text(relative),
      extension: safeExtension(relative),
      bytes: after.size,
      mtimeMs: after.mtimeMs,
      contentHash,
    });
  }

  files.sort((left, right) => left.relativePathHash.localeCompare(right.relativePathHash));
  unresolved.sort((left, right) => left.relativePathHash.localeCompare(right.relativePathHash));
  const contentGroups = new Map();
  for (const file of files) {
    const key = `${file.contentHash}:${file.bytes}`;
    const group = contentGroups.get(key) || [];
    group.push(file.relativePathHash);
    contentGroups.set(key, group);
  }
  const duplicateContentGroups = [...contentGroups.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([key, paths]) => {
      const separator = key.lastIndexOf(':');
      return {
        contentHash: key.slice(0, separator),
        bytesEach: Number(key.slice(separator + 1)),
        count: paths.length,
        relativePathHashes: paths.sort(),
      };
    }).sort((left, right) => left.contentHash.localeCompare(right.contentHash));
  const baseReport = {
    schemaVersion: 1,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
    duplicateContentGroups,
    unresolved,
  };
  return Object.freeze({ ...baseReport, inventoryHash: sha256Text(canonicalJson(baseReport)) });
}

module.exports = { inventoryFiles };
