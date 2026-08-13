'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  canonicalJson,
  validateLedgerEntry,
  validateManifest,
} = require('../../shared/migrationBundleProtocol');

const PAYLOAD_FILES = Object.freeze([
  'manifest.json',
  'reports/inventory.json',
  'reports/migration-ledger.json',
  'reports/unresolved.json',
]);

function bundleError(code, cause) {
  return Object.assign(new Error(code), { code, cause });
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function canonicalBuffer(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
}

function readJson(filePath, invalidCode) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw bundleError(invalidCode, error);
  }
}

function ensureDirectory(value, code) {
  const resolved = path.resolve(String(value || ''));
  if (!value || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw bundleError(code);
  }
  return resolved;
}

function verifyInventoryBundle({ bundlePath } = {}) {
  const root = ensureDirectory(bundlePath, 'MIGRATION_BUNDLE_MISSING');
  const manifest = validateManifest(readJson(path.join(root, 'manifest.json'), 'MIGRATION_BUNDLE_MANIFEST_INVALID'));
  const checksumPath = path.join(root, 'checksums', 'sha256sums.json');
  const checksumDocument = readJson(checksumPath, 'MIGRATION_BUNDLE_CHECKSUMS_INVALID');
  if (!checksumDocument || checksumDocument.algorithm !== 'sha256'
    || !checksumDocument.files || typeof checksumDocument.files !== 'object') {
    throw bundleError('MIGRATION_BUNDLE_CHECKSUMS_INVALID');
  }
  const names = Object.keys(checksumDocument.files).sort();
  if (canonicalJson(names) !== canonicalJson([...PAYLOAD_FILES].sort())) {
    throw bundleError('MIGRATION_BUNDLE_CHECKSUMS_INVALID');
  }

  const verifiedFiles = {};
  for (const relativePath of PAYLOAD_FILES) {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw bundleError('MIGRATION_BUNDLE_FILE_MISSING');
    }
    const buffer = fs.readFileSync(absolutePath);
    const actual = sha256Buffer(buffer);
    if (actual !== checksumDocument.files[relativePath]) {
      throw bundleError('MIGRATION_BUNDLE_CHECKSUM_MISMATCH');
    }
    verifiedFiles[relativePath] = actual;
  }
  const bundleHash = sha256Buffer(canonicalBuffer({ files: verifiedFiles }));
  if (checksumDocument.bundleHash !== bundleHash) {
    throw bundleError('MIGRATION_BUNDLE_CHECKSUM_MISMATCH');
  }
  return Object.freeze({
    bundleId: manifest.bundleId,
    bundleHash,
    fileCount: PAYLOAD_FILES.length,
  });
}

function writeInventoryBundle({ bundlePath, manifest, inventory, ledger, unresolved } = {}) {
  const finalPath = path.resolve(String(bundlePath || ''));
  if (!bundlePath) throw bundleError('MIGRATION_BUNDLE_PATH_REQUIRED');
  const partialPath = `${finalPath}.partial`;
  if (fs.existsSync(finalPath)) throw bundleError('MIGRATION_BUNDLE_ALREADY_EXISTS');
  if (fs.existsSync(partialPath)) throw bundleError('MIGRATION_BUNDLE_PARTIAL_EXISTS');
  const parent = path.dirname(finalPath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw bundleError('MIGRATION_BUNDLE_PARENT_MISSING');
  }

  const validatedManifest = validateManifest(manifest);
  if (!Array.isArray(ledger)) throw bundleError('MIGRATION_BUNDLE_LEDGER_INVALID');
  const validatedLedger = ledger.map(validateLedgerEntry);
  if (!Array.isArray(unresolved)) throw bundleError('MIGRATION_BUNDLE_UNRESOLVED_INVALID');
  const payloads = {
    'manifest.json': validatedManifest,
    'reports/inventory.json': inventory || {},
    'reports/migration-ledger.json': validatedLedger,
    'reports/unresolved.json': unresolved,
  };

  let renamed = false;
  try {
    fs.mkdirSync(path.join(partialPath, 'reports'), { recursive: true });
    fs.mkdirSync(path.join(partialPath, 'checksums'));
    const hashes = {};
    for (const relativePath of PAYLOAD_FILES) {
      const buffer = canonicalBuffer(payloads[relativePath]);
      const absolutePath = path.join(partialPath, ...relativePath.split('/'));
      fs.writeFileSync(absolutePath, buffer, { flag: 'wx' });
      const readBack = fs.readFileSync(absolutePath);
      if (!readBack.equals(buffer)) throw bundleError('MIGRATION_BUNDLE_READBACK_FAILED');
      hashes[relativePath] = sha256Buffer(readBack);
    }
    const bundleHash = sha256Buffer(canonicalBuffer({ files: hashes }));
    const checksums = { schemaVersion: 1, algorithm: 'sha256', files: hashes, bundleHash };
    fs.writeFileSync(
      path.join(partialPath, 'checksums', 'sha256sums.json'),
      canonicalBuffer(checksums),
      { flag: 'wx' },
    );
    verifyInventoryBundle({ bundlePath: partialPath });
    fs.renameSync(partialPath, finalPath);
    renamed = true;
    return verifyInventoryBundle({ bundlePath: finalPath });
  } catch (error) {
    if (error && String(error.code || '').startsWith('MIGRATION_')) throw error;
    throw bundleError('MIGRATION_BUNDLE_WRITE_FAILED', error);
  } finally {
    if (!renamed && fs.existsSync(partialPath)) {
      try {
        fs.writeFileSync(path.join(partialPath, 'FAILED'), 'incomplete\n', { encoding: 'utf8', flag: 'wx' });
      } catch (_) {
        // Preserve the partial directory as evidence; never overwrite it.
      }
    }
  }
}

module.exports = { verifyInventoryBundle, writeInventoryBundle };
